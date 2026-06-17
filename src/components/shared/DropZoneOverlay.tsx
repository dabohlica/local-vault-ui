'use client'

import { useEffect, useState, useCallback } from 'react'
import { Upload, Loader2, Sparkles, X } from 'lucide-react'
import { useToast } from './Toast'
import { ProposalReview, type ProposalResponse } from './ProposalReview'

// All of these now go through /api/vault/ingest (text/pdf → note; image → vision → note).
const INGEST_EXTS = ['.md', '.markdown', '.txt', '.text', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif']

function ext(name: string) {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

export function DropZoneOverlay() {
  const { showToast } = useToast()
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)

  // Ingest queue: text/PDF files are turned into structured notes one at a time.
  const [queue, setQueue] = useState<File[]>([])
  const [current, setCurrent] = useState<File | null>(null)
  const [phase, setPhase] = useState<'idle' | 'ingesting' | 'review'>('idle')
  const [result, setResult] = useState<ProposalResponse | null>(null)

  const rawSave = useCallback(async (file: File) => {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/vault/drop', { method: 'POST', body: fd })
      const data = await res.json() as { savedPath?: string; error?: string }
      if (res.ok && data.savedPath) showToast(`Saved: ${data.savedPath}`, 'success')
      else showToast(data.error ?? `Failed to save ${file.name}`, 'error')
    } catch {
      showToast(`Error saving ${file.name}`, 'error')
    }
  }, [showToast])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    setIsDragging(false); setDragCounter(0)

    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return

    const toIngest: File[] = []
    for (const file of files) {
      if (INGEST_EXTS.includes(ext(file.name))) toIngest.push(file)
      else showToast(`Unsupported file type: ${file.name}`, 'error')
    }
    if (toIngest.length) setQueue(prev => [...prev, ...toIngest])
  }, [showToast])

  // Process the ingest queue one file at a time.
  useEffect(() => {
    if (current || phase !== 'idle' || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    setCurrent(next)
    setPhase('ingesting')

    void (async () => {
      try {
        const fd = new FormData()
        fd.append('file', next)
        const res = await fetch('/api/vault/ingest', { method: 'POST', body: fd })
        if (res.status === 415) {
          // Can't extract text — fall back to saving the raw file.
          await rawSave(next)
          showToast(`${next.name}: saved as-is (couldn't read text)`, 'info')
          setCurrent(null); setPhase('idle')
          return
        }
        const data = await res.json() as ProposalResponse & { savedOnly?: boolean; summary?: string }
        if (!res.ok) throw new Error(data.error ?? 'Ingest failed')
        if (data.savedOnly) {
          // Image saved, but no vision model to summarize it.
          showToast(data.summary ?? `Saved ${next.name}`, 'info')
          setCurrent(null); setPhase('idle')
          return
        }
        setResult(data)
        setPhase('review')
      } catch (err) {
        showToast(err instanceof Error ? err.message : `Failed to ingest ${next.name}`, 'error')
        setCurrent(null); setPhase('idle')
      }
    })()
  }, [queue, current, phase, rawSave, showToast])

  function finish() {
    setResult(null); setCurrent(null); setPhase('idle')
  }

  // Drag listeners
  const onEnter = useCallback((e: DragEvent) => { e.preventDefault(); setDragCounter(c => c + 1); setIsDragging(true) }, [])
  const onLeave = useCallback((e: DragEvent) => { e.preventDefault(); setDragCounter(c => { const n = c - 1; if (n <= 0) setIsDragging(false); return n }) }, [])
  const onOver = useCallback((e: DragEvent) => { e.preventDefault() }, [])

  useEffect(() => {
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [onEnter, onLeave, onOver, handleDrop])

  return (
    <>
      {/* Drag hint */}
      {isDragging && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', border: '2px dashed var(--primary)' }}>
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: 'var(--primary-tint)', border: '2px solid var(--primary)' }}>
              <Upload size={36} style={{ color: 'var(--primary)' }} />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: 'white' }}>Drop to add to your vault</p>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
                .md · .txt · .pdf · images → AI-structured note (reviewed before saving)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Ingesting / review modal */}
      {(phase === 'ingesting' || phase === 'review') && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto p-6" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-2xl my-6 rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  Ingest {current?.name}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}>
                  local
                </span>
              </div>
              <button onClick={finish} className="p-1.5 rounded-lg" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                <X size={15} />
              </button>
            </div>

            {phase === 'ingesting' && (
              <div className="flex items-center gap-2 text-sm py-8 justify-center" style={{ color: 'var(--text-subtle)' }}>
                <Loader2 size={16} className="animate-spin" />
                Reading the file and drafting a note locally…
              </div>
            )}

            {phase === 'review' && result && (
              <ProposalReview result={result} onApplied={finish} onDiscard={finish} />
            )}
          </div>
        </div>
      )}
    </>
  )
}
