import { describe, it, expect } from 'vitest'
import { embedPrefixes, embedSignature, encodeVector, decodeVector, chunkNote, queryTerms, ftsQuery } from '@/lib/embeddings'

describe('embedding prefixes', () => {
  it('uses asymmetric query/document prefixes for search-tuned models', () => {
    expect(embedPrefixes('nomic-embed-text:latest')).toEqual({ query: 'search_query: ', doc: 'search_document: ' })
    expect(embedPrefixes('qwen3-embedding:0.6b').query).toMatch(/^Instruct: .*\nQuery: $/)
    expect(embedPrefixes('qwen3-embedding:0.6b').doc).toBe('')
    expect(embedPrefixes('some-other-model')).toEqual({ query: '', doc: '' })
  })
  it('signature changes with the model', () => {
    expect(embedSignature('a')).not.toBe(embedSignature('b'))
  })
})

describe('vector encoding', () => {
  it('round-trips as unit-length float32', () => {
    const v = decodeVector(encodeVector([3, 4]))
    expect(Array.from(v).map(x => +x.toFixed(5))).toEqual([0.6, 0.8])
  })
  it('decodes unaligned buffers', () => {
    const raw = encodeVector([1, 0, 0])
    const shifted = Buffer.concat([Buffer.from([0]), raw]).subarray(1)
    expect(Array.from(decodeVector(shifted))).toEqual([1, 0, 0])
  })
})

describe('chunkNote', () => {
  it('splits by heading with a breadcrumb header (path › parent › heading)', () => {
    const chunks = chunkNote('People/Ada.md', '---\ntype: person\n---\nIntro\n## Work\nAnalytical engine\n### Status\nActive\n## Life\nLondon')
    expect(chunks.map(c => c.heading)).toEqual(['(intro)', 'Work', 'Status', 'Life'])
    expect(chunks[0].content.startsWith('People/Ada\n')).toBe(true)
    expect(chunks[2].content.startsWith('People/Ada › Work › Status\n')).toBe(true)
    expect(chunks[3].content.startsWith('People/Ada › Life\n')).toBe(true) // sibling resets the trail
  })
})

describe('keyword query building', () => {
  it('drops English/German stopwords and keeps umlauts', () => {
    expect(queryTerms('Wer ist der Ansprechpartner für das Energieaudit bei Müller?')).toEqual(['ansprechpartner', 'energieaudit', 'müller'])
    expect(queryTerms('who is Christopher Kopp')).toEqual(['christopher', 'kopp'])
  })
  it('quotes terms (no FTS syntax injection) and prefix-matches longer ones', () => {
    expect(ftsQuery(['kopp', 'ai'])).toBe('"kopp"* OR "ai"')
    expect(ftsQuery(['a"b OR c'])).toBe('"a""b OR c"*')
  })
})
