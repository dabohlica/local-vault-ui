'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'

// Coerce free input into a valid Obsidian tag (mirror of lib/tags.sanitizeTag —
// kept here so the chip the user sees matches exactly what the server will store).
function sanitize(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^\wÀ-ɏ/-]/g, '')
    .replace(/^[-/]+|[-/]+$/g, '')
}

type Props = {
  value: string[]
  onChange: (tags: string[]) => void
  // Compact single-row variant for tight spots (e.g. above the chat input).
  compact?: boolean
}

// Capture tag picker: type to add a chip (Enter/comma), pick from existing vault tags,
// remove with × or Backspace. The chosen tags are guaranteed onto every note the
// capture writes (enforced server-side in lib/tags.applyTags).
export function TagPicker({ value, onChange, compact }: Props) {
  const [input, setInput] = useState('')
  const [all, setAll] = useState<Array<{ tag: string; count: number }>>([])
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Existing vault tags for autocomplete — fetched once when the picker mounts.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/vault/tags', { cache: 'no-store' })
        const data = await res.json() as { tags?: Array<{ tag: string; count: number }> }
        setAll(data.tags ?? [])
      } catch { /* autocomplete is a nicety; free entry still works */ }
    })()
  }, [])

  const selected = useMemo(() => new Set(value.map(t => t.toLowerCase())), [value])
  const query = sanitize(input).toLowerCase()
  const suggestions = useMemo(() => {
    const pool = all.filter(t => !selected.has(t.tag.toLowerCase()))
    const matched = query ? pool.filter(t => t.tag.toLowerCase().includes(query)) : pool
    return matched.slice(0, 8)
  }, [all, selected, query])

  function add(raw: string) {
    const clean = sanitize(raw)
    if (!clean || selected.has(clean.toLowerCase())) { setInput(''); return }
    onChange([...value, clean])
    setInput('')
  }

  function remove(tag: string) {
    onChange(value.filter(t => t !== tag))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (input.trim()) add(input)
    } else if (e.key === 'Backspace' && !input && value.length) {
      remove(value[value.length - 1])
    }
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1.5"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        onClick={() => inputRef.current?.focus()}
      >
        <Tag size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
        {value.map(t => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs"
            style={{ background: 'var(--icon-grad)', color: 'var(--primary)' }}
          >
            #{t}
            <button onClick={e => { e.stopPropagation(); remove(t) }} title="Remove tag" style={{ color: 'var(--primary)' }}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={value.length ? '' : (compact ? 'Add tags…' : 'Add tags, e.g. AWS_genAI_Cert')}
          className="flex-1 min-w-[8ch] bg-transparent text-xs outline-none py-0.5"
          style={{ color: 'var(--text)' }}
        />
      </div>

      {open && suggestions.length > 0 && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-lg max-h-56 overflow-y-auto"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          {suggestions.map(s => (
            <button
              key={s.tag}
              // mousedown (not click) so it fires before the input's blur closes the list.
              onMouseDown={e => { e.preventDefault(); add(s.tag) }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:opacity-80"
              style={{ color: 'var(--text)' }}
            >
              <span style={{ color: 'var(--primary)' }}>#{s.tag}</span>
              <span style={{ color: 'var(--text-subtle)' }}>{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
