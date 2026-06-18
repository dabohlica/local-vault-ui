import fs from 'fs'
import path from 'path'

// Lightweight, local chat history organized into SESSIONS (separate conversations).
// Stored in data/chat-sessions.json (gitignored, per-machine). Still deliberately
// small: whole sessions are pruned after a week of inactivity, the number of
// sessions is capped, and messages per session are capped — so it never grows
// unbounded. Each session keeps its own thread, so multi-turn context never bleeds
// across unrelated conversations.

const FILE = path.join(process.cwd(), 'data', 'chat-sessions.json')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // prune sessions idle for a week
const MAX_SESSIONS = 50
const MAX_MESSAGES_PER_SESSION = 200

export type Citation = { path: string; heading: string }
export type ChatMessage = { role: 'user' | 'assistant'; content: string; citations?: Citation[]; ts: number }
export type ChatSession = { id: string; title: string; createdAt: number; updatedAt: number; messages: ChatMessage[] }

function read(): ChatSession[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as ChatSession[] } catch { return [] }
}

function write(sessions: ChatSession[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(sessions, null, 2), 'utf-8')
}

function prune(sessions: ChatSession[]): ChatSession[] {
  const cutoff = Date.now() - MAX_AGE_MS
  return sessions
    .filter(s => s.updatedAt >= cutoff && s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map(s => s.messages.length > MAX_MESSAGES_PER_SESSION
      ? { ...s, messages: s.messages.slice(s.messages.length - MAX_MESSAGES_PER_SESSION) }
      : s)
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 48 ? t.slice(0, 48).replace(/\s+\S*$/, '') + '…' : t || 'New chat'
}

// Lightweight listing for the sidebar (no message bodies).
export function listSessions(): Array<{ id: string; title: string; updatedAt: number; messageCount: number }> {
  const sessions = prune(read())
  write(sessions)
  return sessions.map(s => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.length }))
}

export function getSession(id: string): ChatSession | null {
  return read().find(s => s.id === id) ?? null
}

// Append an exchange to a session, creating it (titled from the first user message)
// if `id` is missing/unknown. Returns the session id so the client can track it.
export function appendToSession(id: string | undefined, msgs: Array<Omit<ChatMessage, 'ts'>>): string {
  const sessions = read()
  let session = id ? sessions.find(s => s.id === id) : undefined

  if (!session) {
    const firstUser = msgs.find(m => m.role === 'user')
    session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: titleFrom(firstUser?.content ?? 'New chat'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    sessions.push(session)
  }

  const now = Date.now()
  for (const m of msgs) session.messages.push({ ...m, ts: now })
  session.updatedAt = now

  write(prune(sessions))
  return session.id
}

export function deleteSession(id: string): void {
  write(read().filter(s => s.id !== id))
}

export function clearAllSessions(): void {
  try { fs.rmSync(FILE) } catch { /* already gone */ }
}
