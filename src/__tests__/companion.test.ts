import { describe, it, expect } from 'vitest'
import { resolveCompanion, personaPrompt } from '@/lib/companion'
import { buildRagPrompt } from '@/lib/prompts'

describe('resolveCompanion', () => {
  it('defaults to Inka the octopus and follows the creature for default names', () => {
    expect(resolveCompanion(undefined, undefined)).toEqual({ kind: 'octopus', name: 'Inka', color: 'ink' })
    expect(resolveCompanion('fox', '')).toEqual({ kind: 'fox', name: 'Fenn', color: 'red' })
    expect(resolveCompanion('dragon', '')).toEqual({ kind: 'octopus', name: 'Inka', color: 'ink' })
  })
  it('keeps a custom name, cleaned and capped', () => {
    expect(resolveCompanion('penguin', '  Prof. Ö. Pling <b>  ')).toEqual({ kind: 'penguin', name: 'Prof. Ö. Pling b', color: 'navy' })
    expect(resolveCompanion('fox', 'x'.repeat(40)).name).toHaveLength(24)
  })
})

describe('palettes', () => {
  it('keeps a valid colour for the creature and falls back to its default', () => {
    expect(resolveCompanion('octopus', '', 'teal').color).toBe('teal')
    expect(resolveCompanion('octopus', '', 'arctic').color).toBe('ink') // a fox colour
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
