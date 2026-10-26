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

describe('linkWikilinks (chat answers)', async () => {
  const { linkWikilinks } = await import('@/lib/wikilinks')
  const notes = ['People/Jane Smith.md', 'Clients/VD Energieeffizienz.md']
  it('keeps the alias and links by path or by name', () => {
    expect(linkWikilinks('[[People/Jane Smith|Jane]]', [], notes)).toBe('[Jane](/explorer?file=People%2FJane%20Smith.md)')
    expect(linkWikilinks('[[Jane Smith#Role|the CTO]]', [], notes)).toBe('[the CTO](/explorer?file=People%2FJane%20Smith.md)')
    expect(linkWikilinks('at [[Clients/VD Energieeffizienz]].', [], notes)).toBe('at [VD Energieeffizienz](/explorer?file=Clients%2FVD%20Energieeffizienz.md).')
  })
  it('bolds links to notes that do not exist', () => {
    expect(linkWikilinks('[[Nowhere|here]] and [[Nope]]', [], notes)).toBe('**here** and **Nope**')
  })
})

describe('jotDown races', () => {
  it('appends when the daily note appears between the read and the create', async () => {
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const { vi } = await import('vitest')
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-'))
    const rel = 'Daily/2026-10-26.md'
    // Simulate the race: the first read finds no note, then Obsidian creates it.
    let first = true
    const readFileSync = ((p: string, o?: unknown) => {
      if (first && String(p).endsWith(rel)) {
        first = false
        fs.mkdirSync(path.join(vault, 'Daily'), { recursive: true })
        fs.writeFileSync(path.join(vault, rel), '# from obsidian\n')
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return fs.readFileSync(p, o as BufferEncoding)
    }) as typeof fs.readFileSync
    vi.resetModules()
    vi.doMock('fs', () => ({ ...fs, default: { ...fs, readFileSync }, readFileSync }))
    vi.doMock('@/lib/config', () => ({ getConfig: () => ({ vaultPath: vault }) }))
    vi.doMock('@/lib/opsLog', () => ({ recordOperation: () => {} }))
    const { jotDown } = await import('@/lib/capture')
    expect(jotDown('keep me', new Date(2026, 9, 26, 9, 15))).toBe(rel)
    const out = fs.readFileSync(path.join(vault, rel), 'utf-8')
    expect(out.startsWith('# from obsidian\n')).toBe(true)
    expect(out).toContain('## 09:15 — Jotted down\n\nkeep me')
    vi.doUnmock('fs'); vi.doUnmock('@/lib/config'); vi.doUnmock('@/lib/opsLog')
  })
})

describe('shouldHeal (index self-heal backoff)', async () => {
  const { shouldHeal } = await import('@/lib/indexHeal')
  it('syncs only when not ready, not already running, and not within 10 min of a failure', () => {
    const now = 1_000_000_000
    expect(shouldHeal(false, false, 0, now)).toBe(true)
    expect(shouldHeal(true, false, 0, now)).toBe(false)
    expect(shouldHeal(false, true, 0, now)).toBe(false)
    expect(shouldHeal(false, false, now - 5 * 60_000, now)).toBe(false)
    expect(shouldHeal(false, false, now - 11 * 60_000, now)).toBe(true)
  })
})

describe('recapWindow', async () => {
  const { recapWindow, recapDue } = await import('@/lib/recap')
  const ymd = (d: Date) => d.toLocaleDateString('en-CA')
  it('covers Monday..Sunday ending at the last Sunday 17:00', () => {
    const w = recapWindow(new Date(2026, 9, 26, 9, 0)) // Mon 26 Oct, 09:00
    expect(w.week).toBe('2026-10-25')
    expect(ymd(w.start)).toBe('2026-10-19')
    expect(ymd(w.end)).toBe('2026-10-25')
  })
  it('switches to the new week only after Sunday 17:00', () => {
    expect(recapWindow(new Date(2026, 10, 1, 16, 59)).week).toBe('2026-10-25') // Sun 1 Nov, before 17:00
    expect(recapWindow(new Date(2026, 10, 1, 17, 0)).week).toBe('2026-11-01')
  })
  it('is due once per week', () => {
    const now = new Date(2026, 9, 28, 12, 0)
    expect(recapDue(now, null)).toBe(true)
    expect(recapDue(now, '2026-10-25')).toBe(false)
    expect(recapDue(now, '2026-10-18')).toBe(true)
  })
})

describe('dropSection', async () => {
  const { dropSection } = await import('@/lib/recap')
  const md = '### What you worked on\n- a\n\n### New reading\n- not really\n\n### Open loops\n- b\n'
  it('removes a middle or last section, keeps the rest', () => {
    expect(dropSection(md, 'New reading')).toBe('### What you worked on\n- a\n\n### Open loops\n- b\n')
    expect(dropSection('### A\n- a\n### New reading\n- x\n', 'New reading')).toBe('### A\n- a\n')
    expect(dropSection(md, 'Missing')).toBe(md)
  })
})
