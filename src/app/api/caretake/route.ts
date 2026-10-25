import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { runCaretake } from '@/lib/caretake'
import { ensureWatcher } from '@/lib/watcher'
import { readSchedulerState, startScheduler } from '@/lib/scheduler'

// GET → the schedule plus the last nightly result (the client toasts when a new
// one landed). Also a heartbeat that (re)starts the server-side scheduler and the
// live-indexing watcher, in case instrumentation didn't run (e.g. dev HMR).
export async function GET() {
  const c = getConfig()
  startScheduler()
  const watcher = ensureWatcher()
  const state = readSchedulerState()
  return NextResponse.json({
    caretakeEnabled: c.caretakeEnabled,
    caretakeHour: c.caretakeHour,
    syncIntervalHours: c.syncIntervalHours,
    watcher,
    lastFullAt: state.lastFullAt,
    lastFullSummary: state.lastFullSummary,
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
