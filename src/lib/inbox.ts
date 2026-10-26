import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import matter from 'gray-matter'
import { getConfig } from '@/lib/config'
import { decodeVector, denseSearchVector, embedQuery, embedSignature, getChunk, syncIndex } from '@/lib/embeddings'
import { ollamaChat } from '@/lib/ollama'
import { egressGet } from '@/lib/egress'
import { itemId, parseFeed, titleKey, type FeedEntry } from '@/lib/feeds'
import { allowedHosts, readSources, sourceUrl, type Source } from '@/lib/sources'
import { fileHash, isMetaNote, resolveVaultPath, sanitizePath } from '@/lib/vault'
import { recordOperation } from '@/lib/opsLog'

// The inbox: candidate knowledge from your feeds, waiting for a swipe.
//
//   fetch (egress.ts) → dedupe → embed → score against the vault + your past
//   swipes → "why this matters to you" for the top few → swipe
//     accept → a new source note in the vault (create-only, never overwrites)
//     reject → negative signal for that section's ranking
//     later  → parked
//
// Candidates live in data/inbox.sqlite, NOT the vault, so unreviewed items never
// show up in chat answers or search. Every decision is kept (with its embedding)
// as training signal for the section's interest profile.

const DB_PATH = path.join(process.cwd(), 'data', 'inbox.sqlite')
const MAX_AGE_DAYS = 30          // ignore feed entries older than this on fetch
const PRUNE_UNDECIDED_DAYS = 45  // drop never-swiped items after this
const MIN_PROFILE = 2            // decisions needed before a centroid counts
const ARXIV_SPACING_MS = 3100    // arXiv API etiquette: one request per 3 s
const RELATED_MIN = 0.3          // cosine floor for a "closest note" link
const RELATED_SPREAD = 0.15      // …and within this of the best match

export type InboxStatus = 'new' | 'later' | 'accepted' | 'rejected'
export type RelatedNote = { path: string; score: number; chunkId: number }
export type InboxItem = {
  id: string
  sourceId: string
  sourceName: string
  section: string
  kind: string
  title: string
  url: string
  authors: string[]
  published: string | null
  summary: string
  fetchedAt: number
  status: InboxStatus
  decidedAt: number | null
  score: number | null
  related: RelatedNote[]
  why: string | null
  notePath: string | null
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      section TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      title_key TEXT NOT NULL,
      url TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '[]',
      published TEXT,
      summary TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      decided_at INTEGER,
      embedding BLOB,
      embed_sig TEXT,
      vault_sim REAL,
      score REAL,
      related TEXT NOT NULL DEFAULT '[]',
      why TEXT,
      note_path TEXT,
      note_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, score);
    CREATE INDEX IF NOT EXISTS idx_items_title_key ON items(title_key);
    CREATE TABLE IF NOT EXISTS source_state (
      source_id TEXT PRIMARY KEY,
      last_fetch INTEGER,
      last_count INTEGER,
      last_error TEXT
    );
  `)
  return db
}

type Row = {
  id: string; source_id: string; source_name: string; section: string; kind: string; title: string
  url: string; authors: string; published: string | null; summary: string; fetched_at: number
  status: InboxStatus; decided_at: number | null; score: number | null; related: string; why: string | null
  note_path: string | null
}
const ITEM_COLUMNS = 'id, source_id, source_name, section, kind, title, url, authors, published, summary, fetched_at, status, decided_at, score, related, why, note_path'

function toItem(r: Row): InboxItem {
  return {
    id: r.id, sourceId: r.source_id, sourceName: r.source_name, section: r.section, kind: r.kind,
    title: r.title, url: r.url, authors: JSON.parse(r.authors), published: r.published, summary: r.summary,
    fetchedAt: r.fetched_at, status: r.status, decidedAt: r.decided_at, score: r.score,
    related: JSON.parse(r.related), why: r.why, notePath: r.note_path,
  }
}

export function getItem(id: string): InboxItem | null {
  const r = getDb().prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).get(id) as Row | undefined
  return r ? toItem(r) : null
}

export function listItems(opts: { status?: InboxStatus; section?: string; limit?: number; since?: number } = {}): InboxItem[] {
  const where = ['status = ?']
  const args: Array<string | number> = [opts.status ?? 'new']
  if (opts.section) { where.push('section = ?'); args.push(opts.section) }
  if (opts.since) { where.push('fetched_at >= ?'); args.push(opts.since) }
  args.push(opts.limit ?? 50)
  const rows = getDb().prepare(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE ${where.join(' AND ')}
     ORDER BY score IS NULL, score DESC, fetched_at DESC LIMIT ?`,
  ).all(...args) as Row[]
  return rows.map(toItem)
}

