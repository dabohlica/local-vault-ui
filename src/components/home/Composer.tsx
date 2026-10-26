'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowUp, PenLine, Loader2 } from 'lucide-react'
import { useToast } from '@/components/shared/Toast'

const STARTERS = [
  'What did I work on this week?',
  'What are my open projects?',
  'Which decisions did I make recently?',
]

// The home screen's one input: ask your notes (Enter) or jot a thought into
// today's daily note (⌘Enter). Longer things go through "Add note", which files
// them properly and shows the changes first.
export function Composer() {
  const router = useRouter()
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)

  // Grow with the text, up to a sensible height.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  function ask(q = text) {
    const question = q.trim()
    if (!question) return
    router.push(`/chat?q=${encodeURIComponent(question)}`)
  }

  async function jot() {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const d = await res.json() as { path?: string; error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Could not save')
      setText('')
      showToast('Added to today’s daily note', 'success')
      window.dispatchEvent(new Event('vault:updated'))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const has = text.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="card composer p-2">
        <textarea
          ref={ta}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (e.metaKey || e.ctrlKey) void jot()
            else ask()
          }}
          rows={2}
          placeholder="Ask your notes anything, or jot something down…"
          className="w-full resize-none bg-transparent outline-none px-3 pt-2 text-[15px] leading-relaxed"
          style={{ color: 'var(--text)' }}
          aria-label="Ask or jot down"
        />
        <div className="flex items-center gap-2 px-1 pb-1">
          <p className="text-xs flex-1 hidden sm:block pl-2" style={{ color: 'var(--text-subtle)' }}>
            <kbd className="font-sans">↵</kbd> ask · <kbd className="font-sans">⌘↵</kbd> jot down
          </p>
          <button onClick={() => void jot()} disabled={!has || saving} className="btn btn-ghost text-xs ml-auto sm:ml-0" title="Add to today’s daily note (⌘↵)">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />} Jot down
          </button>
          <button onClick={() => ask()} disabled={!has} className="btn btn-primary text-xs" title="Ask your notes (↵)">
            Ask <ArrowUp size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {has ? (
          <Link href={`/add?text=${encodeURIComponent(text)}`} className="text-xs font-medium" style={{ color: 'var(--primary)' }}>
            Make this a proper note instead → (it’ll be filed into the right place, you approve first)
          </Link>
        ) : STARTERS.map(s => (
          <button key={s} onClick={() => ask(s)} className="text-xs px-3 py-1.5 rounded-full border hover-surface" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
