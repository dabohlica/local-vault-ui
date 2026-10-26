import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { resolveCompanion } from '@/lib/companion'

export const dynamic = 'force-dynamic'

// Which character keeps the notes (cheap; read on every page load).
export async function GET() {
  const cfg = getConfig()
  return NextResponse.json(resolveCompanion(cfg.companionKind, cfg.companionName, cfg.companionColor))
}
