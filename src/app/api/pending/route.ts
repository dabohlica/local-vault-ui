import { NextResponse } from 'next/server'
import { listPending } from '@/lib/pending'

// Reads live state — never prerender at build time (next build would freeze it).
export const dynamic = 'force-dynamic'

// List queued proposals awaiting review (lightweight: no full change bodies).
export async function GET() {
  const items = listPending().map(p => ({
    id: p.id,
    createdAt: p.createdAt,
    origin: p.origin,
    summary: p.summary,
    changeCount: Array.isArray(p.changes) ? p.changes.length : 0,
  }))
  return NextResponse.json({ count: items.length, items })
}
