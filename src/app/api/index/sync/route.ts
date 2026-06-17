import { NextResponse } from 'next/server'
import { syncIndex, indexStats } from '@/lib/embeddings'

export async function POST() {
  try {
    const result = await syncIndex()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    return NextResponse.json(indexStats())
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stats failed' },
      { status: 500 }
    )
  }
}
