import fs from 'fs'
import { syncIndex, indexStats } from '@/lib/embeddings'
import { scanVaultHealth, type HealthReport } from '@/lib/health'
import { buildHealthFixChanges, normalizeChanges } from '@/lib/healthFix'
import { appendToLog, listAllNotes, readNote, resolveVaultPath, isMetaNote, contentHash, stampBaseHashes } from '@/lib/vault'
import { recordOperation, type OpChange } from '@/lib/opsLog'
import { buildNightlyCurationPrompt, type NightlyNote } from '@/lib/prompts'
import { ollamaChatStructured } from '@/lib/ollama'
import { auditNightlyChanges } from '@/lib/nightlyGuard'
import type { ProposalChange } from '@/lib/structuredOutput'
import { getConfig } from '@/lib/config'
import { savePending } from '@/lib/pending'

// Shared caretaking routine, run both on-demand and by the in-app scheduler.
// Fully local. Two tiers, matching the user's chosen "auto-apply safe steps only":
//   - SAFE, auto-applied: index sync + deterministic health fixes (add missing
//     frontmatter / "For future Claude" preamble, body preserved verbatim).
//   - RISKY, queued for review: a model-generated curation proposal over the notes
//     that changed in the last day — saved to the pending queue, never written
//     unattended. The user approves it (as diffs) in the morning.

export type CaretakeResult = {
  mode: 'sync' | 'full'
  sync: { notes: number; chunks: number; skipped: number }
  health: HealthReport | null
  fixesApplied: number
  proposalsQueued: number
  ranAt: string
}

const DAY_MS = 24 * 60 * 60 * 1000

// One full run at a time: the scheduler and a manual/cron POST /api/caretake can
// overlap, and two concurrent nightly passes would queue duplicate proposals.
const inflight = ((globalThis as unknown as { __vaultCaretake?: { full: Promise<CaretakeResult> | null } }).__vaultCaretake ??= { full: null })

export function runCaretake(mode: 'sync' | 'full'): Promise<CaretakeResult> {
  if (mode === 'sync') return runCaretakeOnce('sync')
  inflight.full ??= runCaretakeOnce('full').finally(() => { inflight.full = null })
  return inflight.full
}

async function runCaretakeOnce(mode: 'sync' | 'full'): Promise<CaretakeResult> {
  const sync = await syncIndex()

  let health: HealthReport | null = null
  let fixesApplied = 0
  let proposalsQueued = 0

  if (mode === 'full') {
    health = scanVaultHealth()

    // 1) SAFE — auto-apply deterministic structural fixes (content-preserving).
    fixesApplied = applyDeterministicHealthFixes()
    if (fixesApplied > 0) await syncIndex()

    // 2) RISKY — generate a curation proposal over recently-changed notes and
    //    QUEUE it for morning review. Best-effort: a model hiccup must not break
    //    the safe steps above.
    try {
      proposalsQueued = await queueNightlyCuration()
    } catch { /* model unavailable / bad JSON — skip, try again tomorrow */ }

    const stats = indexStats()
    const issueLine = Object.entries(health.counts)
      .filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'no issues'

    appendToLog(
      `Nightly caretake\n\n` +
        `- Index: ${stats.notes} notes, ${stats.chunks} chunks (${sync.notes} re-embedded${sync.skipped.length ? `, ${sync.skipped.length} skipped` : ''})\n` +
        `- Health: scanned ${health.scanned} notes — ${issueLine}\n` +
        `- Auto-applied ${fixesApplied} structural fix(es) (frontmatter / preamble)\n` +
        `- Queued ${proposalsQueued} curation proposal(s) for your review`
    )
  }

  return {
    mode,
    sync: { notes: sync.notes, chunks: indexStats().chunks, skipped: sync.skipped.length },
    health,
    fixesApplied,
    proposalsQueued,
    ranAt: new Date().toISOString(),
  }
}

// Apply every deterministic structural fix in the vault, writing directly (these
// only ADD frontmatter/preamble and preserve the body). Returns the count written.
function applyDeterministicHealthFixes(): number {
  const { changes } = buildHealthFixChanges()
  const done: OpChange[] = []
  for (const change of changes) {
    try {
      fs.writeFileSync(resolveVaultPath(change.path), change.content, 'utf-8')
      done.push({ action: change.action, path: change.path })
    } catch { /* skip a note we can't write */ }
  }
  if (done.length > 0) {
    recordOperation({
      origin: 'caretaker',
      summary: `Auto-fixed structure on ${done.length} note(s) (frontmatter / preamble)`,
      changes: done,
    })
  }
  return done.length
}

