'use client'

import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { ProposalReview, type ProposalResponse } from '@/components/shared/ProposalReview'

export type { Change, ProposalResponse } from '@/components/shared/ProposalReview'

type Props = {
  inputLabel: string
  inputPlaceholder: string
  submitLabel?: string
  minHeight?: number
  // Caller supplies how to request a proposal from the given input text.
  request: (input: string) => Promise<Response>
}

// Input box -> request a proposal -> review/approve/apply (via ProposalReview).
// Used by the Curate page and by every local command.
export function ProposalFlow({ inputLabel, inputPlaceholder, submitLabel = 'Propose updates', minHeight = 140, request }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProposalResponse | null>(null)

  async function propose() {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await request(text)
      const data = await res.json() as ProposalResponse
      if (!res.ok) throw new Error(data.error ?? 'Request failed')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-col gap-3">
        <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{inputLabel}</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={inputPlaceholder}
          className="resize-none rounded-lg p-3 text-sm outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', minHeight: `${minHeight}px`, fontFamily: 'inherit' }}
        />
        <div className="flex justify-end">
          <button
            onClick={() => void propose()}
            disabled={!text.trim() || loading}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? 'Thinking…' : submitLabel}
          </button>
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {result && (
        <ProposalReview result={result} onApplied={() => { setResult(null); setText('') }} onDiscard={() => setResult(null)} />
      )}
    </div>
  )
}
