import fs from 'fs'
import path from 'path'
import { listAllNotes, resolveVaultPath, isMetaNote } from '@/lib/vault'
import { brokenLinkTargets, buildKnownSet } from '@/lib/interlink'
import { graphOverview } from '@/lib/graph'

// Deterministic, fully-local vault structure scan. No model, no network.
// Surfaces drift from the vault's AI-first conventions so the user can fix it.

export type HealthIssue = {
  path: string
  kind: 'missing-frontmatter' | 'missing-preamble' | 'empty' | 'broken-wikilink' | 'relation-type-mismatch' | 'orphan'
  detail: string
}

export type HealthReport = {
  scanned: number
  issues: HealthIssue[]
  counts: Record<HealthIssue['kind'], number>
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---/
const PREAMBLE_RE = /for future claude/i

export function scanVaultHealth(): HealthReport {
  const notes = listAllNotes()

  // Lowercased set of every note's rel-path + basename, for wikilink resolution.
  const known = buildKnownSet(notes)

  const issues: HealthIssue[] = []

  for (const note of notes) {
    if (isMetaNote(note.path)) continue // skip _CLAUDE.md (conventions/scaffold doc)

    let content: string
    try {
      content = fs.readFileSync(resolveVaultPath(note.path), 'utf-8')
    } catch {
      continue
    }

    const trimmed = content.trim()
    if (trimmed.length < 20) {
      issues.push({ path: note.path, kind: 'empty', detail: 'Note is empty or nearly empty' })
      continue
    }

    if (!FRONTMATTER_RE.test(content)) {
      issues.push({ path: note.path, kind: 'missing-frontmatter', detail: 'No YAML frontmatter block at top' })
    }

    if (!PREAMBLE_RE.test(content)) {
      issues.push({ path: note.path, kind: 'missing-preamble', detail: 'No "For future Claude" preamble' })
    }

    // Broken wikilinks — only the ones Auto-fix can actually resolve (see
    // brokenLinkTargets). Flagging unfixable targets (dates, generic words) would
    // produce a count the user can never clear by clicking "fix".
    for (const target of brokenLinkTargets(content, known)) {
      issues.push({ path: note.path, kind: 'broken-wikilink', detail: `[[${target}]] has no matching note` })
    }
  }

  // Graph/schema checks: typed relations pointing at the wrong kind of note
  // (related-people → a project), and notes nothing links to or from.
  const graph = graphOverview()
  issues.push(...graph.issues)
  for (const p of graph.orphans) {
    issues.push({ path: p, kind: 'orphan', detail: 'No links to or from this note — Tools → Connect notes can suggest some' })
  }

  const counts: HealthReport['counts'] = {
    'missing-frontmatter': 0,
    'missing-preamble': 0,
    'empty': 0,
    'broken-wikilink': 0,
    'relation-type-mismatch': 0,
    'orphan': 0,
  }
  for (const i of issues) counts[i.kind]++

  return { scanned: notes.length, issues, counts }
}

// Home asks on every visit; a vault-wide scan reads every note, so reuse a
// recent result — but rescan as soon as the app writes anything (every write is
// appended to data/operations.jsonl), so a Health check fix shows at once.
// Edits made outside the app (Obsidian) show within a minute.
const HEALTH_TTL_MS = 60_000
const OPS_LOG = path.join(process.cwd(), 'data', 'operations.jsonl')
const HC = ((globalThis as unknown as { __vaultHealthCache?: { at: number; opsMtime: number; report: HealthReport | null } }).__vaultHealthCache ??= { at: 0, opsMtime: 0, report: null })

export function cachedHealthScan(now = Date.now()): HealthReport {
  let opsMtime = 0
  try { opsMtime = fs.statSync(OPS_LOG).mtimeMs } catch { /* no writes yet */ }
  if (!HC.report || now - HC.at > HEALTH_TTL_MS || opsMtime !== HC.opsMtime) {
    HC.report = scanVaultHealth()
    HC.at = now
    HC.opsMtime = opsMtime
  }
  return HC.report
}
