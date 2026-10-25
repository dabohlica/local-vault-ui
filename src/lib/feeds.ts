import crypto from 'crypto'
import { decodeEntities, htmlToText } from '@/lib/extract'

// Feed parsing for the inbox: RSS 2.0, Atom and the arXiv API (which is Atom).
// Regex-based like extract.ts — feeds are small, and a forgiving scan copes with
// the malformed XML real feeds ship better than a strict parser does.

export type FeedEntry = {
  title: string
  url: string
  summary: string
  published: string | null // ISO
  authors: string[]
}

const MAX_SUMMARY = 4000

// Text of the first <name …>…</name> (namespace prefix allowed, e.g. dc:creator).
function tagText(block: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i')
  const m = re.exec(block)
  return m ? m[1] : null
}

function allTagTexts(block: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi')
  return Array.from(block.matchAll(re), m => m[1])
}

// XML text → plain text. CDATA holds raw HTML; otherwise the HTML is entity-encoded
// once by the XML layer, so decode that first, then strip tags.
function plain(raw: string | null): string {
  if (!raw) return ''
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  const html = cdata ? cdata[1] : decodeEntities(raw)
  return htmlToText(html).replace(/\s+/g, ' ').trim()
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null
}

// Atom: <link rel="alternate" href> (or a link without rel); RSS: <link>url</link>.
function entryLink(block: string): string {
  const links = Array.from(block.matchAll(/<link\b[^>]*\/?>/gi), m => m[0])
  const alt = links.find(l => attr(l, 'href') && (!attr(l, 'rel') || attr(l, 'rel') === 'alternate'))
  if (alt) return attr(alt, 'href')!
  const text = plain(tagText(block, 'link'))
  if (/^https?:\/\//.test(text)) return text
  const guid = plain(tagText(block, 'guid')) || plain(tagText(block, 'id'))
  return /^https?:\/\//.test(guid) ? guid : ''
}

function toIso(raw: string): string | null {
  const t = Date.parse(raw.trim())
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function parseFeed(xml: string): FeedEntry[] {
  const blocks = Array.from(xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi), m => m[2])
  const out: FeedEntry[] = []
  for (const block of blocks) {
    const title = plain(tagText(block, 'title'))
    const url = entryLink(block)
    if (!title || !url) continue
    const summary = plain(tagText(block, 'summary') ?? tagText(block, 'description') ?? tagText(block, 'encoded') ?? tagText(block, 'content'))
    const date = tagText(block, 'published') ?? tagText(block, 'pubDate') ?? tagText(block, 'date') ?? tagText(block, 'updated')
    const authors = [
      ...allTagTexts(block, 'author').map(a => plain(tagText(a, 'name') ?? a)),
      ...allTagTexts(block, 'creator').map(plain),
    ].filter(Boolean)
    out.push({
      title: title.slice(0, 300),
      url,
      summary: summary.slice(0, MAX_SUMMARY),
      published: date ? toIso(plain(date)) : null,
      authors: Array.from(new Set(authors)).slice(0, 12),
    })
  }
  return out
}

const ARXIV_ID = /arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(?:v\d+)?/i
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source)$/i

// Stable identity for de-duplication across feeds: arXiv papers by id (any
// version, abs or pdf), everything else by URL minus tracking noise.
export function canonicalUrl(raw: string): string {
  const arxiv = ARXIV_ID.exec(raw)
  if (arxiv) return `arxiv:${arxiv[1].toLowerCase()}`
  try {
    const u = new URL(raw)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    for (const k of Array.from(u.searchParams.keys())) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k)
    u.searchParams.sort()
    return u.toString().replace(/\/(\?|$)/, '$1')
  } catch {
    return raw.trim()
  }
}

export function itemId(url: string): string {
  return crypto.createHash('sha256').update(canonicalUrl(url)).digest('hex').slice(0, 20)
}

// Same story under a different URL (syndication, arXiv listing vs. blog post).
export function titleKey(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff]+/g, ' ').trim()
}
