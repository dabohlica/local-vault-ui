'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Inbox, Sparkles, HeartPulse, CheckCircle2, Loader2, AlertCircle, FileText, ChevronRight, type LucideIcon } from 'lucide-react'
import { Composer } from '@/components/home/Composer'
import { BriefingCard } from '@/components/dashboard/BriefingCard'
import { ActivityTimelineCard } from '@/components/dashboard/ActivityTimelineCard'

type Home = {
  recent: Array<{ path: string; mtime: string }>
  inboxNew: number
  suggestions: number
  needsAttention: number
  notes: number
  index: { ready: boolean; busy: boolean; notes: number; error: string | null } | null
}

function greeting(d = new Date()): string {
  const h = d.getHours()
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  if (m < 48 * 60) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / 1440)}d`
}

export default function HomePage() {
  const [home, setHome] = useState<Home | null>(null)
  const [today, setToday] = useState('')

  useEffect(() => {
    setToday(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))
    const load = () => fetch('/api/home', { cache: 'no-store' }).then(r => r.json()).then(setHome).catch(() => {})
    void load()
    window.addEventListener('vault:updated', load)
    return () => window.removeEventListener('vault:updated', load)
  }, [])

  // While the index is being (re)built, check its status until it's ready:
  // often while it's running, rarely while it waits for the next scheduler
  // tick, and not at all after it failed (the banner then says why).
  const idx = home?.index
  useEffect(() => {
    if (!idx || idx.ready || idx.error) return
    const t = setTimeout(() => {
      fetch('/api/home?part=index', { cache: 'no-store' })
        .then(r => r.json())
        .then((d: { index: Home['index'] }) => setHome(h => h && { ...h, index: d.index }))
        .catch(() => {})
    }, idx.busy ? 8000 : 60000)
    return () => clearTimeout(t)
  }, [idx])

  const tiles: Array<{ n: number; icon: LucideIcon; title: string; sub: string; href: string }> = home ? [
    { n: home.inboxNew, icon: Inbox, title: `${home.inboxNew} new to read`, sub: 'Papers & articles picked for you', href: '/inbox' },
    { n: home.suggestions, icon: Sparkles, title: `${home.suggestions} suggestion${home.suggestions === 1 ? '' : 's'}`, sub: 'Edits prepared overnight, waiting for your OK', href: '/inbox?tab=suggestions' },
    { n: home.needsAttention, icon: HeartPulse, title: `${home.needsAttention} note${home.needsAttention === 1 ? '' : 's'} to tidy`, sub: 'Broken links, missing details', href: '/commands?tool=health' },
  ].filter(t => t.n > 0) : []

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-8">
      <section className="flex flex-col gap-4 pt-2 md:pt-4">
        <div>
          <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>{today}</p>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mt-0.5" style={{ color: 'var(--text)' }}>{greeting()}</h1>
        </div>
        <Composer />
      </section>

      {idx && !idx.ready && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--primary-tint)', color: 'var(--text)' }}>
          {idx.error ? (
            <>
              <AlertCircle size={16} className="flex-shrink-0" style={{ color: 'var(--warning)' }} />
              <span>Your notes can’t be prepared for questions yet: {idx.error}. Is Ollama running? It retries every 10 minutes; name search works meanwhile.</span>
            </>
          ) : (
            <>
              <Loader2 size={16} className="animate-spin flex-shrink-0" style={{ color: 'var(--primary)' }} />
              <span>Getting your notes ready for questions — this runs once after a model change and takes a few minutes. Name search works meanwhile.</span>
            </>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-subtle)' }}>Waiting for you</h2>
        {!home ? (
          <div className="h-[72px] rounded-2xl" style={{ background: 'var(--bg-elevated)' }} />
        ) : tiles.length === 0 ? (
          <div className="card p-4 flex items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            <CheckCircle2 size={18} style={{ color: 'var(--success)' }} /> You’re all caught up.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {tiles.map(t => {
              const Icon = t.icon
              return (
                <Link key={t.href} href={t.href} className="card card-interactive p-4 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-tint)', color: 'var(--primary)' }}>
                    <Icon size={18} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>{t.title}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{t.sub}</span>
                  </span>
                  <ChevronRight size={16} style={{ color: 'var(--text-subtle)' }} />
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <BriefingCard />
        </div>
        <div className="flex flex-col gap-6">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Recently edited</h2>
              <Link href="/explorer" className="text-xs font-medium" style={{ color: 'var(--primary)' }}>All notes</Link>
            </div>
            {!home ? (
              <p className="text-xs py-2" style={{ color: 'var(--text-subtle)' }}>Loading…</p>
            ) : home.recent.length === 0 ? (
              <p className="text-xs py-2" style={{ color: 'var(--text-subtle)' }}>No notes yet.</p>
            ) : (
              <ul className="-mx-2">
                {home.recent.map(f => {
                  const parts = f.path.replace(/\.md$/, '').split('/')
                  return (
                    <li key={f.path}>
                      <Link href={`/explorer?file=${encodeURIComponent(f.path)}`} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover-surface">
                        <FileText size={14} className="flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm truncate" style={{ color: 'var(--text)' }}>{parts[parts.length - 1]}</span>
                          {parts.length > 1 && <span className="block text-[11px] truncate" style={{ color: 'var(--text-subtle)' }}>{parts.slice(0, -1).join(' / ')}</span>}
                        </span>
                        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-subtle)' }}>{ago(f.mtime)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <ActivityTimelineCard />
        </div>
      </div>
    </div>
  )
}
