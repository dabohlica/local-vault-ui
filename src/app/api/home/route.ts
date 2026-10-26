import { NextResponse } from 'next/server'
import { getRecentFiles, getVaultPath, isMetaNote } from '@/lib/vault'
import { countPending } from '@/lib/pending'
import { inboxCounts } from '@/lib/inbox'
import { readLatestBriefing, isBriefingRunning } from '@/lib/briefing'
import { scanVaultHealth } from '@/lib/health'
import { indexStats, isIndexBusy, syncIndex } from '@/lib/embeddings'

export const dynamic = 'force-dynamic'

// Everything the home screen needs in one call. Each part fails independently,
// so a missing inbox DB or index never blanks the whole page.
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

export async function GET() {
  const recent = safe(() => getRecentFiles(getVaultPath(), 60), [])
    .filter(f => !isMetaNote(f.path))
    .slice(0, 6)
    .map(f => ({ path: f.path, mtime: f.mtime.toISOString() }))

  const health = safe(() => scanVaultHealth(), null)
  // Only what's worth a nudge: things that are actually broken, not style nits
  // (missing preamble) or notes that simply have no links yet.
  const NUDGE = new Set(['broken-wikilink', 'empty', 'relation-type-mismatch', 'missing-frontmatter'])
  const needsAttention = health ? new Set(health.issues.filter(i => NUDGE.has(i.kind)).map(i => i.path)).size : 0

  const briefing = safe(() => readLatestBriefing(), null)
  const index = safe(() => indexStats(), null)
  const ready = !!index && index.chunks > 0 && index.modelMatches
  // Self-heal: after an embedding-model change (or a fresh install) the index is
  // empty until something syncs it, so start that here instead of waiting for
  // the 6-hourly sync. syncIndex is locked, so repeated loads don't stack runs.
  if (index && !ready && !safe(() => isIndexBusy(), true) && (health?.scanned ?? 0) > 0) {
    void syncIndex().catch(() => { /* embed model down — the banner stays, next load retries */ })
  }

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
    index: index && {
      ready,
      busy: safe(() => isIndexBusy(), false),
      notes: index.notes,
    },
  })
}
