import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { listAllNotes, resolveVaultPath, stripFrontmatter } from '@/lib/vault'
import { ollamaEmbed, EMBED_CONTEXT_OVERFLOW } from '@/lib/ollama'
import { getConfig } from '@/lib/config'

const DB_PATH = path.join(process.cwd(), 'data', 'index.sqlite')

export type RetrievedChunk = {
  notePath: string
  heading: string
  content: string
  score: number
}

// Bump when the way chunks are turned into vectors changes (prefix rules,
// normalization, chunk headers) — like a model change, it makes stored vectors
// incomparable and triggers a full re-embed. v3: breadcrumb chunk headers.
const EMBED_SCHEME = 'v3'

// Search-tuned embedders are trained with distinct query/document prefixes and
// lose a lot of accuracy without them. The prefix is applied at embed time only;
// stored chunk text stays clean. Unknown models get no prefix (symmetric).
export function embedPrefixes(model: string): { query: string; doc: string } {
  const m = model.toLowerCase()
  if (m.includes('nomic-embed')) return { query: 'search_query: ', doc: 'search_document: ' }
  if (m.includes('qwen3-embedding')) {
    return { query: 'Instruct: Given a question, retrieve passages from a personal knowledge base that answer it\nQuery: ', doc: '' }
  }
  if (m.includes('embeddinggemma')) return { query: 'task: search result | query: ', doc: 'title: none | text: ' }
  if (m.includes('mxbai-embed')) return { query: 'Represent this sentence for searching relevant passages: ', doc: '' }
  if (m.includes('e5')) return { query: 'query: ', doc: 'passage: ' }
  return { query: '', doc: '' }
}

// Identity of the vector space the index lives in. Vectors from a different
// model (or prefix scheme) are not comparable — mixing them silently wrecks
// retrieval — so a mismatch forces a full re-embed (see syncIndex).
export function embedSignature(model = getConfig().embedModel): string {
  return `${model}#${EMBED_SCHEME}`
}

// Vectors are stored L2-normalized as raw float32, so cosine similarity is a dot
// product and nothing is JSON-parsed per query.
export function encodeVector(v: number[]): Buffer {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  const f = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) f[i] = v[i] / norm
  return Buffer.from(f.buffer)
}

