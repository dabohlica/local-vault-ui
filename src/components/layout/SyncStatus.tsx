'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Check, AlertCircle, HardDrive } from 'lucide-react'
import { useToast } from '@/components/shared/Toast'

type State = 'idle' | 'syncing' | 'ok' | 'error' | 'local'

// Module-level guard so the automatic sync fires once per full page load, even
// under StrictMode's double mount (and not on client-side navigations).
let didAutoSync = false

function ago(ts: number | null): string {
  if (!ts) return 'not yet'
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

// One quiet sync indicator instead of separate Pull / Push / Index buttons. On
// load it pulls, then pushes local edits (only after a clean pull, so we never
// push on top of an unreconciled remote). A vault without a git remote is fine:
// it shows as "On this Mac" rather than an error.
export function SyncStatus({ enabled = true }: { enabled?: boolean }) {
  const { showToast } = useToast()
  const [state, setState] = useState<State>('idle')
  const [detail, setDetail] = useState('')
  const [last, setLast] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState<{ notes: number; ready: boolean; busy: boolean } | null>(null)
  const [indexing, setIndexing] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const sync = useCallback(async (quiet: boolean) => {
    setState('syncing')
    try {
      const pull = await fetch('/api/vault/git-pull', { method: 'POST' })
      const pd = await pull.json() as { stdout?: string; error?: string }
      if (!pull.ok) {
        const msg = pd.error ?? 'Sync failed'
        // Only the two "there is nothing to sync with" answers count as local-only;
        // a conflict or an unreachable remote is a real failure and must show.
        const localOnly = /not a git repository|no upstream\/remote configured/i.test(msg)
        setState(localOnly ? 'local' : 'error')
        setDetail(localOnly ? 'This vault isn’t connected to a git remote, so it lives only on this Mac.' : msg)
        if (!quiet && !localOnly) showToast(msg, 'error')
        return
      }
      const pulled = (pd.stdout ?? '').trim()
      const push = await fetch('/api/vault/git-push', { method: 'POST' })
      const ps = await push.json().catch(() => ({})) as { stdout?: string; error?: string }
      if (!push.ok) {
        setState('error'); setDetail(ps.error ?? 'Push failed')
        if (!quiet) showToast(ps.error ?? 'Push failed', 'error')
        return
      }
      setState('ok'); setDetail(''); setLast(Date.now())
      if (pulled && !/already up to date/i.test(pulled)) {
        showToast('Pulled new changes into your vault', 'success')
        window.dispatchEvent(new Event('vault:updated'))
      } else if (!quiet) showToast('Everything is in sync', 'success')
    } catch {
      setState('error'); setDetail('Offline — your notes still work locally.')
    }
  }, [showToast])

  useEffect(() => {
    // Wait until a vault is configured (fresh install): syncing before that
    // would fail and use up the once-per-load auto sync.
    if (!enabled || didAutoSync) return
    didAutoSync = true
    void sync(true)
  }, [sync, enabled])

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    fetch('/api/home?part=index').then(r => r.json()).then(d => setIndex(d.index)).catch(() => {})
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function updateIndex() {
    setIndexing(true)
    try {
      const res = await fetch('/api/index/sync', { method: 'POST' })
      const d = await res.json() as { notes?: number; error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Update failed')
      showToast(d.notes ? `Updated search for ${d.notes} changed note(s)` : 'Search is up to date', 'success')
      const h = await fetch('/api/home?part=index').then(r => r.json()).catch(() => null)
      if (h) setIndex(h.index)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setIndexing(false)
    }
  }

  const label = state === 'syncing' ? 'Syncing…' : state === 'ok' ? 'Synced' : state === 'error' ? 'Not synced' : state === 'local' ? 'On this Mac' : 'Sync'
  const Icon = state === 'syncing' ? RefreshCw : state === 'error' ? CloudOff : state === 'local' ? HardDrive : Cloud
  const color = state === 'error' ? 'var(--warning)' : 'var(--text-subtle)'

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium transition-colors hover-surface"
        style={{ color }}
        title={detail || label}
        aria-label={`Sync status: ${label}`}
      >
        <Icon size={15} className={state === 'syncing' ? 'animate-spin' : ''} />
        <span className="hidden lg:inline">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border p-4 flex flex-col gap-3 shadow-pop" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-2.5">
            {state === 'error' ? <AlertCircle size={16} style={{ color: 'var(--warning)' }} className="mt-0.5 flex-shrink-0" />
              : <Check size={16} style={{ color: 'var(--success)' }} className="mt-0.5 flex-shrink-0" />}
            <div className="text-sm">
              <p className="font-medium" style={{ color: 'var(--text)' }}>{state === 'local' ? 'Saved on this Mac' : state === 'error' ? 'Couldn’t sync' : 'Vault synced'}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{detail || `Last sync ${ago(last)}`}</p>
            </div>
          </div>
          {state !== 'local' && (
            <button onClick={() => void sync(false)} disabled={state === 'syncing'}
              className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border disabled:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <RefreshCw size={14} className={state === 'syncing' ? 'animate-spin' : ''} /> Sync now
            </button>
          )}
          <div className="border-t pt-3 flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
              {!index ? 'Search: …' : index.busy ? 'Search: updating…' : index.ready ? `Search: ${index.notes} notes ready` : 'Search: needs an update'}
            </p>
            <button onClick={() => void updateIndex()} disabled={indexing} className="text-xs font-medium disabled:opacity-60" style={{ color: 'var(--primary)' }}>
              {indexing ? 'Updating…' : 'Update'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
