import { describe, it, expect } from 'vitest'
import { titleScore, noteTitle } from '@/lib/noteMatch'
import { captureBlock, dailyNotePath } from '@/lib/capture'

describe('titleScore (palette / search ranking)', () => {
  const rank = (q: string, paths: string[]) =>
    paths.map(p => ({ p, s: titleScore(q, p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.p)

  it('prefers exact > prefix > word prefix > substring', () => {
    const paths = ['People/Jane Smith.md', 'Projects/Jane.md', 'Ideas/Mary-Jane notes.md', 'Daily/2026-01-01.md', 'Clients/Janet.md']
    expect(rank('jane', paths)).toEqual(['Projects/Jane.md', 'People/Jane Smith.md', 'Clients/Janet.md', 'Ideas/Mary-Jane notes.md'])
  })

  it('matches multi-word queries across folder + name, and ignores accents/case', () => {
    expect(titleScore('people jane', 'People/Jane Smith.md')).toBeGreaterThan(0)
    expect(titleScore('uber', 'Knowledge/Über Alles.md')).toBeGreaterThan(0)
    expect(titleScore('', 'People/Jane.md')).toBe(0)
  })

  it('falls back to in-order letters for 3+ chars only', () => {
    expect(titleScore('rtrv', 'Knowledge/Retrieval.md')).toBeGreaterThan(0)
    expect(titleScore('rv', 'Knowledge/Retrieval.md')).toBe(0)
    expect(titleScore('zzz', 'Knowledge/Retrieval.md')).toBe(0)
  })

  it('noteTitle strips folders and .md', () => {
    expect(noteTitle('A/B/My Note.md')).toBe('My Note')
  })
})

describe('captureBlock (jot down)', () => {
  it('creates a daily note with frontmatter when none exists', () => {
    const out = captureBlock(null, '  call Jane about the audit  ', '2026-10-26', '09:15')
    expect(out.startsWith('---\ndate: 2026-10-26\ntype: daily\n')).toBe(true)
    expect(out).toContain('# 2026-10-26')
    expect(out.trimEnd().endsWith('## 09:15 — Jotted down\n\ncall Jane about the audit')).toBe(true)
  })

  it('appends with exactly one blank line before the entry', () => {
    expect(captureBlock('body', 'x', 'd', '10:00')).toBe('\n\n## 10:00 — Jotted down\n\nx\n')
    expect(captureBlock('body\n', 'x', 'd', '10:00')).toBe('\n## 10:00 — Jotted down\n\nx\n')
    expect(captureBlock('body\n\n', 'x', 'd', '10:00')).toBe('## 10:00 — Jotted down\n\nx\n')
  })

  it('files under Daily/', () => {
    expect(dailyNotePath('2026-10-26')).toBe('Daily/2026-10-26.md')
  })
})

describe('readable (search snippets)', async () => {
  const { readable } = await import('@/lib/find')
  it('drops the chunk breadcrumb, preamble heading and markdown syntax', () => {
    const chunk = 'Knowledge/Prompt Engineering › For future Claude\n\n## For future Claude\nPrompt **engineering** links [[People/Jane Smith|Jane]] and [[Projects/Foo]] — see [docs](https://x.y).\n| a | b |'
    expect(readable(chunk)).toBe('Prompt engineering links Jane and Foo — see docs. a b')
  })
})