export function decodeVector(b: Buffer): Float32Array {
  // Copy into an aligned buffer — SQLite blobs may not be 4-byte aligned.
  const out = new Float32Array(b.byteLength / 4)
  new Uint8Array(out.buffer).set(b)
  return out
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  // v1 stored embeddings as JSON text with no record of the model. Those vectors
  // can't be trusted to match the current model/prefix scheme, so drop them; the
  // next sync re-embeds everything (the signature below is unset).
  const cols = db.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string; type: string }>
  if (cols.some(c => c.name === 'embedding' && c.type.toUpperCase() === 'TEXT')) db.exec('DROP TABLE chunks')
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_path TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_note_path ON chunks(note_path);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- Keyword (BM25) index over the same chunks; rowid = chunks.id. unicode61 with
    -- diacritics folded so "Muller" finds "Müller" and vice versa.
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      title, heading, content, tokenize = 'unicode61 remove_diacritics 2'
    );
  `)
  // Backfill/repair the keyword index if it drifted from the chunks table (e.g. an
  // index created before it existed). Cheap: plain text copy, no embedding.
  const counts = db.prepare('SELECT (SELECT COUNT(*) FROM chunks) AS c, (SELECT COUNT(*) FROM chunks_fts) AS f').get() as { c: number; f: number }
  if (counts.c !== counts.f) {
    db.exec(`DELETE FROM chunks_fts;
      INSERT INTO chunks_fts (rowid, title, heading, content)
        SELECT id, replace(note_path, '.md', ''), heading, content FROM chunks;`)
  }
  return db
}

function clearIndex(database: Database.Database): void {
  database.exec('DELETE FROM chunks; DELETE FROM chunks_fts;')
}

function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setMeta(key: string, value: string): void {
  getDb().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// Module state lives on globalThis: Next can load this module more than once per
// process (per route bundle / HMR), and the lock + cache must be truly shared.
type IndexGlobals = {
  lock: Promise<unknown>
  pending: number // queued + running index jobs
  cache: VectorCache | null
}
type VectorCache = {
  signature: string
  dim: number
  ids: number[]
  rowOf: Map<number, number> // chunk id → row in the arrays below
  notePaths: string[]
  headings: string[]
  contents: string[]
  vecs: Float32Array // n × dim, row-major, normalized
}
const G = ((globalThis as unknown as { __vaultIndex?: IndexGlobals }).__vaultIndex ??= { lock: Promise.resolve(), pending: 0, cache: null })

function invalidateCache() {
  G.cache = null
}

// Serialize every index mutation. The watcher, chat, apply and the scheduler all
// call syncIndex; two overlapping syncs used to both see a note as stale and both
// insert its chunks — duplicating it in retrieval.
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  G.pending++
  const run = G.lock.then(fn, fn).finally(() => { G.pending-- })
  G.lock = run.catch(() => {})
  return run
}

// True while a sync/rebuild is queued or running — interactive callers use the
// current index instead of waiting behind a (possibly full) re-embed.
export function isIndexBusy(): boolean {
  return G.pending > 0
}

function loadCache(): VectorCache {
  const signature = getMeta('signature') ?? ''
  if (G.cache && G.cache.signature === signature) return G.cache
  const rows = getDb().prepare('SELECT id, note_path, heading, content, embedding FROM chunks ORDER BY id').all() as Array<{
    id: number; note_path: string; heading: string; content: string; embedding: Buffer
  }>
  const dim = rows.length ? rows[0].embedding.byteLength / 4 : 0
  const kept = rows.filter(r => r.embedding.byteLength === dim * 4)
  const vecs = new Float32Array(kept.length * dim)
  kept.forEach((r, i) => vecs.set(decodeVector(r.embedding), i * dim))
  G.cache = {
    signature,
    dim,
    ids: kept.map(r => r.id),
    rowOf: new Map(kept.map((r, i) => [r.id, i])),
    notePaths: kept.map(r => r.note_path),
    headings: kept.map(r => r.heading),
    contents: kept.map(r => r.content),
    vecs,
  }
  return G.cache
}

// Refuse to compare a query against vectors from another model/scheme.
function assertIndexMatchesModel(): void {
  const stored = getMeta('signature')
  const current = embedSignature()
  if (stored && stored !== current) {
    throw new Error(
      `The search index was built with "${stored.split('#')[0]}" but the embedding model is now ` +
        `"${current.split('#')[0]}". It is re-indexing in the background — try again in a few minutes.`,
    )
  }
}

// A query vector in the index's space (query prefix applied, L2-normalized).
export async function embedQuery(text: string): Promise<Float32Array> {
  return decodeVector(encodeVector(await ollamaEmbed(embedPrefixes(getConfig().embedModel).query + text)))
}

// Score a query vector against every chunk (dot product of normalized vectors).
function scoreVector(q: Float32Array): { cache: VectorCache; scores: Float32Array } {
  assertIndexMatchesModel()
  const cache = loadCache()
  const n = cache.notePaths.length
  const scores = new Float32Array(n)
  if (q.length !== cache.dim) {
    if (n === 0) return { cache, scores }
    throw new Error(`Embedding size mismatch (query ${q.length}, index ${cache.dim}) — rebuild the index.`)
  }
  const { vecs, dim } = cache
  for (let i = 0; i < n; i++) {
    let dot = 0
    const off = i * dim
    for (let j = 0; j < dim; j++) dot += q[j] * vecs[off + j]
    scores[i] = dot
  }
  return { cache, scores }
}

export type IndexedChunk = { id: number; notePath: string; heading: string; content: string }
export type ScoredId = { id: number; score: number }

function chunkAt(cache: VectorCache, row: number): IndexedChunk {
  return { id: cache.ids[row], notePath: cache.notePaths[row], heading: cache.headings[row], content: cache.contents[row] }
}

export function getChunk(id: number): IndexedChunk | undefined {
  const cache = loadCache()
  const row = cache.rowOf.get(id)
  return row === undefined ? undefined : chunkAt(cache, row)
}

// A note's chunks in document order (ids are assigned in chunk order per note).
export function chunksOfNote(notePath: string): IndexedChunk[] {
  const cache = loadCache()
  const out: IndexedChunk[] = []
  for (let i = 0; i < cache.ids.length; i++) if (cache.notePaths[i] === notePath) out.push(chunkAt(cache, i))
  return out
}

// Semantic ranking: chunk ids by cosine similarity to the query, best first.
export async function denseSearch(query: string, limit = 50): Promise<ScoredId[]> {
  assertIndexMatchesModel()
  return denseSearchVector(await embedQuery(query), limit)
}

// Same ranking for a vector you already have (e.g. a stored feed-item embedding).
export function denseSearchVector(q: Float32Array, limit = 50): ScoredId[] {
  const { cache, scores } = scoreVector(q)
  return Array.from(scores.keys())
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, limit)
    .map(i => ({ id: cache.ids[i], score: scores[i] }))
}

const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be',
  'what', 'who', 'whom', 'whose', 'which', 'when', 'where', 'why', 'how', 'do', 'does', 'did', 'tell',
  'me', 'about', 'i', 'you', 'it', 'its', 'this', 'that', 'these', 'those', 'his', 'her', 'their',
  'they', 'he', 'she', 'we', 'my', 'your', 'with', 'know', 'can', 'please', 'give', 'show', 'have',
  'from', 'any', 'all', 'there', 'has', 'had', 'not', 'but', 'our', 'into', 'than', 'then',
  // German (the vault mixes both)
  'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'oder', 'ist', 'sind', 'war', 'wer', 'was', 'wie',
  'wo', 'wann', 'warum', 'welche', 'welcher', 'welches', 'mit', 'für', 'von', 'zu', 'zum', 'zur', 'im',
  'ein', 'eine', 'einen', 'einem', 'einer', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein',
  'meine', 'dein', 'auf', 'aus', 'bei', 'nach', 'über', 'auch', 'nicht', 'noch', 'mir', 'mich', 'uns',
])

// Meaningful query terms for keyword matching (drops stopwords/short tokens).
export function queryTerms(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^0-9a-z\u00c0-\u024f]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) continue
    seen.add(raw); out.push(raw)
  }
  return out
}

// FTS5 MATCH expression: any term (OR), each quoted so user text can't inject
// FTS syntax; terms of 4+ chars also match as prefixes (plurals, German compounds).
export function ftsQuery(terms: string[]): string {
  return terms.map(t => `"${t.replace(/"/g, '""')}"${t.length >= 4 ? '*' : ''}`).join(' OR ')
}

