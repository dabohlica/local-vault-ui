import { NextResponse } from 'next/server'
import { scanVaultHealth } from '@/lib/health'

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