// The nightly job's purpose is to CONNECT the vault, not rewrite it: the user's
// own note text is the value (all local, nothing to "enrich" from outside). So the
// model is grounded on the FULL content of the changed notes — not on retrieval
// fragments, which is how earlier versions hallucinated whole-note rewrites — and
// every proposed change passes the deterministic auditNightlyChanges() no-loss
// guard before it may reach the pending queue. Deliberately NO reconcileUpdates()
// here: the prompt already demands full additive content, and a second LLM merge
// pass can only degrade a proposal the guard would have accepted.
// The caps live in AppConfig (nightly*) — tunable via data/config.json, no UI.

// Cut text at a cap, snapping back to the last line boundary so the model never
// sees a note ending mid-line or mid-frontmatter.
function truncateAtLine(content: string, cap: number): string {
  const cut = content.slice(0, cap)
  const nl = cut.lastIndexOf('\n')
  return nl > cap / 2 ? cut.slice(0, nl) : cut
}

// Ask the local model to propose how to interconnect/organize the notes that
// changed in the last day. Saves proposals to the pending queue (does NOT write
// to the vault). Returns the number of proposals queued.
async function queueNightlyCuration(): Promise<number> {
  const cfg = getConfig()
  const cutoff = Date.now() - DAY_MS
  const all = listAllNotes()
  // Meta notes (Logs/, _CLAUDE.md) are excluded: feeding the caretaker its own
  // log makes the model synthesize notes about the caretaking run itself.
  const recent = all
    .filter(n => n.mtime.getTime() >= cutoff && !isMetaNote(n.path))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  if (recent.length === 0) return 0
  if (recent.length > cfg.nightlySkipThreshold) {
    appendToLog(
      `Nightly curation skipped: ${recent.length} notes changed in the last day (looks like a bulk ` +
        `import). Curation resumes when the vault settles.`
    )
    return 0
  }

  const skipped = Math.max(0, recent.length - cfg.nightlyMaxNotes)
  const selected = recent.slice(0, cfg.nightlyMaxNotes)

  // Load the full current content of each changed note — the model must see what
  // it is annotating. Oversized notes are truncated and marked read-only.
  const notes: NightlyNote[] = []
  for (const n of selected) {
    const content = readNote(n.path)
    if (!content) continue
    const truncated = content.length > cfg.nightlyPerNoteChars
    notes.push({ path: n.path, content: truncated ? truncateAtLine(content, cfg.nightlyPerNoteChars) : content, truncated })
  }
  if (notes.length === 0) return 0

  const truncatedPaths = new Set(notes.filter(n => n.truncated).map(n => n.path))
  // Fingerprint exactly what the model is shown, so a note edited between now and
  // the morning review can't be silently overwritten by this proposal.
  const seenHashes = new Map(notes.filter(n => !n.truncated).map(n => [n.path, contentHash(n.content)]))
  const allPaths = all.map(n => n.path).slice(0, cfg.nightlyMaxMapPaths)

  // Group related notes into the same LLM call (linking/dedup needs co-visibility)
  // by sorting on path, then greedy-pack into size-bounded batches.
  const byFolder = [...notes].sort((a, b) => a.path.localeCompare(b.path))
  const batches: NightlyNote[][] = []
  let batch: NightlyNote[] = []
  let batchChars = 0
  for (const note of byFolder) {
    if (batch.length > 0 && batchChars + note.content.length > cfg.nightlyBatchChars) {
      batches.push(batch)
      batch = []
      batchChars = 0
    }
    batch.push(note)
    batchChars += note.content.length
  }
  if (batch.length > 0) batches.push(batch)

  let queued = 0
  for (const b of batches.slice(0, cfg.nightlyMaxBatches)) {
    // Best-effort per batch: one bad model reply must not lose the other batches.
    try {
      const messages = buildNightlyCurationPrompt(b, allPaths)
      const { result } = await ollamaChatStructured<{ changes?: ProposalChange[]; log_entry?: string; summary?: string }>({ messages, role: 'librarian' })
      if (!result || !Array.isArray(result.changes) || result.changes.length === 0) continue

      // Deterministic structure pass (frontmatter/preamble), then enforce the
      // no-content-loss rules.
      const { kept, dropped } = auditNightlyChanges(normalizeChanges(result.changes), truncatedPaths)
      if (kept.length === 0) continue

      const guardNote = dropped.length
        ? `\n\nGuard removed ${dropped.length} destructive change(s): ` +
          dropped.map(d => `${d.path} (${d.reason})`).join('; ')
        : ''
      savePending({
        origin: 'nightly-curation',
        summary: result.summary || `Overnight curation over ${b.length} recently-changed note(s)`,
        log_entry: (result.log_entry || 'Overnight curation proposal.') + guardNote,
        changes: stampBaseHashes(kept, seenHashes),
      })
      queued++
    } catch { /* model unavailable / bad reply — next batch, or try again tomorrow */ }
  }

  if (skipped > 0) {
    appendToLog(`Nightly curation processed the ${cfg.nightlyMaxNotes} most recent notes; ${skipped} more wait for the next run.`)
  }
  return queued
}
