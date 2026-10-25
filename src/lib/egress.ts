import fs from 'fs'
import path from 'path'
import dns from 'dns/promises'
import net from 'net'

// The ONLY module that talks to the internet (ollama.ts talks to loopback model
// servers only). It exists for the feed reader: GET-only, no request body, so
// nothing from the vault can leave through it — the only thing sent is the URL of
// a feed you configured (for arXiv: your search query). Guard rails:
//   - the first hop must be a host from your configured sources (allowedHosts)
//   - no private/loopback/link-local targets (DNS-resolved), so a feed URL or a
//     redirect can't reach Ollama, the MLX server or this app (SSRF)
//   - size + time caps, manual redirects (each hop re-checked)
//   - every request is logged to data/egress.jsonl
// Residual risk: DNS can change between our lookup and fetch's own lookup; the
// worst case is a GET to a local port, which the local servers' APIs ignore.

const LOG_PATH = path.join(process.cwd(), 'data', 'egress.jsonl')
const LOG_MAX_BYTES = 2_000_000
const MAX_REDIRECTS = 4
const USER_AGENT = 'vault-ui-feed-reader/0.1 (personal, single-user)'

export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT — Tailscale lives here
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (net.isIPv6(ip)) {
    const h = ip.toLowerCase()
    return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
  }
  return true // not an IP at all — refuse rather than guess
}

function log(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    try { if (fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + '.1') } catch { /* no log yet */ }
    fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf-8')
  } catch { /* logging is best-effort */ }
}

async function assertPublicTarget(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Unsupported protocol ${url.protocol}`)
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address)
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error(`Refusing to fetch a private/local address (${host})`)
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (declared > maxBytes) throw new Error(`Response too large (${declared} bytes)`)
  if (!res.body) return ''
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new Error(`Response larger than ${maxBytes} bytes`) }
    parts.push(value)
  }
  return Buffer.concat(parts).toString('utf-8')
}

export async function egressGet(
  rawUrl: string,
  opts: { allowedHosts: Set<string>; purpose: string; maxBytes?: number; timeoutMs?: number },
): Promise<string> {
  const started = Date.now()
  const maxBytes = opts.maxBytes ?? 3_000_000
  let url = new URL(rawUrl)
  let status = 0
  try {
    if (!opts.allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error(`${url.hostname} is not one of your configured sources`)
    }
    for (let hop = 0; ; hop++) {
      await assertPublicTarget(url)
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      })
      status = res.status
      const location = res.headers.get('location')
      if (status >= 300 && status < 400 && location) {
        if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects')
        url = new URL(location, url)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${status}`)
      const body = await readCapped(res, maxBytes)
      log({ purpose: opts.purpose, url: url.toString(), status, bytes: body.length, ms: Date.now() - started })
      return body
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log({ purpose: opts.purpose, url: url.toString(), status, ms: Date.now() - started, error: message })
    throw new Error(message)
  }
}
