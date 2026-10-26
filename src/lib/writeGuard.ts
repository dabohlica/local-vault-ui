// Guard against a model writing a placeholder instead of the note — e.g. a line
// "...full file content with new links and updates..." in place of the body it
// was asked to return in full. That happened in June and silently wiped four
// notes (one lost 877 lines). Pure, so the review screen (warn + untick before
// approval) and the apply route (hard refusal) run the exact same check.

const ELLIPSIS = String.raw`(?:\.{3}|…)`
const FILLER = String.raw`(?:full|rest|remaining|existing|previous|original|other|unchanged|same|prior|old)`
const STUFF = String.raw`(?:content|contents|file|note|text|body|sections?|lines?|entries|unchanged|as before|preserved)`

// A whole line that only stands in for omitted content:
//   ...full file content with new links...   … rest unchanged …
//   [... existing content ...]   (rest of the note unchanged)   <!-- existing content -->
const PLACEHOLDER_LINES: RegExp[] = [
  new RegExp(String.raw`^[\[(<!\-\s]*${ELLIPSIS}.*\b${FILLER}\b.*\b${STUFF}\b.*$`, 'i'),
  new RegExp(String.raw`^[\[(<!\-\s]*${ELLIPSIS}?\s*\b${FILLER}\b[^\n]{0,40}\b${STUFF}\b[^\n]{0,40}(?:unchanged|preserved|omitted|here|as before|goes here|remains?)?\s*${ELLIPSIS}?\s*[\])>\-]*$`, 'i'),
]
// Keep short so real prose ("The rest of the file is about X, because …") rarely trips it.
const MAX_PLACEHOLDER_LEN = 90

export function placeholderLines(content: string): string[] {
  const out: string[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.length > MAX_PLACEHOLDER_LEN) continue
    // Prose sentences end in a period after real words; placeholders are fragments.
    const fragment = /^(\.{3}|…)|(\.{3}|…)$/.test(line) // ...like this...
      || (/^\[[^[].*[^\]]\]$/.test(line))                    // [like this], not [[a link]]
      || /^\(.*\)$/.test(line)                                // (like this)
      || /^<!--.*-->$/.test(line)                               // <!-- like this -->
    if (fragment && PLACEHOLDER_LINES.some(re => re.test(line))) out.push(line)
  }
  return out
}

function contentLines(text: string): number {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n').filter(l => l.trim()).length
}

// An update that keeps less than half of a note's lines (when the note had a
// real body) is almost always a lossy rewrite.
const SHRINK_MIN_LINES = 12
const SHRINK_RATIO = 0.5

export type GuardResult = { blocked: string | null; warnings: string[]; needsConfirm: boolean }

export function checkWrite(before: string | null, after: string | undefined): GuardResult {
  if (after === undefined) return { blocked: null, warnings: [], needsConfirm: false }
  const ph = placeholderLines(after)
  if (ph.length) {
    return {
      blocked: `The model wrote a placeholder instead of the note (“${ph[0]}”). Applying it would wipe the real text — run it again.`,
      warnings: [],
      needsConfirm: false,
    }
  }
  if (before !== null) {
    const was = contentLines(before)
    const now = contentLines(after)
    if (was >= SHRINK_MIN_LINES && now < was * SHRINK_RATIO) {
      return {
        blocked: null,
        warnings: [`Shrinks this note from ${was} to ${now} lines — check the red lines before applying`],
        needsConfirm: true,
      }
    }
  }
  return { blocked: null, warnings: [], needsConfirm: false }
}
