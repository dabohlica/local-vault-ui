import fs from 'fs'
import { resolveVaultPath, listAllNotes } from '@/lib/vault'
import type { ProposalChange } from '@/lib/structuredOutput'

// Deterministic no-content-loss audit for the unattended nightly curation pass.
// The prompt already tells the model to be strictly additive, but a small local
// model WILL sometimes rewrite anyway — and overnight there is no user watching.
// This is the enforcement layer: pure code, no LLM, run on every proposed change
// before it reaches the pending queue. A change that would lose existing note
// content is dropped (with a reason for the log); a change that merely looks
// suspicious is kept but annotated with warnings the review UI can surface.

export type AuditedChange = ProposalChange & { warnings?: string[] }

export type NightlyAudit = {
  kept: AuditedChange[]
  dropped: Array<{ path: string; reason: string }>
}

// Share of a note's existing lines an "additive" update may lose before we treat
// it as a rewrite and drop it. A small tolerance is needed because legitimate
// updates touch a few lines (frontmatter "updated:", a heading gaining a link).
const MAX_DELETED_LINE_RATIO = 0.15

function nonBlankLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}

function headings(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => /^#{1,6}\s/.test(l))
}

function readCurrent(path: string): string | null {
  try {
    const content = fs.readFileSync(resolveVaultPath(path), 'utf-8')
    return content.trim() ? content : null
  } catch {
    return null
  }
}

// Audit one update-like change (update, or move-with-content) against the note's
// current on-disk content. Returns a drop reason, or null + warnings to keep it.
function auditUpdate(
  current: string,
  proposed: string
): { drop: string | null; warnings: string[] } {
  const warnings: string[] = []

  const curLines = nonBlankLines(current)
  const proposedSet = new Set(nonBlankLines(proposed))
  const deleted = curLines.filter(l => !proposedSet.has(l))
  const ratio = curLines.length ? deleted.length / curLines.length : 0

  if (ratio > MAX_DELETED_LINE_RATIO) {
    return {
      drop: `would remove ${deleted.length} of ${curLines.length} existing line(s) — looks like a rewrite, not an addition`,
      warnings,
    }
  }

  const missingHeadings = headings(current).filter(h => !proposedSet.has(h))
  if (missingHeadings.length > 0) {
    return { drop: `would drop section heading(s): ${missingHeadings.join(', ')}`, warnings }
  }

  if (deleted.length > 0) {
    warnings.push(`Changes ${deleted.length} existing line(s) — review the red lines carefully`)
  }
  if (proposed.length < current.length) {
    warnings.push('Proposed content is shorter than the current note — review carefully')
  }
  return { drop: null, warnings }
}

// A delete is only safe when the note's body already lives verbatim inside some
// other note (a true duplicate). Whitespace-normalized containment check.
function isDuplicateOfAnother(path: string, body: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const needle = squash(body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''))
  if (!needle) return false
  for (const note of listAllNotes()) {
    if (note.path === path) continue
    const other = readCurrent(note.path)
    if (other && squash(other).includes(needle)) return true
  }
  return false
}

export function auditNightlyChanges(
  changes: ProposalChange[],
  truncatedPaths: Set<string> = new Set()
): NightlyAudit {
  const kept: AuditedChange[] = []
  const dropped: Array<{ path: string; reason: string }> = []

  for (const change of changes) {
    const target = change.action === 'move' ? change.from : change.path
    if (!target && !(change.from && change.to)) continue

    // Never touch a note the model saw only truncated.
    if (target && truncatedPaths.has(target) && change.action !== 'create') {
      dropped.push({ path: target, reason: 'note was truncated in the prompt — model never saw it in full' })
      continue
    }

    switch (change.action) {
      case 'create': {
        // "create" over an existing file is a disguised rewrite — audit it like one.
        const current = change.path ? readCurrent(change.path) : null
        if (current && typeof change.content === 'string') {
          const { drop, warnings } = auditUpdate(current, change.content)
          if (drop) { dropped.push({ path: change.path!, reason: drop }); continue }
          kept.push(warnings.length ? { ...change, warnings } : change)
        } else {
          kept.push(change)
        }
        continue
      }
      case 'update': {
        const current = change.path ? readCurrent(change.path) : null
        if (!current || typeof change.content !== 'string') { kept.push(change); continue }
        const { drop, warnings } = auditUpdate(current, change.content)
        if (drop) { dropped.push({ path: change.path!, reason: drop }); continue }
        kept.push(warnings.length ? { ...change, warnings } : change)
        continue
      }
      case 'move': {
        if (typeof change.content !== 'string') { kept.push(change); continue }
        const current = change.from ? readCurrent(change.from) : null
        if (!current) { kept.push(change); continue }
        const { drop, warnings } = auditUpdate(current, change.content)
        if (drop) { dropped.push({ path: change.from!, reason: drop }); continue }
        kept.push(warnings.length ? { ...change, warnings } : change)
        continue
      }
      case 'delete': {
        const current = change.path ? readCurrent(change.path) : null
        if (!current) { kept.push(change); continue } // already gone
        if (isDuplicateOfAnother(change.path!, current)) {
          kept.push(change)
        } else {
          dropped.push({ path: change.path!, reason: 'not a verbatim duplicate of any other note — deleting would lose content' })
        }
        continue
      }
      default:
        kept.push(change)
    }
  }

  return { kept, dropped }
}
