import { NextRequest, NextResponse } from 'next/server'
import { connections, graphOverview } from '@/lib/graph'
import { sanitizePath } from '@/lib/vault'

// Reads live state — never prerender at build time (next build would freeze it).
export const dynamic = 'force-dynamic'

// GET ?note=<path> → that note's outgoing links (typed), backlinks, schema issues
// GET              → vault-wide overview: counts, types, orphans, schema issues
export async function GET(req: NextRequest) {
  try {
    const note = req.nextUrl.searchParams.get('note')
    if (note) return NextResponse.json(connections(sanitizePath(note)))
    return NextResponse.json(graphOverview())
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Graph unavailable' }, { status: 500 })
  }
}
