import fs from 'fs'
import path from 'path'

// Feed sources for the inbox, stored in data/sources.json (per machine, like
// config.json). Each source belongs to a section ("research", "work", …) — the
// unit the inbox learns your taste for and the briefing groups by.

const SOURCES_PATH = path.join(process.cwd(), 'data', 'sources.json')

export type SourceKind = 'arxiv' | 'rss'
export type Source = {
  id: string
  kind: SourceKind
  name: string
  section: string
  query?: string // arxiv: an arXiv API search_query, e.g. "cat:cs.IR AND abs:retrieval"
  url?: string   // rss: feed URL (RSS or Atom)
  enabled: boolean
  maxItems: number
}

export const ARXIV_HOST = 'export.arxiv.org'

// Starting points shown in the UI; nothing is fetched until you add one.
export const SOURCE_PRESETS: Array<Omit<Source, 'id' | 'enabled' | 'maxItems'>> = [
  { kind: 'arxiv', name: 'arXiv · Retrieval & RAG', section: 'research', query: 'cat:cs.IR AND (abs:retrieval OR abs:"retrieval-augmented")' },
  { kind: 'arxiv', name: 'arXiv · LLM agents', section: 'research', query: '(cat:cs.AI OR cat:cs.CL) AND abs:agent AND abs:"language model"' },
  { kind: 'arxiv', name: 'arXiv · Knowledge graphs + LLMs', section: 'research', query: '(cat:cs.CL OR cat:cs.AI) AND abs:"knowledge graph"' },
  { kind: 'rss', name: 'Hacker News (150+ points)', section: 'tech', url: 'https://hnrss.org/frontpage?points=150' },
  { kind: 'rss', name: 'Simon Willison', section: 'tech', url: 'https://simonwillison.net/atom/everything/' },
]

export function sourceUrl(s: Source): string {
  if (s.kind === 'arxiv') {
    const q = new URLSearchParams({
      search_query: s.query ?? '',
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(s.maxItems),
    })
    return `https://${ARXIV_HOST}/api/query?${q}`
  }
  return s.url ?? ''
}

export function readSources(): Source[] {
  try {
    const raw = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8')) as { sources?: unknown[] }
    return (raw.sources ?? []).flatMap(s => {
      const v = validateSource(s)
      return typeof v === 'string' ? [] : [v]
    })
  } catch {
    return []
  }
}

export function writeSources(sources: Source[]): void {
  fs.mkdirSync(path.dirname(SOURCES_PATH), { recursive: true })
  fs.writeFileSync(SOURCES_PATH, JSON.stringify({ sources }, null, 2), 'utf-8')
}

// Hosts the egress module may contact first-hop: exactly what's configured.
export function allowedHosts(sources = readSources()): Set<string> {
  const hosts = new Set<string>()
  for (const s of sources) {
    if (!s.enabled) continue
    try { hosts.add(new URL(sourceUrl(s)).hostname.toLowerCase()) } catch { /* invalid — skipped */ }
  }
  return hosts
}

export function slugSection(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9äöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'general'
}

// Untrusted input (request body or hand-edited file) → Source, or an error message.
export function validateSource(input: unknown): Source | string {
  if (!input || typeof input !== 'object') return 'Source must be an object'
  const o = input as Record<string, unknown>
  const kind = o.kind
  if (kind !== 'arxiv' && kind !== 'rss') return "kind must be 'arxiv' or 'rss'"
  const name = String(o.name ?? '').trim().slice(0, 80)
  if (!name) return 'Every source needs a name'
  const maxItems = Math.min(100, Math.max(5, Math.floor(Number(o.maxItems) || 30)))
  const base = {
    id: String(o.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || Math.random().toString(36).slice(2, 10),
    kind,
    name,
    section: slugSection(String(o.section ?? 'general')),
    enabled: o.enabled !== false,
    maxItems,
  } as const
  if (kind === 'arxiv') {
    const query = String(o.query ?? '').trim().slice(0, 500)
    if (!query) return `${name}: an arXiv source needs a search query`
    return { ...base, query }
  }
  const url = String(o.url ?? '').trim()
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return `${name}: feed URL must be http(s)`
  } catch {
    return `${name}: invalid feed URL`
  }
  return { ...base, url }
}
