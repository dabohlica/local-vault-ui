import fs from 'fs'
import path from 'path'
import { getConfig } from '@/lib/config'
import { runCaretake, type CaretakeResult } from '@/lib/caretake'
import { ensureWatcher } from '@/lib/watcher'
import { readSources } from '@/lib/sources'

// Server-side caretaking scheduler, started once per server process from
// src/instrumentation.ts. Replaces the old browser-tab timer, which only ran
// while a tab was open — so the nightly run (and the morning review queue it
// fills) silently didn't happen on nights the app sat in the background.
//
// Same schedule semantics as before: index sync every `syncIntervalHours`, one
// full caretake per local day at/after `caretakeHour` (catching up on the first
// tick of the day if the server was down at that hour). State is persisted in
// data/scheduler.json so a restart doesn't re-run today's nightly pass.
//
// Feeds use the same pattern: poll the inbox sources every `feedIntervalHours`,
// and build the morning briefing once per day at/after `briefingHour` (which
// includes a fresh poll).

const STATE_PATH = path.join(process.cwd(), 'data', 'scheduler.json')
const TICK_MS = 5 * 60 * 1000

export type SchedulerState = {
  lastSyncMs: number
  lastFullDate: string // YYYY-MM-DD (local) of the last nightly run
  lastFullAt: string | null
  lastFullSummary: string | null
  lastFeedMs: number
  lastBriefingDate: string // YYYY-MM-DD (local)
}

type SchedulerGlobals = { timer: ReturnType<typeof setInterval> | null; running: boolean }
const G = ((globalThis as unknown as { __vaultScheduler?: SchedulerGlobals }).__vaultScheduler ??= { timer: null, running: false })

const EMPTY_STATE: SchedulerState = {
  lastSyncMs: 0, lastFullDate: '', lastFullAt: null, lastFullSummary: null, lastFeedMs: 0, lastBriefingDate: '',
}

function todayStr(now = new Date()): string {
  return now.toLocaleDateString('en-CA') // YYYY-MM-DD, local
}

export function readSchedulerState(): SchedulerState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) }
  } catch {
    return { ...EMPTY_STATE }
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

// Feed jobs due now — pure, for testing.
export function dueFeedJobs(
  now: Date,
  state: Pick<SchedulerState, 'lastFeedMs' | 'lastBriefingDate'>,
  cfg: { feedsEnabled: boolean; feedIntervalHours: number; briefingHour: number },
  hasSources: boolean,
): { feeds: boolean; briefing: boolean } {
  if (!cfg.feedsEnabled || !hasSources) return { feeds: false, briefing: false }
  const briefing = state.lastBriefingDate !== todayStr(now) && now.getHours() >= cfg.briefingHour
  // The briefing polls first, so don't schedule both.
  const feeds = !briefing && now.getTime() - state.lastFeedMs >= Math.max(1, cfg.feedIntervalHours) * 3600_000
  return { feeds, briefing }
}

async function runCaretakeJobs(now: Date, cfg: ReturnType<typeof getConfig>): Promise<void> {
  const { sync, full } = dueJobs(now, readSchedulerState(), cfg)
  if (full) {
    // Mark first so a crash mid-run doesn't retry in a loop every 5 minutes.
    writeSchedulerState({ lastFullDate: todayStr(now), lastSyncMs: now.getTime() })
    const result = await runCaretake('full')
    writeSchedulerState({ lastFullAt: result.ranAt, lastFullSummary: summarize(result) })
  } else if (sync) {
    writeSchedulerState({ lastSyncMs: now.getTime() })
    await runCaretake('sync')
  }
}

async function runFeedJobs(now: Date, cfg: ReturnType<typeof getConfig>): Promise<void> {
  const hasSources = readSources().some(s => s.enabled)
  const { feeds, briefing } = dueFeedJobs(now, readSchedulerState(), cfg, hasSources)
  if (briefing) {
    writeSchedulerState({ lastBriefingDate: todayStr(now), lastFeedMs: now.getTime() })
    const { generateBriefing } = await import('@/lib/briefing')
    await generateBriefing(now)
  } else if (feeds) {
    writeSchedulerState({ lastFeedMs: now.getTime() })
    const { refreshInbox } = await import('@/lib/inbox')
    await refreshInbox()
  }
}

async function tick(): Promise<void> {
  if (G.running) return
  const cfg = getConfig()
  if (!cfg.vaultPath) return
  ensureWatcher()
  G.running = true
  try {
    // Independent: a model/embedder failure in one must not skip the other.
    // Both are retried on their next due tick.
    await runCaretakeJobs(new Date(), cfg).catch(() => {})
    await runFeedJobs(new Date(), cfg).catch(() => {})
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
