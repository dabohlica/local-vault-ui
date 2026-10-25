'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/shared/Toast'

// Caretaking itself runs on the server (src/lib/scheduler.ts, started from
// src/instrumentation.ts), so it no longer depends on this tab being open. This
// component only (a) pings the server so the scheduler + live watcher are up and
// (b) tells you when a nightly run finished since you last looked.

const SEEN = 'vault-ui:lastFullSeen' // lastFullAt of the run we last announced
const POLL_MS = 5 * 60 * 1000

export function AutoCaretake() {
  const { showToast } = useToast()

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const r = await fetch('/api/caretake', { cache: 'no-store' })
        if (!r.ok || cancelled) return
        const d = (await r.json()) as { lastFullAt: string | null; lastFullSummary: string | null }
        if (!d.lastFullAt) return
        let seen: string | null = null
        try { seen = localStorage.getItem(SEEN) } catch { /* storage blocked */ }
        if (seen === d.lastFullAt) return
        try { localStorage.setItem(SEEN, d.lastFullAt) } catch { /* storage blocked */ }
        // First visit ever: record silently rather than announcing an old run.
        if (seen !== null) showToast(`Nightly caretake done — ${d.lastFullSummary ?? 'see the log'}`, 'success')
      } catch {
        // Local-first: a failed poll is non-fatal and silent.
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [showToast])

  return null
}
