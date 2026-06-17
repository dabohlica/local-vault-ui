import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { resolveVaultPath } from '@/lib/vault'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { path: string }
    if (!body.path) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 })
    }

    const absPath = resolveVaultPath(body.path)

    spawn('code', [absPath], {
      detached: true,
      stdio: 'ignore',
    }).unref()

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to open VS Code' },
      { status: 500 }
    )
  }
}
