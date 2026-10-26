import fs from 'fs'
import path from 'path'
import { isMetaNote, listAllNotes, resolveVaultPath, stripFrontmatter } from '@/lib/vault'
import { getChunk, indexStats, isIndexBusy, lexicalSearch, queryTerms } from '@/lib/embeddings'
import { foldText as fold, titleScore } from '@/lib/noteMatch'

// "Find a note" for the search page and the ⌘K palette: note names first (what
// people usually type), then keyword hits in note bodies (BM25 over the index),
// then a plain substring scan as a fallback for when the index is empty or
// rebuilding. Fast and model-free — no embedder call, so it answers per keystroke.

export type FoundNote = {
  path: string
  title: string
  folder: string
  snippet: string
  why: 'title' | 'text'
}

function noteParts(notePath: string): { title: string; folder: string } {
  return { title: path.basename(notePath, '.md'), folder: path.dirname(notePath) === '.' ? '' : path.dirname(notePath) }
}

// Plain prose for a snippet: no index breadcrumb ("Folder/Note › Heading"),
// no "For future Claude" heading, no markdown/table syntax.
export function readable(md: string): string {
  return md
    .replace(/^[^\n]*›[^\n]*(\n|$)/, '') // index chunks start with a breadcrumb line
    .replace(/^#{1,6}\s+for future claude\s*$/gim, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, t: string, a?: string) => a ?? t.split('/').pop() ?? t)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>|]+|[─-╿]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// The line around the first occurrence of any query word.
export function snippetFor(text: string, query: string, max = 160): string {
  const body = readable(stripFrontmatter(text))
  const words = fold(query).split(/\s+/).filter(w => w.length >= 2)
  const hay = fold(body)
  let at = -1
  for (const w of words) {
    const i = hay.indexOf(w)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  if (at === -1) return body.slice(0, max) + (body.length > max ? '…' : '')
  const start = Math.max(0, at - 50)
  const out = body.slice(start, start + max)
  return (start > 0 ? '…' : '') + out + (start + max < body.length ? '…' : '')
}

function readSafe(notePath: string): string {
  try { return fs.readFileSync(resolveVaultPath(notePath), 'utf-8') } catch { return '' }
}

const SCAN_MAX_FILES = 3000
const SCAN_MAX_MS = 150

export function findNotes(query: string, limit = 20): FoundNote[] {
  const q = query.trim()
  if (!q) return []
  const notes = listAllNotes().filter(n => !isMetaNote(n.path))
  const out: FoundNote[] = []
  const seen = new Set<string>()
  const push = (p: string, why: FoundNote['why'], snippet: string) => {
    if (seen.has(p) || out.length >= limit) return
    seen.add(p)
    out.push({ path: p, ...noteParts(p), snippet, why })
  }

  // 1) Note names.
  notes
    .map(n => ({ p: n.path, s: titleScore(q, n.path) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .forEach(x => push(x.p, 'title', snippetFor(readSafe(x.p), q)))

  // 2) Keyword hits from the index (best chunk per note).
  let indexUsable = false
  try {
    const st = indexStats()
    indexUsable = st.chunks > 0 && st.modelMatches && !isIndexBusy()
  } catch { /* no index yet */ }
  try {
    for (const hit of lexicalSearch(q, 60)) {
      const c = getChunk(hit.id)
      if (!c || isMetaNote(c.notePath) || !fs.existsSync(resolveVaultPath(c.notePath))) continue
      push(c.notePath, 'text', snippetFor(c.content, q))
    }
  } catch { /* no index yet — the scan below covers it */ }

  // 3) Plain substring scan — only when the index can't answer: empty or
  // rebuilding, or a query with no indexable words ("ai", stopwords). It reads
  // files synchronously, so it's capped to keep a keystroke from stalling the
  // server on a big vault.
  if (out.length < limit && (!indexUsable || queryTerms(q).length === 0)) {
    const needle = fold(q)
    const started = Date.now()
    for (const n of notes.slice(0, SCAN_MAX_FILES)) {
      if (Date.now() - started > SCAN_MAX_MS) break
      if (seen.has(n.path)) continue
      const text = readSafe(n.path)
      if (fold(text).includes(needle)) push(n.path, 'text', snippetFor(text, q))
      if (out.length >= limit) break
    }
  }
  return out
}

// Every note name, for instant client-side filtering in the palette.
export function noteIndex(): Array<{ path: string; title: string; folder: string; mtime: number }> {
  return listAllNotes()
    .filter(n => !isMetaNote(n.path))
    .map(n => ({ path: n.path, ...noteParts(n.path), mtime: n.mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime)
}
