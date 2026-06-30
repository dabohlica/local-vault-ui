'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Loader2, MessageSquare, FileText, Trash2, BookmarkPlus, Plus } from 'lucide-react'
import { ProposalReview, type ProposalResponse } from '@/components/shared/ProposalReview'
import { TagPicker } from '@/components/shared/TagPicker'
import { fetchWithRetry } from '@/lib/fetchRetry'

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
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureTags, setCaptureTags] = useState<string[]>([])
  const [proposal, setProposal] = useState<ProposalResponse | null>(null)

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

    // Accumulate the streamed answer outside the state updater so the updater stays
    // pure (React StrictMode invokes it twice in dev). `started` flips once the first
    // token lands and the assistant bubble is appended; subsequent tokens replace it.
    let acc = ''
    let started = false
    let citations: Citation[] | undefined
    try {
      const res = await fetchWithRetry('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, mode: 'ask', sessionId }),
      })
      // A failure before streaming begins comes back as JSON, not NDJSON.
      if (!res.ok || !res.body) {
        let msg = 'Chat failed'
        try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* non-JSON body */ }
        throw new Error(msg)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamErr: string | null = null

      const handle = (evt: { type: string; v?: string; citations?: Citation[]; sessionId?: string; error?: string }) => {
        if (evt.type === 'meta') {
          citations = evt.citations
        } else if (evt.type === 'token') {
          acc += evt.v ?? ''
          if (!started) {
            started = true
            setStreaming(true) // first token in — swap the "Thinking…" line for the answer
            setMessages(prev => [...prev, { role: 'assistant', content: acc, citations }])
          } else {
            setMessages(prev => {
              const next = prev.slice()
              next[next.length - 1] = { role: 'assistant', content: acc, citations }
              return next
            })
          }
        } else if (evt.type === 'done') {
          if (evt.sessionId) setSessionId(evt.sessionId)
        } else if (evt.type === 'error') {
          streamErr = evt.error ?? 'Chat failed'
        }
      }

      // Parse the newline-delimited JSON stream, buffering partial lines across reads.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          try { handle(JSON.parse(line)) } catch { /* ignore a torn line */ }
        }
      }

      if (streamErr) throw new Error(streamErr)
      if (!started) throw new Error('Empty response')
      void loadSessions() // refresh titles / new session in the rail
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
      // Self-heal: if nothing streamed in but the server already finished and
      // persisted the answer, pull it from the session so it shows without a manual
      // reload. Only when we have a session and rendered no partial answer.
      if (!started && sessionId) void openSession(sessionId)
    } finally {
      setLoading(false)
      setStreaming(false)
    }
  }

  // Route the whole conversation through the normal ingest pipeline → review.
  async function includeInVault() {
    if (capturing || messages.length === 0) return
    setCapturing(true); setError(null); setProposal(null)
    try {
      const res = await fetchWithRetry('/api/chat/to-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: buildTranscript(messages),
          notes: 'Saved chat conversation about the vault — capture the key questions, answers, decisions, and facts worth keeping.',
          tags: captureTags,
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
    <div className="flex flex-col h-[calc(100vh-56px-32px)] md:h-[calc(100vh-56px-48px)]">
      {proposal && (
        <div className="mb-4 flex-shrink-0 rounded-2xl p-4 overflow-y-auto" style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)', maxHeight: '50vh' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>Review proposed changes</p>
          <ProposalReview result={proposal} onApplied={() => setProposal(null)} onDiscard={() => setProposal(null)} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Sessions rail — hidden on phones to give the conversation full width. */}
        <aside className="hidden md:flex w-60 flex-shrink-0 flex-col rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
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
        <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between px-4 md:px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Chat</h1>
              {/* Tagline is noise on a phone — the bottom helper text already says this. */}
              <p className="text-xs hidden sm:block" style={{ color: 'var(--text-subtle)' }}>Ask your vault, or Edit it — all local, every edit reviewed.</p>
            </div>
            {messages.length > 0 && (
              // Capture controls: full-width row under the title on mobile; inline on md+.
              <div className="flex items-center gap-2 md:flex-shrink-0">
                <div className="flex-1 min-w-0 md:w-56 md:flex-none">
                  <TagPicker value={captureTags} onChange={setCaptureTags} compact />
                </div>
                <button
                  onClick={() => void includeInVault()}
                  disabled={capturing}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  title="Turn this conversation into a vault note via the ingest pipeline — tagged with the tags on the left"
                >
                  {capturing ? <Loader2 size={13} className="animate-spin" /> : <BookmarkPlus size={13} />}
                  Save to vault
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 flex flex-col gap-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-elevated)' }}>
                  <MessageSquare size={28} style={{ color: 'var(--text-subtle)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
                  Ask something like &ldquo;What do I know about Example Company?&rdquo;
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className="flex flex-col gap-2 min-w-0 max-w-[90%] sm:max-w-2xl" style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  className="px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words"
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
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all duration-150 hover:scale-[1.02] min-w-0 max-w-full"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                      >
                        <FileText size={11} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <span className="truncate">{c.path.replace(/\.md$/, '')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && !streaming && (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-subtle)' }}>
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          </div>

          <div className="flex-shrink-0 border-t p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs px-1 self-start" style={{ color: 'var(--text-subtle)' }}>
              Answers come from your notes. To add knowledge, use <strong>Add</strong> or drag a file in — or
              save this conversation below.
            </span>
            <div className="flex gap-2">
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
      </div>
    </div>
  )
}
