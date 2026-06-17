'use client'

import { useRouter } from 'next/navigation'
import { FileText, FolderOpen } from 'lucide-react'

export type SearchResult = {
  path: string
  matchingLines: string[]
}

type Props = {
  results: SearchResult[]
  query: string
}

export function SearchResults({ results, query }: Props) {
  const router = useRouter()

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <FileText size={32} style={{ color: 'var(--text-subtle)' }} />
        <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
          No results for &ldquo;{query}&rdquo;
        </p>
      </div>
    )
  }

  function highlight(line: string, q: string): React.ReactNode {
    if (!q) return line
    const regex = new RegExp(`(${escapeRegex(q)})`, 'gi')
    const parts = line.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          style={{ background: 'var(--primary-tint-strong)', color: 'var(--primary)', borderRadius: '2px', padding: '0 2px' }}
        >
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
        {results.length} file{results.length !== 1 ? 's' : ''} matched
      </p>
      {results.map(result => {
        const parts = result.path.split('/')
        const name = parts.at(-1)?.replace('.md', '') ?? result.path
        const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : ''

        return (
          <button
            key={result.path}
            onClick={() => router.push(`/explorer?file=${encodeURIComponent(result.path)}`)}
            className="w-full text-left p-4 rounded-xl border transition-all duration-150 hover:scale-[1.01]"
            style={{
              background: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'
              ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'var(--primary-tint)' }}
              >
                <FileText size={14} style={{ color: 'var(--primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{name}</p>
                {folder && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <FolderOpen size={11} style={{ color: 'var(--text-subtle)' }} />
                    <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{folder}</p>
                  </div>
                )}
                {result.matchingLines.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {result.matchingLines.slice(0, 3).map((line, i) => (
                      <p
                        key={i}
                        className="text-xs font-mono truncate"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {highlight(line.trim(), query)}
                      </p>
                    ))}
                    {result.matchingLines.length > 3 && (
                      <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                        +{result.matchingLines.length - 3} more matches
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
