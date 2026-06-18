'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { ProposalReview, type ProposalResponse } from '@/components/shared/ProposalReview'

// Runner for deterministic commands that produce a change-proposal directly (no
// text input, no model). One button → POST the endpoint → review/approve diffs.
export function ProposalRunner({ endpoint, runLabel, blurb }: { endpoint: string; runLabel: string; blurb: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProposalResponse | null>(null)

  async function run() {
    if (loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json() as ProposalResponse
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{blurb}</p>
      <button
        onClick={() => void run()}
        disabled={loading}
        className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? 'Scanning…' : runLabel}
      </button>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {result && (
        result.changes.length === 0
          ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{result.summary}</p>
          : <ProposalReview result={result} onApplied={() => setResult(null)} onDiscard={() => setResult(null)} />
      )}
    </div>
  )
}
