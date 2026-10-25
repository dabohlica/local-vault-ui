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
// normalization) — like a model change, it makes stored vectors incomparable.
const EMBED_SCHEME = 'v2'

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
  `)
  return db
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
  notePaths: string[]
  headings: string[]
  contents: string[]
  lowered: string[]
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
  const rows = getDb().prepare('SELECT note_path, heading, content, embedding FROM chunks').all() as Array<{
    note_path: string; heading: string; content: string; embedding: Buffer
  }>
  const dim = rows.length ? rows[0].embedding.byteLength / 4 : 0
  const kept = rows.filter(r => r.embedding.byteLength === dim * 4)
  const vecs = new Float32Array(kept.length * dim)
  kept.forEach((r, i) => vecs.set(decodeVector(r.embedding), i * dim))
  G.cache = {
    signature,
    dim,
    notePaths: kept.map(r => r.note_path),
    headings: kept.map(r => r.heading),
    contents: kept.map(r => r.content),
    lowered: kept.map(r => r.content.toLowerCase()),
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

// Embed a query and score it against every chunk (dot product of normalized vectors).
async function scoreAll(query: string): Promise<{ cache: VectorCache; scores: Float32Array }> {
  assertIndexMatchesModel()
  const cache = loadCache()
  const q = decodeVector(encodeVector(await ollamaEmbed(embedPrefixes(getConfig().embedModel).query + query)))
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

// Split a note into size-bounded chunks. Each chunk is prefixed with a short
// "<note title> — <heading>" header for context, NOT the full frontmatter:
// prepending identical frontmatter to every chunk pulls their embeddings toward
// frontmatter similarity (so unrelated daily/log notes mis-match), and crowds out
// the actual prose. The header keeps just enough context to stay self-locating.
export function chunkNote(notePath: string, content: string): Array<{ heading: string; content: string }> {
  const body = stripFrontmatter(content)
  const title = path.basename(notePath).replace(/\.md$/, '')

  const budget = Math.max(500, MAX_CHUNK_CHARS - title.length - 40)
  const sections = body.split(/\n(?=#{1,6}\s)/)
  const chunks: Array<{ heading: string; content: string }> = []

  const pushSection = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const headingMatch = /^(#{1,6})\s+(.*)/.exec(trimmed)
    const heading = headingMatch ? headingMatch[2].trim() : '(intro)'
    const header = heading === '(intro)' ? title : `${title} — ${heading}`
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
    getDb().exec('DELETE FROM chunks')
    setMeta('signature', embedSignature())
    invalidateCache()
    return embedNotes(listAllNotes().map(f => f.path))
  })
}

// Drop all chunks without re-embedding — used when switching to a different vault
// so stale chunks from the previous vault can't leak into retrieval.
export function resetIndex(): void {
  getDb().exec('DELETE FROM chunks')
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
      database.exec('DELETE FROM chunks')
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
    const del = database.prepare('DELETE FROM chunks WHERE note_path = ?')
    let pruned = 0
    for (const p of Array.from(indexedAt.keys())) {
      if (!present.has(p)) { del.run(p); pruned++ }
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

// Callers must hold the index lock.
async function embedNotes(notePaths: string[]): Promise<IndexRun> {
  const database = getDb()
  const insert = database.prepare(
    'INSERT INTO chunks (note_path, heading, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  const del = database.prepare('DELETE FROM chunks WHERE note_path = ?')
  // Swap a note's chunks atomically: its old chunks stay searchable until the
  // new ones are fully embedded, and a failure mid-note leaves the old ones.
  const replaceNote = database.transaction(
    (notePath: string, rows: Array<{ heading: string; text: string; embedding: number[] }>, mtime: number) => {
      del.run(notePath)
      for (const r of rows) insert.run(notePath, r.heading, r.text, encodeVector(r.embedding), mtime)
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

export async function retrieve(query: string, k = 6): Promise<RetrievedChunk[]> {
  const { cache, scores } = await scoreAll(query)
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, k)
  return order.map(i => ({
    notePath: cache.notePaths[i],
    heading: cache.headings[i],
    content: cache.contents[i],
    score: scores[i],
  }))
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be',
  'what', 'who', 'whom', 'whose', 'which', 'when', 'where', 'why', 'how', 'do', 'does', 'did', 'tell',
  'me', 'about', 'i', 'you', 'it', 'its', 'this', 'that', 'these', 'those', 'his', 'her', 'their',
  'they', 'he', 'she', 'we', 'my', 'your', 'with', 'know', 'can', 'please', 'give', 'show', 'have',
])

// Meaningful query terms for lexical matching (drops stopwords/short tokens).
function queryTerms(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9äöüß]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) continue
    seen.add(raw); out.push(raw)
  }
  return out
}

function titleOf(notePath: string): string {
  return path.basename(notePath).replace(/\.md$/, '')
}

// Hybrid note-level retrieval: combine semantic similarity with a lexical/keyword
// signal and a strong title-match boost, then return FULL note content for the top
// notes. The lexical + title signals are what make "tell me about <Person>" surface
// the note literally named/containing that person — pure embedding similarity ranks
// short named-entity queries poorly and was the cause of false "I don't know"s.
export async function retrieveNotes(
  query: string,
  opts: { topNotes?: number; perNoteChars?: number } = {}
): Promise<RetrievedChunk[]> {
  const topNotes = opts.topNotes ?? 7
  const perNoteChars = opts.perNoteChars ?? 6000

  const { cache, scores } = await scoreAll(query)
  const terms = queryTerms(query)

  // Per note: best semantic score + accumulated lexical hits across its chunks.
  const sem = new Map<string, number>()
  const lex = new Map<string, number>()
  for (let i = 0; i < cache.notePaths.length; i++) {
    const notePath = cache.notePaths[i]
    const score = scores[i]
    if ((sem.get(notePath) ?? -1) < score) sem.set(notePath, score)
    if (terms.length) {
      const hay = cache.lowered[i]
      let hits = 0
      for (const t of terms) if (hay.includes(t)) hits++
      if (hits) lex.set(notePath, (lex.get(notePath) ?? 0) + hits)
    }
  }

  // Combine into a single score per note.
  const notePaths = new Set<string>([...Array.from(sem.keys()), ...Array.from(lex.keys())])
  const combined: Array<{ notePath: string; score: number }> = []
  for (const notePath of Array.from(notePaths)) {
    const s = sem.get(notePath) ?? 0
    const lexNorm = Math.min(1, (lex.get(notePath) ?? 0) / Math.max(1, terms.length)) // fraction of terms present
    // Title containing a query term is the strongest signal (e.g. People/<Name>.md).
    const title = titleOf(notePath).toLowerCase()
    const titleHit = terms.some(t => title.includes(t))
    const score = s + 0.5 * lexNorm + (titleHit ? 0.6 : 0)
    combined.push({ notePath, score })
  }
  combined.sort((a, b) => b.score - a.score)

  const out: RetrievedChunk[] = []
  const seen = new Set<string>() // dedup identical-content notes (duplicate imports)
  for (const { notePath, score } of combined) {
    if (out.length >= topNotes) break
    let raw: string
    try {
      raw = fs.readFileSync(resolveVaultPath(notePath), 'utf-8')
    } catch {
      continue
    }
    const body = stripFrontmatter(raw).trim()
    if (!body) continue
    const key = body.slice(0, 400) // cheap near-duplicate key
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ notePath, heading: '(full note)', content: body.slice(0, perNoteChars), score })
  }
  return out
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
