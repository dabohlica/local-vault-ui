import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { listAllNotes, resolveVaultPath } from '@/lib/vault'
import { ollamaEmbed } from '@/lib/ollama'

const DB_PATH = path.join(process.cwd(), 'data', 'index.sqlite')

type ChunkRow = {
  id: number
  note_path: string
  heading: string
  content: string
  embedding: string
  updated_at: number
}

export type RetrievedChunk = {
  notePath: string
  heading: string
  content: string
  score: number
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_path TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_note_path ON chunks(note_path);
  `)
  return db
}

// Split a note into self-contained chunks: frontmatter + "For future Claude"
// preamble is prefixed to every chunk so each chunk stands alone, per the
// vault's AI-first rule.
export function chunkNote(notePath: string, content: string): Array<{ heading: string; content: string }> {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  const frontmatter = fmMatch ? fmMatch[0] : ''
  const body = fmMatch ? content.slice(fmMatch[0].length) : content

  const sections = body.split(/\n(?=#{1,6}\s)/)
  const chunks: Array<{ heading: string; content: string }> = []

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue
    const headingMatch = /^(#{1,6})\s+(.*)/.exec(trimmed)
    const heading = headingMatch ? headingMatch[2].trim() : '(intro)'
    chunks.push({ heading, content: `${frontmatter}${trimmed}` })
  }

  if (chunks.length === 0 && body.trim()) {
    chunks.push({ heading: '(intro)', content: `${frontmatter}${body.trim()}` })
  }

  return chunks
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function rebuildIndex(): Promise<{ notes: number; chunks: number }> {
  const database = getDb()
  database.exec('DELETE FROM chunks')
  return embedNotes(listAllNotes().map(f => f.path))
}

// Drop all chunks without re-embedding — used when switching to a different vault
// so stale chunks from the previous vault can't leak into retrieval.
export function resetIndex(): void {
  getDb().exec('DELETE FROM chunks')
}

export async function syncIndex(): Promise<{ notes: number; chunks: number }> {
  const database = getDb()
  const notes = listAllNotes()

  const stale: string[] = []
  for (const note of notes) {
    const row = database.prepare(
      'SELECT MAX(updated_at) as updated_at FROM chunks WHERE note_path = ?'
    ).get(note.path) as { updated_at: number | null }

    const mtime = Math.floor(note.mtime.getTime() / 1000)
    if (!row.updated_at || mtime > row.updated_at) {
      stale.push(note.path)
    }
  }

  // Drop chunks for stale notes before re-embedding
  const del = database.prepare('DELETE FROM chunks WHERE note_path = ?')
  for (const p of stale) del.run(p)

  return embedNotes(stale)
}

async function embedNotes(notePaths: string[]): Promise<{ notes: number; chunks: number }> {
  const database = getDb()
  const insert = database.prepare(
    'INSERT INTO chunks (note_path, heading, content, embedding, updated_at) VALUES (?, ?, ?, ?, ?)'
  )

  let chunkCount = 0
  for (const notePath of notePaths) {
    let content: string
    try {
      content = fs.readFileSync(resolveVaultPath(notePath), 'utf-8')
    } catch {
      continue
    }

    const mtime = Math.floor(fs.statSync(resolveVaultPath(notePath)).mtime.getTime() / 1000)
    const chunks = chunkNote(notePath, content)

    for (const chunk of chunks) {
      const embedding = await ollamaEmbed(chunk.content)
      insert.run(notePath, chunk.heading, chunk.content, JSON.stringify(embedding), mtime)
      chunkCount++
    }
  }

  return { notes: notePaths.length, chunks: chunkCount }
}

export async function retrieve(query: string, k = 6): Promise<RetrievedChunk[]> {
  const database = getDb()
  const queryEmbedding = await ollamaEmbed(query)

  const rows = database.prepare('SELECT * FROM chunks').all() as ChunkRow[]

  const scored = rows.map(row => ({
    notePath: row.note_path,
    heading: row.heading,
    content: row.content,
    score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

export function indexStats(): { notes: number; chunks: number; hasIndex: boolean } {
  const database = getDb()
  const row = database.prepare(
    'SELECT COUNT(*) as chunks, COUNT(DISTINCT note_path) as notes FROM chunks'
  ).get() as { chunks: number; notes: number }
  return { ...row, hasIndex: fs.existsSync(DB_PATH) }
}
