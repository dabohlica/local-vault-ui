import { NextRequest, NextResponse } from 'next/server'
import { readOperations } from '@/lib/opsLog'

// Traceability timeline: the most recent vault-write operations (what changed,
// where, and when), newest first. Fully local — reads the structured ops log.
export async function GET(req: NextRequest) {
  try {
    const limitParam = Number(req.nextUrl.searchParams.get('limit'))
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(200, limitParam) : 50
    return NextResponse.json({ operations: readOperations(limit) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read timeline' },
      { status: 500 }
    )
  }
}
