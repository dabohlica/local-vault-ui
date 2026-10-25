import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import { acceptedNoteContent, centroid, scoreFrom, type InboxItem } from '@/lib/inbox'
import { renderBriefing } from '@/lib/briefing'
import { dueFeedJobs } from '@/lib/scheduler'

const item: InboxItem = {
  id: 'abc', sourceId: 's1', sourceName: 'arXiv · IR', section: 'research', kind: 'arxiv',
  title: 'Contextual Retrieval: "Chunks" with headers', url: 'http://arxiv.org/abs/2410.12345',
  authors: ['A', 'B', 'C', 'D'], published: '2026-10-20T00:00:00.000Z', summary: 'We study retrieval.',
  fetchedAt: 0, status: 'new', decidedAt: null, score: 0.6,
  related: [{ path: 'Knowledge/Embeddings.md', score: 0.7, chunkId: 1 }], why: 'Extends your Embeddings note.', notePath: null,
}

describe('scoreFrom', () => {
  it('is the vault similarity until there is a profile', () => {
    expect(scoreFrom(0.5, null, null)).toBe(0.5)
  })
  it('blends in what you accepted, and penalizes only reject-like items', () => {
    expect(scoreFrom(0.5, 0.8, null)).toBe(0.62)
    expect(scoreFrom(0.5, 0.8, 0.3)).toBe(0.62) // closer to accepts: no penalty
    expect(scoreFrom(0.5, 0.3, 0.8)).toBeCloseTo(0.42 - 0.25)
    expect(scoreFrom(0.5, null, 0.7)).toBeCloseTo(0.4)
  })
})

describe('centroid', () => {
  it('needs a minimum of decisions and returns a unit vector', () => {
    expect(centroid([new Float32Array([1, 0])])).toBeNull()
    const c = centroid([new Float32Array([1, 0]), new Float32Array([0, 1])])!
    expect(c[0]).toBeCloseTo(Math.SQRT1_2)
    expect(Math.hypot(c[0], c[1])).toBeCloseTo(1)
  })
})

describe('acceptedNoteContent', () => {
  it('follows the vault frontmatter rules and links related notes', () => {
    const md = acceptedNoteContent(item, '2026-10-25')
    const { data, content } = matter(md)
    expect(data).toMatchObject({ type: 'research', section: 'research', source: item.url, confidence: 'stated', 'ai-first': true, published: '2026-10-20' })
    expect(data.title).toBe(item.title)
    expect(data.tags).toEqual(['research', 'from-inbox'])
    expect(content).toContain('**For future Claude:**')
    expect(content).toContain('by A, B, C et al.')
    expect(content).toContain('- [[Knowledge/Embeddings]]')
    expect(content).toContain(`Source: ${item.url}`)
  })
})

describe('renderBriefing', () => {
  it('groups by section and links the inbox', () => {
    const md = renderBriefing('2026-10-25', 'Overview.', new Map([['research', [item]]]), 3)
    expect(md).toMatch(/^### 2026-10-25\n\nOverview\.\n\n\*\*Research\*\*/)
    expect(md).toContain(`- [Contextual Retrieval: "Chunks" with headers](${item.url}) — Extends your Embeddings note. _(arXiv · IR)_`)
    expect(md).toContain('[Swipe through 3 new items →](/inbox)')
  })
  it('says so when nothing is new', () => {
    expect(renderBriefing('2026-10-25', '', new Map(), 0)).toContain('Nothing new')
  })
})

describe('dueFeedJobs', () => {
  const cfg = { feedsEnabled: true, feedIntervalHours: 6, briefingHour: 7 }
  const at = (h: number) => new Date(2026, 9, 25, h, 0, 0)
  it('builds the briefing once per day at/after the hour, polling otherwise', () => {
    expect(dueFeedJobs(at(6), { lastFeedMs: at(5).getTime(), lastBriefingDate: '2026-10-24' }, cfg, true)).toEqual({ feeds: false, briefing: false })
    expect(dueFeedJobs(at(7), { lastFeedMs: at(5).getTime(), lastBriefingDate: '2026-10-24' }, cfg, true)).toEqual({ feeds: false, briefing: true })
    expect(dueFeedJobs(at(14), { lastFeedMs: at(7).getTime(), lastBriefingDate: '2026-10-25' }, cfg, true)).toEqual({ feeds: true, briefing: false })
  })
  it('does nothing without sources or when disabled', () => {
    expect(dueFeedJobs(at(9), { lastFeedMs: 0, lastBriefingDate: '' }, cfg, false)).toEqual({ feeds: false, briefing: false })
    expect(dueFeedJobs(at(9), { lastFeedMs: 0, lastBriefingDate: '' }, { ...cfg, feedsEnabled: false }, true)).toEqual({ feeds: false, briefing: false })
  })
})
