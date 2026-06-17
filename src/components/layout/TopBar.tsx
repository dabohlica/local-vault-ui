'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GitPullRequestArrow, Search, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

type PullStatus = 'idle' | 'loading' | 'success' | 'error'

export function TopBar() {
  const router = useRouter()
  const [pullStatus, setPullStatus] = useState<PullStatus>('idle')
  const [pullMsg, setPullMsg] = useState('')
  const [syncStatus, setSyncStatus] = useState<PullStatus>('idle')
  const [syncMsg, setSyncMsg] = useState('')

  async function handleSyncIndex() {
    setSyncStatus('loading')
    try {
      const res = await fetch('/api/index/sync', { method: 'POST' })
      const data = await res.json() as { notes?: number; chunks?: number; error?: string }
      if (res.ok) {
        setSyncStatus('success')
        setSyncMsg(`Indexed ${data.notes ?? 0} note(s), ${data.chunks ?? 0} chunk(s)`)
      } else {
        setSyncStatus('error')
        setSyncMsg(data.error ?? 'Sync failed')
      }
    } catch {
      setSyncStatus('error')
      setSyncMsg('Network error')
    }
    setTimeout(() => {
      setSyncStatus('idle')
      setSyncMsg('')
    }, 4000)
  }

  async function handleGitPull() {
    setPullStatus('loading')
    try {
      const res = await fetch('/api/vault/git-pull', { method: 'POST' })
      const data = await res.json() as { stdout?: string; error?: string }
      if (res.ok) {
        setPullStatus('success')
        setPullMsg(data.stdout ?? 'Up to date')
      } else {
        setPullStatus('error')
        setPullMsg(data.error ?? 'Pull failed')
      }
    } catch {
      setPullStatus('error')
      setPullMsg('Network error')
    }
    setTimeout(() => {
      setPullStatus('idle')
      setPullMsg('')
    }, 4000)
  }

  return (
    <header
      className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
        height: '56px',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Knowledge Vault
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)' }}
        >
          Obsidian
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <ThemeToggle />

        {/* Search shortcut */}
        <button
          onClick={() => router.push('/search')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 hover:scale-[1.02]"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          <Search size={14} />
          <span>Search vault</span>
          <kbd
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'var(--border)', color: 'var(--text-subtle)' }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Git pull */}
        <button
          onClick={handleGitPull}
          disabled={pullStatus === 'loading'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: pullStatus === 'success'
              ? 'rgba(16,185,129,0.15)'
              : pullStatus === 'error'
              ? 'rgba(239,68,68,0.15)'
              : 'var(--bg-elevated)',
            color: pullStatus === 'success'
              ? 'var(--success)'
              : pullStatus === 'error'
              ? 'var(--danger)'
              : 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
          title={pullMsg || 'Git pull'}
        >
          {pullStatus === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : pullStatus === 'success' ? (
            <CheckCircle2 size={14} />
          ) : pullStatus === 'error' ? (
            <AlertCircle size={14} />
          ) : (
            <GitPullRequestArrow size={14} />
          )}
          <span>
            {pullStatus === 'loading' ? 'Pulling…' : pullStatus === 'success' ? 'Pulled' : pullStatus === 'error' ? 'Error' : 'Git Pull'}
          </span>
        </button>

        {/* Sync embedding index */}
        <button
          onClick={() => void handleSyncIndex()}
          disabled={syncStatus === 'loading'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: syncStatus === 'success'
              ? 'rgba(16,185,129,0.15)'
              : syncStatus === 'error'
              ? 'rgba(239,68,68,0.15)'
              : 'var(--bg-elevated)',
            color: syncStatus === 'success'
              ? 'var(--success)'
              : syncStatus === 'error'
              ? 'var(--danger)'
              : 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
          title={syncMsg || 'Sync local embedding index'}
        >
          {syncStatus === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : syncStatus === 'success' ? (
            <CheckCircle2 size={14} />
          ) : syncStatus === 'error' ? (
            <AlertCircle size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          <span>
            {syncStatus === 'loading' ? 'Indexing…' : syncStatus === 'success' ? 'Indexed' : syncStatus === 'error' ? 'Error' : 'Sync Index'}
          </span>
        </button>
      </div>
    </header>
  )
}
