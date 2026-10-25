// The vault's semantic layer: note types and typed relations, as defined by the
// vault's own conventions (_CLAUDE.md: "Note types: daily | project | task |
// person | devlog | idea | decision | research | meeting | review"). Not a
// product — just the shared vocabulary the graph, health checks and retrieval
// agree on. Pure, so it's testable and safe to import anywhere.

export const NOTE_TYPES = [
  'daily', 'project', 'task', 'person', 'devlog', 'idea', 'decision', 'research', 'meeting', 'review', 'briefing',
] as const
export type NoteType = (typeof NOTE_TYPES)[number]

// Folder → type, for notes without a `type:` (the folder map in _CLAUDE.md).
const FOLDER_TYPES: Array<[RegExp, NoteType]> = [
  [/^daily\//i, 'daily'],
  [/^projects?\//i, 'project'],
  [/^tasks?\//i, 'task'],
  [/^(people|persons|contacts|personen|kontakte)\//i, 'person'],
  [/^dev ?logs?\//i, 'devlog'],
  [/^ideas?\//i, 'idea'],
  [/^decisions?\//i, 'decision'],
  [/^meetings?\//i, 'meeting'],
  [/^reviews?\//i, 'review'],
]

export function isNoteType(t: string): t is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(t)
}

export function inferType(notePath: string): NoteType | null {
  for (const [re, type] of FOLDER_TYPES) if (re.test(notePath)) return type
  return null
}

// Frontmatter fields whose [[links]] must point at a specific type. Any other
// field holding [[links]] still becomes an edge (kind = field name), untyped.
export const RELATION_TARGETS: Record<string, NoteType> = {
  'related-people': 'person',
  people: 'person',
  attendees: 'person',
  participants: 'person',
  owner: 'person',
  'related-projects': 'project',
  project: 'project',
  projects: 'project',
  'related-decisions': 'decision',
}

// Frontmatter fields that are never relations even if they contain brackets.
export const NON_RELATION_FIELDS = new Set(['tags', 'aliases', 'cssclasses', 'title'])

export const BODY_LINK = 'link' // edge kind for a [[wikilink]] in the note body
