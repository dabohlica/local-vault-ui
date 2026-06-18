import path from 'path'
import type { HealthIssue } from '@/lib/health'

// Deterministic, fully-local repair of STRUCTURAL health issues. No model — so it
// always produces a correct, predictable fix (unlike a small chat model, which
// often returns a non-fix). It only ADDS what's missing; the original body is
// preserved byte-for-byte. Handles the two bulk issues:
//   - missing-frontmatter → prepend a YAML block (title/type/dates/tags/confidence)
//   - missing-preamble    → insert a "## For future Claude" section, summarised
//                           from the note's own first paragraph
// Broken wikilinks and empty notes are left untouched (they need human judgment).

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

function stripFrontmatter(s: string): string {
  return s.replace(FRONTMATTER_RE, '')
}

// Infer a note `type` from its folder path (matches anywhere in the path so
// "CLAUDE_projects/" and "Projects/" both map to "project").
function inferType(notePath: string): string {
  const dir = notePath.slice(0, notePath.lastIndexOf('/')).toLowerCase()
  if (dir.includes('project')) return 'project'
  if (dir.includes('people') || dir.includes('person')) return 'person'
  if (dir.includes('meeting')) return 'meeting'
  if (dir.includes('daily')) return 'daily'
  if (dir.includes('log')) return 'log'
  if (dir.includes('board')) return 'board'
  if (dir.includes('knowledge')) return 'knowledge'
  return 'note'
}

// First meaningful sentence(s) of the body, for a non-hollow preamble.
function deriveSummary(body: string, title: string): string {
  const firstPara = body
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .find(p => p && !p.startsWith('#') && !p.startsWith('---'))
  if (!firstPara) return `This note captures ${title}.`
  const clean = firstPara.replace(/[*_`>#[\]]/g, '').replace(/\s+/g, ' ').trim()
  const cut = clean.slice(0, 240)
  return cut.length < clean.length ? `${cut.replace(/\s+\S*$/, '')}…` : cut
}

function buildFrontmatter(notePath: string, title: string, today: string): string {
  return [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `type: ${inferType(notePath)}`,
    `created: ${today}`,
    `updated: ${today}`,
    'tags: []',
    'confidence: medium',
    '---',
  ].join('\n')
}

// Returns the corrected content, or null if there's nothing this deterministic
// fixer can safely change for the given issue kinds.
export function deterministicFix(
  notePath: string,
  content: string,
  kinds: Set<HealthIssue['kind']>,
  today = new Date().toISOString().slice(0, 10)
): string | null {
  const title = path.basename(notePath).replace(/\.md$/, '')
  const fmMatch = FRONTMATTER_RE.exec(content)
  const body = stripFrontmatter(content).trim()

  const needFrontmatter = kinds.has('missing-frontmatter') && !fmMatch
  const needPreamble = kinds.has('missing-preamble') && !/for future claude/i.test(body)
  if (!needFrontmatter && !needPreamble) return null

  const frontmatter = fmMatch ? fmMatch[0].replace(/\r?\n?$/, '') : buildFrontmatter(notePath, title, today)
  const preamble = needPreamble ? `## For future Claude\n\n${deriveSummary(body, title)}\n` : ''

  const parts = [frontmatter, preamble, body].filter(Boolean)
  return parts.join('\n\n').trimEnd() + '\n'
}
