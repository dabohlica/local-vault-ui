import fs from 'fs'
import path from 'path'
import { appendToLog } from '@/lib/vault'

// Structured operations log — the source of truth for the traceability Timeline.
// Each vault-write records one line of JSON to data/operations.jsonl (app-side,
// gitignored, never touches the vault). We ALSO mirror a prose entry into the
// Obsidian-native Logs/<date>.md so the vault keeps its human-readable log; the
// JSONL is just what the UI can reliably scan into a timeline.

const OPS_PATH = path.join(process.cwd(), 'data', 'operations.jsonl')

export type OpAction = 'create' | 'update' | 'move' | 'delete'
export type OpChange = { action: OpAction; path: string; from?: string; to?: string }
export type Operation = {
  ts: string          // ISO timestamp
  origin: string      // where it came from: add | chat | drop | health | interlink | synthesize | caretaker | edit
  summary: string     // one-line human summary
  changes: OpChange[] // what changed, per file
}

function affectedLine(changes: OpChange[]): string {
  return changes
    .map(c => (c.action === 'move' ? `${c.from} → ${c.to}` : `${c.action} ${c.path}`))
    .join(', ')
}

// Record one vault-write operation. Best-effort: a logging failure must never
// break the write that already happened.
export function recordOperation(op: { origin: string; summary: string; changes: OpChange[] }): void {
  if (!op.changes.length) return
  const entry: Operation = { ts: new Date().toISOString(), origin: op.origin, summary: op.summary, changes: op.changes }
  try {
    fs.mkdirSync(path.dirname(OPS_PATH), { recursive: true })
    fs.appendFileSync(OPS_PATH, JSON.stringify(entry) + '\n', 'utf-8')
  } catch { /* timeline is best-effort */ }

  try {
    const affected = affectedLine(op.changes)
    appendToLog(`${op.summary}${affected ? `\n\nAffected: ${affected}` : ''}`)
  } catch { /* markdown log is best-effort too */ }
}

// Most recent operations, newest first. Tolerates a partial/corrupt file so a
// single bad line never blanks the whole timeline.
export function readOperations(limit = 100): Operation[] {
  let raw: string
  try { raw = fs.readFileSync(OPS_PATH, 'utf-8') } catch { return [] }
  const ops: Operation[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const op = JSON.parse(t) as Operation
      if (op?.ts && Array.isArray(op.changes)) ops.push(op)
    } catch { /* skip corrupt line */ }
  }
  return ops.reverse().slice(0, limit)
}
