import { NextResponse } from 'next/server'
import { noteIndex } from '@/lib/find'

export const dynamic = 'force-dynamic'

// All note names (newest first) for instant filtering in the ⌘K palette.
export async function GET() {
  try {
    return NextResponse.json({ notes: noteIndex() })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to list notes' }, { status: 500 })
  }
}
