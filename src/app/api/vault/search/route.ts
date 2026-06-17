import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { listAllNotes, resolveVaultPath } from '@/lib/vault'

// Pure-Node full-text search — no `grep` dependency, so it works identically on
// Windows and macOS. Walks the vault's .md files and matches case-insensitively.
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ results: [] })
  }

  try {
    const needle = query.toLowerCase()
    const results: Array<{ path: string; matchingLines: string[] }> = []

    for (const note of listAllNotes()) {
      if (results.length >= 20) break
      let content: string
      try {
        content = fs.readFileSync(resolveVaultPath(note.path), 'utf-8')
      } catch {
        continue
      }
      if (!content.toLowerCase().includes(needle)) continue

      const matchingLines = content
        .split('\n')
        .filter(line => line.toLowerCase().includes(needle))
        .slice(0, 5)

      results.push({ path: note.path, matchingLines })
    }

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 }
    )
  }
}
