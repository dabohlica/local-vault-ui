'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, MessageCircle, Swords, PenLine, FileText, HeartPulse, Network, Layers, Sunrise, CornerDownLeft, type LucideIcon } from 'lucide-react'
import { titleScore } from '@/lib/noteMatch'
import { NAV, SETTINGS_ITEM } from './nav'
import { useCompanion } from '@/components/companion/CompanionContext'

type Note = { path: string; title: string; folder: string; mtime: number }
type Hit = { path: string; title: string; folder: string; snippet: string }
type Entry = { id: string; group: string; label: string; sub?: string; icon: LucideIcon; run: () => void }

const TOOLS: Array<{ label: string; sub: string; icon: LucideIcon; href: string; keys: string }> = [
  { label: 'Health check', sub: 'Find notes that need tidying', icon: HeartPulse, href: '/commands?tool=health', keys: 'health check fix broken tidy' },
  { label: 'Connect notes', sub: 'Suggest missing [[links]]', icon: Network, href: '/commands?tool=interlink', keys: 'connect interlink links graph' },
  { label: 'Write a summary', sub: 'Of a topic or a week', icon: Layers, href: '/commands?tool=synthesize', keys: 'summary synthesize recap week' },
  { label: 'Morning briefing', sub: 'Today’s picks from your sources', icon: Sunrise, href: '/#briefing', keys: 'briefing morning today news' },
]

