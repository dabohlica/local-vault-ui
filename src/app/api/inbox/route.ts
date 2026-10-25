import { NextRequest, NextResponse } from 'next/server'
import { inboxCounts, inboxJob, listItems, refreshInbox, type InboxStatus } from '@/lib/inbox'

const STATUSES: InboxStatus[] = ['new', 'later', 'accepted', 'rejected']

// GET  ?countOnly=1 → counts only (sidebar badge)
// GET  ?status=new|later|accepted|rejected&section=… → items (best first) + counts
// POST { action: 'refresh' } → poll all sources now (runs in the background;
//      poll GET until job.running is false)
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams
    if (q.get('countOnly')) return NextResponse.json({ counts: inboxCounts() })
    const status = STATUSES.find(s => s === q.get('status')) ?? 'new'
    const section = q.get('section') || undefined
    const items = listItems({ status, section, limit: status === 'new' ? 100 : 50 })
    return NextResponse.json({ items, counts: inboxCounts(), job: inboxJob() })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Inbox unavailable' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  if (body.action !== 'refresh') return NextResponse.json({ error: "action must be 'refresh'" }, { status: 400 })
  void refreshInbox().catch(() => { /* result/error is reported via job.last */ })
  return NextResponse.json({ job: inboxJob() }, { status: 202 })
}
