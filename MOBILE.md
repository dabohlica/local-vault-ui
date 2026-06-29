# Using Vault UI from your phone

Vault UI is a **server app** — it reads your vault from the filesystem and runs AI through
**Ollama on the same machine**. So the model and the app stay on your **laptop**; your phone is just
a browser pointed at it. That keeps the privacy guarantee intact (vault data never leaves your
devices) and means you don't need a powerful phone.

> **Why not run the model on the phone?** Ollama + this Next.js server + a native SQLite module on a
> phone isn't a lightweight option, and the app is deliberately hard-wired to talk to Ollama on
> `localhost`. Keep the heavy lifting on the laptop.

There are two independent things you might want, and you can do either or both:

| Goal | What you set up |
|------|-----------------|
| **Use the full app (Chat, Curate, Commands…) on your phone** | Reach the laptop's web server from the phone — §1 (Tailscale) or §2 (same Wi-Fi). |
| **Read/edit the notes themselves on your phone, offline** | Sync the vault through GitHub and open it in Obsidian mobile — §3. |

---

## 1. Reach the app from anywhere — Tailscale (recommended)

[Tailscale](https://tailscale.com) is a free, ~2-minute install that puts your laptop and phone on
a private encrypted network. The phone can then reach the laptop from any network (home Wi-Fi,
cellular, a café) **without exposing anything to the public internet**.

1. Install Tailscale on the **laptop** and the **phone** (App Store / Play Store) and sign in to the
   same account on both.
2. On the laptop, note its Tailscale IP (`tailscale ip -4`, looks like `100.x.y.z`).
3. Start the app **bound to all interfaces** (the default `npm run dev` only listens on localhost):

   ```bash
   npm run dev:lan      # development
   # or, for the production build:
   npm run build && npm run start:lan
   ```

   On startup it prints a banner listing every reachable URL (Tailscale, Wi-Fi/LAN, local)
   **plus a scannable QR code** for the best one.

4. **Scan the QR with your phone's camera** — it opens the app directly. (Or type the
   `http://100.x.y.z:3000` address by hand.) That's it.

The laptop must be **awake and running the app** for the phone to connect — it's the server. Ollama
stays exactly as-is (the app calls it on the laptop's own localhost); nothing about your AI setup
changes.

### Make it feel like an app (optional)
The app ships a web manifest, so from the phone browser choose **"Add to Home Screen"**. It then
launches full-screen from an icon like a native app. (No offline mode — it's a thin client, so it
only works while the laptop is reachable.)

---

## 2. Same-Wi-Fi only (simplest, no extra software)

If you only need phone access while on the **same Wi-Fi** as the laptop:

1. `npm run dev:lan` (or `npm run start:lan`). The startup banner prints the `Wi-Fi/LAN` URL and a
   **QR code** — scan it with your phone's camera to open the app. (To find the IP manually:
   macOS `ipconfig getifaddr en0`; Windows `ipconfig` → IPv4 Address, then open
   `http://192.168.x.x:3000`.)

No access when you're away from home, and a firewall prompt may ask you to allow incoming
connections on port 3000. For anywhere-access, use Tailscale (§1).

> **Which URL the QR uses:** it prefers Tailscale (works anywhere), falling back to your LAN IP.
> Force a choice with `VAULT_QR=lan` (or `tailscale` / `local`) before the command, e.g.
> `VAULT_QR=lan npm run dev:lan`. On a non-default port, set `PORT=3001 npm run dev:lan -- -p 3001`.

---

## 3. Share vault knowledge through GitHub

Your vault is just Markdown files, so GitHub makes a perfect private sync hub between the
laptop (where the AI enriches notes) and the phone (where you capture and read).

### One-time setup
1. Create a **private** GitHub repo for the vault.
2. In the vault folder on the laptop:

   ```bash
   cd /path/to/your/vault
   git init
   git add -A && git commit -m "initial vault"
   git branch -M main
   git remote add origin git@github.com:<you>/<vault-repo>.git
   git push -u origin main          # sets the upstream the app needs
   ```

That upstream is what the app's sync buttons rely on.

### How the app syncs
- **On every load** the app automatically **pulls** the latest from GitHub, then **pushes** any
  local edits back up (it commits pending changes first — nothing is discarded). If you're offline
  or there's no remote, it silently does nothing.
- **Top bar** has manual **Git Pull** and **Git Push** buttons (and **Sync Index** to re-embed).
  Use **Git Pull** to grab notes you wrote on your phone, **Git Push** to publish the laptop's AI
  edits.
- If a push is **rejected**, the remote has changes you don't have yet — hit **Git Pull** first, then
  **Git Push**. Genuine content conflicts are reported and left for you to resolve in git; the vault
  is never left half-merged.

### Read & edit on the phone
Install **[Obsidian](https://obsidian.md) mobile** plus a Git plugin and point it at the same repo:
- **iOS:** [Working Copy](https://workingcopy.app) clones the repo; open that folder as an Obsidian
  vault.
- **Android:** the community **obsidian-git** plugin pulls/pushes on a schedule.

Now the flow is: capture on the phone → push to GitHub → the laptop pulls, the local model curates
and interlinks → push back → phone pulls. GitHub is the shared spine; the AI features live on the
laptop.

---

## Quick reference

| You want… | Do this |
|-----------|---------|
| App on phone, anywhere | Tailscale (§1) + `npm run dev:lan`, open `http://100.x.y.z:3000` |
| App on phone, same Wi-Fi | `npm run dev:lan`, open `http://192.168.x.x:3000` |
| Notes on phone, offline | GitHub repo (§3) + Obsidian mobile + Git plugin |
| Publish laptop AI edits | Top-bar **Git Push** (or just reload — it auto-pushes) |
