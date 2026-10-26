// What the companion says on Home, from the state of things. Pure, for testing.

export type HomeState = {
  inboxNew: number
  suggestions: number
  needsAttention: number
  index: { ready: boolean; busy: boolean; error: string | null } | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function homeLine(s: HomeState | null): string {
  if (!s) return 'Let me have a look at your notes…'
  if (s.index && !s.index.ready) {
    return s.index.error
      ? 'I can’t read your notes right now — is Ollama running? I’ll try again in a few minutes. Finding notes by name still works.'
      : 'I’m still reading through your notes, give me a few minutes. You can already find notes by name.'
  }
  const parts: string[] = []
  if (s.suggestions) parts.push(`prepared ${plural(s.suggestions, 'change', 'changes')} that ${s.suggestions === 1 ? 'needs' : 'need'} your OK`)
  if (s.inboxNew) parts.push(`picked ${plural(s.inboxNew, 'new read', 'new reads')} for you`)
  if (s.needsAttention) parts.push(`found ${plural(s.needsAttention, 'note', 'notes')} with loose ends`)
  if (!parts.length) return 'Your notes are in good order. What’s on your mind?'
  return `I’ve ${list(parts)}. Or just tell me what’s on your mind.`
}
