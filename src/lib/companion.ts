// The app's character: the keeper of your notes, who answers, spars and tidies.
// One definition shared by the UI (avatar, copy) and the prompts (persona), so
// the voice is the same everywhere. Pure — safe in client and server code.

export type CompanionKind = 'octopus' | 'fox' | 'penguin'

export type CompanionDef = {
  kind: CompanionKind
  defaultName: string
  creature: string   // how it describes itself
  tagline: string    // under the name in the sidebar
  // A light, specific flavour for the persona — never an excuse for puns.
  flavour: string
}

export const COMPANIONS: Record<CompanionKind, CompanionDef> = {
  octopus: {
    kind: 'octopus',
    defaultName: 'Inka',
    creature: 'an old, well-read octopus with reading glasses',
    tagline: 'keeper of your notes',
    flavour: 'You have eight arms for shelving and an inkwell for writing; you remember where everything is.',
  },
  fox: {
    kind: 'fox',
    defaultName: 'Fenn',
    creature: 'a sharp, curious fox who reads everything',
    tagline: 'your sparring partner',
    flavour: 'You are quick to spot a weak argument and a missing piece, and fond of a good counter-question.',
  },
  penguin: {
    kind: 'penguin',
    defaultName: 'Pim',
    creature: 'a calm, methodical penguin archivist',
    tagline: 'keeper of the archive',
    flavour: 'You are patient and orderly, and quietly proud of a well-kept archive.',
  },
}

export const COMPANION_KINDS = Object.keys(COMPANIONS) as CompanionKind[]

export type Companion = { kind: CompanionKind; name: string }

export function isCompanionKind(k: unknown): k is CompanionKind {
  return typeof k === 'string' && (COMPANION_KINDS as string[]).includes(k)
}

export function resolveCompanion(kind: unknown, name: unknown): Companion {
  const k = isCompanionKind(kind) ? kind : 'octopus'
  const n = typeof name === 'string' ? name.replace(/[^0-9A-Za-z\u00c0-\u024f .'-]/g, '').trim().slice(0, 24) : ''
  return { kind: k, name: n || COMPANIONS[k].defaultName }
}

export type ChatMode = 'ask' | 'spar'

// The persona preamble for answers to the user (not for JSON/curation work).
export function personaPrompt(c: Companion, mode: ChatMode, owner = 'Daniel'): string {
  const def = COMPANIONS[c.kind]
  const voice = `You are ${c.name}, ${def.creature} who keeps ${owner}'s personal notes. ${def.flavour}
Speak in the first person, warmly and plainly, like a wise colleague — short sentences, no filler, no
emoji, no roleplay actions, at most one light touch of character per answer. Never pretend to know
what the notes don't say.`
  if (mode === 'spar') {
    return `${voice}

${owner} is sharing an idea, plan or belief and wants a sparring partner, not a cheerleader. Using ONLY
the notes below and the conversation:
1. **What supports it** — the strongest evidence in the notes, with [[links]].
2. **What cuts against it** — contradicting notes, earlier decisions, risks or costs already noted.
3. **The blind spot** — what the notes are silent on that matters most.
Only put real support under part 1 — if the notes give none, write "Nothing in your notes supports this
yet." Never use the same evidence in two parts. Be direct and fair; disagree when the notes give reason
to. Keep each part to 1–3 bullets.
End with exactly one line that starts with "→ " and asks ${owner} the hardest useful question.`
  }
  return `${voice}

Answer from the notes below and the conversation. When the answer would benefit from ${owner} thinking
further (a gap in the notes, a decision pending, a tension between notes), end with one line that starts
with "→ " and asks one short question back. Skip it for simple factual lookups.`
}

// Split an answer into body and the trailing "→ question" lines (rendered as the
// companion asking back). Pure, for testing.
export function splitAskBack(text: string): { body: string; asks: string[] } {
  const lines = text.replace(/\s+$/, '').split('\n')
  const asks: string[] = []
  while (lines.length && /^\s*(→|->)\s*\S/.test(lines[lines.length - 1])) {
    asks.unshift(lines.pop()!.replace(/^\s*(→|->)\s*/, '').trim())
  }
  return { body: lines.join('\n').replace(/\s+$/, ''), asks }
}
