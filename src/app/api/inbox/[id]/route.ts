import { NextRequest, NextResponse } from 'next/server'
import { decideItem, type Decision } from '@/lib/inbox'

const DECISIONS: Decision[] = ['accepted', 'rejected', 'later', 'new']

// POST { decision: 'accepted' | 'rejected' | 'later' | 'new' } — a swipe, or an
// undo ('new'). Accepting writes a new note to the vault (create-only).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as { decision?: string }
    const decision = DECISIONS.find(d => d === body.decision)
    if (!decision) return NextResponse.json({ error: `decision must be one of ${DECISIONS.join(', ')}` }, { status: 400 })
    return NextResponse.json(decideItem(params.id, decision))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Decision failed'
    return NextResponse.json({ error: message }, { status: message === 'Item not found' ? 404 : 500 })
  }
}
