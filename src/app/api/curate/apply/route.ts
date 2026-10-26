import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { resolveVaultPath, moveNote, deleteNote, fileHash, changeTarget } from '@/lib/vault'
import { syncIndex } from '@/lib/embeddings'
import { recordOperation, type OpChange } from '@/lib/opsLog'
import { checkWrite } from '@/lib/writeGuard'

type Change = {
  path: string
  action: 'create' | 'update' | 'move' | 'delete'
  content?: string
  from?: string // for move
  to?: string   // for move (defaults to `path`)
  // Fingerprint of the target when the proposal was built/reviewed (null = it
  // didn't exist). If the file has changed since, the change is refused rather
  // than overwriting edits made in between. Omitted = no check (legacy callers).
  baseHash?: string | null
  // The user explicitly approved an update that removes over half the note.
  confirmShrink?: boolean
}

function readOrNull(rel: string): string | null {
  try { return fs.readFileSync(resolveVaultPath(rel), 'utf-8') } catch { return null }
}

// Last line of defence for every write (see src/lib/writeGuard.ts): never write
// a placeholder over a note, and never silently halve one.
function guard(change: Change): void {
  if (change.content === undefined || change.action === 'delete') return
  const target = change.action === 'move' ? (change.from ?? change.path) : change.path
  const g = checkWrite(readOrNull(target), change.content)
  if (g.blocked) throw new Error(g.blocked)
  if (g.needsConfirm && !change.confirmShrink) throw new Error(`${g.warnings[0]}. Tick it explicitly to apply.`)
}

// Apply a reviewed set of vault changes: create/update writes, plus the caretaker
// operations move (rename/relocate) and delete. Path-contained, logged, and the
// embedding index is re-synced so retrieval stays correct after files move.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { changes: Change[]; log_entry?: string; origin?: string }

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
    }

    const written: string[] = []
    const applied: OpChange[] = [] // structured record of what actually changed
    const errors: string[] = []

    for (const change of body.changes) {
      try {
        if (change.baseHash !== undefined) {
          const target = changeTarget(change)
          if (target && fileHash(target) !== change.baseHash) {
            throw new Error('changed since this proposal was made — not applied, so your newer edits are kept. Re-run the proposal.')
          }
        }
        guard(change)
        switch (change.action) {
          case 'move': {
            const to = change.to ?? change.path
            const from = change.from
            if (!from || !to) throw new Error('move requires from and to')
            moveNote(from, to)
            // Optionally also rewrite the moved file's content in the same step.
            if (change.content !== undefined) {
              fs.writeFileSync(resolveVaultPath(to), change.content, 'utf-8')
            }
            written.push(`${from} → ${to}`)
            applied.push({ action: 'move', path: to, from, to })
            break
          }
          case 'delete': {
            deleteNote(change.path)
            written.push(`deleted ${change.path}`)
            applied.push({ action: 'delete', path: change.path })
            break
          }
          case 'create':
          case 'update':
          default: {
            if (change.content === undefined) continue
            const absPath = resolveVaultPath(change.path)
            const existed = fs.existsSync(absPath)
            fs.mkdirSync(path.dirname(absPath), { recursive: true })
            fs.writeFileSync(absPath, change.content, 'utf-8')
            written.push(change.path)
            applied.push({ action: existed ? 'update' : 'create', path: change.path })
          }
        }
      } catch (e) {
        errors.push(`${changeTarget(change) ?? change.path}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    if (applied.length) {
      recordOperation({
        origin: body.origin ?? 'edit',
        summary: body.log_entry?.split('\n')[0]?.trim() || `Updated ${applied.length} note(s) via local AI assistant`,
        changes: applied,
      })
    }

    // Re-sync the index so moved/deleted/created notes are reflected in retrieval.
    try { await syncIndex() } catch { /* embed model may be down — index self-heals later */ }

    return NextResponse.json({ success: errors.length === 0, written, errors })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Apply failed' },
      { status: 500 }
    )
  }
}
