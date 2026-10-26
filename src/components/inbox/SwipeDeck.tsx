'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock, ExternalLink, Sparkles, Undo2, X, FileText } from 'lucide-react'
import type { InboxItem } from '@/lib/inbox'
import { CompanionAvatar } from '@/components/companion/Avatar'
import { useCompanion } from '@/components/companion/CompanionContext'

export type SwipeDecision = 'accepted' | 'rejected' | 'later'

const THRESHOLD = 110 // px of horizontal drag that commits a swipe
const FLY_MS = 180

function ago(ms: number | string | null): string {
  if (!ms) return ''
  const t = typeof ms === 'string' ? Date.parse(ms) : ms
  const h = Math.floor((Date.now() - t) / 3600_000)
  if (h < 1) return 'just now'
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Card stack: drag the top card right to keep, left to skip (touch or mouse), or
// use the buttons / ← → ↓ keys. Vertical drags scroll the card as usual.
export function SwipeDeck({
  items,
  onDecide,
  onUndo,
  canUndo,
}: {
  items: InboxItem[]
  onDecide: (item: InboxItem, decision: SwipeDecision) => void
  onUndo: () => void
  canUndo: boolean
}) {
  const top = items[0]
  const companion = useCompanion()
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<SwipeDecision | null>(null)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  // New top card: reset position/expansion.
  useEffect(() => { setDx(0); setLeaving(null); setExpanded(false) }, [top?.id])

  const commit = useCallback((decision: SwipeDecision) => {
    if (!top || leaving) return
    setLeaving(decision)
    setTimeout(() => onDecide(top, decision), FLY_MS)
  }, [top, leaving, onDecide])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); commit('accepted') }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); commit('rejected') }
      else if (e.key === 'ArrowDown') { e.preventDefault(); commit('later') }
      else if ((e.key === 'z' || e.key === 'Backspace') && canUndo) { e.preventDefault(); onUndo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, onUndo, canUndo])

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('a, button')) return
    start.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return
    const mx = e.clientX - start.current.x
    const my = e.clientY - start.current.y
    if (!dragging) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (Math.abs(my) > 10) {
        start.current = null // it's a scroll
      }
      return
    }
    setDx(mx)
  }
  function onPointerEnd() {
    start.current = null
    if (!dragging) return
    setDragging(false)
    if (dx > THRESHOLD) commit('accepted')
    else if (dx < -THRESHOLD) commit('rejected')
    else setDx(0)
  }

  const flyX = leaving === 'accepted' ? 1.2 * window.innerWidth : leaving === 'rejected' ? -1.2 * window.innerWidth : dx
  const flyY = leaving === 'later' ? 600 : 0
  const keepOpacity = Math.min(1, Math.max(0, dx / THRESHOLD))
  const skipOpacity = Math.min(1, Math.max(0, -dx / THRESHOLD))

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative w-full max-w-xl" style={{ minHeight: 440 }}>
        {/* Next card peeking from behind. */}
        {items[1] && (
          <div
            className="absolute inset-0 rounded-2xl border"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', transform: 'scale(0.96) translateY(10px)', opacity: 0.7 }}
            aria-hidden
          />
        )}
        {top && (
          <div
            key={top.id}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            className="absolute inset-0 rounded-2xl border flex flex-col select-none"
            style={{
              background: 'var(--bg-surface)',
              borderColor: 'var(--border)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.10)',
              transform: `translate(${flyX}px, ${flyY}px) rotate(${(leaving === 'later' ? 0 : flyX) / 22}deg)`,
              transition: dragging ? 'none' : `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms`,
              opacity: leaving ? 0 : 1,
              touchAction: 'pan-y',
              cursor: dragging ? 'grabbing' : 'grab',
            }}
          >
            <span className="absolute top-4 left-4 z-10 px-3 py-1 rounded-lg text-sm font-bold border-2 pointer-events-none"
              style={{ color: 'var(--success)', borderColor: 'var(--success)', opacity: keepOpacity, transform: 'rotate(-8deg)' }}>KEEP</span>
            <span className="absolute top-4 right-4 z-10 px-3 py-1 rounded-lg text-sm font-bold border-2 pointer-events-none"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)', opacity: skipOpacity, transform: 'rotate(8deg)' }}>SKIP</span>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-subtle)' }}>
                <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--primary-tint)', color: 'var(--primary)' }}>
                  {top.section}
                </span>
                <span>{top.sourceName}</span>
                {top.published && <span>· {ago(top.published)}</span>}
              </div>

              <h2 className="text-lg font-semibold leading-snug" style={{ color: 'var(--text)' }}>{top.title}</h2>
              {top.authors.length > 0 && (
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {top.authors.slice(0, 4).join(', ')}{top.authors.length > 4 ? ' et al.' : ''}
                </p>
              )}

              {top.why && (
                <div className="rounded-xl p-3 text-sm flex gap-2.5" style={{ background: 'var(--primary-tint)', color: 'var(--text)' }}>
                  <CompanionAvatar kind={companion.kind} size={34} className="-mt-0.5" />
                  <span><span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>Why {companion.name} picked it</span>{top.why}</span>
                </div>
              )}

              {top.summary && (
                <div className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  <p className={expanded ? '' : 'line-clamp-6'}>{top.summary}</p>
                  {top.summary.length > 420 && (
                    <button onClick={() => setExpanded(v => !v)} className="text-xs mt-1 font-medium" style={{ color: 'var(--primary)' }}>
                      {expanded ? 'Less' : 'More'}
                    </button>
                  )}
                </div>
              )}

              {top.related.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Related to your notes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {top.related.map(r => (
                      <Link key={r.path} href={`/explorer?file=${encodeURIComponent(r.path)}`}
                        className="text-xs px-2 py-1 rounded-lg flex items-center gap-1 max-w-full"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                        <FileText size={12} className="flex-shrink-0" />
                        <span className="truncate">{r.path.replace(/\.md$/, '').split('/').pop()}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-between text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-subtle)' }}>
              <span>{items.length > 1 ? `${items.length - 1} more after this` : 'Last one'}</span>
              <a href={top.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium" style={{ color: 'var(--primary)' }}>
                Read original <ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <RoundButton label="Undo (Z)" onClick={onUndo} disabled={!canUndo} size={44}><Undo2 size={18} /></RoundButton>
        <RoundButton label="Skip (←)" onClick={() => commit('rejected')} disabled={!top} size={60} color="var(--danger)"><X size={26} /></RoundButton>
        <RoundButton label="Later (↓)" onClick={() => commit('later')} disabled={!top} size={48} color="var(--warning)"><Clock size={20} /></RoundButton>
        <RoundButton label="Keep — save to vault (→)" onClick={() => commit('accepted')} disabled={!top} size={60} color="var(--success)"><Check size={26} /></RoundButton>
      </div>
    </div>
  )
}

function RoundButton({ children, label, onClick, disabled, size, color = 'var(--text-muted)' }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; size: number; color?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-full border flex items-center justify-center transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
      style={{ width: size, height: size, background: 'var(--bg-surface)', borderColor: 'var(--border)', color, boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
    >
      {children}
    </button>
  )
}
