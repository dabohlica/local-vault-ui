import { NextResponse } from 'next/server'
import { scanVaultHealth } from '@/lib/health'

// Reads live state — never prerender at build time (next build would freeze it).
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(scanVaultHealth())
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Health scan failed' },
      { status: 500 }
    )
  }
}
