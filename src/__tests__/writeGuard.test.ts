import { describe, it, expect } from 'vitest'
import { checkWrite, placeholderLines } from '@/lib/writeGuard'

describe('placeholderLines', () => {
  it('catches the placeholders models write instead of full notes', () => {
    for (const l of [
      '...full file content with new links and updates...',
      '...full file content with added wikilinks...',
      '...full file content...',
      '… rest unchanged …',
      '[... existing content ...]',
      '(rest of the note unchanged)',
      '<!-- existing content preserved -->',
      '...remaining sections unchanged...',
      '[existing content]',
    ]) expect(placeholderLines(`# Note\n\n${l}\n`), l).toEqual([l])
  })

  it('leaves real prose, lists and ellipses alone', () => {
    const real = [
      'The rest of the file is about pricing, which we agreed on Monday.',
      '- Existing content audit is planned for Q3',
      'We tried this... and the same thing happened.',
      '...and then the original plan fell through.',
      'Full content strategy: see [[Marketing]]',
      '| existing | content |',
    ].join('\n')
    expect(placeholderLines(real)).toEqual([])
  })
})

describe('checkWrite', () => {
  const body = (n: number) => '---\ntype: x\n---\n' + Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')

  it('blocks a placeholder write, create or update', () => {
    expect(checkWrite(null, '---\na: 1\n---\n## For future Claude\n...full file content...').blocked).toMatch(/placeholder/)
    expect(checkWrite(body(40), body(3) + '\n...existing content unchanged...').blocked).toMatch(/placeholder/)
  })

  it('asks for confirmation when an update drops more than half the lines', () => {
    const r = checkWrite(body(40), body(10))
    expect(r.blocked).toBeNull()
    expect(r.needsConfirm).toBe(true)
    expect(r.warnings[0]).toMatch(/40 to 10/)
  })

  it('passes normal updates, small notes and new notes', () => {
    expect(checkWrite(body(40), body(45))).toEqual({ blocked: null, warnings: [], needsConfirm: false })
    expect(checkWrite(body(8), body(2)).needsConfirm).toBe(false)
    expect(checkWrite(null, body(5)).blocked).toBeNull()
    expect(checkWrite(body(5), undefined).blocked).toBeNull()
  })
})
