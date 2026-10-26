'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Loader2, CheckCircle2, SlidersHorizontal } from 'lucide-react'
import { SwipeDeck, type SwipeDecision } from '@/components/inbox/SwipeDeck'
import { SourcesPanel } from '@/components/inbox/SourcesPanel'
import { SuggestionsPanel } from '@/components/inbox/SuggestionsPanel'
import { PageHeader } from '@/components/shared/PageHeader'
import { useToast } from '@/components/shared/Toast'
import type { InboxItem, InboxStatus, RefreshResult } from '@/lib/inbox'

type Tab = 'new' | 'suggestions' | 'later' | 'sources'
const TABS: Tab[] = ['new', 'suggestions', 'later', 'sources']
type Counts = { byStatus: Record<InboxStatus, number>; newBySection: Record<string, number> }
type Job = { running: boolean; last: RefreshResult | null }

// Everything waiting for a decision: new reads from your feeds (swipe triage, see
// src/lib/inbox.ts), suggestions the night shift prepared, and items parked for later.
export default function InboxPage() {
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('new')
  const [suggestions, setSuggestions] = useState<number | null>(null)
  const [section, setSection] = useState<string | null>(null)
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [undo, setUndo] = useState<{ item: InboxItem; prev: InboxStatus }[]>([])
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (tab === 'sources' || tab === 'suggestions') return
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

  // Deep links: /inbox?tab=suggestions|later|sources
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.includes(t)) setTab(t)
  }, [])

  const loadSuggestions = useCallback(() => {
    fetch('/api/pending', { cache: 'no-store' }).then(r => r.json()).then(d => setSuggestions(d.count ?? 0)).catch(() => {})
  }, [])
  useEffect(() => { loadSuggestions() }, [loadSuggestions])

  function pickTab(t: Tab) {
    setTab(t); setSection(null)
    window.history.replaceState(null, '', t === 'new' ? '/inbox' : `/inbox?tab=${t}`)
  }
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
      <PageHeader title="Inbox" subtitle="New reads picked for you, and changes waiting for your OK.">
        {tab === 'new' && (
          <button onClick={() => void refresh()} disabled={job?.running} className="btn btn-ghost text-xs" title="Check your sources for new items now">
            <RefreshCw size={14} className={job?.running ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{job?.running ? 'Checking…' : 'Check now'}</span>
          </button>
        )}
        <button onClick={() => pickTab('sources')} className="btn btn-ghost text-xs" title="Choose where new reads come from" style={tab === 'sources' ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}>
          <SlidersHorizontal size={14} /> <span className="hidden sm:inline">Sources</span>
        </button>
      </PageHeader>

      <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
        {([['new', 'To read', counts?.byStatus.new], ['suggestions', 'Suggestions', suggestions], ['later', 'Later', counts?.byStatus.later]] as const).map(([key, label, n]) => (
          <button key={key} onClick={() => pickTab(key)}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: tab === key ? 'var(--bg-surface)' : 'transparent',
              color: tab === key ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>
            {label}
            {!!n && <span className="text-[11px] font-semibold px-1.5 rounded-full" style={{ background: tab === key ? 'var(--primary)' : 'var(--border)', color: tab === key ? 'white' : 'var(--text-muted)' }}>{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <SourcesPanel />
      ) : tab === 'suggestions' ? (
        <SuggestionsPanel onChange={loadSuggestions} />
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
              <CheckCircle2 size={28} style={{ color: 'var(--success)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{tab === 'later' ? 'Nothing parked for later.' : 'All caught up.'}</p>
              <p className="text-xs max-w-sm" style={{ color: 'var(--text-subtle)' }}>
                {lastRun ? `Last checked ${new Date(lastRun.ranAt).toLocaleString()}: ${lastRun.added} new.` : 'New reads arrive automatically from your sources.'}{' '}
                {undo.length > 0 && <button onClick={() => void onUndo()} className="underline" style={{ color: 'var(--primary)' }}>Undo last</button>}
              </p>
            </div>
          ) : (
            <SwipeDeck items={items} onDecide={onDecide} onUndo={() => void onUndo()} canUndo={undo.length > 0} />
          )}

          {tab === 'new' && items !== null && items.length > 0 && (
            <p className="text-xs text-center mt-6" style={{ color: 'var(--text-subtle)' }}>
              Swipe right or press → to keep it as a note, left or ← to skip. Your choices teach it what you like.
            </p>
          )}
        </>
      )}
    </div>
  )
}
