# Vault UI — The Complete Guide (Install · Setup · Start)

A **local-first** companion app for an Obsidian-style vault. Chat with your notes, let a local
model curate and reorganize them, drop in documents, and run knowledge workflows — all powered by
**local AI ([Ollama](https://ollama.com))**. Nothing leaves your machine: no OpenAI/Anthropic/Gemini,
no cloud vector DBs, no telemetry.

> **Vault data never leaves your device.** The only AI network call is to Ollama on `localhost`.
> (The single exception is an optional automatic `git pull` on load if your vault is a git repo — it
> degrades silently when offline.)

Works on **macOS and Windows**. This one guide covers everything; **pick your path in Step 4.**
Want it on your phone too? See **[MOBILE.md](MOBILE.md)** (Tailscale/Wi-Fi access + GitHub sync).

---

## 1. Prerequisites (install once)

| Tool | What for | Get it |
|------|----------|--------|
| **Node.js 18+** | runs the app | https://nodejs.org |
| **Ollama** | local AI models | https://ollama.com |
| **Git** *(optional)* | vault sync | https://git-scm.com |
| **Obsidian** *(optional)* | editing notes | https://obsidian.md |

**Hardware:** 16 GB RAM recommended; 8 GB works with the smallest models. Any vault size is fine.

After installing Ollama, make sure it's running (leave it in the background):

```bash
ollama serve
```

---

## 2. Install & start the app

```bash
git clone <repo-url> vault-ui
cd vault-ui
npm install
npm run dev
```

Open **http://localhost:3000**. That's the entire install — **everything else is done in the app;
you never edit config files.** (Port in use? `npm run dev -- -p 3001`.)

---

## 3. Connect Ollama + pick models (same for everyone)

On first launch you land on the setup wizard.

**Step 1 — Connect your vault.** Paste the path to your vault folder
(`~/Documents/Second-Brain` on Mac, `C:\Users\you\Documents\Second-Brain` on Windows). Validated live.
*If the folder is empty or new, see Path B below — the wizard will offer to initialize it.*

**Step 2 — Local AI models.** The app detects Ollama, lists the models already on your machine, and
offers a one-click **Pull** (with a live progress bar) for any you're missing. You're never locked to
our picks — type any Ollama model name.

- **Chat model** — powers chat, curation, commands, edits
- **Embedding model** — `nomic-embed-text` (~270 MB) — powers search/retrieval (**required**)
- **Vision model** *(optional)* — only for dropping **images** to be OCR'd/summarized

**8 GB RAM? One model for everything:** `qwen3.5:4b` (~3.4 GB) is multimodal — set it as *both* chat
and vision. With `nomic-embed-text` that's the whole setup (~3.7 GB).

| Need | Suggested |
|------|-----------|
| One model, 8 GB | `qwen3.5:4b` (chat + vision) |
| Lightest | `qwen3.5:2b` |
| Text chat, 16 GB (default) | `qwen2.5:3b` |
| Higher quality, 32 GB+ | `qwen2.5:7b` |
| Embeddings (required) | `nomic-embed-text` |
| Best image OCR | `llama3.2-vision` |

> **Edit/curation quality scales with the chat model.** The 3B default is fast but rough at
> multi-file edits; a 7B+ model produces noticeably cleaner proposals. Swap anytime in Settings.

---

## 4. Choose your path

### Path A — You already have a vault full of notes

1. In **Step 1**, point at your existing vault folder.
2. In **Step 3 — Build the index**, click **Build index**. It embeds every note locally so chat can
   find and cite them. (Large vault? It runs once; after that it stays fresh automatically — see §6.)
3. Click **Enter your vault**. Done — go to **Chat** and ask something.
4. *Recommended first pass:* **Commands → Vault Health → Auto-fix structure** to bring older notes up
   to the AI-first convention (adds missing frontmatter/preamble, resolves broken links), then
   **Commands → Interlink** to grow `[[wikilink]]` connections. Both show diffs you approve.

> Your notes don't have to follow any convention to start — chat and search work on anything. The
> health/interlink passes are optional polish.

### Path B — Starting from scratch (empty/new vault, or notes scattered across tools)

1. **Make an empty folder** for your vault (e.g. `~/Documents/My-Vault`) and point Step 1 at it.
2. The wizard detects it's empty and offers **Initialize vault** — one click scaffolds the AI-first
   skeleton (`_CLAUDE.md` conventions file + `Projects/ Daily/ Logs/ People/ Knowledge/ Assets/`).
   It never overwrites anything.
3. **Bring in your existing notes** (if they're spread across other tools): sidebar → **Import**.
   - First **export** from each source (almost everything exports to one of these): Markdown, `.txt`,
     HTML (Notion/Evernote), Evernote `.enex` (expands to one note per entry), `.csv`, `.json`, PDF,
     `.docx` (Google Docs/Word).
   - Click **Choose a folder**, point at the export folder. The app structures the files into
     AI-first notes **6 at a time** and shows each batch as diffs to **approve** before writing.
     Re-run "Process next" until the queue is empty.
4. **Build the index** (Step 3 / top-bar **Sync Index**) so the imported notes are searchable.
5. **Connect them:** **Commands → Interlink** (adds wikilinks + creates stubs for dangling links),
   then **Vault Health → Auto-fix** for any structural gaps.
6. From here just **chat** and **add** — drop files, use Edit mode, or the Commands to keep growing it.

> No vault to import at all? Skip step 3 — just initialize and start writing via **Chat → Edit vault**,
> the **Commands**, or by dropping documents.

---

## 5. Using it day-to-day

The sidebar:

- **Chat** — ask your vault (grounded answers with clickable citations), or flip the **Edit vault**
  toggle to *change* it conversationally ("add a note for Max, CTO at VD"; "move the decisions into
  the project page"). Edits are shown as diffs to approve. Conversations are organized into
  **sessions** (New chat + a recent-list rail), auto-cleared after 7 days.
- **Curate** — paste raw notes / a meeting summary; get structured multi-file updates to review.
- **Import** — bulk-build from a folder of exports (Path B).
- **Review** — proposals the overnight caretaker queued for you (see §6).
- **Commands** — 10 one-click local workflows: Daily · Meeting · Person · Project · Task · Dev Log ·
  Board · Recap · Synthesize · **Vault Health** + **Interlink**.
- **Explorer / Search** — browse with rendered Markdown + working `[[wikilinks]]`, and full-text search.
- **Drag & drop** anywhere — `.md/.txt/.pdf` → structured note; **images** → OCR'd via the vision
  model. A compose step lets you attach **high-priority notes** that steer the summary.
- **Settings** — change vault/models, the caretaking schedule, and **Diagnostics** (see §6).

**Nothing is ever written without your approval** — every AI action is a diff you confirm first.

---

## 6. Keeping the index fresh & automatic caretaking

- **Live indexing.** A watcher re-indexes ~3s after any `.md` changes — *including edits made in
  Obsidian*. It also syncs on chat and on a timer. You rarely need the manual **Sync Index** button.
- **Automatic caretaking** (Settings → *Automatic caretaking*). While the app is open it keeps the
  index fresh and, at a nightly hour, **auto-applies safe deterministic fixes** (frontmatter/preamble)
  and **queues** a model-driven curation proposal into **Review**. It runs only while the app is open
  (with catch-up on next launch). For true 24/7, point an OS cron at it:

  ```bash
  # nightly full caretake at 03:00, app open or not
  0 3 * * * curl -s -X POST http://localhost:3000/api/caretake -H 'Content-Type: application/json' -d '{"mode":"full"}'
  ```

- **Diagnostics** (Settings → **Diagnostics**). If notes aren't showing up in chat, this is your
  first stop: it compares the **vault path vs. notes-on-disk vs. indexed notes vs. chunks**, shows the
  embed model + Ollama status and the exact index DB path, lists any unindexed notes, and gives a
  plain-language verdict with a one-click **Rebuild index**.

---

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Ollama isn't running" in the wizard | Run `ollama serve`, then **Re-check**. |
| Chat says "I don't know" about a note that exists | Open **Settings → Diagnostics**. Usually the vault path is wrong/nested, the embed model isn't installed, or the index needs a rebuild. |
| Chunk totals don't change after adding notes | Same — **Diagnostics**. Often the app was launched from a different working directory (different `data/index.sqlite`); launch it from the `vault-ui` folder. |
| New API routes 404 after `git pull` | Restart `npm run dev` — Next.js doesn't always hot-register brand-new route files. |
| Chat/commands are slow | Expected on the first call (model loads into RAM). Use a smaller chat model, or a faster machine. |
| A model won't pull (`...r2.cloudflarestorage.com: no such host`) | DNS can't reach Ollama's CDN. Switch DNS to `1.1.1.1`/`8.8.8.8`, disable VPN/filter, or change networks, then re-pull. Or pull manually: `ollama pull <model>`. |
| Edit/curate output is clumsy | Small-model limitation — you're reviewing a diff, so reject/adjust. A 7B+ chat model is much better. |
| Dropped image just saved to Assets, no note | The **vision model** isn't installed — pull one (e.g. `qwen3.5:4b` or `llama3.2-vision`) in Settings. |
| Scanned PDF produced an empty note | Image-only PDFs have no text layer; it falls back to a raw save. |
| Port 3000 in use | `npm run dev -- -p 3001` → http://localhost:3001. |

---

## 8. Privacy summary

**Used:** local Ollama inference, a local SQLite index, your local vault files, your own git remote.
**Never used:** external AI APIs, cloud vector databases, third-party telemetry. The only module that
makes outbound requests is `src/lib/ollama.ts`, and it asserts the host is `localhost` before every
call.

Your knowledge stays on your machine.
