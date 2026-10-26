import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { resolveVaultPath, contentHash } from '@/lib/vault'

export async function GET(req: NextRequest) {
  const relativePath = req.nextUrl.searchParams.get('path')
  if (!relativePath) {
    return NextResponse.json({ error: 'Missing path param' }, { status: 400 })
  }

  try {
    const absPath = resolveVaultPath(relativePath)
    const content = fs.readFileSync(absPath, 'utf-8')
    // `hash` lets the review UI pin the version it diffed against, so applying
    // can refuse if the note changed in the meantime (e.g. edited in Obsidian).
    return NextResponse.json({ content, path: relativePath, hash: contentHash(content) })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'File not found' },
      { status: 404 }
    )
  }
}

// No POST: every write goes through /api/curate/apply (reviewed, hash-checked,
// placeholder-guarded) or a purpose-built append-only route like /api/capture.
