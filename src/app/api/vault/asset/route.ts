import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { resolveVaultPath } from '@/lib/vault'
import { IMAGE_EXTS } from '@/lib/images'

// Serve a binary vault asset (images only) so the UI can render ![[…]] embeds
// and citation thumbnails. /api/vault/file stays text/JSON; this is its binary
// sibling. Path-contained via resolveVaultPath, extension-allowlisted.

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export async function GET(req: NextRequest) {
  const relativePath = req.nextUrl.searchParams.get('path')
  if (!relativePath) {
    return NextResponse.json({ error: 'Missing path param' }, { status: 400 })
  }
  const ext = path.extname(relativePath).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) {
    return NextResponse.json({ error: 'Not an image asset' }, { status: 415 })
  }
  try {
    const buffer = fs.readFileSync(resolveVaultPath(relativePath))
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        // Vault images are immutable in practice (dedupe renames on collision);
        // a short private cache keeps thumbnails snappy without staleness risk.
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }
}
