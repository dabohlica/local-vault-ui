import fs from 'fs'
import path from 'path'
import { ollamaChat } from '@/lib/ollama'
import { isMetaNote, listAllNotes, readNote, resolveVaultPath, stripFrontmatter } from '@/lib/vault'
import { readOperations, recordOperation } from '@/lib/opsLog'
import { checkWrite } from '@/lib/writeGuard'

// The weekly recap: what happened in the last 7 days, from the daily notes, the
// app's change log, notes edited and reading kept from the inbox. Built once a
// week (Sunday evening, or on the next tick after), stored in data/recaps/ —
// NOT the vault — and shown on Home. "Save as note" copies it into the vault.

const DIR = path.join(process.cwd(), 'data', 'recaps')
const RECAP_DAY = 0  // Sunday
const RECAP_HOUR = 17
const DAILY_BUDGET = 14_000 // chars of daily-note text sent to the model

export type Recap = {
  week: string      // key of the week it covers, "YYYY-MM-DD" of its last day (the Sunday)
  from: string      // YYYY-MM-DD, local
  to: string
  generatedAt: string
  markdown: string
}

const ymd = (d: Date) => d.toLocaleDateString('en-CA')

// The most recent recap boundary (Sunday 17:00 local) at or before `now`, and
// the 7 days it covers (Monday..Sunday). Pure, for testing.
export function recapWindow(now: Date): { week: string; start: Date; end: Date } {
  const end = new Date(now)
  end.setHours(RECAP_HOUR, 0, 0, 0)
  const back = (end.getDay() - RECAP_DAY + 7) % 7
  end.setDate(end.getDate() - back)
  if (end > now) end.setDate(end.getDate() - 7)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  return { week: ymd(end), start, end }
}

export function recapDue(now: Date, lastWeek: string | null): boolean {
  return recapWindow(now).week !== lastWeek
}

export function readLatestRecap(): Recap | null {
  try {
    const files = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    const last = files[files.length - 1]
    return last ? JSON.parse(fs.readFileSync(path.join(DIR, last), 'utf-8')) as Recap : null
  } catch {
    return null
  }
}

// Everything the model gets to see for the window. Exported for testing.
export function gatherWeek(start: Date, end: Date): { daily: string; edited: string[]; changes: string[]; reading: string[] } {
  const from = ymd(start)
  const to = ymd(end)
  const notes = listAllNotes().filter(n => !isMetaNote(n.path))

  const dailies = notes
    .map(n => ({ n, date: /(\d{4}-\d{2}-\d{2})/.exec(path.basename(n.path))?.[1] }))
    .filter(x => x.date && /(^|\/)daily\//i.test(x.n.path) && x.date >= from && x.date <= to)
    .sort((a, b) => a.date!.localeCompare(b.date!))
  let budget = DAILY_BUDGET
  const daily: string[] = []
  for (const { n, date } of dailies) {
    if (budget <= 0) break
    const body = stripFrontmatter(readNote(n.path) ?? '').trim().slice(0, Math.min(budget, 4000))
    budget -= body.length
    if (body) daily.push(`### ${date}\n${body}`)
  }

  const edited = notes
    .filter(n => n.mtime >= start && n.mtime <= end && !/(^|\/)daily\//i.test(n.path))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, 40)
    .map(n => n.path.replace(/\.md$/, ''))

  const changes = readOperations(1000)
    .filter(op => { const t = Date.parse(op.ts); return t >= start.getTime() && t <= end.getTime() })
    .map(op => op.summary)
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 40)

  const reading = changes.filter(s => s.startsWith('Accepted from inbox: ')).map(s => s.slice('Accepted from inbox: '.length))
  return { daily: daily.join('\n\n'), edited, changes: changes.filter(s => !s.startsWith('Accepted from inbox: ')), reading }
}

// Remove a "### Heading" section (up to the next ### or the end). Pure, for testing.
export function dropSection(md: string, heading: string): string {
  const re = new RegExp(String.raw`^#{2,4}\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*$[\s\S]*?(?=^#{2,4}\s|(?![\s\S]))`, 'im')
  return md.replace(re, '').replace(/\n{3,}/g, '\n\n')
}

const G = ((globalThis as unknown as { __vaultRecap?: { running: Promise<Recap | null> | null } }).__vaultRecap ??= { running: null })

export function isRecapRunning(): boolean {
  return !!G.running
}

export function generateRecap(now = new Date()): Promise<Recap | null> {
  if (G.running) return G.running
  G.running = (async () => {
    const { week, start, end } = recapWindow(now)
    const w = gatherWeek(start, end)
    if (!w.daily && !w.edited.length && !w.changes.length && !w.reading.length) return null
    const list = (xs: string[]) => xs.length ? xs.map(x => `- ${x}`).join('\n') : '(none)'
    const text = await ollamaChat({
      role: 'writer',
      messages: [
        {
          role: 'system',
          content: 'You write a short weekly recap for one person from their own notes. Only use facts present in the input. ' +
            'Plain, specific, no filler, no praise. Use [[Note name]] links when you mention a note listed below.',
        },
        {
          role: 'user',
          content:
            `Week ${ymd(start)} to ${ymd(end)}.\n\nDaily notes:\n${w.daily || '(none)'}\n\n` +
            `Notes edited this week:\n${list(w.edited)}\n\nChanges made through the app:\n${list(w.changes)}\n\n` +
            `Reading kept from the inbox:\n${list(w.reading)}\n\n` +
            'Write the recap in Markdown with exactly these sections, skipping any that would be empty:\n' +
            '### What you worked on\n### Decisions\n### Open loops\n### New reading\n' +
            'Bullets, at most 5 per section, each one line. Open loops = things started or promised but not finished.',
        },
      ],
    })
    // Small models fill every section they're shown; drop "New reading" when
    // nothing was kept, rather than trust the instruction.
    const markdown = (w.reading.length ? text : dropSection(text, 'New reading')).trim()
    if (!markdown) return null
    const recap: Recap = { week, from: ymd(start), to: ymd(end), generatedAt: new Date().toISOString(), markdown }
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(path.join(DIR, `${week}.json`), JSON.stringify(recap, null, 2), 'utf-8')
    return recap
  })().finally(() => { G.running = null })
  return G.running
}

// Copy the latest recap into the vault as a note (create-only, guarded).
export function saveRecapNote(recap: Recap): string {
  const rel = `Knowledge/Recaps/Week ${recap.from} to ${recap.to}.md`
  const content =
    `---\ndate: ${recap.to}\ntype: review\ntags: [recap, weekly]\nconfidence: medium\nai-first: true\n---\n\n` +
    `## For future Claude\nWeekly recap for ${recap.from} to ${recap.to}, generated from that week's daily notes and changes.\n\n` +
    `${recap.markdown}\n`
  const g = checkWrite(null, content)
  if (g.blocked) throw new Error(g.blocked)
  const abs = resolveVaultPath(rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  try {
    fs.writeFileSync(abs, content, { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return rel // already saved
    throw err
  }
  recordOperation({ origin: 'recap', summary: `Saved weekly recap ${recap.from} to ${recap.to}`, changes: [{ action: 'create', path: rel }] })
  return rel
}
