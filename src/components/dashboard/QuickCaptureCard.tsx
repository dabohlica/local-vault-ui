'use client'

import { useState } from 'react'
import { Zap, Send, CheckCircle2, AlertCircle } from 'lucide-react'

type SaveStatus = 'idle' | 'saving' | 'success' | 'error'

export function QuickCaptureCard() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [msg, setMsg] = useState('')

  async function handleSave() {
    if (!text.trim()) return
    setStatus('saving')

    try {
      const today = new Date().toISOString().slice(0, 10)
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      const appendContent = `\n\n## Capture — ${timestamp}\n\n${text.trim()}\n`

      const filePath = `Daily/${today}.md`

      // First try to get existing content
      let existingContent = ''
      try {
        const getRes = await fetch(`/api/vault/file?path=${encodeURIComponent(filePath)}`)
        if (getRes.ok) {
          const d = await getRes.json() as { content: string }
          existingContent = d.content
        }
      } catch {
        // file doesn't exist yet, that's fine
      }

      const newContent = existingContent
        ? existingContent + appendContent
        : `# Daily Note — ${today}\n${appendContent}`

      const postRes = await fetch('/api/vault/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: newContent }),
      })

      if (postRes.ok) {
        setStatus('success')
        setMsg(`Saved to Daily/${today}.md`)
        setText('')
      } else {
        const err = await postRes.json() as { error?: string }
        setStatus('error')
        setMsg(err.error ?? 'Failed to save')
      }
    } catch {
      setStatus('error')
      setMsg('Network error')
    }

    setTimeout(() => {
      setStatus('idle')
      setMsg('')
    }, 3000)
  }

  return (
    <div className="card p-4 flex flex-col gap-3 self-start">
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(245,158,11,0.15)' }}
        >
          <Zap size={14} style={{ color: 'var(--warning)' }} />
        </div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Quick Capture</h2>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Capture a thought, link, or idea…"
        className="flex-1 resize-none rounded-lg p-2.5 text-sm outline-none transition-all duration-150"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          minHeight: '80px',
          fontFamily: 'inherit',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            void handleSave()
          }
        }}
      />

      {msg && (
        <div
          className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5"
          style={{
            background: status === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color: status === 'success' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {status === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {msg}
        </div>
      )}

      <button
        onClick={() => void handleSave()}
        disabled={!text.trim() || status === 'saving'}
        className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--accent))',
          color: 'white',
        }}
      >
        <Send size={13} />
        {status === 'saving' ? 'Saving…' : 'Save to Vault'}
      </button>

      <p className="text-xs text-center" style={{ color: 'var(--text-subtle)' }}>
        ⌘↵ to save · appends to today&apos;s daily note
      </p>
    </div>
  )
}
