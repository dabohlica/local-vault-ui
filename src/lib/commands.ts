// Registry of LOCAL vault commands. Every command here runs entirely through
// local Ollama (via /api/commands/local) and produces the same change-proposal
// contract as the curation flow ({ changes, log_entry, summary }), which the user
// reviews as diffs before anything is written. No command in this app touches a
// cloud API — vault data never leaves the device.

export type CommandMode = 'local-model' | 'local-deterministic'

export type LocalCommand = {
  id: string
  title: string
  desc: string
  icon: string
  mode: CommandMode
  inputLabel: string
  inputPlaceholder: string
  // How many vault chunks to retrieve as context (0 = none)
  retrieveK: number
  // Command-specific instructions appended to the shared AI-first system prompt.
  // The model must always respond with the change-proposal JSON contract.
  instructions: string
}

export const CONTRACT_INSTRUCTIONS = `
Respond with ONLY valid JSON in this exact shape, no other text, no markdown fences:
{
  "changes": [
    { "path": "Folder/Note.md", "action": "create" | "update", "content": "...FULL file content..." }
  ],
  "log_entry": "one short paragraph describing what was done and why, for the operations log",
  "summary": "one sentence summary for the UI"
}
When updating an existing file, return its FULL new content, not a diff.
Follow the vault's AI-first rules. Each note's "content" MUST be structured in this exact order:
1. YAML frontmatter as the very FIRST thing — real YAML between "---" fences (NOT inside a markdown code block),
   e.g. starting literally with a line of "---". Include fields like date, type, tags, related-people,
   related-projects, confidence.
2. A "## For future Claude" section: 2-3 plain-English sentences summarizing the note.
3. The note body, using [[wikilinks]] for any person/project/client referenced, with recency markers and
   confidence levels where relevant.
Only state facts present in the user's input or the retrieved context — do NOT invent emails, names, or details.`

