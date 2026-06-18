import fs from 'fs'
import path from 'path'
import { listAllNotes, resolveVaultPath } from '@/lib/vault'

// Deterministic, fully-local vault structure scan. No model, no network.
// Surfaces drift from the vault's AI-first conventions so the user can fix it.

export type HealthIssue = {
  path: string
  kind: 'missing-frontmatter' | 'missing-preamble' | 'empty' | 'broken-wikilink'
  detail: string
}

export type HealthReport = {
  scanned: number
  issues: HealthIssue[]
  counts: Record<HealthIssue['kind'], number>
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---/
const PREAMBLE_RE = /for future claude/i

// Strip fenced code blocks and inline code so example/illustrative [[links]] inside
// them aren't mistaken for real, broken wikilinks.
function stripCode(s: string): string {
  return s.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
}

// Notes that are documentation/scaffolding, not content — their example links and
// structure shouldn't be health-flagged.
function isMetaNote(notePath: string): boolean {
  return path.basename(notePath).toLowerCase() === '_claude.md'
}

export function scanVaultHealth(): HealthReport {
  const notes = listAllNotes()

  // Build a set of all note basenames + relative paths (without .md) for wikilink resolution.
  const known = new Set<string>()
  for (const n of notes) {
    const rel = n.path.replace(/\.md$/, '')
    known.add(rel.toLowerCase())
    known.add(path.basename(rel).toLowerCase())
  }

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

    // Broken wikilinks: [[Target]] or [[Target|alias]] / [[Target#heading]].
    // Scan code-stripped content so example links in fences aren't false positives.
    const links = Array.from(stripCode(content).matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g))
    const seen = new Set<string>()
    for (const m of links) {
      const target = m[1].trim()
      const key = target.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!known.has(key) && !known.has(path.basename(key))) {
        issues.push({ path: note.path, kind: 'broken-wikilink', detail: `[[${target}]] has no matching note` })
      }
    }
  }

  const counts: HealthReport['counts'] = {
    'missing-frontmatter': 0,
    'missing-preamble': 0,
    'empty': 0,
    'broken-wikilink': 0,
  }
  for (const i of issues) counts[i.kind]++

  return { scanned: notes.length, issues, counts }
}
