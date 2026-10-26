import { NextRequest, NextResponse } from 'next/server'
import { findNotes } from '@/lib/find'

export const dynamic = 'force-dynamic'

// Note names first, then keyword hits in note text (see src/lib/find.ts).
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') ?? ''
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 20))
  try {
    return NextResponse.json({ results: findNotes(query, limit) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Search failed' }, { status: 500 })
  }
}
