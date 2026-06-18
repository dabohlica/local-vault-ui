import { NextResponse } from 'next/server'
import { vaultInitState, scaffoldVault } from '@/lib/vaultInit'

// GET → is the connected vault empty / does it already have _CLAUDE.md?
export async function GET() {
  try {
    return NextResponse.json(vaultInitState())
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Init check failed' },
      { status: 500 }
    )
  }
}

// POST → scaffold the AI-first skeleton (idempotent; never overwrites).
export async function POST() {
  try {
    const { created } = scaffoldVault()
    return NextResponse.json({ success: true, created, state: vaultInitState() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Vault init failed' },
      { status: 500 }
    )
  }
}
