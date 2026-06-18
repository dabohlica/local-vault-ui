import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { runCaretake } from '@/lib/caretake'

// GET → the current schedule, so the in-app scheduler knows when/how often to run.
export async function GET() {
  const c = getConfig()
  return NextResponse.json({
    caretakeEnabled: c.caretakeEnabled,
    caretakeHour: c.caretakeHour,
    syncIntervalHours: c.syncIntervalHours,
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
