import { NextRequest, NextResponse } from 'next/server'
import { jotDown } from '@/lib/capture'

// POST { text } → appended to today's daily note. Returns the note path.
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json() as { text?: string }
    if (!text?.trim()) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
    if (text.length > 20000) return NextResponse.json({ error: 'That’s too long for a quick note — use Add note instead' }, { status: 413 })
    return NextResponse.json({ path: jotDown(text) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 })
  }
}