// ⌘K: one box to find a note, ask a question, save a thought, or jump anywhere.
export function CommandPalette() {
  const router = useRouter()
  const companion = useCompanion()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [notes, setNotes] = useState<Note[]>([])
  const [hits, setHits] = useState<Hit[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const show = useCallback((query = '') => {
    setQ(query); setSel(0); setHits([]); setOpen(true)
    fetch('/api/vault/notes').then(r => r.json()).then(d => setNotes(d.notes ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) setOpen(false); else show()
      }
    }
    const onOpen = (e: Event) => show((e as CustomEvent<{ query?: string }>).detail?.query ?? '')
    window.addEventListener('keydown', onKey)
    window.addEventListener('palette:open', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('palette:open', onOpen) }
  }, [open, show])

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0) }, [open])

  // Full-text hits, debounced; note names are filtered instantly below.
  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return }
    // Abort on the next keystroke so a slow answer for "ja" can't land after
    // (and overwrite) the one for "jane".
    const ctrl = new AbortController()
    setHits([])
    const t = setTimeout(() => {
      fetch(`/api/vault/search?q=${encodeURIComponent(q)}&limit=8`, { signal: ctrl.signal })
        .then(r => r.json()).then(d => { if (!ctrl.signal.aborted) setHits(d.results ?? []) }).catch(() => {})
    }, 180)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q, open])

  const go = useCallback((href: string) => { setOpen(false); router.push(href) }, [router])
  const openNote = useCallback((p: string) => go(`/explorer?file=${encodeURIComponent(p)}`), [go])

  const entries = useMemo<Entry[]>(() => {
    const query = q.trim()
    const out: Entry[] = []
    if (query) {
      const actions: Entry[] = [
        { id: 'ask', group: 'Do', label: `Ask ${companion.name}: “${query}”`, sub: 'Answered from your notes', icon: MessageCircle, run: () => go(`/chat?q=${encodeURIComponent(query)}`) },
        { id: 'spar', group: 'Do', label: `Spar with ${companion.name}: “${query.length > 40 ? query.slice(0, 40) + '…' : query}”`, sub: 'Get pushback from your own notes', icon: Swords, run: () => go(`/chat?q=${encodeURIComponent(query)}&mode=spar`) },
        { id: 'save', group: 'Do', label: `Save as a note: “${query.length > 40 ? query.slice(0, 40) + '…' : query}”`, sub: 'Filed into the right place, you approve first', icon: PenLine, run: () => go(`/add?text=${encodeURIComponent(query)}`) },
      ]
      const named = notes
        .map(n => ({ n, s: titleScore(query, n.path) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 6)
      // Typing a note's name → Enter opens it; anything else → Enter asks.
      const nameFirst = (named[0]?.s ?? 0) >= 50
      if (!nameFirst) out.push(...actions)
      const seen = new Set<string>()
      for (const { n } of named) {
        seen.add(n.path)
        out.push({ id: `n:${n.path}`, group: 'Notes', label: n.title, sub: n.folder, icon: FileText, run: () => openNote(n.path) })
      }
      for (const h of hits) {
        if (seen.has(h.path) || seen.size >= 10) continue
        seen.add(h.path)
        out.push({ id: `t:${h.path}`, group: 'Notes', label: h.title, sub: h.snippet, icon: FileText, run: () => openNote(h.path) })
      }
      if (nameFirst) out.push(...actions)
      const lq = query.toLowerCase()
      for (const t of TOOLS) if ((t.label + ' ' + t.keys).toLowerCase().includes(lq)) out.push({ id: `tool:${t.href}`, group: 'Tools', label: t.label, sub: t.sub, icon: t.icon, run: () => go(t.href) })
      for (const n of [...NAV, SETTINGS_ITEM]) if (n.label.toLowerCase().startsWith(lq) || (n.href === '/chat' && companion.name.toLowerCase().startsWith(lq))) out.push({ id: `go:${n.href}`, group: 'Go to', label: n.href === '/chat' ? `Ask ${companion.name}` : n.label, sub: n.hint, icon: n.icon, run: () => go(n.href) })
    } else {
      for (const n of notes.slice(0, 5)) out.push({ id: `n:${n.path}`, group: 'Recent notes', label: n.title, sub: n.folder, icon: FileText, run: () => openNote(n.path) })
      for (const n of [...NAV, SETTINGS_ITEM]) out.push({ id: `go:${n.href}`, group: 'Go to', label: n.href === '/chat' ? `Ask ${companion.name}` : n.label, sub: n.hint, icon: n.icon, run: () => go(n.href) })
      for (const t of TOOLS) out.push({ id: `tool:${t.href}`, group: 'Tools', label: t.label, sub: t.sub, icon: t.icon, run: () => go(t.href) })
    }
    return out
  }, [q, notes, hits, go, openNote, companion.name])

  useEffect(() => { setSel(s => Math.min(s, Math.max(0, entries.length - 1))) }, [entries.length])
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % Math.max(1, entries.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (s - 1 + entries.length) % Math.max(1, entries.length)) }
    else if (e.key === 'Enter') { e.preventDefault(); entries[sel]?.run() }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-hidden />
      <div
        role="dialog"
        aria-label="Search and actions"
        onMouseDown={e => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl border overflow-hidden shadow-pop"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3 px-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <Search size={18} style={{ color: 'var(--text-subtle)' }} />
          <input
            ref={input}
            value={q}
            onChange={e => { setQ(e.target.value); setSel(0) }}
            onKeyDown={onKeyDown}
            placeholder={`Find a note, ask ${companion.name}, or jot something down…`}
            className="flex-1 h-14 bg-transparent outline-none text-[15px]"
            style={{ color: 'var(--text)' }}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded hidden sm:inline" style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)' }}>esc</kbd>
        </div>

        <div ref={list} className="max-h-[56vh] overflow-y-auto p-2">
          {entries.length === 0 && <p className="text-sm px-3 py-6 text-center" style={{ color: 'var(--text-subtle)' }}>Nothing found.</p>}
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? e.group : null
            lastGroup = e.group
            const Icon = e.icon
            const active = i === sel
            return (
              <div key={e.id}>
                {header && <p className="text-[11px] font-semibold uppercase tracking-wide px-3 pt-3 pb-1" style={{ color: 'var(--text-subtle)' }}>{header}</p>}
                <button
                  data-idx={i}
                  onMouseMove={() => setSel(i)}
                  onClick={e.run}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left"
                  style={{ background: active ? 'var(--primary-tint)' : 'transparent' }}
                >
                  <Icon size={16} className="flex-shrink-0" style={{ color: active ? 'var(--primary)' : 'var(--text-subtle)' }} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate" style={{ color: 'var(--text)' }}>{e.label}</span>
                    {e.sub && <span className="block text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{e.sub}</span>}
                  </span>
                  {active && <CornerDownLeft size={14} className="flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
