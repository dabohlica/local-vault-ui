import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { isMetaNote, listAllNotes, resolveVaultPath, getVaultPath } from '@/lib/vault'
import { BODY_LINK, NON_RELATION_FIELDS, RELATION_TARGETS, inferType, isNoteType } from '@/lib/schema'

// The vault as a graph: notes are nodes; [[wikilinks]] in the body and in
// frontmatter relation fields (related-people, related-projects, …) are edges.
// Built from the files alone — no model, no embedder — so it is always current
// and works while the index is re-embedding. Kept in memory and refreshed
// incrementally by mtime (only changed notes are re-read), at most every few
// seconds.
//
// Used for: backlinks/connections in the Explorer, graph-aware retrieval
// (linked notes of the best hits get a boost), linked-note hints in chat
// context, and schema checks (a related-people link must point at a person).

export type GraphNode = {
  path: string
  title: string
  type: string | null    // declared `type:` (lowercased), else inferred from folder
  typeInferred: boolean
}
export type RawEdge = { target: string; kind: string } // target as written, e.g. "People/Jane Smith"
export type ParsedNote = { type: string | null; edges: RawEdge[] }

export type Connection = { path: string | null; target: string; kind: string; type: string | null }
export type SchemaIssue = { path: string; kind: 'relation-type-mismatch'; detail: string }

const REFRESH_MS = 5000
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|mp4|mov|mp3|wav|canvas|base)$/i

// --- Parsing (pure) -----------------------------------------------------------

