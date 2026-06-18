import fs from 'fs'
import { getVaultPath } from '@/lib/vault'
import { syncIndex } from '@/lib/embeddings'

// Live indexing: watch the vault directory and incrementally re-index shortly
// after any .md file is added/changed/removed — including edits made OUTSIDE the
// app (e.g. in Obsidian). This is what makes "I added a note → it's searchable"
// true without a manual Sync. Debounced so a burst of saves coalesces into one
// re-embed.
//
// Cross-platform note: fs.watch recursive is supported on macOS + Windows (the
// supported targets). On Linux recursive watching isn't available, so we fall
// back to the periodic AutoCaretake sync (every N hours) — still correct, just
// not instant.

type WatchState = { dir: string; watcher: fs.FSWatcher; timer: ReturnType<typeof setTimeout> | null }
let state: WatchState | null = null
const DEBOUNCE_MS = 3000

function scheduleSync() {
  if (!state) return
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    void syncIndex().catch(() => { /* embed model down — next sync retries */ })
  }, DEBOUNCE_MS)
}

// Idempotent. Starts (or re-targets) the watcher on the currently-configured
// vault. Safe to call on every request — it only does work when the vault path
// changes or nothing is watching yet.
export function ensureWatcher(): { watching: boolean; dir: string | null; recursive: boolean } {
  const dir = getVaultPath()
  if (!dir) return { watching: false, dir: null, recursive: false }

  if (state && state.dir === dir) return { watching: true, dir, recursive: true }

  // Vault changed (or first run): tear down any existing watcher.
  if (state) {
    try { state.watcher.close() } catch { /* ignore */ }
    if (state.timer) clearTimeout(state.timer)
    state = null
  }

  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { watching: false, dir, recursive: false }
    }
    const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const name = String(filename)
      if (!name.endsWith('.md')) return
      if (name.includes('.git') || name.includes('.obsidian') || name.includes('node_modules')) return
      scheduleSync()
    })
    state = { dir, watcher, timer: null }
    return { watching: true, dir, recursive: true }
  } catch {
    // Recursive watch unavailable (e.g. Linux) — rely on periodic sync instead.
    return { watching: false, dir, recursive: false }
  }
}
