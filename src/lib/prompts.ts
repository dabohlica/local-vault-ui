import fs from 'fs'
import path from 'path'
import { getVaultPath } from '@/lib/vault'
import type { RetrievedChunk } from '@/lib/embeddings'
import type { LocalCommand } from '@/lib/commands'
import { CONTRACT_INSTRUCTIONS } from '@/lib/commands'
import { STRUCTURED_OUTPUT_SPEC, STRUCTURED_OUTPUT_SPEC_SINGLE } from '@/lib/structuredOutput'

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
    .map((c, i) => {
      const links = c.links?.length ? `\nLinked notes: ${c.links.map(l => `[[${l}]]`).join(', ')}` : ''
      return `### Source ${i + 1}: [[${c.notePath.replace(/\.md$/, '')}]] — ${c.heading}${links}\n\n${c.content}`
    })
    .join('\n\n---\n\n')
}

export type PriorMessage = { role: 'user' | 'assistant'; content: string }

export function buildRagPrompt(question: string, chunks: RetrievedChunk[], history: PriorMessage[] = []) {
  const system = `You are a local assistant answering questions about Daniel's personal Obsidian vault.
This is a multi-turn conversation — use the earlier messages for context (e.g. resolve "he", "that
project", "the one you mentioned" against what was already discussed).

Answer using the information in the provided source excerpts below and the conversation so far. If the
sources don't contain the answer, say so plainly — do not make things up. When you reference information
from a source, cite it inline using its wikilink, e.g. [[Projects/Example Project]].

--- VAULT SOURCES ---

${formatChunks(chunks)}`

  // Keep the last few turns for context without blowing the small model's window.
  const recent = history.slice(-6)

  return [
    { role: 'system' as const, content: system },
    ...recent.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: question },
  ]
}

