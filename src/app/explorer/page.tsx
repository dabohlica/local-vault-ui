'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileTree } from '@/components/explorer/FileTree'
import { MarkdownPreview } from '@/components/explorer/MarkdownPreview'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'

function ExplorerContent() {
  const searchParams = useSearchParams()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const fileParam = searchParams.get('file')
    if (fileParam) {
      setSelectedFile(decodeURIComponent(fileParam))
    }
  }, [searchParams])

  return (
    <div className="flex h-full gap-0 rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      {/* File tree panel. Master/detail on mobile: full-width tree, hidden once a
          file is open (the preview takes over). Always a fixed rail on md+. */}
      <div
        className={cn(
          'flex-shrink-0 flex-col w-full md:w-[260px] md:flex',
          selectedFile ? 'hidden' : 'flex',
        )}
        style={{
          background: 'var(--bg-base)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        <div className="p-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-subtle)' }} />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter notes…"
              className="field w-full h-8 pl-8 pr-2 text-sm"
              aria-label="Filter notes by name"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <FileTree selectedPath={selectedFile} onSelect={setSelectedFile} filter={filter} />
        </div>
      </div>

      {/* Preview panel. Hidden on mobile until a file is picked; full-width then. */}
      <div
        className={cn('flex-1 min-w-0 md:block', selectedFile ? 'block' : 'hidden')}
        style={{ background: 'var(--bg-surface)' }}
      >
        <MarkdownPreview filePath={selectedFile} onBack={() => setSelectedFile(null)} />
      </div>
    </div>
  )
}

export default function NotesPage() {
  return (
    <div className="page-fill flex flex-col">
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="text-sm" style={{ color: 'var(--text-subtle)' }}>Loading…</div>}>
          <ExplorerContent />
        </Suspense>
      </div>
    </div>
  )
}
