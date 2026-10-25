import fs from 'fs'
import path from 'path'
import { getConfig } from '@/lib/config'
import { runCaretake, type CaretakeResult } from '@/lib/caretake'
import { ensureWatcher } from '@/lib/watcher'

// Server-side caretaking scheduler, started once per server process from
// src/instrumentation.ts. Replaces the old browser-tab timer, which only ran
// while a tab was open — so the nightly run (and the morning review queue it
// fills) silently didn't happen on nights the app sat in the background.
//
// Same schedule semantics as before: index sync every `syncIntervalHours`, one
// full caretake per local day at/after `caretakeHour` (catching up on the first
// tick of the day if the server was down at that hour). State is persisted in
// data/scheduler.json so a restart doesn't re-run today's nightly pass.

const STATE_PATH = path.join(process.cwd(), 'data', 'scheduler.json')
const TICK_MS = 5 * 60 * 1000

export type SchedulerState = {
  lastSyncMs: number
  lastFullDate: string // YYYY-MM-DD (local) of the last nightly run
  lastFullAt: string | null
  lastFullSummary: string | null
}

type SchedulerGlobals = { timer: ReturnType<typeof setInterval> | null; running: boolean }
const G = ((globalThis as unknown as { __vaultScheduler?: SchedulerGlobals }).__vaultScheduler ??= { timer: null, running: false })

function todayStr(now = new Date()): string {
  return now.toLocaleDateString('en-CA') // YYYY-MM-DD, local
}

export function readSchedulerState(): SchedulerState {
  try {
    return { lastSyncMs: 0, lastFullDate: '', lastFullAt: null, lastFullSummary: null, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) }
  } catch {
    return { lastSyncMs: 0, lastFullDate: '', lastFullAt: null, lastFullSummary: null }
  }
}

function writeSchedulerState(patch: Partial<SchedulerState>): void {
  const next = { ...readSchedulerState(), ...patch }
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), 'utf-8')
  } catch { /* best-effort */ }
}

function summarize(r: CaretakeResult): string {
  const parts = [`${r.fixesApplied} fix(es) applied`]
  if (r.proposalsQueued) parts.push(`${r.proposalsQueued} proposal(s) to review`)
  return parts.join(', ')
}

// What a tick should do now — pure, for testing.
export function dueJobs(
  now: Date,
  state: Pick<SchedulerState, 'lastSyncMs' | 'lastFullDate'>,
  cfg: { caretakeEnabled: boolean; caretakeHour: number; syncIntervalHours: number },
): { sync: boolean; full: boolean } {
  if (!cfg.caretakeEnabled) return { sync: false, full: false }
  const full = state.lastFullDate !== todayStr(now) && now.getHours() >= cfg.caretakeHour
  // A full run includes a sync, so don't schedule both.
  const sync = !full && now.getTime() - state.lastSyncMs >= Math.max(1, cfg.syncIntervalHours) * 3600_000
  return { sync, full }
}

async function tick(): Promise<void> {
  if (G.running) return
  const cfg = getConfig()
  if (!cfg.vaultPath) return
  ensureWatcher()
  const now = new Date()
  const { sync, full } = dueJobs(now, readSchedulerState(), cfg)
  if (!sync && !full) return

  G.running = true
  try {
    if (full) {
      // Mark first so a crash mid-run doesn't retry in a loop every 5 minutes.
      writeSchedulerState({ lastFullDate: todayStr(now), lastSyncMs: now.getTime() })
      const result = await runCaretake('full')
      writeSchedulerState({ lastFullAt: result.ranAt, lastFullSummary: summarize(result) })
    } else {
      writeSchedulerState({ lastSyncMs: now.getTime() })
      await runCaretake('sync')
    }
  } catch {
    // Model/embedder down — non-fatal; the next due tick tries again.
  } finally {
    G.running = false
  }
}

// Idempotent: safe to call from instrumentation and from any request.
export function startScheduler(): void {
  if (G.timer) return
  G.timer = setInterval(() => void tick(), TICK_MS)
  G.timer.unref?.()
  // First evaluation shortly after boot, not during it.
  setTimeout(() => void tick(), 15_000).unref?.()
}
