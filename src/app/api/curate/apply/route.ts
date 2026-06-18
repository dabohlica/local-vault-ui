import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { resolveVaultPath, appendToLog, moveNote, deleteNote } from '@/lib/vault'
import { syncIndex } from '@/lib/embeddings'

type Change = {
  path: string
  action: 'create' | 'update' | 'move' | 'delete'
  content?: string
  from?: string // for move
  to?: string   // for move (defaults to `path`)
}

// Apply a reviewed set of vault changes: create/update writes, plus the caretaker
// operations move (rename/relocate) and delete. Path-contained, logged, and the
// embedding index is re-synced so retrieval stays correct after files move.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { changes: Change[]; log_entry?: string }

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
    }

    const written: string[] = []
    const errors: string[] = []

    for (const change of body.changes) {
      try {
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
            break
          }
          case 'delete': {
            deleteNote(change.path)
            written.push(`deleted ${change.path}`)
            break
          }
          case 'create':
          case 'update':
          default: {
            if (change.content === undefined) continue
            const absPath = resolveVaultPath(change.path)
            fs.mkdirSync(path.dirname(absPath), { recursive: true })
            fs.writeFileSync(absPath, change.content, 'utf-8')
            written.push(change.path)
          }
        }
      } catch (e) {
        errors.push(`${change.path}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    if (body.log_entry || written.length) {
      appendToLog(
        `Curated via local AI assistant — affected: ${written.join(', ')}` +
          (body.log_entry ? `\n\n${body.log_entry}` : '')
      )
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
