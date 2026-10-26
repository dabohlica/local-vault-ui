import { indexStats, isIndexBusy, syncIndex } from '@/lib/embeddings'

// Self-heal for an empty or outdated search index (fresh install, or a changed
// embedding model — syncIndex then clears and re-embeds everything). Run from
// the scheduler tick, never from a GET. A failure (embed model down) backs off
// instead of retrying on every tick; the last error is shown on Home.

const RETRY_AFTER_MS = 10 * 60 * 1000

type HealState = { lastFailMs: number; lastError: string | null }
const H = ((globalThis as unknown as { __vaultIndexHeal?: HealState }).__vaultIndexHeal ??= { lastFailMs: 0, lastError: null })

// Pure, for testing.
export function shouldHeal(ready: boolean, busy: boolean, lastFailMs: number, now: number): boolean {
  return !ready && !busy && now - lastFailMs >= RETRY_AFTER_MS
}

export function indexReadiness(): { ready: boolean; busy: boolean; notes: number; error: string | null } {
  const st = indexStats()
  const ready = st.chunks > 0 && st.modelMatches
  return { ready, busy: isIndexBusy(), notes: st.notes, error: ready ? null : H.lastError }
}

export async function healIndex(now = Date.now()): Promise<void> {
  let r: ReturnType<typeof indexReadiness>
  try { r = indexReadiness() } catch { return }
  if (!shouldHeal(r.ready, r.busy, H.lastFailMs, now)) return
  try {
    await syncIndex()
    H.lastError = null; H.lastFailMs = 0
  } catch (err) {
    H.lastFailMs = Date.now()
    H.lastError = err instanceof Error ? err.message : String(err)
  }
}
