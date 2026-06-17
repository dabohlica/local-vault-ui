'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Loader2, MessageSquare, FileText } from 'lucide-react'

type Citation = { path: string; heading: string }
type Message = { role: 'user' | 'assistant'; content: string; citations?: Citation[] }

export default function ChatPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const question = input.trim()
    if (!question || loading) return

    setMessages(prev => [...prev, { role: 'user', content: question }])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json() as { answer?: string; citations?: Citation[]; error?: string }
      if (!res.ok || !data.answer) {
        throw new Error(data.error ?? 'Chat failed')
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer!, citations: data.citations }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - 56px - 48px)' }}>
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-xl font-bold gradient-text">Chat</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Ask questions about your vault — answered locally via Ollama with citations
        </p>
      </div>

      <div
        className="flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <MessageSquare size={28} style={{ color: 'var(--text-subtle)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
                Ask something like &ldquo;What do I know about FreeRange?&rdquo;
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-2 max-w-2xl" style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                className="px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap"
                style={{
                  background: m.role === 'user' ? 'var(--primary)' : 'var(--bg-elevated)',
                  color: m.role === 'user' ? 'white' : 'var(--text)',
                  border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
                }}
              >
                {m.content}
              </div>

              {m.citations && m.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.citations.map(c => (
                    <button
                      key={c.path}
                      onClick={() => router.push(`/explorer?file=${encodeURIComponent(c.path)}`)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all duration-150 hover:scale-[1.02]"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                    >
                      <FileText size={11} style={{ color: 'var(--primary)' }} />
                      {c.path.replace(/\.md$/, '')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-subtle)' }}>
              <Loader2 size={14} className="animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          )}
        </div>

        <div className="flex-shrink-0 border-t p-3 flex gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void send() }}
            placeholder="Ask about your vault…"
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
          >
            <Send size={14} />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
