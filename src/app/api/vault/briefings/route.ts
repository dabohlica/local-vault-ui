import { NextResponse } from 'next/server'
import fs from 'fs'
import matter from 'gray-matter'
import { listAllNotes, resolveVaultPath } from '@/lib/vault'

export type BriefingMeta = { path: string; title: string; date: string; tags: string[] }

// YAML auto-parses unquoted dates into Date objects; normalize to YYYY-MM-DD.
function toDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return v ? String(v).slice(0, 10) : ''
}

// Auto-discover briefing notes so each becomes a dashboard tab: a note qualifies
// if its frontmatter has `type: briefing` OR its filename contains "briefing".
export async function GET() {
  try {
    const briefings: BriefingMeta[] = []

    for (const note of listAllNotes()) {
      const nameHit = /briefing/i.test(note.path)
      let content: string
      try {
        content = fs.readFileSync(resolveVaultPath(note.path), 'utf-8')
      } catch {
        continue
      }

      let fm: Record<string, unknown> = {}
      try { fm = matter(content).data as Record<string, unknown> } catch { /* no frontmatter */ }

      const typeHit = String(fm.type ?? '').toLowerCase() === 'briefing'
      if (!nameHit && !typeHit) continue

      const base = note.path.split('/').pop()?.replace(/\.md$/, '') ?? note.path
      briefings.push({
        path: note.path,
        title: (fm.title as string) ?? base,
        date: toDateString(fm['last-updated'] ?? fm.date),
        tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
      })
    }

    // Stable, friendly order: most recently updated first.
    briefings.sort((a, b) => b.date.localeCompare(a.date))
    return NextResponse.json({ briefings })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list briefings' },
      { status: 500 }
    )
  }
}
