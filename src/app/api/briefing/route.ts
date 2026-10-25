import { NextResponse } from 'next/server'
import { generateBriefing, isBriefingRunning, readLatestBriefing } from '@/lib/briefing'

// Reads live state — never prerender at build time (next build would freeze it).
export const dynamic = 'force-dynamic'

// GET  → the latest morning briefing (or null) + whether one is being built
// POST → build today's briefing now (background; poll GET)
export async function GET() {
  return NextResponse.json({ briefing: readLatestBriefing(), running: isBriefingRunning() })
}

export async function POST() {
  void generateBriefing().catch(() => { /* surfaced as "no new briefing" */ })
  return NextResponse.json({ running: true }, { status: 202 })
}