// Keyword ranking: BM25 over title (note path), heading and content, weighted so
// a hit in the note's name/heading counts more than one in body text.
export function lexicalSearch(query: string, limit = 50): ScoredId[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const rows = getDb().prepare(
    'SELECT rowid AS id, bm25(chunks_fts, 4.0, 2.0, 1.0) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?'
  ).all(ftsQuery(terms), limit) as Array<{ id: number; rank: number }>
  return rows.map(r => ({ id: r.id, score: -r.rank })) // bm25(): lower is better
}

// Notes the query names explicitly — the strongest signal for named entities
// ("who is Alex" → People/Alex.md), which embed poorly and whose names also
// appear in the body of many other notes. Deliberately strict: a note matches
// only if the query contains ALL words of its file name, or — for person notes
// (People/, Contacts/…) — the first name, AND those name words make up at least
// half of the query's meaningful words, i.e. the query is ABOUT that note
// ("who is Alex"), not a longer question that merely mentions it. Looser rules
// (any query word as a substring of a file name; any full-title mention)
// measurably hurt ranking on descriptive questions in the retrieval eval.
const PERSON_DIR = /(^|\/)(people|persons|contacts|personen|kontakte)\//i

export function titleMatches(query: string): Array<{ notePath: string; score: number }> {
  const terms = new Set(queryTerms(query))
  if (terms.size === 0) return []
  const cache = loadCache()
  const out: Array<{ notePath: string; score: number }> = []
  for (const notePath of Array.from(new Set(cache.notePaths))) {
    const words = queryTerms(path.basename(notePath, '.md'))
    if (words.length === 0) continue
    const present = words.filter(w => terms.has(w)).length
    const named = present === words.length || (PERSON_DIR.test(notePath) && terms.has(words[0]))
    const coverage = present / terms.size
    if (named && coverage >= 0.5) out.push({ notePath, score: coverage })
  }
  return out.sort((a, b) => b.score - a.score)
}

