'use client'

import { useCallback, useEffect, useState } from 'react'
import { Stethoscope, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Database } from 'lucide-react'

type Diag = {
  vault: { path: string; exists: boolean; notesOnDisk: number }
  index: { chunks: number; indexedNotes: number; dbPath: string; cwd: string }
  embed: { model: string; ollamaReachable: boolean; embedInstalled: boolean; host: string }
  unindexed: string[]
  unindexedCount: number
  stale: string[]
  staleCount: number
  ok: boolean
  problems: string[]
}

// Surfaces exactly why notes might not be searchable: vault path vs. on-disk
// count vs. indexed count, the embed model state, and the DB path (a different
// launch cwd silently uses a different index). The "Sync now" button forces a
// full rebuild so a stuck index can be fixed in one click.
export function DiagnosticsCard() {
  const [diag, setDiag] = useState<Diag | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/diagnostics', { cache: 'no-store' })
      setDiag(await res.json() as Diag)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function rebuild() {
    setSyncing(true)
    try {
      await fetch('/api/index/rebuild', { method: 'POST' })
      await load()
    } catch { /* ignore */ } finally { setSyncing(false) }
  }

  const d = diag
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--icon-grad)' }}>
          <Stethoscope size={16} style={{ color: 'var(--primary)' }} />
        </div>
        <h2 className="text-sm font-semibold flex-1" style={{ color: 'var(--text)' }}>Diagnostics</h2>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Re-check
        </button>
      </div>

      {!d ? (
        <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Checking…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Verdict */}
          <div className="flex items-start gap-2 text-xs rounded-lg p-3"
            style={{ background: d.ok ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)', color: 'var(--text-muted)' }}>
            {d.ok
              ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
              : <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />}
            <div>
              {d.ok ? <p style={{ color: 'var(--success)' }}>Indexing looks correctly wired.</p>
                    : d.problems.map((p, i) => <p key={i}>• {p}</p>)}
            </div>
          </div>

          {/* Key numbers */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Vault path" value={d.vault.path || '(unset)'} mono ok={d.vault.exists} />
            <Stat label="Notes on disk" value={String(d.vault.notesOnDisk)} />
            <Stat label="Indexed notes" value={`${d.index.indexedNotes} (${d.index.chunks} chunks)`} ok={d.index.chunks > 0} />
            <Stat label="Not yet indexed" value={String(d.unindexedCount)} ok={d.unindexedCount === 0} />
            <Stat label="Embed model" value={d.embed.model} ok={d.embed.embedInstalled} />
            <Stat label="Ollama" value={d.embed.ollamaReachable ? 'reachable' : 'unreachable'} ok={d.embed.ollamaReachable} />
            <Stat label="Index DB" value={d.index.dbPath} mono />
            <Stat label="Launch cwd" value={d.index.cwd} mono />
          </div>

          {d.unindexedCount > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                {d.unindexedCount} note(s) on disk not in the index
              </summary>
              <div className="mt-1.5 flex flex-col gap-0.5 font-mono" style={{ color: 'var(--text-subtle)' }}>
                {d.unindexed.map(p => <span key={p}>{p}</span>)}
                {d.unindexedCount > d.unindexed.length && <span>…and {d.unindexedCount - d.unindexed.length} more</span>}
              </div>
            </details>
          )}

          <button
            onClick={() => void rebuild()}
            disabled={syncing}
            className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
            {syncing ? 'Rebuilding…' : 'Rebuild index now'}
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, mono, ok }: { label: string; value: string; mono?: boolean; ok?: boolean }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <p style={{ color: 'var(--text-subtle)' }}>{label}</p>
      <p className={`${mono ? 'font-mono break-all' : ''} mt-0.5`}
        style={{ color: ok === false ? 'var(--danger)' : ok === true ? 'var(--success)' : 'var(--text)' }}>
        {value}
      </p>
    </div>
  )
}
