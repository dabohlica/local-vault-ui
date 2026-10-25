import { describe, it, expect } from 'vitest'
import { stripModelArtifacts, createArtifactFilter, isMlxModel } from '@/lib/ollama'

describe('stripModelArtifacts', () => {
  it('removes think blocks and GLM box tokens', () => {
    expect(stripModelArtifacts('<think>hmm</think>\nAnswer <|begin_of_box|>42<|end_of_box|>')).toBe('Answer 42')
    expect(stripModelArtifacts('reasoning…</think>Final')).toBe('Final')
    expect(stripModelArtifacts('a < b')).toBe('a < b')
  })
})

describe('createArtifactFilter (streaming)', () => {
  const run = (deltas: string[]) => {
    const f = createArtifactFilter()
    return deltas.map(d => f.push(d)).join('') + f.flush()
  }
  it('drops think spans split across deltas', () => {
    expect(run(['Hel', 'lo <th', 'ink>secret', ' stuff</thi', 'nk> world'])).toBe('Hello world')
  })
  it('drops box tokens split across deltas and keeps plain "<"', () => {
    expect(run(['<|begin_', 'of_box|>x < y', '<|end_of_box|>'])).toBe('x < y')
  })
})

describe('isMlxModel', () => {
  it('routes only mlx: models to MLX', () => {
    expect(isMlxModel('mlx:mlx-community/GLM-4.6V-Flash-4bit')).toBe(true)
    expect(isMlxModel('qwen3-embedding:0.6b')).toBe(false)
  })
})
