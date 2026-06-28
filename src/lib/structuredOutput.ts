// Structured output WITHOUT asking the model to produce valid JSON. Small local
// models are unreliable at JSON punctuation — a single missing quote/brace in a
// long note body fails the whole parse ("Model did not return valid JSON"). The
// hard part is never the *content* (the model writes good notes); it's the
// escaping. So we move the punctuation into code: the model emits each "part" of
// the proposal between plain @@@ markers, and parseStructuredOutput() assembles
// the JSON contract { changes, log_entry, summary } from those parts. Note content
// is copied verbatim between markers — it can contain quotes, braces, newlines,
// YAML, anything, with zero escaping.

import { parseModelJson } from '@/lib/modelJson'

export type ProposalChange = {
  path?: string
  action: 'create' | 'update' | 'move' | 'delete'
  content?: string
  from?: string
  to?: string
}

export type ProposalResult = {
  changes: ProposalChange[]
  log_entry: string
  summary: string
}

// The block-format spec injected into prompts. Full version: supports multiple
// changes plus move/delete (curation, commands, caretake).
export const STRUCTURED_OUTPUT_SPEC = `Respond in this PLAIN-TEXT block format — NOT JSON. Do not worry about quotes, commas, or brackets:
just write each part on its own, between the @@@ markers. Use the markers EXACTLY as shown, each on its
own line:

@@@SUMMARY
one sentence summary for the UI
@@@LOG
one short paragraph describing what was done and why, for the operations log
@@@CHANGE
action: create
path: Folder/Note.md
@@@CONTENT
...the FULL file content, exactly as it should be saved — any characters, multiple lines, markdown,
YAML frontmatter between --- fences, all fine, no escaping needed...
@@@CHANGE
action: move
from: Inbox/Stray.md
to: Projects/Stray.md
@@@CHANGE
action: delete
path: Projects/Duplicate.md
@@@END

Rules:
- Every marker line (@@@SUMMARY, @@@CHANGE, …) is on its OWN line with nothing else on it.
- Put "action:", "path:", "from:", "to:" each on their OWN separate line.
- For "create"/"update": include an "action:" line, a "path:" line, then a @@@CONTENT block with the FULL file content.
- For "move": include "action:", "from:" and "to:" lines (a @@@CONTENT block is optional, to also rewrite it).
- For "delete": include "action:" and "path:" lines.
- You may emit several @@@CHANGE blocks. Put @@@END after the last one.
- Never write "@@@" anywhere inside file content.`

// Single-note version for ingest (always exactly one "create").
export const STRUCTURED_OUTPUT_SPEC_SINGLE = `Respond in this PLAIN-TEXT block format — NOT JSON. Do not worry about quotes, commas, or brackets.
Use the markers EXACTLY as shown, each on its own line:

@@@SUMMARY
one sentence summary for the UI
@@@LOG
one short paragraph describing what was ingested and why, for the operations log
@@@CHANGE
action: create
path: Knowledge/Example.md
@@@CONTENT
...the FULL note content, exactly as it should be saved — markdown with YAML frontmatter between ---
fences, any characters, multiple lines, no escaping needed...
@@@END

Rules:
- Every marker line is on its OWN line with nothing else on it.
- Put "action:" and "path:" each on their OWN separate line.
- Emit exactly ONE @@@CHANGE with "action: create", a "path:" line, and a @@@CONTENT block.
- Never write "@@@" anywhere inside the note content.`

// A marker line: "@@@CHANGE", tolerating leading markdown decoration (#, *, -, >,
// backticks), whitespace, and a trailing colon. Small models love to dress markers up.
const SENTINEL = /^[\s>*#`_-]*@@@\s*(SUMMARY|LOG|CHANGE|CONTENT|END)\b[:\s]*$/i
// Header keys inside a @@@CHANGE block. Used both to find them and to split a line
// that crams several onto one (e.g. "action: create path: People/Test.md").
const HEADER_KEYS = /\b(action|path|from|to)\s*:/gi

// Pull every "key: value" pair out of one header line. Values run until the next
// known key or end of line, so file paths with spaces survive ("People/John Doe.md").
function parseHeaderLine(line: string, cur: ProposalChange): boolean {
  HEADER_KEYS.lastIndex = 0
  const hits: { key: string; valStart: number; keyStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = HEADER_KEYS.exec(line))) {
    hits.push({ key: m[1].toLowerCase(), keyStart: m.index, valStart: m.index + m[0].length })
  }
  if (hits.length === 0) return false
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].keyStart : line.length
    const val = line.slice(hits[i].valStart, end).trim()
    switch (hits[i].key) {
      case 'action': cur.action = val.toLowerCase() as ProposalChange['action']; break
      case 'path': cur.path = val; break
      case 'from': cur.from = val; break
      case 'to': cur.to = val; break
    }
  }
  return true
}

const VALID_ACTIONS = new Set(['create', 'update', 'move', 'delete'])

// Parse the @@@ block format into the proposal contract. Falls back to JSON
// parsing when no @@@ markers are present, so a model that still emits JSON (or an
// older prompt) keeps working. Returns null only when nothing usable was found.
export function parseStructuredOutput<T = ProposalResult>(raw: string): T | null {
  if (!raw) return null
  // Reasoning models sometimes inline their scratchpad as <think>…</think> before
  // the answer — strip it so markers inside it can't confuse the parse.
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const lines = cleaned.split(/\r?\n/)
  if (!lines.some(l => SENTINEL.test(l))) {
    return parseModelJson<T>(cleaned)
  }

  const result: ProposalResult = { changes: [], log_entry: '', summary: '' }
  let section: 'summary' | 'log' | 'content' | 'header' | null = null
  let buf: string[] = []
  let cur: ProposalChange | null = null

  const flush = () => {
    if (section === 'summary') result.summary = buf.join('\n').trim()
    else if (section === 'log') result.log_entry = buf.join('\n').trim()
    // Content: preserve internal formatting; only strip leading blank lines and
    // trailing whitespace so frontmatter "---" stays the very first line.
    else if (section === 'content' && cur) cur.content = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')
    buf = []
  }
  const pushChange = () => {
    // Keep a change only if it carries something actionable. Normalize a bogus
    // action (e.g. the model glued extra text onto it) to a sensible default.
    if (cur) {
      if (!VALID_ACTIONS.has(cur.action)) {
        cur.action = cur.from && cur.to ? 'move' : 'create'
      }
      if (cur.path || (cur.from && cur.to) || cur.content) result.changes.push(cur)
    }
    cur = null
  }

  for (const line of lines) {
    const m = SENTINEL.exec(line)
    if (m) {
      flush()
      switch (m[1].toUpperCase()) {
        case 'SUMMARY': section = 'summary'; break
        case 'LOG': section = 'log'; break
        case 'CHANGE': pushChange(); cur = { action: 'create' }; section = 'header'; break
        case 'CONTENT': section = 'content'; break
        case 'END': pushChange(); section = null; break
      }
      continue
    }
    if (section === 'header' && cur) {
      if (parseHeaderLine(line, cur)) continue
      // A non-blank, non-header line inside a CHANGE block means the model skipped
      // the @@@CONTENT marker and started writing the note — treat it as content.
      if (line.trim()) { section = 'content'; buf.push(line) }
    } else if (section === 'content' || section === 'summary' || section === 'log') {
      buf.push(line)
    }
  }
  flush()
  pushChange()

  if (result.changes.length === 0 && !result.summary && !result.log_entry) return null
  return result as unknown as T
}
