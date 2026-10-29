import { describe, it, expect } from 'vitest'
import { resolveCompanion, personaPrompt } from '@/lib/companion'
import { buildRagPrompt } from '@/lib/prompts'
import { fracIndex } from '@/components/companion/orrin'

describe('resolveCompanion', () => {
  it('defaults to Orrin the owl and follows the creature for default names', () => {
    expect(resolveCompanion(undefined, undefined)).toEqual({ kind: 'owl', name: 'Orrin', color: 'natural' })
    expect(resolveCompanion('octopus', '')).toEqual({ kind: 'octopus', name: 'Inka', color: 'orange' })
    expect(resolveCompanion('fox', '')).toEqual({ kind: 'fox', name: 'Fenn', color: 'red' })
    expect(resolveCompanion('dragon', '')).toEqual({ kind: 'owl', name: 'Orrin', color: 'natural' })
  })
  it('keeps a custom name, cleaned and capped', () => {
    expect(resolveCompanion('penguin', '  Prof. Ö. Pling <b>  ')).toEqual({ kind: 'penguin', name: 'Prof. Ö. Pling b', color: 'navy' })
    expect(resolveCompanion('fox', 'x'.repeat(40)).name).toHaveLength(24)
  })
})

describe('fracIndex', () => {
  it('places a value between the rendered head angles', () => {
    const yaw = [-40, -30, -20, -10, 0, 10, 20, 30, 40]
    expect(fracIndex(yaw, 0)).toBe(4)
    expect(fracIndex(yaw, 15)).toBe(5.5)
    expect(fracIndex(yaw, -99)).toBe(0)
    expect(fracIndex(yaw, 99)).toBe(8)
    expect(fracIndex([-24, -12, 0, 11, 22], 5.5)).toBe(2.5)
  })
})

describe('palettes', () => {
  it('keeps a valid colour for the creature and falls back to its default', () => {
    expect(resolveCompanion('octopus', '', 'teal').color).toBe('teal')
    expect(resolveCompanion('octopus', '', 'arctic').color).toBe('orange') // a fox colour
    expect(resolveCompanion('fox', '', 'arctic').color).toBe('arctic')
  })
})

describe('personaPrompt', () => {
  const inka = resolveCompanion('octopus', '')
  it('ask mode: first person, grounded, optional ask-back', () => {
    const p = personaPrompt(inka, 'ask')
    expect(p).toContain('You are Inka')
    expect(p).toContain('"→ "')
    expect(p).not.toContain('sparring partner')
  })
  it('spar mode: supports / cuts against / blind spot, always ends with a question', () => {
    const p = personaPrompt(inka, 'spar')
    for (const s of ['What supports it', 'What cuts against it', 'The blind spot', 'End with exactly one line']) expect(p).toContain(s)
  })
  it('is used by the answer prompt, which still carries the grounding rules', () => {
    const [system] = buildRagPrompt('q', [], [], { companion: inka, mode: 'spar' })
    expect(system.content).toContain('You are Inka')
    expect(system.content).toContain('do not make things up')
  })
})
