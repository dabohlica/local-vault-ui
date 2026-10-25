import { describe, it, expect } from 'vitest'
import { embedPrefixes, embedSignature, encodeVector, decodeVector, chunkNote } from '@/lib/embeddings'

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
  it('splits by heading with a self-locating header', () => {
    const chunks = chunkNote('People/Ada.md', '---\ntype: person\n---\nIntro\n## Work\nAnalytical engine')
    expect(chunks.map(c => c.heading)).toEqual(['(intro)', 'Work'])
    expect(chunks[1].content.startsWith('Ada — Work')).toBe(true)
  })
})
