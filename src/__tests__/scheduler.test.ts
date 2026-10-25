import { describe, it, expect } from 'vitest'
import { dueJobs } from '@/lib/scheduler'

const cfg = { caretakeEnabled: true, caretakeHour: 3, syncIntervalHours: 6 }
const at = (h: number) => new Date(2026, 9, 25, h, 0, 0)

describe('dueJobs', () => {
  it('runs the nightly pass once per day at/after the hour (with catch-up)', () => {
    expect(dueJobs(at(2), { lastSyncMs: at(1).getTime(), lastFullDate: '2026-10-24' }, cfg)).toEqual({ sync: false, full: false })
    expect(dueJobs(at(3), { lastSyncMs: 0, lastFullDate: '2026-10-24' }, cfg).full).toBe(true)
    expect(dueJobs(at(14), { lastSyncMs: 0, lastFullDate: '2026-10-24' }, cfg).full).toBe(true)
    expect(dueJobs(at(14), { lastSyncMs: at(13).getTime(), lastFullDate: '2026-10-25' }, cfg)).toEqual({ sync: false, full: false })
  })
  it('syncs on the interval, and never when disabled', () => {
    expect(dueJobs(at(14), { lastSyncMs: at(7).getTime(), lastFullDate: '2026-10-25' }, cfg).sync).toBe(true)
    expect(dueJobs(at(14), { lastSyncMs: 0, lastFullDate: '' }, { ...cfg, caretakeEnabled: false })).toEqual({ sync: false, full: false })
  })
})
