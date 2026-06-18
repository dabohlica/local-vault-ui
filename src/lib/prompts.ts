import fs from 'fs'
import path from 'path'
import { getVaultPath } from '@/lib/vault'
import type { RetrievedChunk } from '@/lib/embeddings'
import type { LocalCommand } from '@/lib/commands'
import { CONTRACT_INSTRUCTIONS } from '@/lib/commands'

// _CLAUDE.md encodes the vault's "AI-first" conventions. Read fresh each call —
// it's tiny, and this keeps the prompt correct when the user switches vaults.
// Not every vault has one; missing is fine (returns '').
function loadClaudeMd(): string {
  try {
    return fs.readFileSync(path.join(getVaultPath(), '_CLAUDE.md'), 'utf-8')
  } catch {
    return ''
  }
}

function formatChunks(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => `### Source ${i + 1}: [[${c.notePath.replace(/\.md$/, '')}]] — ${c.heading}\n\n${c.content}`)
    .join('\n\n---\n\n')
}

export function buildRagPrompt(question: string, chunks: RetrievedChunk[]) {
  const system = `You are a local assistant answering questions about Daniel's personal Obsidian vault.
Answer ONLY using the information in the provided source excerpts below. If the sources don't contain
the answer, say you don't know — do not make things up.

When you reference information from a source, cite it inline using its wikilink, e.g. [[Projects/FreeRange]].

--- VAULT SOURCES ---

${formatChunks(chunks)}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: question },
  ]
}

export function buildCurationPrompt(userText: string, chunks: RetrievedChunk[]) {
  const claudeMd = loadClaudeMd()

  const system = `You are a local curation assistant for Daniel's Obsidian vault. The vault follows strict
"AI-first" conventions described below — every note you write or update MUST follow them.

--- VAULT CONVENTIONS (_CLAUDE.md) ---
${claudeMd}

--- RELEVANT EXISTING NOTES ---
${formatChunks(chunks)}

--- TASK ---
The user will give you raw notes (e.g. a meeting summary). Decide which vault file(s) need to be created
or updated to capture this information (e.g. a project page, a daily note at Daily/YYYY-MM-DD.md, a task
list, a decision log, a person note). For each file:
- If updating, return the FULL new file content (not a diff).
- Follow the AI-first rules: rich frontmatter, a "For future Claude" preamble, [[wikilinks]] to related
  people/projects, recency markers and confidence levels where relevant.
- Use today's date where needed: ${new Date().toISOString().slice(0, 10)}.

As the vault's caretaker you may also reorganize it, not only write notes. Besides
"create"/"update", you can emit "move" (rename/relocate a note; optionally include "content" to also
rewrite it) and "delete" (remove a clear duplicate or obsolete note). To move INFORMATION from note A
to note B, update B with the merged content and update (or delete) A. Every change is reviewed as a
diff before anything is written, so propose reorganizations freely.

Respond with ONLY valid JSON in this exact shape, no other text:
{
  "changes": [
    { "path": "Projects/Example.md", "action": "update", "content": "...full file content..." },
    { "action": "move", "from": "Inbox/Stray.md", "to": "Projects/Stray.md" },
    { "action": "delete", "path": "Projects/Duplicate.md" }
  ],
  "log_entry": "one paragraph describing what was curated and why, for the operations log",
  "summary": "one sentence summary for the UI"
}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userText },
  ]
}

export function buildIngestPrompt(
  filename: string,
  sourceText: string,
  chunks: RetrievedChunk[],
  assetPath?: string,
  userNotes?: string,
) {
  const claudeMd = loadClaudeMd()
  const today = new Date().toISOString().slice(0, 10)
  const notes = userNotes?.trim()
  const embedLine = assetPath
    ? `\n4. Embed the saved image at the top of the body with: ![[${assetPath}]]`
    : ''

  // The user's own notes are authoritative and must be surfaced prominently — not
  // buried under the OCR'd / extracted source text.
  const notesBlock = notes
    ? `

--- USER'S NOTES ABOUT THIS FILE (HIGHEST PRIORITY) ---
The user attached these notes when dropping the file. Treat them as AUTHORITATIVE: they MUST be
reflected prominently and near the top of the note — fold them into the "## For future Claude" summary,
and where the user's notes conflict with or add to the source text, the user's notes win. Do not drop or
water them down.
${notes}`
    : ''

  const notesPriorityLine = notes
    ? `\n2b. Reflect the USER'S NOTES (above) prominently in the "## For future Claude" summary — they take precedence over the extracted source.`
    : ''

  const system = `You are a local ingest assistant for an Obsidian vault. The vault follows strict
"AI-first" conventions described below — the note you create MUST follow them.

--- VAULT CONVENTIONS (_CLAUDE.md) ---
${claudeMd}

--- RELATED EXISTING NOTES (retrieved from the vault) ---
${chunks.length ? formatChunks(chunks) : '(none retrieved)'}${notesBlock}

--- TASK ---
The user dropped a source ${assetPath ? 'image' : 'document'} named "${filename}". Turn it into ONE
well-structured vault note that captures its key content so future-Claude can reason over it. Decide an
appropriate folder and filename (e.g. Knowledge/<Topic>.md, Learning/<Title>.md, or Research/<Title>.md).
The note MUST contain, in order:
1. YAML frontmatter as the very first thing (real "---" fences, not a code block): date (${today}), type,
   tags, source: "${filename}", confidence.
2. A "## For future Claude" section: 2-3 sentences summarizing what this is and why it matters.${notesPriorityLine}
3. A structured summary of the source's key points, with [[wikilinks]] to any related people/projects/topics
   that appear in the related notes above.${embedLine}
Summarize and structure — do not copy the whole document verbatim. Base it on the provided source text${notes ? " and, above all, the user's notes" : ''}.

Respond with ONLY valid JSON in this exact shape, no other text, no markdown fences:
{
  "changes": [ { "path": "Knowledge/Example.md", "action": "create", "content": "...full note content..." } ],
  "log_entry": "one short paragraph describing what was ingested and why, for the operations log",
  "summary": "one sentence summary for the UI"
}`

  const userContent = notes
    ? `Source document "${filename}":\n\n${sourceText}\n\n--- MY NOTES (HIGH PRIORITY — make sure these land in the summary) ---\n${notes}`
    : `Source document "${filename}":\n\n${sourceText}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userContent },
  ]
}

export function buildCommandPrompt(command: LocalCommand, userInput: string, chunks: RetrievedChunk[]) {
  const claudeMd = loadClaudeMd()
  const today = new Date().toISOString().slice(0, 10)
  const instructions = command.instructions.replace(/\{\{TODAY\}\}/g, today)

  const system = `You are a local curation assistant for Daniel's Obsidian vault, running the "${command.title}"
command. The vault follows strict "AI-first" conventions described below — every note you write or update
MUST follow them.

--- VAULT CONVENTIONS (_CLAUDE.md) ---
${claudeMd}

--- RELEVANT EXISTING NOTES (retrieved from the vault) ---
${chunks.length ? formatChunks(chunks) : '(none retrieved)'}

--- COMMAND: ${command.title} ---
${instructions}

Today's date is ${today}.
${CONTRACT_INSTRUCTIONS}`

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userInput },
  ]
}
