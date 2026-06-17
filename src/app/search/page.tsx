'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { SearchResults, type SearchResult } from '@/components/search/SearchResults'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json() as { results: SearchResult[] }
        setResults(data.results)
        setSearched(true)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void doSearch(query)
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doSearch])

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold gradient-text">Search</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Full-text search across all vault files
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading ? (
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} />
          ) : (
            <Search size={18} style={{ color: 'var(--text-subtle)' }} />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search vault…"
          className="w-full pl-12 pr-12 py-3.5 rounded-2xl text-base outline-none transition-all duration-150"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full transition-all duration-150 hover:scale-110"
            style={{ color: 'var(--text-subtle)' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Results */}
      {searched && !loading && (
        <SearchResults results={results} query={query} />
      )}

      {!searched && !loading && !query && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--bg-surface)' }}
          >
            <Search size={28} style={{ color: 'var(--text-subtle)' }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
            Type to search your vault
          </p>
        </div>
      )}
    </div>
  )
}
