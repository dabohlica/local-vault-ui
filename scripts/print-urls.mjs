// Startup banner for the `:lan` scripts: prints every address the phone can use
// to reach the app, plus a scannable QR for the best one. Runs before `next`,
// so the URLs/QR sit at the top of the dev output.
//
// Local-first note: this only reads local network interfaces and renders a QR
// in your terminal. No network calls, nothing leaves the machine.
import os from 'node:os'

const port = process.argv[2] || process.env.PORT || '3000'

// Tailscale hands out addresses in the 100.64.0.0/10 CGNAT range. Detecting by
// range is cross-platform and needs no `tailscale` CLI.
function isTailscale(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

// Rank private LAN ranges so we surface the most likely Wi-Fi address first.
function lanRank(ip) {
  if (ip.startsWith('192.168.')) return 0
  if (ip.startsWith('10.')) return 1
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2
  return 3
}

function collect() {
  let tailscale = null
  const lans = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (isTailscale(a.address)) tailscale ??= a.address
      else lans.push(a.address)
    }
  }
  lans.sort((x, y) => lanRank(x) - lanRank(y))
  return { tailscale, lan: lans[0] ?? null }
}

const detected = collect()
const url = (host) => `http://${host}:${port}`

// Mirror scripts/bind-host.mjs: by default the server binds ONLY the Tailscale IP
// (not the Wi-Fi/LAN, not localhost). VAULT_BIND=0.0.0.0 opts back into LAN.
const bind = process.env.VAULT_BIND || detected.tailscale || '127.0.0.1'
const all = bind === '0.0.0.0'
const tailscale = all || bind === detected.tailscale ? detected.tailscale : null
const lan = all ? detected.lan : null

const rows = []
if (tailscale) rows.push(['Tailscale', url(tailscale), 'your tailnet devices, from anywhere'])
if (lan) rows.push(['Wi-Fi/LAN', url(lan), 'ANYONE on this network — VAULT_BIND=0.0.0.0'])
if (all || bind === '127.0.0.1') rows.push(['Local', url('localhost'), 'this machine'])
else if (!tailscale) rows.push(['Bound', url(bind), 'VAULT_BIND'])

// Which URL the QR encodes. Override with VAULT_QR=tailscale|lan|local.
const pref = (process.env.VAULT_QR || '').toLowerCase()
const qrHost =
  pref === 'tailscale' ? tailscale :
  pref === 'lan' ? lan :
  pref === 'local' ? 'localhost' :
  tailscale || lan || bind
const qrUrl = url(qrHost || bind)

const label = (s) => s.padEnd(10)
console.log('\n  Vault UI — open on your phone:\n')
for (const [name, link, hint] of rows) {
  console.log(`    ${label(name)} ${link}  (${hint})`)
}

// Render a QR for the best URL. Degrade to text-only if the optional dep is
// missing or rendering fails — never let the banner break `npm run dev:lan`.
try {
  const { default: qrcode } = await import('qrcode-terminal')
  console.log(`\n  Scan to open ${qrUrl} :\n`)
  qrcode.generate(qrUrl, { small: true }, (qr) => {
    console.log(qr.replace(/^/gm, '    '))
  })
} catch {
  console.log(`\n  (install qrcode-terminal for a scannable QR — or just type ${qrUrl})`)
}

if (!tailscale) {
  console.log('  Tip: install Tailscale on this laptop + your phone for access away from home.\n')
}