export function inboxCounts(): { byStatus: Record<InboxStatus, number>; newBySection: Record<string, number> } {
  const byStatus: Record<InboxStatus, number> = { new: 0, later: 0, accepted: 0, rejected: 0 }
  for (const r of getDb().prepare('SELECT status, COUNT(*) AS n FROM items GROUP BY status').all() as Array<{ status: InboxStatus; n: number }>) {
    byStatus[r.status] = r.n
  }
  const newBySection: Record<string, number> = {}
  for (const r of getDb().prepare("SELECT section, COUNT(*) AS n FROM items WHERE status = 'new' GROUP BY section").all() as Array<{ section: string; n: number }>) {
    newBySection[r.section] = r.n
  }
  return { byStatus, newBySection }
}

export type SourceState = { lastFetch: number | null; lastCount: number | null; lastError: string | null }
export function sourceStates(): Record<string, SourceState> {
  const out: Record<string, SourceState> = {}
  for (const r of getDb().prepare('SELECT * FROM source_state').all() as Array<{ source_id: string; last_fetch: number | null; last_count: number | null; last_error: string | null }>) {
    out[r.source_id] = { lastFetch: r.last_fetch, lastCount: r.last_count, lastError: r.last_error }
  }
  return out
}

// --- Fetch -------------------------------------------------------------------

// New entries from one source → rows. Skips anything already seen, by URL
// identity (arXiv id for papers) or by title (the same story syndicated twice).
export function storeEntries(source: Source, entries: FeedEntry[], now = Date.now()): number {
  const database = getDb()
  const exists = database.prepare('SELECT 1 FROM items WHERE id = ? OR title_key = ? LIMIT 1')
  const insert = database.prepare(`INSERT INTO items
    (id, source_id, source_name, section, kind, title, title_key, url, authors, published, summary, fetched_at)
    VALUES (@id, @sourceId, @sourceName, @section, @kind, @title, @titleKey, @url, @authors, @published, @summary, @fetchedAt)`)
  let added = 0
  const fresh = entries
    .filter(e => !e.published || now - Date.parse(e.published) < MAX_AGE_DAYS * 86_400_000)
    .slice(0, source.maxItems)
  database.transaction(() => {
    for (const e of fresh) {
      const id = itemId(e.url)
      const key = titleKey(e.title)
      if (exists.get(id, key)) continue
      insert.run({
        id, sourceId: source.id, sourceName: source.name, section: source.section, kind: source.kind,
        title: e.title, titleKey: key, url: e.url, authors: JSON.stringify(e.authors),
        published: e.published, summary: e.summary, fetchedAt: now,
      })
      added++
    }
  })()
  return added
}

async function fetchSource(source: Source, hosts: Set<string>): Promise<number> {
  const xml = await egressGet(sourceUrl(source), { allowedHosts: hosts, purpose: `feed:${source.id}` })
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error('Not an RSS/Atom feed')
  // The arXiv API reports a bad query as a single entry pointing at /api/errors.
  const entries = parseFeed(xml).filter(e => !/arxiv\.org\/api\/errors/.test(e.url))
  if (source.kind === 'arxiv' && /arxiv\.org\/api\/errors/.test(xml)) {
    throw new Error(`arXiv rejected the query: ${/<summary>([\s\S]*?)<\/summary>/.exec(xml)?.[1]?.trim() ?? 'unknown error'}`)
  }
  return storeEntries(source, entries)
}

// --- Scoring -----------------------------------------------------------------