// Target max characters per chunk. Embedding models have a fixed context window
// (nomic-embed-text ~2048 tokens ≈ 8k chars; smaller models far less), so a single
// oversized section/note must never be sent whole or the embed call 400s. ~2000
// chars (~500 tokens) is also a good retrieval granularity. The resilient embed
// below further splits if a model's window is even smaller.
const MAX_CHUNK_CHARS = 2000
// Carry the tail of each chunk into the next so a fact split across a boundary
// stays retrievable in at least one chunk.
const CHUNK_OVERLAP_CHARS = 200

// Last `n` chars of a string, snapped forward to a line boundary when possible.
function tailOverlap(s: string, n: number): string {
  if (s.length <= n) return s
  const slice = s.slice(s.length - n)
  const nl = slice.indexOf('\n')
  return nl === -1 ? slice : slice.slice(nl + 1)
}

// Split text into pieces no longer than maxLen, preferring line boundaries, with
// `overlap` characters shared between consecutive pieces. A single over-long line
// is hard-split into overlapping windows.
function splitText(text: string, maxLen: number, overlap = CHUNK_OVERLAP_CHARS): string[] {
  if (text.length <= maxLen) return [text]
  const out: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (line.length > maxLen) {
      if (cur) { out.push(cur); cur = '' }
      const step = Math.max(1, maxLen - overlap)
      for (let i = 0; i < line.length; i += step) out.push(line.slice(i, i + maxLen))
      continue
    }
    if (cur && cur.length + line.length + 1 > maxLen) {
      out.push(cur)
      cur = tailOverlap(cur, overlap) // seed the next chunk with the overlap
    }
    cur = cur ? `${cur}\n${line}` : line
  }
  if (cur) out.push(cur)
  return out
}

