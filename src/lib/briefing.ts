import fs from 'fs'
import path from 'path'
import { ollamaChat } from '@/lib/ollama'
import { explainTop, freshCandidates, inboxCounts, refreshInbox, type InboxItem } from '@/lib/inbox'

// The morning briefing: the best new inbox items per section, each with its
// "why this matters to you", plus a short overview. Stored in data/briefings/
// (not the vault — unreviewed items must not become "knowledge" that chat can
// cite). The dashboard shows the latest one; items link to the swipe inbox.

const DIR = path.join(process.cwd(), 'data', 'briefings')
const PER_SECTION = 5
const KEEP_DAYS = 60
const LOOKBACK_MS = 36 * 3600_000 // first briefing
const MIN_WINDOW_MS = 12 * 3600_000

export type Briefing = {
  date: string // YYYY-MM-DD, local
  generatedAt: string
  overview: string
  markdown: string
  itemIds: string[]
}

function today(now = new Date()): string {
  return now.toLocaleDateString('en-CA')
}

export function readLatestBriefing(): Briefing | null {
  try {
    const files = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    const last = files[files.length - 1]
    return last ? (JSON.parse(fs.readFileSync(path.join(DIR, last), 'utf-8')) as Briefing) : null
  } catch {
    return null
  }
}

function prune(): void {
  const cutoff = today(new Date(Date.now() - KEEP_DAYS * 86_400_000))
  for (const f of fs.readdirSync(DIR)) {
    if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < cutoff) fs.rmSync(path.join(DIR, f), { force: true })
  }
}

function sectionTitle(s: string): string {
  return s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Markdown for the dashboard card (react-markdown). Pure, for testing.
export function renderBriefing(date: string, overview: string, sections: Map<string, InboxItem[]>, waiting: number): string {
  const lines = [`### ${date}`, '']
  if (overview) lines.push(overview, '')
  if (sections.size === 0) lines.push('_Nothing new from your sources since the last briefing._', '')
  sections.forEach((items, section) => {
    lines.push(`**${sectionTitle(section)}**`, '')
    for (const it of items) {
      const why = it.why ?? it.summary.slice(0, 220) + (it.summary.length > 220 ? '…' : '')
      lines.push(`- [${it.title.replace(/[[\]]/g, '')}](${it.url}) — ${why} _(${it.sourceName})_`)
    }
    lines.push('')
  })
  if (waiting > 0) lines.push(`[Swipe through ${waiting} new item${waiting === 1 ? '' : 's'} →](/inbox)`)
  return lines.join('\n').trim() + '\n'
}

async function overviewOf(items: InboxItem[]): Promise<string> {
  if (items.length === 0) return ''
  const list = items.map(i => `- [${i.section}] ${i.title}${i.why ? ` — ${i.why}` : ''}`).join('\n')
  try {
    const text = await ollamaChat({
      role: 'writer',
      messages: [
        { role: 'system', content: 'You write a short, warm, factual morning briefing for one person. No preamble, no lists.' },
        {
          role: 'user',
          content: `Today's new items from my feeds, with why each matters to me:\n${list}\n\n` +
            'Write 2–3 sentences: the main themes, and the single item I should read first and why. Use only what is listed.',
        },
      ],
    })
    return text.replace(/\s+/g, ' ').trim().slice(0, 800)
  } catch {
    return '' // model down — the list alone still makes a useful briefing
  }
}

type BriefingGlobals = { running: Promise<Briefing> | null }
const G = ((globalThis as unknown as { __vaultBriefing?: BriefingGlobals }).__vaultBriefing ??= { running: null })

export function isBriefingRunning(): boolean {
  return !!G.running
}

// Fresh fetch → pick the best items since the last briefing → explain any the
// refresh didn't get to → overview → save. Concurrent callers share the run.
export function generateBriefing(now = new Date()): Promise<Briefing> {
  if (G.running) return G.running
  G.running = (async () => {
    await refreshInbox({ explain: 0 })
    // Everything since the previous briefing, but never less than the last 12 h
    // (so regenerating the same morning shows the same items).
    const prev = readLatestBriefing()
    const since = Math.min(prev ? Date.parse(prev.generatedAt) : now.getTime() - LOOKBACK_MS, now.getTime() - MIN_WINDOW_MS)
    let sections = freshCandidates(since, PER_SECTION)
    const unexplained = Array.from(sections.values()).flat().filter(i => !i.why)
    if (unexplained.length) {
      await explainTop(unexplained.length, unexplained.map(i => i.id))
      sections = freshCandidates(since, PER_SECTION)
    }
    const items = Array.from(sections.values()).flat()
    const date = today(now)
    const briefing: Briefing = {
      date,
      generatedAt: now.toISOString(),
      overview: '',
      markdown: '',
      itemIds: items.map(i => i.id),
    }
    briefing.overview = await overviewOf(items)
    briefing.markdown = renderBriefing(date, briefing.overview, sections, inboxCounts().byStatus.new)
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(path.join(DIR, `${date}.json`), JSON.stringify(briefing, null, 2), 'utf-8')
    prune()
    return briefing
  })().finally(() => { G.running = null })
  return G.running
}
