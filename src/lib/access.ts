// Request-origin rules for the API (used by src/middleware.ts). Pure functions,
// edge-runtime safe (no Node imports), so they're unit-testable.
//
// Network reach is handled by binding (127.0.0.1, or the Tailscale IP for the
// :lan scripts) plus Tailscale's device ACLs. These checks close the two holes
// binding can't: a malicious web page open in YOUR browser
//   - POSTing to http://localhost:3000/api/... (CSRF) → Origin check
//   - rebinding its own domain to 127.0.0.1 to read responses → Host check

// Host header (may include :port, IPv6 in brackets) → bare lowercase hostname.
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'))
  return h.replace(/:\d+$/, '')
}

function isIpLiteral(name: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(':')
}

// DNS rebinding needs an attacker-controlled NAME resolving to us, so IP literals
// are always fine; names must be loopback, this machine's MagicDNS name
// (*.ts.net), or listed in VAULT_ALLOWED_HOSTS (comma-separated, e.g. "mac.local").
export function isAllowedHost(host: string | null, extra: string[] = []): boolean {
  if (!host) return false
  const name = hostnameOf(host)
  if (!name) return false
  if (isIpLiteral(name)) return true
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  if (name.endsWith('.ts.net')) return true
  return extra.some(e => e.trim().toLowerCase() === name)
}

// State-changing requests must come from our own pages. Browsers always send
// Origin on cross-origin POST/PUT/DELETE; non-browser clients (curl, cron) send
// none and are allowed — they can't be driven by a web page. A reverse proxy
// (e.g. `tailscale serve`) may pass the public name in X-Forwarded-Host; a page
// can't forge that header cross-origin without a CORS preflight we never grant.
export function isSameOriginRequest(
  method: string,
  origin: string | null,
  host: string | null,
  forwardedHost: string | null = null,
): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  if (!origin) return true
  if (origin === 'null') return false
  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return false
  }
  return [host, forwardedHost].some(h => !!h && h.split(',')[0].trim().toLowerCase() === originHost)
}
