import { describe, it, expect } from 'vitest'
import { canonicalUrl, itemId, parseFeed, titleKey } from '@/lib/feeds'
import { isPrivateAddress } from '@/lib/egress'
import { validateSource, sourceUrl, allowedHosts } from '@/lib/sources'

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<title>Blog</title><link>https://blog.example.com</link>
<item><title>Hybrid search &amp; rerankers</title><link>https://blog.example.com/p/1?utm_source=rss</link>
<description>&lt;p&gt;BM25 &lt;b&gt;plus&lt;/b&gt; dense.&lt;/p&gt;</description><pubDate>Fri, 24 Oct 2026 08:00:00 GMT</pubDate>
<dc:creator>Ada Lovelace</dc:creator></item>
<item><title><![CDATA[CDATA & <b>bold</b> title]]></title><link>https://blog.example.com/p/2</link>
<description><![CDATA[<p>Raw <i>HTML</i> &amp; more</p>]]></description></item>
<item><title>No link at all</title></item>
</channel></rss>`

const ARXIV = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2410.12345v2</id><published>2026-10-20T17:59:00Z</published>
<title>Contextual Retrieval
  for Personal Knowledge</title>
<summary>  We study retrieval.
  It works. </summary>
<author><name>Jane Doe</name></author><author><name>John Roe</name></author>
<link href="http://arxiv.org/abs/2410.12345v2" rel="alternate" type="text/html"/>
<link title="pdf" href="http://arxiv.org/pdf/2410.12345v2" rel="related" type="application/pdf"/>
</entry></feed>`

describe('parseFeed', () => {
  it('reads RSS: entity-encoded HTML, CDATA, dc:creator, dates; skips entries without a link', () => {
    const e = parseFeed(RSS)
    expect(e).toHaveLength(2)
    expect(e[0]).toMatchObject({ title: 'Hybrid search & rerankers', summary: 'BM25 plus dense.', authors: ['Ada Lovelace'], published: '2026-10-24T08:00:00.000Z' })
    expect(e[1]).toMatchObject({ title: 'CDATA & bold title', summary: 'Raw HTML & more', published: null })
  })
  it('reads arXiv Atom: alternate link, authors, collapsed whitespace', () => {
    const [p] = parseFeed(ARXIV)
    expect(p.url).toBe('http://arxiv.org/abs/2410.12345v2')
    expect(p.title).toBe('Contextual Retrieval for Personal Knowledge')
    expect(p.summary).toBe('We study retrieval. It works.')
    expect(p.authors).toEqual(['Jane Doe', 'John Roe'])
  })
})

describe('dedupe identity', () => {
  it('treats arXiv versions and abs/pdf as the same paper', () => {
    expect(canonicalUrl('http://arxiv.org/abs/2410.12345v2')).toBe('arxiv:2410.12345')
    expect(itemId('https://arxiv.org/pdf/2410.12345v1')).toBe(itemId('http://arxiv.org/abs/2410.12345'))
  })
  it('drops tracking params, www, fragments and trailing slashes', () => {
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a?a=1&b=2')
  })
  it('normalizes titles', () => {
    expect(titleKey('Über  RAG: a Survey!')).toBe(titleKey('uber rag a survey'))
  })
})

describe('isPrivateAddress (SSRF guard)', () => {
  it('blocks loopback, private, link-local, CGNAT/Tailscale and ULA', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '100.101.102.103', '0.0.0.0', '::1', 'fd7a:115c::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })
  it('allows public addresses', () => {
    for (const ip of ['151.101.1.140', '128.84.21.199', '2a04:4e42::81']) expect(isPrivateAddress(ip), ip).toBe(false)
  })
})

describe('sources', () => {
  it('validates input and builds the arXiv API URL', () => {
    expect(validateSource({ kind: 'arxiv', name: 'x' })).toMatch(/query/)
    expect(validateSource({ kind: 'rss', name: 'x', url: 'file:///etc/passwd' })).toMatch(/http/)
    const s = validateSource({ kind: 'arxiv', name: 'IR', section: 'Deep Research!', query: 'cat:cs.IR', maxItems: 500 })
    if (typeof s === 'string') throw new Error(s)
    expect(s.section).toBe('deep-research')
    expect(s.maxItems).toBe(100)
    expect(sourceUrl(s)).toBe('https://export.arxiv.org/api/query?search_query=cat%3Acs.IR&sortBy=submittedDate&sortOrder=descending&max_results=100')
  })
  it('allows exactly the hosts of enabled sources', () => {
    const hosts = allowedHosts([
      { id: 'a', kind: 'rss', name: 'a', section: 's', url: 'https://Feeds.Example.com/x', enabled: true, maxItems: 10 },
      { id: 'b', kind: 'rss', name: 'b', section: 's', url: 'https://off.example.com/x', enabled: false, maxItems: 10 },
    ])
    expect(Array.from(hosts)).toEqual(['feeds.example.com'])
  })
})