// Relevance of a candidate. vaultSim = similarity to the closest chunk of your
// vault (are you working on this?); pos/neg = similarity to the centroid of what
// you accepted/rejected in this section (null until there are a few). Pure.
export function scoreFrom(vaultSim: number, pos: number | null, neg: number | null): number {
  let s = pos === null ? vaultSim : 0.6 * vaultSim + 0.4 * pos
  // Penalize only items that look more like your rejects than like your accepts.
  if (neg !== null) s -= 0.5 * Math.max(0, neg - (pos ?? vaultSim))
  return Math.round(s * 1000) / 1000
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// Normalized mean of vectors, or null below MIN_PROFILE.
export function centroid(vecs: Float32Array[]): Float32Array | null {
  if (vecs.length < MIN_PROFILE) return null
  const c = new Float32Array(vecs[0].length)
  for (const v of vecs) for (let i = 0; i < c.length; i++) c[i] += v[i]
  let norm = 0
  for (let i = 0; i < c.length; i++) norm += c[i] * c[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < c.length; i++) c[i] /= norm
  return c
}

function sectionProfiles(sig: string): Map<string, { pos: Float32Array | null; neg: Float32Array | null }> {
  const rows = getDb().prepare(
    "SELECT section, status, embedding FROM items WHERE status IN ('accepted', 'rejected') AND embed_sig = ? AND embedding IS NOT NULL",
  ).all(sig) as Array<{ section: string; status: InboxStatus; embedding: Buffer }>
  const groups = new Map<string, { pos: Float32Array[]; neg: Float32Array[] }>()
  for (const r of rows) {
    const g = groups.get(r.section) ?? { pos: [], neg: [] }
    ;(r.status === 'accepted' ? g.pos : g.neg).push(decodeVector(r.embedding))
    groups.set(r.section, g)
  }
  const out = new Map<string, { pos: Float32Array | null; neg: Float32Array | null }>()
  groups.forEach((g, section) => out.set(section, { pos: centroid(g.pos), neg: centroid(g.neg) }))
  return out
}

// Embed undecided items (once per embedding model) and find their closest notes,
// then re-rank everything undecided with the latest profiles.
async function scoreUndecided(): Promise<number> {
  const database = getDb()
  const sig = embedSignature()
  const todo = database.prepare(
    "SELECT id, title, summary FROM items WHERE status IN ('new', 'later') AND (embed_sig IS NULL OR embed_sig != ?) LIMIT 300",
  ).all(sig) as Array<{ id: string; title: string; summary: string }>
  const update = database.prepare('UPDATE items SET embedding = ?, embed_sig = ?, vault_sim = ?, related = ? WHERE id = ?')
  for (const t of todo) {
    const vec = await embedQuery(`${t.title}\n\n${t.summary.slice(0, 1500)}`)
    const hits = denseSearchVector(vec, 40)
    const related: RelatedNote[] = []
    for (const hit of hits) {
      // Only notes about as close as the best one — not "least unrelated".
      if (hit.score < Math.max(RELATED_MIN, hits[0].score - RELATED_SPREAD)) break
      const c = getChunk(hit.id)
      if (!c || isMetaNote(c.notePath) || related.some(r => r.path === c.notePath)) continue
      related.push({ path: c.notePath, score: Math.round(hit.score * 1000) / 1000, chunkId: hit.id })
      if (related.length === 3) break
    }
    update.run(Buffer.from(vec.buffer), sig, hits[0]?.score ?? 0, JSON.stringify(related), t.id)
  }

  const profiles = sectionProfiles(sig)
  const rows = database.prepare(
    "SELECT id, section, embedding, vault_sim FROM items WHERE status IN ('new', 'later') AND embed_sig = ?",
  ).all(sig) as Array<{ id: string; section: string; embedding: Buffer; vault_sim: number }>
  const setScore = database.prepare('UPDATE items SET score = ? WHERE id = ?')
  database.transaction(() => {
    for (const r of rows) {
      const p = profiles.get(r.section)
      const v = decodeVector(r.embedding)
      setScore.run(scoreFrom(r.vault_sim, p?.pos ? dot(v, p.pos) : null, p?.neg ? dot(v, p.neg) : null), r.id)
    }
  })()
  return todo.length
}

// --- "Why this matters to you" -------------------------------------------------

async function explain(item: InboxItem): Promise<string> {
  const notes = item.related
    .map(r => {
      const c = getChunk(r.chunkId)
      return c ? `- [[${r.path.replace(/\.md$/, '')}]]: ${c.content.replace(/\s+/g, ' ').slice(0, 350)}` : null
    })
    .filter(Boolean)
    .join('\n')
  const text = await ollamaChat({
    role: 'writer',
    messages: [
      { role: 'system', content: 'You help one person triage their reading. Be concrete and brief. Never invent facts about the item.' },
      {
        role: 'user',
        content:
          `My notes closest to this item:\n${notes || '(none)'}\n\n` +
          `New ${item.kind === 'arxiv' ? 'paper' : 'item'} from "${item.sourceName}":\nTitle: ${item.title}\n${item.summary.slice(0, 1500)}\n\n` +
          'In at most two short sentences, tell me why this could matter to me given my notes — name the related ' +
          'note if one fits. If it looks unrelated to anything I work on, say so plainly. No preamble.',
      },
    ],
  })
  return text.replace(/\s+/g, ' ').trim().slice(0, 500)
}

export async function explainTop(limit: number, ids?: string[]): Promise<number> {
  const database = getDb()
  const rows = ids?.length
    ? (database.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE why IS NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[])
    : (database.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE status = 'new' AND why IS NULL AND score IS NOT NULL ORDER BY score DESC LIMIT ?`).all(limit) as Row[])
  const set = database.prepare('UPDATE items SET why = ? WHERE id = ?')
  let n = 0
  for (const r of rows.slice(0, limit)) {
    try {
      const why = await explain(toItem(r))
      if (why) { set.run(why, r.id); n++ }
    } catch {
      break // model down — the rest keep their abstract only
    }
  }
  return n
}

// --- Refresh job (scheduler + "Fetch now") -------------------------------------

export type RefreshResult = {
  ranAt: string
  added: number
  scored: number
  explained: number
  sources: Array<{ id: string; name: string; added: number; error?: string }>
  error?: string
}
type InboxGlobals = { running: Promise<RefreshResult> | null; last: RefreshResult | null }
const G = ((globalThis as unknown as { __vaultInbox?: InboxGlobals }).__vaultInbox ??= { running: null, last: null })

export function inboxJob(): { running: boolean; last: RefreshResult | null } {
  return { running: !!G.running, last: G.last }
}

// Fetch every enabled source, score, explain the top few. Concurrent callers
// share the run in flight.
export function refreshInbox(opts: { explain?: number } = {}): Promise<RefreshResult> {
  if (G.running) return G.running
  G.running = (async () => {
    const result: RefreshResult = { ranAt: new Date().toISOString(), added: 0, scored: 0, explained: 0, sources: [] }
    const sources = readSources().filter(s => s.enabled)
    const hosts = allowedHosts(sources)
    const state = getDb().prepare(`INSERT INTO source_state (source_id, last_fetch, last_count, last_error) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET last_fetch = excluded.last_fetch, last_count = excluded.last_count, last_error = excluded.last_error`)
    let lastArxiv = 0
    for (const s of sources) {
      if (s.kind === 'arxiv') {
        const wait = lastArxiv + ARXIV_SPACING_MS - Date.now()
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
        lastArxiv = Date.now()
      }
      try {
        const added = await fetchSource(s, hosts)
        result.added += added
        result.sources.push({ id: s.id, name: s.name, added })
        state.run(s.id, Date.now(), added, null)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        result.sources.push({ id: s.id, name: s.name, added: 0, error })
        state.run(s.id, Date.now(), 0, error)
      }
    }
    getDb().prepare("DELETE FROM items WHERE status IN ('new', 'later') AND fetched_at < ?")
      .run(Date.now() - PRUNE_UNDECIDED_DAYS * 86_400_000)
    try {
      result.scored = await scoreUndecided()
      result.explained = await explainTop(opts.explain ?? 8)
    } catch (err) {
      // Index mid re-embed or embedder down: items stay unscored until next run.
      result.error = err instanceof Error ? err.message : String(err)
    }
    G.last = result
    return result
  })().finally(() => { G.running = null })
  return G.running
}

// --- Decisions -------------------------------------------------------------------

function titleCase(s: string): string {
  return s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]{}]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100) || 'Untitled'
}

export function acceptedNoteContent(item: InboxItem, today = new Date().toLocaleDateString('en-CA')): string {
  const kindLabel = item.kind === 'arxiv' ? 'Paper' : 'Article'
  const byline = item.authors.length ? ` by ${item.authors.slice(0, 3).join(', ')}${item.authors.length > 3 ? ' et al.' : ''}` : ''
  const published = item.published?.slice(0, 10)
  const related = item.related.map(r => `- [[${r.path.replace(/\.md$/, '')}]]`).join('\n')
  const body = [
    `> **For future Claude:** ${kindLabel} "${item.title}"${byline}${published ? ` (published ${published})` : ''}, ` +
      `accepted from the ${item.section} inbox on ${today}. The summary below is the source's own abstract, not verified.` +
      (item.why ? ` Why it was kept: ${item.why}` : ''),
    '',
    `## Summary (from the source, as of ${today})`,
    '',
    item.summary || '_No summary in the feed — open the source._',
    '',
    '## Why it matters',
    '',
    item.why ?? '_Not assessed yet._',
    '',
    ...(related ? ['## Related notes', '', related, ''] : []),
    `Source: ${item.url}`,
    '',
  ].join('\n')
  return matter.stringify(body, {
    date: today,
    type: 'research',
    title: item.title,
    tags: Array.from(new Set(['research', item.section, 'from-inbox'])),
    section: item.section,
    source: item.url,
    'source-name': item.sourceName,
    ...(item.authors.length ? { authors: item.authors } : {}),
    ...(published ? { published } : {}),
    confidence: 'stated',
    'ai-first': true,
  })
}

// Create-only: picks a free file name, never overwrites (wx).
function writeAcceptedNote(item: InboxItem): { notePath: string; hash: string } {
  const folder = sanitizePath(`${getConfig().feedNoteFolder}/${titleCase(item.section)}`)
  const content = acceptedNoteContent(item)
  const base = safeFileName(item.title)
  for (let i = 1; i < 50; i++) {
    const notePath = `${folder}/${base}${i > 1 ? ` (${i})` : ''}.md`
    const abs = resolveVaultPath(notePath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    try {
      fs.writeFileSync(abs, content, { encoding: 'utf-8', flag: 'wx' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    recordOperation({ origin: 'inbox', summary: `Accepted from inbox: ${item.title}`, changes: [{ action: 'create', path: notePath }] })
    void syncIndex().catch(() => {})
    return { notePath, hash: fileHash(notePath)! }
  }
  throw new Error('Could not find a free file name')
}

export type Decision = InboxStatus

// Swipe. Moving an accepted item back (undo) removes its note only if it is
// still exactly what was written — edits made since are never thrown away.
export function decideItem(id: string, decision: Decision): { item: InboxItem; notePath?: string; noteKept?: boolean } {
  const database = getDb()
  const row = database.prepare('SELECT status, note_path, note_hash FROM items WHERE id = ?').get(id) as
    | { status: InboxStatus; note_path: string | null; note_hash: string | null } | undefined
  if (!row) throw new Error('Item not found')

  let notePath: string | null = row.note_path
  let noteHash: string | null = row.note_hash
  let noteKept: boolean | undefined
  if (decision === 'accepted' && !notePath) {
    const item = getItem(id)!
    const written = writeAcceptedNote(item)
    notePath = written.notePath
    noteHash = written.hash
    // Background: compare its claims with the closest notes (src/lib/conflicts.ts).
    const { notePath: p, hash: h } = written
    void import('@/lib/conflicts').then(m => m.queueConflictCheck(item, p, h)).catch(() => {})
  } else if (decision !== 'accepted' && notePath) {
    noteKept = fileHash(notePath) !== noteHash
    if (!noteKept) {
      fs.rmSync(resolveVaultPath(notePath), { force: true })
      recordOperation({ origin: 'inbox', summary: 'Undid an inbox accept', changes: [{ action: 'delete', path: notePath }] })
      void syncIndex().catch(() => {})
    }
    notePath = null
    noteHash = null
  }
  database.prepare('UPDATE items SET status = ?, decided_at = ?, note_path = ?, note_hash = ? WHERE id = ?')
    .run(decision, decision === 'new' ? null : Date.now(), notePath, noteHash, id)
  return { item: getItem(id)!, notePath: notePath ?? undefined, noteKept }
}

// Undecided items that came in since a moment (for the briefing).
export function freshCandidates(since: number, perSection: number): Map<string, InboxItem[]> {
  const out = new Map<string, InboxItem[]>()
  for (const item of listItems({ status: 'new', since, limit: 500 })) {
    const list = out.get(item.section) ?? []
    if (list.length < perSection) list.push(item)
    out.set(item.section, list)
  }
  return out
}

