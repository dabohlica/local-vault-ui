import { readNote, stripFrontmatter, listAllNotes } from '@/lib/vault'
import type { ProposalChange } from '@/lib/structuredOutput'

// Deterministic no-content-loss audit for the unattended nightly curation pass.
// The prompt already tells the model to be strictly additive, but a small local
// model WILL sometimes rewrite anyway — and overnight there is no user watching.
// This is the enforcement layer: pure code, no LLM, run on every proposed change
// before it reaches the pending queue. A change that would lose existing note
// content is dropped (with a reason for the log); a change that merely looks
// suspicious is kept but annotated with warnings the review UI surfaces.

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

// Inspect a proposed replacement for an existing note. Returns a drop reason for
// clear content loss, else the warnings to annotate the change with:
// - changed/removed lines within the tolerated ratio
// - surviving lines no longer in their original order (content preserved but the
//   note restructured — the model was told "unchanged and in order")
function inspectUpdate(current: string, proposed: string): { drop: string | null; warnings: string[] } {
  const curLines = nonBlankLines(current)
  const proposedLines = nonBlankLines(proposed)
  const proposedSet = new Set(proposedLines)

  const deleted = curLines.filter(l => !proposedSet.has(l))
  const ratio = curLines.length ? deleted.length / curLines.length : 0
  if (ratio > MAX_DELETED_LINE_RATIO) {
    return {
      drop: `would remove ${deleted.length} of ${curLines.length} existing line(s) — looks like a rewrite, not an addition`,
      warnings: [],
    }
  }

  const missingHeadings = headings(current).filter(h => !proposedSet.has(h))
  if (missingHeadings.length > 0) {
    return { drop: `would drop section heading(s): ${missingHeadings.join(', ')}`, warnings: [] }
  }

  const warnings: string[] = []
  if (deleted.length > 0) {
    warnings.push(`Changes ${deleted.length} existing line(s) — review the red lines carefully`)
  }

  // Order check: the surviving current lines must appear in the proposal in their
  // original order (in-order subsequence). Duplicated lines can rarely false-hit;
  // acceptable for a warning.
  const surviving = curLines.filter(l => proposedSet.has(l))
  let matched = 0
  for (const line of proposedLines) {
    if (matched < surviving.length && line === surviving[matched]) matched++
  }
  if (matched < surviving.length) {
    warnings.push('Existing lines appear reordered — review the structure carefully')
  }

  return { drop: null, warnings }
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Squashed body of every vault note, for duplicate checks. Built at most once per
// audit call (only when a delete is actually proposed), not per delete candidate.
function buildSquashedBodies(): Map<string, string> {
  const map = new Map<string, string>()
  for (const note of listAllNotes()) {
    const content = readNote(note.path)
    if (content) map.set(note.path, squash(content))
  }
  return map
}

export function auditNightlyChanges(
  changes: ProposalChange[],
  truncatedPaths: Set<string>
): NightlyAudit {
  const kept: AuditedChange[] = []
  const dropped: Array<{ path: string; reason: string }> = []
  let squashedBodies: Map<string, string> | null = null

  for (const change of changes) {
    const target = change.action === 'move' ? change.from : change.path
    if (!target && !(change.from && change.to)) continue

    // Never touch a note the model saw only truncated.
    if (target && truncatedPaths.has(target) && change.action !== 'create') {
      dropped.push({ path: target, reason: 'note was truncated in the prompt — model never saw it in full' })
      continue
    }

    // A delete is only safe when the note's body already lives verbatim inside
    // some other note (a true duplicate). Whitespace-normalized containment.
    if (change.action === 'delete') {
      const current = target ? readNote(target) : null
      if (!current) { kept.push(change); continue } // already gone
      squashedBodies ??= buildSquashedBodies()
      const needle = squash(stripFrontmatter(current))
      let duplicate = false
      if (needle) {
        for (const [path, body] of Array.from(squashedBodies)) {
          if (path !== target && body.includes(needle)) { duplicate = true; break }
        }
      }
      if (duplicate) kept.push(change)
      else dropped.push({ path: target!, reason: 'not a verbatim duplicate of any other note — deleting would lose content' })
      continue
    }

    // Everything that writes content over an existing note is audited the same
    // way — including "create" over an existing file (a disguised rewrite) and
    // "move" with a content rewrite (audited against the from-file). A move
    // without content is a pure relocation and passes through.
    const current = typeof change.content === 'string' && target ? readNote(target) : null
    if (!current) { kept.push(change); continue }
    const { drop, warnings } = inspectUpdate(current, change.content!)
    if (drop) { dropped.push({ path: target!, reason: drop }); continue }
    kept.push(warnings.length ? { ...change, warnings } : change)
  }

  return { kept, dropped }
}

// Warnings-only variant for ATTENDED proposal flows (curate, chat, commands,
// ingest): the user is present and reviews the diff, so nothing is dropped — but
// a lossy update shouldn't look innocuous either. Attaches the same warnings the
// nightly audit computes, comparing each write against the note on disk.
export function annotateLossWarnings<
  T extends { path?: string; action?: string; content?: string; from?: string; to?: string }
>(changes: T[]): Array<T & { warnings?: string[] }> {
  return changes.map(change => {
    const target = change.action === 'move' ? change.from : (change.to ?? change.path)
    if (typeof change.content !== 'string' || !target || change.action === 'delete') return change
    const current = readNote(target)
    if (!current) return change
    const { drop, warnings } = inspectUpdate(current, change.content)
    // In attended flows a would-be drop becomes a loud warning instead.
    const all = drop ? [`Likely rewrite: ${drop}`, ...warnings] : warnings
    return all.length ? { ...change, warnings: all } : change
  })
}
