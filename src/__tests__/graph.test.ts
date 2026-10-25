import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseNote, resolveTarget, connections, graphOverview, neighbors } from '@/lib/graph'
import { inferType } from '@/lib/schema'
import { graphList } from '@/lib/search'

const { vaultDir } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  return { vaultDir: fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'graph-test-'))) }
})
vi.mock('@/lib/config', async (orig) => ({
  ...(await orig<typeof import('@/lib/config')>()),
  getConfig: () => ({ vaultPath: vaultDir }),
}))

function write(rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true })
  fs.writeFileSync(path.join(vaultDir, rel), content)
}

beforeAll(() => {
  write('People/Jane Smith.md', '---\ntype: person\n---\n# Jane\nWorks on [[Agentic Collab]].')
  write('Projects/Agentic Collab.md', '---\ntype: project\nrelated-people:\n  - "[[Jane Smith]]"\n  - "[[Agentic Collab Kickoff]]"\n---\nSee [[Missing Note]] and ![[diagram.png]].\n```\n[[Not A Link]]\n```')
  write('Meetings/Agentic Collab Kickoff.md', '---\ntype: meeting\nattendees: [[Jane Smith]]\n---\nKickoff.')
  write('Knowledge/Lonely.md', 'No links here.')
  write('Daily/2026-10-25.md', 'Nothing linked, but daily notes are exempt.')
})

describe('parseNote', () => {
  it('reads typed frontmatter relations (quoted and unquoted YAML) and body links', () => {
    const p = parseNote('---\ntype: Project\nrelated-people: [[Jane Smith]]\nowner: "[[Bob]]"\ntags: ["[[nope]]"]\n---\n[[A|alias]] [[B#heading]] ![[img.png]] `[[code]]` [[A]]')
    expect(p.type).toBe('project')
    expect(p.edges).toEqual([
      { target: 'Jane Smith', kind: 'related-people' },
      { target: 'Bob', kind: 'owner' },
      { target: 'A', kind: 'link' },
      { target: 'B', kind: 'link' },
    ])
  })
  it('survives malformed frontmatter', () => {
    expect(parseNote('---\n: : bad\n---\n[[X]]').edges.map(e => e.target)).toContain('X')
  })
})

describe('resolveTarget', () => {
  const byPath = new Map([['people/jane smith', 'People/Jane Smith.md'], ['archive/people/jane smith', 'Archive/People/Jane Smith.md']])
  const byBase = new Map([['jane smith', ['Archive/People/Jane Smith.md', 'People/Jane Smith.md']]])
  it('prefers an exact path, then the shortest basename match', () => {
    expect(resolveTarget('Archive/People/Jane Smith', byPath, byBase)).toBe('Archive/People/Jane Smith.md')
    expect(resolveTarget('jane smith', byPath, byBase)).toBe('People/Jane Smith.md')
    expect(resolveTarget('Nobody', byPath, byBase)).toBeNull()
  })
})

describe('vault graph', () => {
  it('resolves links both ways, with types', () => {
    const c = connections('Projects/Agentic Collab.md')
    expect(c.node).toMatchObject({ type: 'project', typeInferred: false })
    expect(c.outgoing.map(o => [o.kind, o.path])).toEqual([
      ['related-people', 'People/Jane Smith.md'],
      ['related-people', 'Meetings/Agentic Collab Kickoff.md'],
      ['link', null], // [[Missing Note]] — unresolved; embeds and code ignored
    ])
    expect(c.backlinks.map(b => b.path).sort()).toEqual(['People/Jane Smith.md'])
    expect(Array.from(neighbors('People/Jane Smith.md')).sort()).toEqual(['Meetings/Agentic Collab Kickoff.md', 'Projects/Agentic Collab.md'])
  })
  it('flags typed relations pointing at the wrong kind of note', () => {
    const c = connections('Projects/Agentic Collab.md')
    expect(c.issues).toHaveLength(1)
    expect(c.issues[0].detail).toContain('is a meeting note, expected person')
  })
  it('reports orphans (except dated notes), types and unresolved links', () => {
    const o = graphOverview()
    expect(o.orphans).toEqual(['Knowledge/Lonely.md'])
    expect(o.unresolved).toBe(1)
    expect(o.types).toMatchObject({ person: 1, project: 1, meeting: 1, daily: 1, '(none)': 1 })
  })
})

describe('schema + graph retrieval signal', () => {
  it('infers types from the folder map', () => {
    expect(inferType('People/X.md')).toBe('person')
    expect(inferType('Dev Logs/2026-10-25 - x.md')).toBe('devlog')
    expect(inferType('Knowledge/X.md')).toBeNull()
  })
  it('graphList keeps fused order, boosting candidates linked to the top notes', () => {
    const note: Record<number, string> = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' }
    const links: Record<string, string[]> = { A: ['C', 'E'], B: [], C: ['A'], D: [], E: ['A'] } // symmetric, like neighbors()
    const out = graphList([1, 2, 3, 4, 5], id => note[id], p => new Set(links[p]), 3)
    expect(out).toEqual([1, 3, 5]) // A (linked from seed C), C (links seed A), E (linked to seed A)
  })
})
