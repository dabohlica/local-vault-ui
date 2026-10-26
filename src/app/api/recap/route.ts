import { NextRequest, NextResponse } from 'next/server'
import { generateRecap, isRecapRunning, readLatestRecap, saveRecapNote } from '@/lib/recap'

export const dynamic = 'force-dynamic'

// GET  → the latest weekly recap (or null) + whether one is being built
// POST { action: 'build' } → build last week's recap now (background; poll GET)
// POST { action: 'save' }  → copy the latest recap into the vault as a note
export async function GET() {
  return NextResponse.json({ recap: readLatestRecap(), running: isRecapRunning() })
}

export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({})) as { action?: string }
  if (action === 'build') {
    void generateRecap().catch(() => { /* surfaced as "no recap" */ })
    return NextResponse.json({ running: true }, { status: 202 })
  }
  if (action === 'save') {
    const recap = readLatestRecap()
    if (!recap) return NextResponse.json({ error: 'No recap yet' }, { status: 404 })
    try {
      return NextResponse.json({ path: saveRecapNote(recap) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 })
    }
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
