'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GitPullRequestArrow, Upload, Search, Loader2, CheckCircle2, AlertCircle, RefreshCw, Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

type PullStatus = 'idle' | 'loading' | 'success' | 'error'

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const router = useRouter()
  const [pullStatus, setPullStatus] = useState<PullStatus>('idle')
  const [pullMsg, setPullMsg] = useState('')
  const [pushStatus, setPushStatus] = useState<PullStatus>('idle')
  const [pushMsg, setPushMsg] = useState('')
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

  async function handleGitPush() {
    setPushStatus('loading')
    try {
      const res = await fetch('/api/vault/git-push', { method: 'POST' })
      const data = await res.json() as { stdout?: string; error?: string }
      if (res.ok) {
        setPushStatus('success')
        setPushMsg(data.stdout ?? 'Pushed')
      } else {
        setPushStatus('error')
        setPushMsg(data.error ?? 'Push failed')
      }
    } catch {
      setPushStatus('error')
      setPushMsg('Network error')
    }
    setTimeout(() => {
      setPushStatus('idle')
      setPushMsg('')
    }, 4000)
  }

  return (
    <header
      className="flex items-center justify-between px-4 md:px-6 py-3 border-b flex-shrink-0 gap-2"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
        height: '56px',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger — mobile only, opens the nav drawer. */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-1.5 -ml-1 rounded-lg flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
          Knowledge Vault
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 hidden sm:inline"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)' }}
        >
          Obsidian
        </span>
      </div>

      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {/* Theme toggle */}
        <ThemeToggle />

        {/* Search shortcut — hidden on phones (Search is in the nav drawer) to keep
            the action row from overflowing. */}
        <button
          onClick={() => router.push('/search')}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 hover:scale-[1.02]"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          <Search size={14} />
          <span className="hidden lg:inline">Search vault</span>
          <kbd
            className="text-xs px-1.5 py-0.5 rounded hidden lg:inline"
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
          <span className="hidden lg:inline">
            {pullStatus === 'loading' ? 'Pulling…' : pullStatus === 'success' ? 'Pulled' : pullStatus === 'error' ? 'Error' : 'Git Pull'}
          </span>
        </button>

        {/* Git push */}
        <button
          onClick={() => void handleGitPush()}
          disabled={pushStatus === 'loading'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: pushStatus === 'success'
              ? 'rgba(16,185,129,0.15)'
              : pushStatus === 'error'
              ? 'rgba(239,68,68,0.15)'
              : 'var(--bg-elevated)',
            color: pushStatus === 'success'
              ? 'var(--success)'
              : pushStatus === 'error'
              ? 'var(--danger)'
              : 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
          title={pushMsg || 'Commit local vault changes and push to git'}
        >
          {pushStatus === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : pushStatus === 'success' ? (
            <CheckCircle2 size={14} />
          ) : pushStatus === 'error' ? (
            <AlertCircle size={14} />
          ) : (
            <Upload size={14} />
          )}
          <span className="hidden lg:inline">
            {pushStatus === 'loading' ? 'Pushing…' : pushStatus === 'success' ? 'Pushed' : pushStatus === 'error' ? 'Error' : 'Git Push'}
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
          <span className="hidden lg:inline">
            {syncStatus === 'loading' ? 'Indexing…' : syncStatus === 'success' ? 'Indexed' : syncStatus === 'error' ? 'Error' : 'Sync Index'}
          </span>
        </button>
      </div>
    </header>
  )
}
