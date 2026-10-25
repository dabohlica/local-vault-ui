import { NextResponse } from 'next/server'
import { getVaultPath, getRecentFiles } from '@/lib/vault'

// Reads live state — never prerender at build time (next build would freeze it).
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const files = getRecentFiles(getVaultPath(), 6)
    return NextResponse.json({
      files: files.map(f => ({ path: f.path, mtime: f.mtime.toISOString() })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get recent files' },
      { status: 500 }
    )
  }
}
