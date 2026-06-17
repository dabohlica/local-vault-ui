'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/shared/Toast'

// Module-level guard so the pull fires once per full page load, even under
// React StrictMode's double-mount in dev (and not on client-side navigations,
// since the layout — and thus this component — doesn't remount between routes).
let didSync = false

export function AutoGitSync() {
  const { showToast } = useToast()

  useEffect(() => {
    if (didSync) return
    didSync = true

    void (async () => {
      try {
        const res = await fetch('/api/vault/git-pull', { method: 'POST' })
        const data = await res.json() as { stdout?: string; error?: string }
        if (!res.ok) {
          // Offline or no remote — fail quietly; the vault still works fully local.
          return
        }
        const out = (data.stdout ?? '').trim()
        if (out && !/already up to date/i.test(out)) {
          showToast('Vault synced from git', 'success')
        }
      } catch {
        // No network: silently ignore. Local-first means this is non-fatal.
      }
    })()
  }, [showToast])

  return null
}
