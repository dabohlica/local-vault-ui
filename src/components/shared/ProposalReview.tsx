'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, X, FilePlus, FileEdit } from 'lucide-react'
import { DiffView } from '@/components/curate/DiffView'
import { useToast } from '@/components/shared/Toast'

export type Change = { path: string; action: 'create' | 'update'; content: string; before?: string | null }
export type ProposalResponse = { changes: Change[]; log_entry: string; summary: string; error?: string; raw?: string }

type Props = {
  result: ProposalResponse
  onApplied?: () => void
  onDiscard?: () => void
}

// Review a set of proposed vault changes as per-file diffs, approve/reject each,
// then apply via /api/curate/apply (local write + log + re-index). Shared by the
// Curate page, every local command, and drag-drop ingest.
export function ProposalReview({ result, onApplied, onDiscard }: Props) {
  const { showToast } = useToast()
  const [changes, setChanges] = useState<Change[]>(result.changes)
  const [approved, setApproved] = useState<Set<string>>(new Set(result.changes.map(c => c.path)))
  const [applying, setApplying] = useState(false)

  // Fetch the current content of each target so the diff shows real before/after.
  useEffect(() => {
    let active = true
    void (async () => {
      const enriched = await Promise.all(
        result.changes.map(async (c) => {
          try {
            const r = await fetch(`/api/vault/file?path=${encodeURIComponent(c.path)}`)
            if (r.ok) {
              const d = await r.json() as { content: string }
              return { ...c, before: d.content, action: 'update' as const }
            }
          } catch { /* not found -> create */ }
          return { ...c, before: null, action: 'create' as const }
        })
      )
      if (active) {
        setChanges(enriched)
        setApproved(new Set(enriched.map(c => c.path)))
      }
    })()
    return () => { active = false }
  }, [result])

  function toggle(p: string) {
    setApproved(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })
  }

  async function apply() {
    if (applying) return
    const selected = changes.filter(c => approved.has(c.path))
    if (selected.length === 0) return
    setApplying(true)
    try {
      const res = await fetch('/api/curate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: selected.map(({ path, action, content }) => ({ path, action, content })),
          log_entry: result.log_entry,
        }),
      })
      const data = await res.json() as { written?: string[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Apply failed')
      showToast(`Updated ${data.written?.length ?? 0} file(s)`, 'success')
      onApplied?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Apply failed', 'error')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-4">
        <p className="text-sm" style={{ color: 'var(--text)' }}>{result.summary}</p>
      </div>

      {changes.map(change => (
        <div key={change.path} className="card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {change.action === 'create'
                ? <FilePlus size={14} style={{ color: 'var(--success)' }} />
                : <FileEdit size={14} style={{ color: 'var(--warning)' }} />}
              <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{change.path}</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)' }}>
                {change.action}
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={approved.has(change.path)} onChange={() => toggle(change.path)} />
              Apply this change
            </label>
          </div>
          <DiffView before={change.before ?? null} after={change.content} />
        </div>
      ))}

      <div className="flex justify-end gap-2">
        {onDiscard && (
          <button
            onClick={onDiscard}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <X size={14} /> Discard
          </button>
        )}
        <button
          onClick={() => void apply()}
          disabled={applying || approved.size === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
        >
          {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Apply {approved.size} change{approved.size === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}
