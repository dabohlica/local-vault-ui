import { ollamaChat } from '@/lib/ollama'
import { parseModelJson } from '@/lib/modelJson'
import { getChunk } from '@/lib/embeddings'
import { readable } from '@/lib/find'
import { fileHash, readNote } from '@/lib/vault'
import { savePending } from '@/lib/pending'
import type { InboxItem } from '@/lib/inbox'

// Contradiction check for items kept from the inbox: does the new paper/article
// claim something that disagrees with what the closest notes say? Runs in the
// background after a keep (one at a time — the local model is a single queue).
// A finding never edits anything directly: it becomes a suggestion in
// Inbox → Suggestions that appends a "Possible conflicts" section to the NEW
// note only, so the user decides and existing notes stay untouched.

export type Conflict = { note: string; existing: string; incoming: string; why: string }

const MAX_CONFLICTS = 3

// Validate the model's JSON: only notes we actually showed it, short non-empty
// claims, no duplicates. Pure, for testing.
export function parseConflicts(raw: string, shownNotes: string[]): Conflict[] {
  const data = parseModelJson<{ conflicts?: unknown }>(raw)
  const list = Array.isArray(data?.conflicts) ? data!.conflicts as unknown[] : []
  const byKey = new Map(shownNotes.map(p => [p.replace(/\.md$/, '').toLowerCase(), p]))
  const out: Conflict[] = []
  const seen = new Set<string>()
  for (const c of list) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).replace(/\s+/g, ' ').trim() : '')
    // Models write [[X]], [X], X or X.md — accept any, plus the bare note name.
    const noteKey = str('note').replace(/^\[+|\]+$/g, '').trim().replace(/\.md$/, '').toLowerCase()
    const note = byKey.get(noteKey)
      ?? shownNotes.find(p => (p.split('/').pop() ?? '').replace(/\.md$/, '').toLowerCase() === noteKey)
    const existing = str('existing').slice(0, 300)
    const incoming = str('incoming').slice(0, 300)
    const why = str('why').slice(0, 300)
    if (!note || !existing || !incoming) continue
    const k = `${note}\u0000${existing.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ note, existing, incoming, why })
    if (out.length >= MAX_CONFLICTS) break
  }
  return out
}

export function conflictSection(conflicts: Conflict[], today: string): string {
  const lines = [`## Possible conflicts (checked ${today})`, '']
  for (const c of conflicts) {
    lines.push(`- **[[${c.note.replace(/\.md$/, '')}]]** says: ${c.existing}`)
    lines.push(`  - This source says: ${c.incoming}`)
    if (c.why) lines.push(`  - ${c.why}`)
  }
  lines.push('', '_Flagged automatically by comparing claims — check before relying on either._', '')
  return lines.join('\n')
}

async function findConflicts(item: InboxItem): Promise<Conflict[]> {
  const shown: string[] = []
  const notes = item.related
    .map(r => {
      const c = getChunk(r.chunkId)
      if (!c) return null
      shown.push(r.path)
      return `[[${r.path.replace(/\.md$/, '')}]]:\n${readable(c.content).slice(0, 1200)}`
    })
    .filter(Boolean)
  if (!notes.length) return []
  const raw = await ollamaChat({
    role: 'librarian',
    messages: [
      {
        role: 'system',
        content: 'You compare a new source against a person\'s notes and report only clear factual contradictions. ' +
          'Different topics, extra detail, or different emphasis are NOT contradictions. When unsure, report nothing. ' +
          'Answer with JSON only.',
      },
      {
        role: 'user',
        content:
          `My notes:\n\n${notes.join('\n\n')}\n\n` +
          `New source "${item.title}" (${item.sourceName}):\n${item.summary.slice(0, 2000)}\n\n` +
          'Does the new source directly contradict a specific claim in one of my notes? Reply with JSON:\n' +
          '{"conflicts":[{"note":"<note name exactly as in [[...]] above>","existing":"<the claim in my note>",' +
          '"incoming":"<the conflicting claim in the new source>","why":"<one short sentence>"}]}\n' +
          'Use {"conflicts":[]} if there is no clear contradiction.',
      },
    ],
  })
  return parseConflicts(raw, shown)
}

// Queue a suggestion when conflicts are found. Returns how many were found.
export async function checkAcceptedItem(item: InboxItem, notePath: string, noteHash: string): Promise<number> {
  const conflicts = await findConflicts(item)
  if (!conflicts.length) return 0
  const current = readNote(notePath)
  // The user may have edited or un-kept it meanwhile — then don't propose.
  if (current === null || fileHash(notePath) !== noteHash) return 0
  const today = new Date().toLocaleDateString('en-CA')
  const content = current.replace(/\s*$/, '\n\n') + conflictSection(conflicts, today)
  const names = Array.from(new Set(conflicts.map(c => c.note.replace(/\.md$/, '').split('/').pop())))
  savePending({
    origin: 'inbox-conflict',
    summary: `Possible conflict: “${item.title}” vs ${names.map(n => `[[${n}]]`).join(', ')}`,
    log_entry: `Flagged ${conflicts.length} possible conflict(s) between ${notePath} and ${names.join(', ')}`,
    changes: [{ action: 'update', path: notePath, content, baseHash: noteHash }],
  })
  return conflicts.length
}

// One check at a time: rapid swiping queues them instead of flooding the model.
let chain: Promise<unknown> = Promise.resolve()
export function queueConflictCheck(item: InboxItem, notePath: string, noteHash: string): void {
  chain = chain
    .then(() => checkAcceptedItem(item, notePath, noteHash))
    .catch(() => { /* model down — no suggestion this time */ })
}
