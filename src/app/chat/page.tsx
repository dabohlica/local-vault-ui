'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUp, Loader2, MessageCircle, FileText, Trash2, BookmarkPlus, Plus, History, X } from 'lucide-react'
import { ProposalReview, type ProposalResponse } from '@/components/shared/ProposalReview'
import { TagPicker } from '@/components/shared/TagPicker'
import { fetchWithRetry } from '@/lib/fetchRetry'
import { linkWikilinks, noteHref, titleOf } from '@/lib/wikilinks'
import { splitAskBack, type ChatMode } from '@/lib/companion'
import { CompanionAvatar } from '@/components/companion/Avatar'
import { useCompanion } from '@/components/companion/CompanionContext'

type Citation = { path: string; heading: string; images?: string[] }
type Message = { role: 'user' | 'assistant'; content: string; citations?: Citation[] }
type SessionItem = { id: string; title: string; updatedAt: number; messageCount: number }

const STARTERS: Record<ChatMode, string[]> = {
  ask: [
    'What did I work on this week?',
    'What are my open projects and their next steps?',
    'Which decisions did I make recently, and why?',
    'Who have I met recently?',
  ],
  spar: [
    'I think I should take on another client this quarter.',
    'Local models are good enough for all my work now.',
    'I should drop the weekly status meeting.',
    'My current project is on track.',
  ],
}

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
  return (
    <Suspense fallback={null}>
      <ChatView />
    </Suspense>
  )
}

