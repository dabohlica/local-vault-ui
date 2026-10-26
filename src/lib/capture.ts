import fs from 'fs'
import path from 'path'
import { resolveVaultPath } from '@/lib/vault'
import { recordOperation } from '@/lib/opsLog'

// "Jot down": append a thought to today's daily note, instantly and without a
// model. Append-only on the server (never a client read-modify-write), so it
// can't clobber an edit made in Obsidian a second earlier.

export function dailyNotePath(date: string): string {
  return `Daily/${date}.md`
}

// The text to append (or the whole new note when there is none). Pure, for testing.
export function captureBlock(existing: string | null, text: string, date: string, time: string): string {
  const entry = `## ${time} — Jotted down\n\n${text.trim()}\n`
  if (existing === null) return `---\ndate: ${date}\ntype: daily\ntags: []\n---\n\n# ${date}\n\n${entry}`
  const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return `${sep}${entry}`
}

export function jotDown(text: string, now = new Date()): string {
  const date = now.toLocaleDateString('en-CA')
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const rel = dailyNotePath(date)
  const abs = resolveVaultPath(rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  let existing: string | null = null
  try { existing = fs.readFileSync(abs, 'utf-8') } catch { /* new daily note */ }
  if (existing === null) fs.writeFileSync(abs, captureBlock(null, text, date, time), { encoding: 'utf-8', flag: 'wx' })
  else fs.appendFileSync(abs, captureBlock(existing, text, date, time), 'utf-8')
  recordOperation({
    origin: 'capture',
    summary: `Jotted down: ${text.trim().split('\n')[0].slice(0, 80)}`,
    changes: [{ action: existing === null ? 'create' : 'update', path: rel }],
  })
  return rel
}
