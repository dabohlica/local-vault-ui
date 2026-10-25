'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox as InboxIcon, RefreshCw, Loader2, PartyPopper } from 'lucide-react'
import { SwipeDeck, type SwipeDecision } from '@/components/inbox/SwipeDeck'
import { SourcesPanel } from '@/components/inbox/SourcesPanel'
import { useToast } from '@/components/shared/Toast'
import type { InboxItem, InboxStatus, RefreshResult } from '@/lib/inbox'

type Tab = 'new' | 'later' | 'sources'
type Counts = { byStatus: Record<InboxStatus, number>; newBySection: Record<string, number> }
type Job = { running: boolean; last: RefreshResult | null }

// Swipe triage for candidate knowledge from your feeds (see src/lib/inbox.ts).
export default function InboxPage() {
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('new')
  const [section, setSection] = useState<string | null>(null)
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [undo, setUndo] = useState<{ item: InboxItem; prev: InboxStatus }[]>([])
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (tab === 'sources') return
    const q = new URLSearchParams({ status: tab, ...(section ? { section } : {}) })
    try {
      const d = await fetch(`/api/inbox?${q}`, { cache: 'no-store' }).then(r => r.json())
      if (d.error) throw new Error(d.error)
      setItems(d.items); setCounts(d.counts); setJob(d.job)
    } catch (err) {
      setItems([])
      showToast(err instanceof Error ? err.message : 'Inbox unavailable', 'error')
    }
  }, [tab, section, showToast])

  useEffect(() => { setItems(null); void load() }, [load])
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current) }, [])

  // While a fetch runs, poll until it finishes, then report what came in.
  const watchJob = useCallback(() => {
    if (poll.current) clearTimeout(poll.current)
    poll.current = setTimeout(async () => {
      const d = await fetch('/api/inbox?status=new', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
      if (!d) return
      setJob(d.job); setCounts(d.counts)
      if (d.job.running) { watchJob(); return }
      const last: RefreshResult | null = d.job.last
      const failed = last?.sources.filter(s => s.error) ?? []
      if (last?.error) showToast(`Fetched, but scoring failed: ${last.error}`, 'error')
      else if (failed.length) showToast(`${last!.added} new · ${failed.length} source(s) failed — see Sources`, 'error')
      else showToast(`${last?.added ?? 0} new item(s)`, 'success')
      void load()
    }, 2500)
  }, [load, showToast])

  async function refresh() {
    const d = await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) })
      .then(r => r.json()).catch(() => null)
    if (d?.job) { setJob(d.job); watchJob() }
  }

  async function decide(id: string, decision: InboxStatus): Promise<{ notePath?: string; noteKept?: boolean } | null> {
    const r = await fetch(`/api/inbox/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) return d
    showToast(d.error ?? 'Could not save that', 'error')
    void load()
    return null
  }

  function onDecide(item: InboxItem, decision: SwipeDecision) {
    setItems(list => list?.filter(i => i.id !== item.id) ?? null)
    setUndo(u => [...u.slice(-19), { item, prev: item.status }])
    setCounts(c => c && {
      ...c,
      byStatus: { ...c.byStatus, [item.status]: Math.max(0, c.byStatus[item.status] - 1), [decision]: c.byStatus[decision] + 1 },
    })
    void decide(item.id, decision).then(d => {
      if (decision === 'accepted' && d?.notePath) showToast(`Saved to ${d.notePath}`, 'success')
    })
  }

  async function onUndo() {
    const last = undo[undo.length - 1]
    if (!last) return
    setUndo(u => u.slice(0, -1))
    const d = await decide(last.item.id, last.prev)
    if (!d) return
    if (d.noteKept) showToast('Back in the inbox — the note was edited since, so it was kept', 'info')
    setItems(list => [last.item, ...(list ?? []).filter(i => i.id !== last.item.id)])
    void load()
  }

  const sections = Object.entries(counts?.newBySection ?? {}).sort((a, b) => b[1] - a[1])
  const lastRun = job?.last

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold gradient-text flex items-center gap-2"><InboxIcon size={18} /> Inbox</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            New papers and articles from your sources, best match first. Keep → saved as a note in your vault. Skip → it learns.
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={job?.running}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border flex-shrink-0 disabled:opacity-60"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'var(--bg-surface)' }}>
          <RefreshCw size={14} className={job?.running ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{job?.running ? 'Fetching…' : 'Fetch now'}</span>
        </button>
      </div>

      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        {([['new', 'Triage', counts?.byStatus.new], ['later', 'Later', counts?.byStatus.later], ['sources', 'Sources', undefined]] as const).map(([key, label, n]) => (
          <button key={key} onClick={() => { setTab(key); setSection(null) }}
            className="flex-1 text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-150"
            style={{
              background: tab === key ? 'var(--bg-surface)' : 'transparent',
              color: tab === key ? 'var(--primary)' : 'var(--text-muted)',
              boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}>
            {label}{n ? ` (${n})` : ''}
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <SourcesPanel />
      ) : (
        <>
          {tab === 'new' && sections.length > 1 && (
            <div className="flex gap-2 mb-4 flex-wrap">
              {[[null, counts?.byStatus.new ?? 0] as const, ...sections].map(([s, n]) => (
                <button key={s ?? 'all'} onClick={() => setSection(s)}
                  className="text-xs px-2.5 py-1 rounded-full border font-medium"
                  style={{ borderColor: section === s ? 'var(--primary)' : 'var(--border)', color: section === s ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {s ?? 'All'} · {n}
                </button>
              ))}
            </div>
          )}

          {items === null ? (
            <div className="flex justify-center py-16"><Loader2 className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
          ) : items.length === 0 ? (
            <div className="card p-10 flex flex-col items-center text-center gap-3">
              <PartyPopper size={28} style={{ color: 'var(--primary)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{tab === 'later' ? 'Nothing parked for later.' : 'Inbox zero.'}</p>
              <p className="text-xs max-w-sm" style={{ color: 'var(--text-subtle)' }}>
                {lastRun ? `Last fetch ${new Date(lastRun.ranAt).toLocaleString()}: ${lastRun.added} new.` : 'New items arrive on the schedule set under Sources.'}{' '}
                {undo.length > 0 && <button onClick={() => void onUndo()} className="underline" style={{ color: 'var(--primary)' }}>Undo last</button>}
              </p>
              <button onClick={() => setTab('sources')} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>Manage sources →</button>
            </div>
          ) : (
            <SwipeDeck items={items} onDecide={onDecide} onUndo={() => void onUndo()} canUndo={undo.length > 0} />
          )}

          {tab === 'new' && (
            <p className="text-xs text-center mt-6" style={{ color: 'var(--text-subtle)' }}>
              The morning briefing on the <Link href="/" style={{ color: 'var(--primary)' }}>dashboard</Link> summarizes the best of these.
            </p>
          )}
        </>
      )}
    </div>
  )
}