// Split a note into size-bounded chunks. Each chunk is prefixed with a breadcrumb
// "<folder/note> › <parent heading> › <heading>" for context, NOT the full
// frontmatter: prepending identical frontmatter to every chunk pulls their
// embeddings toward frontmatter similarity (so unrelated daily/log notes
// mis-match), and crowds out the actual prose. The breadcrumb keeps each chunk
// self-locating — the folder says what kind of note it is (People/, Projects/),
// the parent heading says what a terse "### Status" section is the status of.
export function chunkNote(notePath: string, content: string): Array<{ heading: string; content: string }> {
  const body = stripFrontmatter(content)
  const title = notePath.replace(/\.md$/, '')

  const sections = body.split(/\n(?=#{1,6}\s)/)
  const chunks: Array<{ heading: string; content: string }> = []
  const trail: string[] = [] // heading text by level (index 0 = "#")

  const pushSection = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const headingMatch = /^(#{1,6})\s+(.*)/.exec(trimmed)
    if (headingMatch) {
      const level = headingMatch[1].length
      trail.length = level - 1
      trail[level - 1] = headingMatch[2].trim()
    }
    const heading = headingMatch ? headingMatch[2].trim() : '(intro)'
    const header = [title, ...(headingMatch ? trail.filter(Boolean) : [])].join(' › ')
    const budget = Math.max(500, MAX_CHUNK_CHARS - header.length - 2)
    for (const piece of splitText(trimmed, budget)) {
      chunks.push({ heading, content: `${header}\n\n${piece}` })
    }
  }

  for (const section of sections) pushSection(section)
  if (chunks.length === 0 && body.trim()) pushSection(body)

  return chunks
}

type IndexRun = { notes: number; chunks: number; skipped: string[] }

export function rebuildIndex(): Promise<IndexRun> {
  return withIndexLock(async () => {
    clearIndex(getDb())
    setMeta('signature', embedSignature())
    invalidateCache()
    return embedNotes(listAllNotes().map(f => f.path))
  })
}

// Drop all chunks without re-embedding — used when switching to a different vault
// so stale chunks from the previous vault can't leak into retrieval.
export function resetIndex(): void {
  clearIndex(getDb())
  invalidateCache()
}

// Incremental sync: re-embed notes whose mtime changed, prune deleted ones. If the
// embedding model (or prefix scheme) changed since the index was built, every
// stored vector is in the wrong space — wipe and re-embed everything.
export function syncIndex(): Promise<IndexRun> {
  return withIndexLock(async () => {
    const database = getDb()
    const signature = embedSignature()
    if (getMeta('signature') !== signature) {
      clearIndex(database)
      setMeta('signature', signature)
      invalidateCache()
    }

    const notes = listAllNotes()
    // One query for every note's indexed mtime (was one query per note).
    const indexedAt = new Map(
      (database.prepare('SELECT note_path, MAX(updated_at) AS updated_at FROM chunks GROUP BY note_path').all() as Array<{
        note_path: string; updated_at: number
      }>).map(r => [r.note_path, r.updated_at]),
    )
    // Any mtime difference counts (ms precision): a note restored to an OLDER
    // version (git checkout, undo) must be re-embedded too.
    const stale = notes.filter(n => indexedAt.get(n.path) !== n.mtime.getTime()).map(n => n.path)

    // Prune chunks for notes that no longer exist in the vault (deleted/renamed).
    const present = new Set(notes.map(n => n.path))
    const del = deleteNoteRows(database)
    let pruned = 0
    for (const p of Array.from(indexedAt.keys())) {
      if (!present.has(p)) { del(p); pruned++ }
    }
    if (pruned) invalidateCache()

    return embedNotes(stale)
  })
}

// Split-and-retry ONLY on a genuine context-window overflow (tagged by ollamaEmbed).
// Previously this matched any error containing "400"/"exceeds"/"too long", so
// transient failures (model loading, server busy) were misread as "chunk too long"
// and recursively shredded notes into sub-300-char fragments — inflating the chunk
// count by 6–10× and making it differ between rebuilds of the SAME notes.
function isContextError(err: unknown): boolean {
  return String(err).includes(EMBED_CONTEXT_OVERFLOW)
}

// Embed a chunk, but if the model rejects it for length, split and embed the
// halves (recursively) so the index still gets built. Adapts to any embed
// model's context window. Returns one (text, embedding) pair per surviving piece.
// `prefix` is the model's document prefix — embedded, but not stored as text.
async function embedResilient(text: string, prefix: string): Promise<Array<{ text: string; embedding: number[] }>> {
  try {
    return [{ text, embedding: await ollamaEmbed(prefix + text) }]
  } catch (err) {
    if (!isContextError(err)) throw err // e.g. embed model not installed — surface it
    if (text.length <= 300) {
      // Can't split meaningfully; embed a hard-truncated head so we keep something.
      return [{ text: text.slice(0, 300), embedding: await ollamaEmbed(prefix + text.slice(0, 300)) }]
    }
    const mid = text.lastIndexOf('\n', Math.floor(text.length / 2))
    const cut = mid > 200 ? mid : Math.floor(text.length / 2)
    const left = text.slice(0, cut).trim()
    const right = text.slice(cut).trim()
    const out: Array<{ text: string; embedding: number[] }> = []
    if (left) out.push(...await embedResilient(left, prefix))
    if (right) out.push(...await embedResilient(right, prefix))
    return out
  }
}

// Remove a note's chunks from both the vector table and the keyword index.
function deleteNoteRows(database: Database.Database): (notePath: string) => void {
  const delFts = database.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE note_path = ?)')
  const del = database.prepare('DELETE FROM chunks WHERE note_path = ?')
  return (notePath) => { delFts.run(notePath); del.run(notePath) }
}

// Callers must hold the index lock.
async function embedNotes(notePaths: string[]): Promise<IndexRun> {
  const database = getDb()
  const insert = database.prepare(
    'INSERT INTO chunks (note_path, heading, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  const insertFts = database.prepare('INSERT INTO chunks_fts (rowid, title, heading, content) VALUES (?, ?, ?, ?)')
  const del = deleteNoteRows(database)
  // Swap a note's chunks atomically: its old chunks stay searchable until the
  // new ones are fully embedded, and a failure mid-note leaves the old ones.
  const replaceNote = database.transaction(
    (notePath: string, rows: Array<{ heading: string; text: string; embedding: number[] }>, mtime: number) => {
      del(notePath)
      const title = notePath.replace(/\.md$/, '')
      for (const r of rows) {
        const { lastInsertRowid } = insert.run(notePath, r.heading, r.text, encodeVector(r.embedding), mtime)
        insertFts.run(lastInsertRowid, title, r.heading, r.text)
      }
    },
  )
  const { doc: docPrefix } = embedPrefixes(getConfig().embedModel)

  let chunkCount = 0
  let done = 0
  const skipped: string[] = []

  for (const notePath of notePaths) {
    let content: string
    let mtime: number
    try {
      const abs = resolveVaultPath(notePath)
      mtime = fs.statSync(abs).mtime.getTime()
      content = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }

    try {
      const rows: Array<{ heading: string; text: string; embedding: number[] }> = []
      for (const chunk of chunkNote(notePath, content)) {
        for (const piece of await embedResilient(chunk.content, docPrefix)) {
          rows.push({ heading: chunk.heading, text: piece.text, embedding: piece.embedding })
        }
      }
      replaceNote(notePath, rows, mtime)
      chunkCount += rows.length
      done++
    } catch (err) {
      // A non-context failure on this note (e.g. transient). Skip it so the rest
      // of the index still builds, unless it's the very first note failing —
      // which usually means the embed model itself is missing.
      skipped.push(notePath)
      if (done === 0) throw err
    }
  }

  if (notePaths.length) invalidateCache()
  return { notes: notePaths.length, chunks: chunkCount, skipped }
}

// Distinct note paths currently present in the index — used by diagnostics to
// show which on-disk notes are NOT indexed (the usual cause of "it can't find my
// note" / "chunks don't change").
export function listIndexedNotePaths(): string[] {
  const rows = getDb().prepare('SELECT DISTINCT note_path FROM chunks').all() as Array<{ note_path: string }>
  return rows.map(r => r.note_path)
}

// Absolute path of the SQLite index — surfaced in diagnostics because it's
// derived from process.cwd(), and launching the app from a different working
// directory yields a different (empty) DB, which looks like "indexing is broken".
export function indexDbPath(): string {
  return DB_PATH
}

export function indexStats(): { notes: number; chunks: number; hasIndex: boolean; model: string | null; modelMatches: boolean } {
  const database = getDb()
  const row = database.prepare(
    'SELECT COUNT(*) as chunks, COUNT(DISTINCT note_path) as notes FROM chunks'
  ).get() as { chunks: number; notes: number }
  // Which embedding model built the stored vectors, and whether it's the current one.
  const signature = getMeta('signature')
  return {
    ...row,
    hasIndex: fs.existsSync(DB_PATH),
    model: signature ? signature.split('#')[0] : null,
    modelMatches: signature === embedSignature(),
  }
}