export const LOCAL_COMMANDS: LocalCommand[] = [
  {
    id: 'daily',
    title: 'Daily Note',
    desc: "Draft or update today's daily note",
    icon: 'Calendar',
    mode: 'local-model',
    inputLabel: "What happened today? (notes, events, anything)",
    inputPlaceholder: 'e.g. Shipped the vault UI, call with VD client at 3pm, idea about offline maps…',
    retrieveK: 4,
    instructions: `Create or update today's daily note at Daily/{{TODAY}}.md. Organize the user's raw input
into clear sections (e.g. Done, Notes, Decisions, Follow-ups). If a daily note for today already exists
in the provided context, merge new content into it rather than replacing existing entries. Link any
mentioned people, projects, or clients with [[wikilinks]].`,
  },
  {
    id: 'meeting',
    title: 'Meeting Note',
    desc: 'Log a meeting and propagate to related notes',
    icon: 'Users',
    mode: 'local-model',
    inputLabel: 'Meeting notes / summary',
    inputPlaceholder: 'e.g. Kickoff with VD Energieeffizienz — agreed on audit scope, next milestone…',
    retrieveK: 8,
    instructions: `Capture this meeting. Typically produce MULTIPLE file changes: (1) a meeting note (under the
relevant project or a Meetings/ area), (2) an update to today's daily note Daily/{{TODAY}}.md referencing
it, (3) updates to the related project/client note (decisions, next steps), and (4) person notes for any
new people mentioned. Only include files that genuinely need changing.`,
  },
  {
    id: 'person',
    title: 'Person Note',
    desc: 'Create or update a note about a person',
    icon: 'User',
    mode: 'local-model',
    inputLabel: 'Who, and what do you know about them?',
    inputPlaceholder: 'e.g. Max Müller — CTO at VD Energieeffizienz, met at kickoff, owns the audit tooling…',
    retrieveK: 4,
    instructions: `Create or update a person note under People/. Use the person's name as the filename
(People/<Name>.md). Capture role, affiliation, how/when met, and relationship to projects/clients via
[[wikilinks]]. If a note for this person already exists in context, merge new facts in.`,
  },
  {
    id: 'project',
    title: 'Project Note',
    desc: 'Create or update a project note',
    icon: 'Folder',
    mode: 'local-model',
    inputLabel: 'Project name and update',
    inputPlaceholder: 'e.g. FreeRange — added offline map cache to roadmap, decided on Mapbox tiles…',
    retrieveK: 6,
    instructions: `Create or update a project note under Projects/. If the project exists in context, merge
the update into the existing note (status, key features, decisions, next steps). Keep the AI-first
frontmatter and preamble intact.`,
  },
  {
    id: 'task',
    title: 'Add Task',
    desc: 'Capture a task or to-do into the vault',
    icon: 'CheckSquare',
    mode: 'local-model',
    inputLabel: 'Task(s)',
    inputPlaceholder: 'e.g. Follow up with VD on audit data by Friday; spike Mapbox offline tiles…',
    retrieveK: 4,
    instructions: `Capture the task(s). Append to today's daily note Daily/{{TODAY}}.md under a "## Tasks"
section as markdown checkboxes (- [ ] task), and link to the relevant project/person with [[wikilinks]].
If a task clearly belongs to a project note that exists in context, also add it there.`,
  },
  {
    id: 'log',
    title: 'Dev Log',
    desc: 'Append a technical work log entry',
    icon: 'FileText',
    mode: 'local-model',
    inputLabel: 'What did you build / change?',
    inputPlaceholder: 'e.g. Implemented local RAG over the vault with sqlite + nomic-embed-text…',
    retrieveK: 4,
    instructions: `Append a dated dev log entry. Write to Dev Logs/{{TODAY}}.md (create if missing, append
if it exists). Tag the related project with [[wikilinks]] and note key technical decisions.`,
  },
  {
    id: 'board',
    title: 'Update Board',
    desc: 'Add or move items on a kanban board',
    icon: 'Layout',
    mode: 'local-model',
    inputLabel: 'Board update',
    inputPlaceholder: 'e.g. On the FreeRange board, move "offline map cache" to Doing and add "test on iOS"…',
    retrieveK: 6,
    instructions: `Create or update a kanban board under Boards/ (Boards/<Name>.md). Boards are markdown with
"## Column" headers (typically ## Todo, ## Doing, ## Done) and "- [ ]" / "- [x]" task items under them.
Apply the user's request by adding or moving items between columns. If the board exists in the retrieved
context, preserve existing items and only make the requested changes. Link related projects with [[wikilinks]].`,
  },
  {
    id: 'recap',
    title: 'Recap',
    desc: "Summarize today or this week from the vault",
    icon: 'RefreshCw',
    mode: 'local-model',
    inputLabel: 'Recap scope (e.g. "today" or "this week")',
    inputPlaceholder: 'e.g. this week',
    retrieveK: 10,
    instructions: `Using the retrieved recent notes as source, write a concise recap. Save it to
Knowledge/Recaps/{{TODAY}} Recap.md. Summarize what happened, decisions made, and open follow-ups, citing
source notes with [[wikilinks]]. Do not invent events not present in the retrieved context.`,
  },
  {
    id: 'synthesize',
    title: 'Synthesize',
    desc: 'Synthesize what the vault knows on a topic',
    icon: 'Layers',
    mode: 'local-model',
    inputLabel: 'Topic to synthesize',
    inputPlaceholder: 'e.g. everything I know about local AI / RAG',
    retrieveK: 12,
    instructions: `Synthesize the retrieved notes on the given topic into a single coherent permanent note at
Knowledge/<Topic>.md. Connect ideas across notes, cite every source with [[wikilinks]], and mark
confidence levels. Base it ONLY on the retrieved context — do not fabricate.`,
  },
  {
    id: 'health',
    title: 'Vault Health',
    desc: 'Scan vault structure for issues',
    icon: 'Activity',
    mode: 'local-deterministic',
    inputLabel: '',
    inputPlaceholder: '',
    retrieveK: 0,
    instructions: '',
  },
]

export function getLocalCommand(id: string): LocalCommand | undefined {
  return LOCAL_COMMANDS.find(c => c.id === id)
}
