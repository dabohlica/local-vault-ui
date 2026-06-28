'use client'

import { useEffect } from 'react'

// Keep the local models resident so the user never hits a multi-minute cold load
// (which surfaces as "NetworkError"/"Failed to fetch" on the first capture/chat).
// Pings /api/warmup on mount and every 20 minutes — comfortably inside the model's
// 30-minute keep_alive — so an idle-but-open app stays warm. Fully best-effort.
const WARM_EVERY_MS = 20 * 60 * 1000

export function ModelWarmup() {
  useEffect(() => {
    const warm = () => { void fetch('/api/warmup', { method: 'POST' }).catch(() => {}) }
    warm()
    const id = setInterval(warm, WARM_EVERY_MS)
    return () => clearInterval(id)
  }, [])
  return null
}
