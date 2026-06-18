import { syncIndex, indexStats } from '@/lib/embeddings'
import { scanVaultHealth, type HealthReport } from '@/lib/health'
import { appendToLog } from '@/lib/vault'

// Shared caretaking routine, run both on-demand and by the in-app scheduler.
// Fully local: index sync (re-embeds changed notes) + a deterministic health
// scan. The "full" run also writes a summary to Logs/<today>.md so there's an
// audit trail of unattended overnight runs.

export type CaretakeResult = {
  mode: 'sync' | 'full'
  sync: { notes: number; chunks: number; skipped: number }
  health: HealthReport | null
  ranAt: string
}

export async function runCaretake(mode: 'sync' | 'full'): Promise<CaretakeResult> {
  const sync = await syncIndex()
  const stats = indexStats()

  let health: HealthReport | null = null
  if (mode === 'full') {
    health = scanVaultHealth()

    const issueLine = Object.entries(health.counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ') || 'no issues'

    appendToLog(
      `Nightly caretake\n\n` +
        `- Index: ${stats.notes} notes, ${stats.chunks} chunks ` +
        `(${sync.notes} re-embedded${sync.skipped.length ? `, ${sync.skipped.length} skipped` : ''})\n` +
        `- Health: scanned ${health.scanned} notes — ${issueLine}`
    )
  }

  return {
    mode,
    sync: { notes: sync.notes, chunks: stats.chunks, skipped: sync.skipped.length },
    health,
    ranAt: new Date().toISOString(),
  }
}
