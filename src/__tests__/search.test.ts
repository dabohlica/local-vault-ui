import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from '@/lib/search'
import { yesProbability } from '@/lib/ollama'

describe('reciprocalRankFusion', () => {
  it('rewards items ranked well by several signals over a single top rank', () => {
    const fused = reciprocalRankFusion([[1, 2, 3], [2, 3, 1], [2]])
    const order = Array.from(fused).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    expect(order[0]).toBe(2)
    expect(fused.get(1)).toBeCloseTo(1 / 61 + 1 / 63)
  })
})

describe('yesProbability (reranker score from logprobs)', () => {
  it('normalizes P(yes) against P(no), case-insensitively', () => {
    expect(yesProbability([{ token: 'yes', logprob: Math.log(0.9) }, { token: 'no', logprob: Math.log(0.1) }])).toBeCloseTo(0.9)
    expect(yesProbability([{ token: 'No', logprob: Math.log(0.8) }, { token: ' yes', logprob: Math.log(0.2) }])).toBeCloseTo(0.2)
  })
  it('is 0 when neither answer token appears', () => {
    expect(yesProbability([{ token: ',', logprob: -11.9 }])).toBe(0)
  })
})