function tagBlock(tags?: string[]): string {
  const clean = (tags ?? []).map(t => t.replace(/^#+/, '').trim()).filter(Boolean)
  if (clean.length === 0) return ''
  return `

--- TAGS TO APPLY ---
Add these tags to the frontmatter \`tags:\` array of EVERY note you create or update (merge with any
existing tags, no duplicates): ${clean.map(t => `#${t}`).join(', ')}.`
}

export function buildCurationPrompt(userText: string, chunks: RetrievedChunk[], history: PriorMessage[] = [], tags?: string[]) {
  const claudeMd = loadClaudeMd()

  const system = `You are a local curation assistant for Daniel's Obsidian vault. The vault follows strict
"AI-first" conventions described below — every note you write or update MUST follow them.

--- VAULT CONVENTIONS (_CLAUDE.md) ---
${claudeMd}

--- RELEVANT EXISTING NOTES ---
${formatChunks(chunks)}

--- TASK ---
The user will give you raw notes — a meeting, a fact about a person, a project update, a task, an idea,
anything. Decide for yourself which vault file(s) need to be created or updated to capture it, and create
ALL of them (often more than one). Route by content, e.g.:
- a person → a person note at People/<Name>.md
- a project/client update → the project or client page (Projects/… or Clients/…)
- something that happened → today's daily note at Daily/YYYY-MM-DD.md
- a meeting → a meeting note plus updates to the related project and any people mentioned
- a task → a "- [ ]" item on the relevant board or daily note
- a reusable fact/idea → Knowledge/<Topic>.md
Capturing one input across several linked notes is expected and encouraged. For each file:
- If updating, return the FULL new file content (not a diff). PRESERVE the existing content that still
  holds and integrate your changes into it — add new facts, correct only what's contradicted, and never
  drop unrelated sections. You are extending existing knowledge, not replacing it.
- Follow the AI-first rules: rich frontmatter, a "For future Claude" preamble, [[wikilinks]] to related
  people/projects, recency markers and confidence levels where relevant.
- Use today's date where needed: ${new Date().toISOString().slice(0, 10)}.

As the vault's caretaker you may also reorganize it, not only write notes. Besides
"create"/"update", you can emit "move" (rename/relocate a note; optionally include "content" to also
rewrite it) and "delete" (remove a clear duplicate or obsolete note). To move INFORMATION from note A
to note B, update B with the merged content and update (or delete) A. Every change is reviewed as a
diff before anything is written, so propose reorganizations freely.

${STRUCTURED_OUTPUT_SPEC}${tagBlock(tags)}`

  // Recent conversation so requests like "save what we just discussed" or "add that
  // to his note" resolve against the chat.
  const recent = history.slice(-6)

  return [
    { role: 'system' as const, content: system },
    ...recent.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userText },
  ]
}

export type NightlyNote = { path: string; content: string; truncated: boolean }

// Prompt for the unattended nightly curation pass. Deliberately NOT
// buildCurationPrompt: that one captures NEW input into the vault and asks for
// full-file rewrites, which is destructive when the model works from partial
// context overnight. Here the model gets the FULL current content of the
// recently-changed notes (the authoritative text) plus a map of every note path,
// and its job is strictly additive: connect notes, file strays, synthesize NEW
// linking notes — never rewrite existing prose. auditNightlyChanges() enforces
// the same rules deterministically after the fact.
export function buildNightlyCurationPrompt(notes: NightlyNote[], allPaths: string[]) {
  const claudeMd = loadClaudeMd()
  const today = new Date().toISOString().slice(0, 10)

  const notesBlock = notes
    .map(n =>
      `### Note: ${n.path}${n.truncated ? ' [TRUNCATED — read-only: do NOT update or delete this note]' : ''}\n\n${n.content}`
    )
    .join('\n\n---\n\n')

  const system = `You are the night gardener of Daniel's Obsidian vault, running unattended overnight. The
vault follows strict "AI-first" conventions described below.

--- VAULT CONVENTIONS (_CLAUDE.md) ---
${claudeMd}

--- ALL NOTE PATHS IN THE VAULT (link and move targets) ---
${allPaths.join('\n')}

--- RECENTLY CHANGED NOTES (FULL CURRENT CONTENT — this text is authoritative) ---
${notesBlock}

--- TASK ---
Your job is strictly ADDITIVE: connect the dots between notes, file strays, and synthesize new linking
notes. The user's own words are the value of this vault — you must NEVER lose, rewrite, summarize,
condense, or "clean up" a single line of an existing note.

Allowed operations, in order of preference:
1. "update" — ONLY to add [[wikilinks]] around existing phrases, append a "## Related" section, or
   append genuinely new lines at the end of a section. The updated content MUST contain every existing
   line of the current note, unchanged and in order. You are annotating, not rewriting.
2. "move" — file a stray note into the right folder. Do NOT include a @@@CONTENT block: the note is
   relocated with its content untouched.
3. "create" — a NEW Knowledge/ note that synthesizes a clearly-emerging theme by LINKING to its source
   notes with [[wikilinks]]. The source notes stay untouched. Follow the AI-first rules: frontmatter,
   a "## For future Claude" preamble, date ${today}.
4. "delete" — ONLY for a note whose entire content is already present verbatim in another note shown in
   full above. When in doubt, don't.

Forbidden, no exceptions:
- Rewriting, summarizing, condensing, normalizing, or restructuring existing prose.
- Updating or deleting any note NOT shown in full above (including [TRUNCATED] ones).
- Merging notes by replacing one's content with a summary of both.

Proposing NOTHING is a good outcome. Only propose changes you are certain about.

${STRUCTURED_OUTPUT_SPEC}`

  return [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content:
        'Review the recently changed notes above and propose only certain, additive changes — ' +
        'wikilinks, filing, a synthesis note if a theme clearly emerges. If nothing is clearly ' +
        'worth doing, propose nothing.',
    },
  ]
}

export function buildIngestPrompt(
  filename: string,
  sourceText: string,
  chunks: RetrievedChunk[],
  assetPath?: string,
  userNotes?: string,
  tags?: string[],
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

${STRUCTURED_OUTPUT_SPEC_SINGLE}${tagBlock(tags)}`

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
