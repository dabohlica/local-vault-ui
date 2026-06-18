'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Loader2, MessageSquare, FileText, Trash2, BookmarkPlus, Plus } from 'lucide-react'
import { ProposalReview, type ProposalResponse } from '@/components/shared/ProposalReview'

type Citation = { path: string; heading: string }
type Message = { role: 'user' | 'assistant'; content: string; citations?: Citation[] }
type SessionItem = { id: string; title: string; updatedAt: number; messageCount: number }

function buildTranscript(messages: Message[]): string {
  const date = new Date().toISOString().slice(0, 10)
  const lines = [`# Conversation — ${date}`, '']
  for (const m of messages) {
    lines.push(m.role === 'user' ? `**You:** ${m.content}` : `**Assistant:** ${m.content}`)
    if (m.citations?.length) lines.push(`_Sources: ${m.citations.map(c => `[[${c.path.replace(/\.md$/, '')}]]`).join(', ')}_`)
    lines.push('')
  }
  return lines.join('\n')
}

export default function ChatPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [proposal, setProposal] = useState<ProposalResponse | null>(null)
  const [mode, setMode] = useState<'ask' | 'edit'>('ask')

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/sessions', { cache: 'no-store' })
      const data = await res.json() as { sessions: SessionItem[] }
      setSessions(data.sessions ?? [])
      return data.sessions ?? []
    } catch { return [] }
  }, [])

  const openSession = useCallback(async (id: string) => {
    setProposal(null); setError(null)
    try {
      const res = await fetch(`/api/chat/sessions/${id}`, { cache: 'no-store' })
      const data = await res.json() as { id: string; messages: Message[] }
      setSessionId(data.id)
      setMessages(data.messages ?? [])
    } catch { /* ignore */ }
  }, [])

  // On load: open the most recent session if there is one.
  useEffect(() => {
    void (async () => {
      const list = await loadSessions()
      if (list.length) await openSession(list[0].id)
    })()
  }, [loadSessions, openSession])

  function newChat() {
    setSessionId(undefined); setMessages([]); setProposal(null); setError(null); setInput('')
  }

  async function deleteSession(id: string) {
    await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' })
    if (id === sessionId) newChat()
    await loadSessions()
  }

  async function send() {
    const question = input.trim()
    if (!question || loading) return

    setMessages(prev => [...prev, { role: 'user', content: question }])
    setInput('')
    setLoading(true)
    setError(null)
    setProposal(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, mode, sessionId }),
      })
      const data = await res.json() as {
        answer?: string; citations?: Citation[]; error?: string
        mode?: string; changes?: unknown[]; log_entry?: string; summary?: string; sessionId?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Chat failed')
      if (data.sessionId) setSessionId(data.sessionId)

      if (data.mode === 'edit' && data.changes) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Proposed ${data.changes!.length} change(s): ${data.summary ?? ''}`.trim(), citations: data.citations }])
        setProposal({ changes: data.changes as ProposalResponse['changes'], log_entry: data.log_entry ?? '', summary: data.summary ?? '' })
      } else if (data.answer) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer!, citations: data.citations }])
      } else {
        throw new Error('Empty response')
      }
      void loadSessions() // refresh titles / new session in the rail
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
    } finally {
      setLoading(false)
    }
  }

  // Route the whole conversation through the normal ingest pipeline → review.
  async function includeInVault() {
    if (capturing || messages.length === 0) return
    setCapturing(true); setError(null); setProposal(null)
    try {
      const res = await fetch('/api/chat/to-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: buildTranscript(messages),
          notes: 'Saved chat conversation about the vault — capture the key questions, answers, decisions, and facts worth keeping.',
        }),
      })
      const data = await res.json() as ProposalResponse
      if (!res.ok) throw new Error(data.error ?? 'Could not capture conversation')
      setProposal(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture conversation')
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - 56px - 48px)' }}>
      {proposal && (
        <div className="mb-4 flex-shrink-0 rounded-2xl p-4 overflow-y-auto" style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)', maxHeight: '50vh' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>Review proposed changes</p>
          <ProposalReview result={proposal} onApplied={() => setProposal(null)} onDiscard={() => setProposal(null)} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Sessions rail */}
        <aside className="w-60 flex-shrink-0 flex flex-col rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button
            onClick={newChat}
            className="m-2 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
          >
            <Plus size={15} /> New chat
          </button>
          <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {sessions.length === 0 && (
              <p className="text-xs px-2 py-3" style={{ color: 'var(--text-subtle)' }}>No conversations yet.</p>
            )}
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => void openSession(s.id)}
                className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all"
                style={s.id === sessionId
                  ? { background: 'var(--icon-grad)', borderLeft: '2px solid var(--primary)' }
                  : { background: 'transparent' }}
              >
                <MessageSquare size={13} style={{ color: s.id === sessionId ? 'var(--primary)' : 'var(--text-subtle)', flexShrink: 0 }} />
                <span className="flex-1 truncate text-xs" style={{ color: 'var(--text)' }}>{s.title}</span>
                <button
                  onClick={e => { e.stopPropagation(); void deleteSession(s.id) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-subtle)' }}
                  title="Delete conversation"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] px-3 py-2 border-t" style={{ color: 'var(--text-subtle)', borderColor: 'var(--border-subtle)' }}>
            Conversations auto-clear after 7 days.
          </p>
        </aside>

        {/* Chat column */}
        <div className="flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <h1 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Chat</h1>
              <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Ask your vault, or Edit it — all local, every edit reviewed.</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => void includeInVault()}
                disabled={capturing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                title="Turn this conversation into a vault note via the ingest pipeline"
              >
                {capturing ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />}
                Save to vault
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
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
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          </div>

          <div className="flex-shrink-0 border-t p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-1 self-start rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              {(['ask', 'edit'] as const).map(mm => (
                <button
                  key={mm}
                  onClick={() => setMode(mm)}
                  className="px-3 py-1 rounded-md text-xs font-medium transition-all"
                  style={mode === mm
                    ? { background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }
                    : { background: 'transparent', color: 'var(--text-muted)' }}
                >
                  {mm === 'ask' ? 'Ask' : 'Edit vault'}
                </button>
              ))}
              <span className="text-xs px-2" style={{ color: 'var(--text-subtle)' }}>
                {mode === 'edit' ? 'changes proposed as diffs to approve' : 'answers from your notes'}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void send() }}
                placeholder={mode === 'edit' ? 'Tell the assistant what to change… e.g. "Add a note for Max Müller, CTO at VD"' : 'Ask about your vault…'}
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
                {mode === 'edit' ? 'Propose' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
