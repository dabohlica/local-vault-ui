'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CalendarCheck, Loader2, BookmarkPlus, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/shared/Toast'
import { linkWikilinks } from '@/lib/wikilinks'
import type { Recap } from '@/lib/recap'

function fmt(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// Last week in a few bullets (src/lib/recap.ts). Built every Sunday evening.
export function RecapCard() {
  const { showToast } = useToast()
  const [recap, setRecap] = useState<Recap | null | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)

  const load = useCallback(async () => {
    const d = await fetch('/api/recap', { cache: 'no-store' }).then(r => r.json()).catch(() => null) as { recap: Recap | null; running: boolean } | null
    setRecap(d?.recap ?? null)
    setRunning(!!d?.running)
    return d
  }, [])

  useEffect(() => {
    void load()
    fetch('/api/vault/notes').then(r => r.json()).then(d => setNotes((d.notes ?? []).map((n: { path: string }) => n.path))).catch(() => {})
  }, [load])

  // Poll while a build runs.
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => void load(), 4000)
    return () => clearTimeout(t)
  }, [running, recap, load])

  async function build() {
    setRunning(true)
    setTried(true)
    await fetch('/api/recap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'build' }) }).catch(() => {})
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/recap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save' }) })
      const d = await r.json() as { path?: string; error?: string }
      if (!r.ok) throw new Error(d.error ?? 'Could not save')
      showToast(`Saved to ${d.path}`, 'success')
      window.dispatchEvent(new Event('vault:updated'))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (recap === undefined) return null

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CalendarCheck size={16} style={{ color: 'var(--primary)' }} />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Your week</h2>
          {recap && <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{fmt(recap.from)} – {fmt(recap.to)}</p>}
        </div>
        {recap && (
          <button onClick={() => void save()} disabled={saving} className="flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg hover-surface disabled:opacity-50" style={{ color: 'var(--text-subtle)' }} title="Save this recap as a note in your vault">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />} Save as note
          </button>
        )}
        <button onClick={() => void build()} disabled={running} className="p-1.5 rounded-lg hover-surface disabled:opacity-50" style={{ color: 'var(--text-subtle)' }} title="Rebuild last week’s recap" aria-label="Rebuild recap">
          <RefreshCw size={13} className={running ? 'animate-spin' : ''} />
        </button>
      </div>

      {running && !recap ? (
        <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-subtle)' }}><Loader2 size={14} className="animate-spin" /> Reading last week’s notes…</p>
      ) : recap ? (
        <div className="markdown-body chat-answer recap">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ a: ({ href, children }) => href?.startsWith('/') ? <Link href={href}>{children}</Link> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}
          >
            {linkWikilinks(recap.markdown, [], notes)}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
            {tried
              ? 'I found nothing to recap for last week — no daily notes, changes or kept reading between Monday and Sunday.'
              : 'Every Sunday evening I’ll sum up your week: what you worked on, decisions, open loops and new reading.'}
          </p>
          <button onClick={() => void build()} className="btn btn-ghost text-xs">Build last week’s recap</button>
        </div>
      )}
    </div>
  )
}
