'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileTree } from '@/components/explorer/FileTree'
import { MarkdownPreview } from '@/components/explorer/MarkdownPreview'

function ExplorerContent() {
  const searchParams = useSearchParams()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  useEffect(() => {
    const fileParam = searchParams.get('file')
    if (fileParam) {
      setSelectedFile(decodeURIComponent(fileParam))
    }
  }, [searchParams])

  return (
    <div className="flex h-full gap-0 rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      {/* File tree panel */}
      <div
        className="flex-shrink-0 flex flex-col w-[44%] min-w-[140px] md:w-[260px]"
        style={{
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            VAULT FILES
          </p>
        </div>
        <FileTree selectedPath={selectedFile} onSelect={setSelectedFile} />
      </div>

      {/* Preview panel */}
      <div className="flex-1 min-w-0" style={{ background: 'var(--bg-base)' }}>
        <MarkdownPreview filePath={selectedFile} />
      </div>
    </div>
  )
}

export default function ExplorerPage() {
  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - 56px - 48px)' }}>
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-xl font-bold gradient-text">Explorer</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Browse and preview your vault files
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="text-sm" style={{ color: 'var(--text-subtle)' }}>Loading…</div>}>
          <ExplorerContent />
        </Suspense>
      </div>
    </div>
  )
}
