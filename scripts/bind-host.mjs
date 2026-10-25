// Prints the address the `:lan` scripts bind to: this machine's Tailscale IP, so
// the app is reachable from your tailnet devices (governed by Tailscale ACLs) but
// NOT from whatever Wi-Fi/LAN you happen to be on. Override with VAULT_BIND
// (e.g. VAULT_BIND=0.0.0.0 to deliberately expose it on the local network).
// Falls back to 127.0.0.1 with a warning when Tailscale isn't up.
import os from 'node:os'

function tailscaleIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const [x, y] = a.address.split('.').map(Number)
      if (x === 100 && y >= 64 && y <= 127) return a.address // 100.64.0.0/10
    }
  }
  return null
}

const host = process.env.VAULT_BIND || tailscaleIp()
if (!host) {
  console.error('  Tailscale IP not found — binding to 127.0.0.1 (this machine only). Start Tailscale, or set VAULT_BIND.')
}
process.stdout.write(host || '127.0.0.1')
