import { NextRequest, NextResponse } from 'next/server'
import { getRecentFiles, getVaultPath, isMetaNote } from '@/lib/vault'
import { countPending } from '@/lib/pending'
import { inboxCounts } from '@/lib/inbox'
import { readLatestBriefing, isBriefingRunning } from '@/lib/briefing'
import { cachedHealthScan } from '@/lib/health'
import { indexReadiness } from '@/lib/indexHeal'

export const dynamic = 'force-dynamic'

// Everything the home screen needs in one call. Each part fails independently,
// so a missing inbox DB or index never blanks the whole page. Read-only: the
// index self-heal runs in the scheduler (src/lib/indexHeal.ts).
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

// Only what's worth a nudge: things that are actually broken, not style nits
// (missing preamble) or notes that simply have no links yet.
const NUDGE = new Set(['broken-wikilink', 'empty', 'relation-type-mismatch', 'missing-frontmatter'])

export async function GET(req: NextRequest) {
  const index = safe(() => indexReadiness(), null)
  // ?part=index — just the search-index status (sync popover, Home polling).
  if (req.nextUrl.searchParams.get('part') === 'index') return NextResponse.json({ index })

  const recent = safe(() => getRecentFiles(getVaultPath(), 60), [])
    .filter(f => !isMetaNote(f.path))
    .slice(0, 6)
    .map(f => ({ path: f.path, mtime: f.mtime.toISOString() }))

  const health = safe(() => cachedHealthScan(), null)
  const needsAttention = health ? new Set(health.issues.filter(i => NUDGE.has(i.kind)).map(i => i.path)).size : 0
  const briefing = safe(() => readLatestBriefing(), null)

  return NextResponse.json({
    recent,
    inboxNew: safe(() => inboxCounts().byStatus.new, 0),
    suggestions: safe(() => countPending(), 0),
    needsAttention,
    notes: health?.scanned ?? 0,
    briefing: briefing && {
      date: briefing.date,
      overview: briefing.overview,
      markdown: briefing.markdown,
      picks: briefing.itemIds.length,
    },
    briefingRunning: safe(() => isBriefingRunning(), false),
    index,
  })
}