function linkTargets(text: string, includeEmbeds = false): string[] {
  const out: string[] = []
  for (const m of Array.from(text.matchAll(/(!?)\[\[([^\]|#^]+)(?:[#^|][^\]]*)?\]\]/g))) {
    if (m[1] && !includeEmbeds) continue
    const t = m[2].trim().replace(/^\/+/, '')
    if (t && !ASSET_EXT.test(t)) out.push(t.replace(/\.md$/i, ''))
  }
  return out
}

function asStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(asStrings)
  return []
}

export function parseNote(content: string): ParsedNote {
  let data: Record<string, unknown> = {}
  let body = content
  try {
    const parsed = matter(content)
    data = parsed.data as Record<string, unknown>
    body = parsed.content
  } catch { /* malformed frontmatter — treat the whole file as body */ }

  const edges: RawEdge[] = []
  const seen = new Set<string>()
  const add = (target: string, kind: string) => {
    const k = `${kind}\u0000${target.toLowerCase()}`
    if (!seen.has(k)) { seen.add(k); edges.push({ target, kind }) }
  }
  for (const [field, value] of Object.entries(data)) {
    const kind = field.toLowerCase()
    if (NON_RELATION_FIELDS.has(kind)) continue
    // YAML turns unquoted [[X]] into nested arrays [["X"]]; quoted it stays text.
    const flat = asStrings(value)
    const links = flat.flatMap(s => linkTargets(s))
    const nested = Array.isArray(value) && value.some(Array.isArray) ? flat.filter(s => !s.includes('[[')) : []
    for (const t of [...links, ...nested]) add(t.replace(/\.md$/i, ''), kind)
  }
  const code = /```[\s\S]*?```|`[^`\n]*`/g
  for (const t of linkTargets(body.replace(code, ''))) add(t, BODY_LINK)

  const declared = typeof data.type === 'string' ? data.type.trim().toLowerCase() : null
  return { type: declared || null, edges }
}

// --- In-memory graph -------------------------------------------------------------

type Entry = { mtime: number; node: GraphNode; edges: RawEdge[] }
type GraphState = {
  vault: string
  entries: Map<string, Entry>
  checkedAt: number
  // Derived, rebuilt after any change:
  byPath: Map<string, string>   // lowercased path sans .md → path
  byBase: Map<string, string[]> // lowercased basename → paths
  out: Map<string, Connection[]>
  in: Map<string, Connection[]>
}
const G = (globalThis as unknown as { __vaultGraph?: GraphState | null })

function emptyState(vault: string): GraphState {
  return { vault, entries: new Map(), checkedAt: 0, byPath: new Map(), byBase: new Map(), out: new Map(), in: new Map() }
}

// Obsidian-style resolution: exact vault path, else unique basename, else (for
// "Folder/Note") a path ending in it. Ambiguous basenames prefer the shortest path.
export function resolveTarget(target: string, byPath: Map<string, string>, byBase: Map<string, string[]>): string | null {
  const key = target.toLowerCase()
  const exact = byPath.get(key)
  if (exact) return exact
  const base = key.split('/').pop()!
  const candidates = byBase.get(base) ?? []
  const suffix = candidates.filter(p => p.toLowerCase().replace(/\.md$/, '').endsWith(key))
  const pool = key.includes('/') ? suffix : candidates
  if (!pool.length) return null
  return [...pool].sort((a, b) => a.length - b.length)[0]
}

function derive(state: GraphState): void {
  state.byPath = new Map()
  state.byBase = new Map()
  state.entries.forEach((_, p) => {
    const key = p.replace(/\.md$/, '').toLowerCase()
    state.byPath.set(key, p)
    const base = key.split('/').pop()!
    state.byBase.set(base, [...(state.byBase.get(base) ?? []), p])
  })
  state.out = new Map()
  state.in = new Map()
  state.entries.forEach((e, src) => {
    const outs: Connection[] = []
    for (const edge of e.edges) {
      const dst = resolveTarget(edge.target, state.byPath, state.byBase)
      if (dst === src) continue
      const dstNode = dst ? state.entries.get(dst)?.node : undefined
      outs.push({ path: dst, target: edge.target, kind: edge.kind, type: dstNode?.type ?? null })
      if (dst) state.in.set(dst, [...(state.in.get(dst) ?? []), { path: src, target: src, kind: edge.kind, type: e.node.type }])
    }
    state.out.set(src, outs)
  })
}

function refresh(force = false): GraphState {
  const vault = getVaultPath()
  let state = G.__vaultGraph
  if (!state || state.vault !== vault) state = G.__vaultGraph = emptyState(vault)
  if (!vault) return state
  if (!force && Date.now() - state.checkedAt < REFRESH_MS) return state
  state.checkedAt = Date.now()

  let changed = false
  const present = new Set<string>()
  for (const { path: p, mtime } of listAllNotes()) {
    if (isMetaNote(p)) continue
    present.add(p)
    const m = mtime.getTime()
    if (state.entries.get(p)?.mtime === m) continue
    let content: string
    try { content = fs.readFileSync(resolveVaultPath(p), 'utf-8') } catch { continue }
    const parsed = parseNote(content)
    const inferred = inferType(p)
    state.entries.set(p, {
      mtime: m,
      edges: parsed.edges,
      node: {
        path: p,
        title: path.basename(p, '.md'),
        type: parsed.type ?? inferred,
        typeInferred: !parsed.type && !!inferred,
      },
    })
    changed = true
  }
  for (const p of Array.from(state.entries.keys())) {
    if (!present.has(p)) { state.entries.delete(p); changed = true }
  }
  if (changed) derive(state)
  return state
}

export function invalidateGraph(): void {
  if (G.__vaultGraph) G.__vaultGraph.checkedAt = 0
}

// --- Queries ---------------------------------------------------------------------

export function getNode(notePath: string): GraphNode | null {
  return refresh().entries.get(notePath)?.node ?? null
}

// Notes linked to or from this one (resolved only).
export function neighbors(notePath: string): Set<string> {
  const s = refresh()
  const out = new Set<string>()
  for (const c of s.out.get(notePath) ?? []) if (c.path) out.add(c.path)
  for (const c of s.in.get(notePath) ?? []) if (c.path) out.add(c.path)
  return out
}

export function schemaIssuesFor(notePath: string, outgoing: Connection[]): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  for (const c of outgoing) {
    const expected = RELATION_TARGETS[c.kind]
    if (!expected || !c.path || !c.type || !isNoteType(c.type) || c.type === expected) continue
    issues.push({
      path: notePath,
      kind: 'relation-type-mismatch',
      detail: `${c.kind}: [[${c.target}]] is a ${c.type} note, expected ${expected}`,
    })
  }
  return issues
}

export function connections(notePath: string): {
  node: GraphNode | null
  outgoing: Connection[]
  backlinks: Connection[]
  issues: SchemaIssue[]
} {
  const s = refresh()
  const outgoing = s.out.get(notePath) ?? []
  return {
    node: s.entries.get(notePath)?.node ?? null,
    outgoing,
    backlinks: s.in.get(notePath) ?? [],
    issues: schemaIssuesFor(notePath, outgoing),
  }
}

const ORPHAN_EXEMPT = /^(daily|logs?)\//i // dated notes are fine unlinked

export function graphOverview(): {
  notes: number
  edges: number
  unresolved: number
  types: Record<string, number>
  orphans: string[]
  issues: SchemaIssue[]
} {
  const s = refresh()
  let edges = 0
  let unresolved = 0
  const types: Record<string, number> = {}
  const orphans: string[] = []
  const issues: SchemaIssue[] = []
  s.entries.forEach((e, p) => {
    const outs = s.out.get(p) ?? []
    edges += outs.filter(c => c.path).length
    unresolved += outs.filter(c => !c.path).length
    const t = e.node.type ?? '(none)'
    types[t] = (types[t] ?? 0) + 1
    if (!outs.some(c => c.path) && !(s.in.get(p)?.length) && !ORPHAN_EXEMPT.test(p)) orphans.push(p)
    issues.push(...schemaIssuesFor(p, outs))
  })
  return { notes: s.entries.size, edges, unresolved, types, orphans: orphans.sort(), issues }
}
