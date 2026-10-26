import { describe, it, expect } from 'vitest'
import { parseConflicts, conflictSection } from '@/lib/conflicts'

const shown = ['Knowledge/RAG.md', 'People/Jane Smith.md']

describe('parseConflicts', () => {
  it('keeps valid conflicts on notes that were shown, in any name form', () => {
    const raw = '```json\n{"conflicts":[{"note":"[[Knowledge/RAG]]","existing":"Rerankers add  ~4 s","incoming":"Rerankers add 40 ms","why":"Latency differs by 100x"},' +
      '{"note":"knowledge/rag.md","existing":"rerankers add ~4 s","incoming":"dup","why":""}]}\n```'
    expect(parseConflicts(raw, shown)).toEqual([
      { note: 'Knowledge/RAG.md', existing: 'Rerankers add ~4 s', incoming: 'Rerankers add 40 ms', why: 'Latency differs by 100x' },
    ])
  })

  it('drops invented notes, missing claims, junk and empty answers', () => {
    expect(parseConflicts('{"conflicts":[{"note":"Made Up","existing":"a","incoming":"b"}]}', shown)).toEqual([])
    expect(parseConflicts('{"conflicts":[{"note":"Knowledge/RAG","existing":"","incoming":"b"}]}', shown)).toEqual([])
    expect(parseConflicts('{"conflicts":[]}', shown)).toEqual([])
    expect(parseConflicts('no json here', shown)).toEqual([])
    expect(parseConflicts('{"conflicts":"none"}', shown)).toEqual([])
  })

  it('accepts the note as [X], bare path or bare name (as GLM writes it)', () => {
    for (const note of ['[People/Jane Smith]', 'People/Jane Smith', 'Jane Smith', '[[Jane Smith]]'])
      expect(parseConflicts(JSON.stringify({ conflicts: [{ note, existing: 'a', incoming: 'b' }] }), shown)[0]?.note, note).toBe('People/Jane Smith.md')
  })

  it('caps at three', () => {
    const many = JSON.stringify({ conflicts: Array.from({ length: 6 }, (_, i) => ({ note: 'Knowledge/RAG', existing: `e${i}`, incoming: 'x' })) })
    expect(parseConflicts(many, shown)).toHaveLength(3)
  })
})

describe('conflictSection', () => {
  it('renders linked, dated, hedged markdown', () => {
    const md = conflictSection([{ note: 'Knowledge/RAG.md', existing: 'A', incoming: 'B', why: 'C' }], '2026-10-26')
    expect(md).toContain('## Possible conflicts (checked 2026-10-26)')
    expect(md).toContain('- **[[Knowledge/RAG]]** says: A\n  - This source says: B\n  - C')
    expect(md).toContain('check before relying on either')
  })
})
