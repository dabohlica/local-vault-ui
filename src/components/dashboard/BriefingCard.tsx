'use client'

import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RefreshCw, Brain } from 'lucide-react'

type BriefingMeta = { path: string; title: string; date: string; tags: string[] }

// Friendlier tab label: strip a trailing "Briefing" word so e.g.
// "AI Trending Briefing" -> "AI Trending", "Stock & Trading Briefing" -> "Stock & Trading".
function tabLabel(title: string) {
  const stripped = title.replace(/\s*briefing\s*$/i, '').trim()
  return stripped || title
}

export function BriefingCard() {
  const [briefings, setBriefings] = useState<BriefingMeta[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [date, setDate] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Discover available briefings once.
  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/briefings')
      const data = await res.json() as { briefings?: BriefingMeta[] }
      const list = data.briefings ?? []
      setBriefings(list)
      setActive(prev => prev && list.some(b => b.path === prev) ? prev : (list[0]?.path ?? null))
      if (list.length === 0) { setError('No briefings found'); setLoading(false) }
    } catch {
      setError('Failed to load briefings')
      setLoading(false)
    }
  }, [])

  // Load the selected briefing's latest section.
  const loadContent = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/vault/file?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error('Briefing not found')
      const d = await res.json() as { content: string }
      const parsed = parseBriefing(d.content)
      setContent(parsed.content)
      setDate(parsed.date)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { if (active) void loadContent(active) }, [active, loadContent])

  return (
    <div className="card col-span-2 flex flex-col p-5" style={{ minHeight: '320px' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary-tint)' }}>
            <Brain size={15} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Briefings</h2>
            {date && <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{date}</p>}
          </div>
        </div>
        <button
          onClick={() => active && void loadContent(active)}
          disabled={loading}
          className="p-1.5 rounded-lg transition-all duration-150 hover:scale-110 disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      {briefings.length > 1 && (
        <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
          {briefings.map(b => {
            const selected = b.path === active
            return (
              <button
                key={b.path}
                onClick={() => setActive(b.path)}
                className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-150"
                style={{
                  background: selected ? 'var(--bg-surface)' : 'transparent',
                  color: selected ? 'var(--primary)' : 'var(--text-muted)',
                  boxShadow: selected ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {tabLabel(b.title)}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-center" style={{ color: 'var(--text-subtle)' }}>
              {error}
              <br />
              <span className="text-xs mt-1 block">Add a note with <code>type: briefing</code> (or &quot;briefing&quot; in its name) to your vault</span>
            </p>
          </div>
        )}
        {!loading && !error && (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}

function parseBriefing(raw: string): { content: string; date: string } {
  // Show the latest "### YYYY-MM-DD" section if present, else the whole note body.
  const sectionRegex = /^### (\d{4}-\d{2}-\d{2})/m
  const match = sectionRegex.exec(raw)
  if (!match) {
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    return { content: body, date: '' }
  }

  const date = match[1]
  const startIdx = match.index
  const nextRegex = /^### \d{4}-\d{2}-\d{2}/gm
  nextRegex.lastIndex = startIdx + 1
  const next = nextRegex.exec(raw)
  const content = next ? raw.slice(startIdx, next.index).trim() : raw.slice(startIdx).trim()
  return { content, date }
}