function ChatView() {
  const router = useRouter()
  const params = useSearchParams()
  const handoff = params.get('q')
  const handoffMode: ChatMode = params.get('mode') === 'spar' ? 'spar' : 'ask'
  const companion = useCompanion()
  const [mode, setMode] = useState<ChatMode>('ask')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureTags, setCaptureTags] = useState<string[]>([])
  const [proposal, setProposal] = useState<ProposalResponse | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notePaths, setNotePaths] = useState<string[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/sessions', { cache: 'no-store' })
      const data = await res.json() as { sessions: SessionItem[] }
      setSessions(data.sessions ?? [])
      return data.sessions ?? []
    } catch { return [] }
  }, [])

  const openSession = useCallback(async (id: string) => {
    setProposal(null); setError(null); setHistoryOpen(false)
    try {
      const res = await fetch(`/api/chat/sessions/${id}`, { cache: 'no-store' })
      const data = await res.json() as { id: string; messages: Message[] }
      setSessionId(data.id)
      setMessages(data.messages ?? [])
    } catch { /* ignore */ }
  }, [])

  function newChat() {
    setSessionId(undefined); setMessages([]); setProposal(null); setError(null); setInput(''); setHistoryOpen(false); setSaveOpen(false)
    ta.current?.focus()
  }

  async function deleteSession(id: string) {
    await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' })
    if (id === sessionId) newChat()
    await loadSessions()
  }

  useEffect(() => {
    fetch('/api/vault/notes').then(r => r.json()).then(d => setNotePaths((d.notes ?? []).map((n: { path: string }) => n.path))).catch(() => {})
  }, [])

  // Keep the newest message in view while answers stream in.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  // `sid` defaults to the open conversation; a hand-off from Home / ⌘K passes
  // undefined to start a new one.
  async function send(text?: string, sid: string | undefined = sessionId, m: ChatMode = mode) {
    const question = (text ?? input).trim()
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
        body: JSON.stringify({ question, mode: m, sessionId: sid }),
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
      if (!started && sid) void openSession(sid)
    } finally {
      setLoading(false)
      setStreaming(false)
    }
  }

  // A question handed over from Home / ⌘K (?q=) starts a fresh chat — on first
  // load and also when /chat is already open (the page stays mounted). Without
  // one, the first load reopens the most recent conversation.
  const booted = useRef(false)
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!handoff) { handled.current = null }
    else if (handoff !== handled.current) {
      // An answer is still streaming: wait for it (this effect re-runs when
      // `loading` drops) rather than clearing the view under it.
      if (loading) return
      handled.current = handoff
      booted.current = true
      router.replace('/chat')
      setSessionId(undefined); setMessages([]); setProposal(null); setError(null); setHistoryOpen(false); setSaveOpen(false)
      void loadSessions()
      setMode(handoffMode)
      void send(handoff, undefined, handoffMode)
      return
    }
    if (booted.current) return
    booted.current = true
    void (async () => {
      const list = await loadSessions()
      if (list.length) await openSession(list[0].id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff, loading])

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
      setSaveOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture conversation')
    } finally {
      setCapturing(false)
    }
  }

  const current = sessions.find(s => s.id === sessionId)

  return (
    <div className="page-fill flex gap-4 max-w-6xl mx-auto">
      {/* Conversation history: a rail on desktop, an overlay on phones. */}
      {historyOpen && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setHistoryOpen(false)} aria-hidden />}
      <aside
        className={`${historyOpen ? 'fixed inset-y-0 left-0 z-50 w-72 flex' : 'hidden'} md:static md:z-auto md:flex md:w-60 flex-shrink-0 flex-col md:rounded-2xl overflow-hidden border-r md:border`}
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2 p-2">
          <button onClick={newChat} className="btn btn-ghost flex-1 justify-start text-sm">
            <Plus size={15} /> New chat
          </button>
          <button onClick={() => setHistoryOpen(false)} className="md:hidden p-2" style={{ color: 'var(--text-muted)' }} aria-label="Close history"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
          {sessions.length === 0 && (
            <p className="text-xs px-2 py-3" style={{ color: 'var(--text-subtle)' }}>Your conversations will appear here.</p>
          )}
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => void openSession(s.id)}
              className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover-surface"
              style={s.id === sessionId ? { background: 'var(--primary-tint)' } : undefined}
            >
              <span className="flex-1 truncate text-sm" style={{ color: s.id === sessionId ? 'var(--primary)' : 'var(--text-muted)' }}>{s.title}</span>
              <button
                onClick={e => { e.stopPropagation(); void deleteSession(s.id) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-subtle)' }}
                title="Delete conversation"
                aria-label="Delete conversation"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] px-3 py-2 border-t" style={{ color: 'var(--text-subtle)', borderColor: 'var(--border-subtle)' }}>
          Kept for 7 days.
        </p>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2 px-3 md:px-5 h-12 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <button onClick={() => setHistoryOpen(true)} className="md:hidden p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Conversations"><History size={18} /></button>
          <p className="flex-1 min-w-0 truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{current?.title ?? `New conversation with ${companion.name}`}</p>
          {messages.length > 0 && (
            <>
              <button onClick={() => setSaveOpen(v => !v)} className="btn btn-ghost text-xs py-1.5 px-2.5" title="Turn this conversation into a note">
                <BookmarkPlus size={14} /> <span className="hidden sm:inline">Save as note</span>
              </button>
              <button onClick={newChat} className="md:hidden p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="New chat"><Plus size={18} /></button>
            </>
          )}
        </div>

        {saveOpen && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 md:px-5 py-3 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
            <p className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Keep the key points as a note. Tags (optional):</p>
            <div className="flex-1 min-w-0"><TagPicker value={captureTags} onChange={setCaptureTags} compact /></div>
            <button onClick={() => void includeInVault()} disabled={capturing} className="btn btn-primary text-xs py-1.5">
              {capturing ? <Loader2 size={13} className="animate-spin" /> : null} {capturing ? 'Preparing…' : 'Prepare note'}
            </button>
          </div>
        )}

        {proposal && (
          <div className="flex-shrink-0 p-4 overflow-y-auto border-b" style={{ borderColor: 'var(--border-subtle)', maxHeight: '50%' }}>
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>Here’s what would be saved — approve to write it</p>
            <ProposalReview result={proposal} onApplied={() => setProposal(null)} onDiscard={() => setProposal(null)} />
          </div>
        )}

        <div ref={scroller} className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
          <div className="max-w-3xl mx-auto flex flex-col gap-6">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center text-center gap-4 pt-[6vh]">
                <CompanionAvatar kind={companion.kind} size={88} title={companion.name} />
                <div className="max-w-md">
                  <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
                    {mode === 'spar' ? 'Try me. I’ll argue back.' : `Hi, I’m ${companion.name}.`}
                  </h1>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-subtle)' }}>
                    {mode === 'spar'
                      ? 'Tell me an idea, a plan or something you believe. I’ll weigh it against your own notes: what supports it, what cuts against it, and what you might be missing.'
                      : `I’m ${companion.def.creature.replace(/^an? /, 'the ')} who keeps your notes. Ask me anything you’ve written down, and I’ll show you where it came from.`}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl mt-2">
                  {STARTERS[mode].map(s => (
                    <button key={s} onClick={() => void send(s)} className="text-left text-sm px-4 py-3 rounded-xl border hover-surface" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} className="self-end max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md text-sm whitespace-pre-wrap break-words" style={{ background: 'var(--primary)', color: 'white' }}>
                {m.content}
              </div>
            ) : (
              <div key={i} className="flex gap-3 min-w-0">
                <CompanionAvatar kind={companion.kind} size={32} thinking={streaming && i === messages.length - 1} className="mt-0.5 hidden sm:inline-flex" />
                <div className="flex flex-col gap-3 min-w-0 flex-1">
                <p className="text-xs font-semibold -mb-1.5" style={{ color: 'var(--text-subtle)' }}>{companion.name}</p>
                <div className="markdown-body chat-answer">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => href?.startsWith('/')
                        ? <Link href={href}>{children}</Link>
                        : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                    }}
                  >
                    {linkWikilinks(splitAskBack(m.content).body, m.citations, notePaths)}
                  </ReactMarkdown>
                </div>

                {splitAskBack(m.content).asks.map(q => (
                  <button
                    key={q}
                    onClick={() => ta.current?.focus()}
                    className="ask-back text-left px-3.5 py-2.5 text-sm"
                    style={{ color: 'var(--text)' }}
                    title="Answer in the box below"
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--primary)' }}>{companion.name} asks</span>
                    {q}
                  </button>
                ))}

                {m.citations && m.citations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-subtle)' }}>Based on</p>
                    <div className="flex flex-wrap gap-1.5">
                      {m.citations.map(c => (
                        <Link
                          key={c.path}
                          href={noteHref(c.path)}
                          title={c.path}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs min-w-0 max-w-full border hover-surface"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                        >
                          <FileText size={12} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <span className="truncate">{titleOf(c.path)}</span>
                        </Link>
                      ))}
                    </div>
                    {/* Images embedded in the cited notes — the matched files themselves. */}
                    {m.citations.some(c => c.images?.length) && (
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(m.citations.flatMap(c => c.images ?? []))).map(img => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={img}
                            src={`/api/vault/asset?path=${encodeURIComponent(img)}`}
                            alt={img.split('/').pop()}
                            title={img}
                            onClick={() => router.push(noteHref(img))}
                            className="h-20 max-w-[160px] object-cover rounded-lg cursor-pointer border"
                            style={{ borderColor: 'var(--border)' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            ))}

            {loading && !streaming && (
              <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-subtle)' }}>
                <CompanionAvatar kind={companion.kind} size={32} thinking />
                {mode === 'spar' ? `${companion.name} is looking for counter-arguments in your notes…` : `${companion.name} is reading your notes…`}
              </div>
            )}
            {error && <p className="text-sm rounded-xl px-4 py-3" style={{ color: 'var(--danger)', background: 'var(--bg-elevated)' }}>{error}</p>}
          </div>
        </div>

        <div className="flex-shrink-0 p-3 md:px-8 md:pb-5">
          <div className="max-w-3xl mx-auto flex items-center gap-1 mb-2" role="tablist" aria-label="How should I respond?">
            {([['ask', 'Ask', 'Answers from your notes'], ['spar', 'Spar', 'Pushback from your notes']] as const).map(([k, label, hint]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} title={hint}
                className="text-xs font-medium px-3 py-1 rounded-full border transition-colors"
                style={mode === k
                  ? { background: 'var(--primary-tint)', borderColor: 'var(--primary)', color: 'var(--primary)' }
                  : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                {label}
              </button>
            ))}
            <span className="text-[11px] ml-2 hidden sm:inline" style={{ color: 'var(--text-subtle)' }}>
              {mode === 'spar' ? `${companion.name} will challenge what you say` : `${companion.name} answers from your notes`}
            </span>
          </div>
          <div className="max-w-3xl mx-auto card composer flex items-end gap-2 p-2">
            <textarea
              ref={ta}
              value={input}
              rows={1}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
              }}
              placeholder={mode === 'spar' ? 'Tell me an idea, plan or belief…' : messages.length ? 'Reply, or ask a follow-up…' : `Ask ${companion.name} about your notes…`}
              className="flex-1 resize-none bg-transparent outline-none px-2 py-1.5 text-[15px]"
              style={{ color: 'var(--text)' }}
              aria-label="Your question"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="btn btn-primary w-9 h-9 p-0 rounded-xl flex-shrink-0"
              aria-label="Send"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
