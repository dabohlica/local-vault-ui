// Pure note-name matching, shared by the server search (src/lib/find.ts) and the
// ⌘K palette in the browser — so no Node imports here.

function fold(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

export function noteTitle(notePath: string): string {
  return (notePath.split('/').pop() ?? notePath).replace(/\.md$/i, '')
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (const ch of hay) if (ch === needle[i]) i++
  return i === needle.length
}

// Score a note name against the query (0 = no match).
export function titleScore(query: string, notePath: string): number {
  const q = fold(query.trim())
  if (!q) return 0
  const title = fold(noteTitle(notePath))
  const full = fold(notePath.replace(/\.md$/i, ''))
  let score = 0
  if (title === q) score = 100
  else if (title.startsWith(q)) score = /[a-z0-9]/.test(title.charAt(q.length)) ? 80 : 90 // whole first word beats partial
  else if (title.split(/[\s\-_.,()]+/).some(w => w.startsWith(q))) score = 65
  else if (title.includes(q)) score = 50
  else {
    const words = q.split(/\s+/).filter(Boolean)
    if (words.length > 1 && words.every(w => full.includes(w))) score = 35
    else if (q.length >= 3 && isSubsequence(q.replace(/\s+/g, ''), title)) score = 15
  }
  // Among equal matches, shorter names (closer to what was typed) win.
  return score ? score - Math.min(9, title.length / 10) : 0
}

export function foldText(s: string): string {
  return fold(s)
}
