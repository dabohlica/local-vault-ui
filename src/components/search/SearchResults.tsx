'use client'

import Link from 'next/link'
import { FileText } from 'lucide-react'
import type { FoundNote } from '@/lib/find'

export type SearchResult = FoundNote

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text: string, q: string): React.ReactNode {
  const words = q.trim().split(/\s+/).filter(w => w.length >= 2).map(escapeRegex)
  if (!words.length) return text
  const re = new RegExp(`(${words.join('|')})`, 'gi')
  return text.split(re).map((part, i) =>
    i % 2 === 1
      ? <mark key={i} style={{ background: 'var(--primary-tint-strong)', color: 'var(--text)', borderRadius: 3, padding: '0 2px' }}>{part}</mark>
      : part,
  )
}

export function SearchResults({ results, query }: { results: SearchResult[]; query: string }) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <FileText size={28} style={{ color: 'var(--text-subtle)' }} />
        <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>No notes mention “{query}”.</p>
        <Link href={`/chat?q=${encodeURIComponent(query)}`} className="text-sm font-medium" style={{ color: 'var(--primary)' }}>Ask about it instead →</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {results.map(r => (
        <Link key={r.path} href={`/explorer?file=${encodeURIComponent(r.path)}`} className="card card-interactive px-4 py-3 block">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{highlight(r.title, query)}</span>
            {r.folder && <span className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{r.folder}</span>}
          </div>
          {r.snippet && <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{highlight(r.snippet, query)}</p>}
        </Link>
      ))}
    </div>
  )
}
