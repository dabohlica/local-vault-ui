import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { runCaretake } from '@/lib/caretake'
import { ensureWatcher } from '@/lib/watcher'

// GET → the current schedule, so the in-app scheduler knows when/how often to run.
// Also a convenient heartbeat to (re)start the live-indexing watcher, since the
// client polls this on load and every few minutes.
export async function GET() {
  const c = getConfig()
  const watcher = ensureWatcher()
  return NextResponse.json({
    caretakeEnabled: c.caretakeEnabled,
    caretakeHour: c.caretakeHour,
    syncIntervalHours: c.syncIntervalHours,
    watcher,
  })
}

// POST { mode: 'sync' | 'full' } → run caretaking now. 'sync' keeps the index
// fresh (cheap, frequent); 'full' also runs a health scan + writes a log entry.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: 'sync' | 'full' }
    const mode = body.mode === 'full' ? 'full' : 'sync'
    const result = await runCaretake(mode)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Caretake failed' },
      { status: 500 }
    )
  }
}
