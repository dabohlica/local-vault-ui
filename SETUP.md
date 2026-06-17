# Vault UI — Setup Guide

A **local-first** companion app for your Obsidian vault. It lets you chat with your notes,
auto-file new information, run knowledge workflows, and drop in documents — all powered by
**local AI (Ollama)**. Nothing leaves your machine: no OpenAI/Anthropic/Gemini, no cloud
vector DBs, no telemetry.

> **Vault data never leaves your device.** The only network call the app makes for AI is to
> Ollama on `localhost`. (The one exception is an optional automatic `git pull` on load, if your
> vault is a git repo — it degrades silently when you're offline.)

Works on **macOS and Windows**.

---

## 1. Prerequisites

Install these once:

| Tool | What for | Get it |
|------|----------|--------|
| **Node.js 18+** | runs the app | https://nodejs.org |
| **Ollama** | local AI models | https://ollama.com |
| **Git** *(optional)* | vault sync | https://git-scm.com |
| **Obsidian** *(optional)* | editing notes | https://obsidian.md |

**Hardware:** 16 GB RAM recommended (8 GB works with the smallest models). A vault of any size is fine.

After installing Ollama, make sure it's running:

```bash
ollama serve        # leave this running in the background
```

---

## 2. Install & start the app

```bash
git clone <repo-url> vault-ui
cd vault-ui
npm install
npm run dev
```

Open **http://localhost:3000**.

That's the whole install — **everything else is done in the app.** You do *not* edit any
config files.

---

## 3. First-run wizard (3 steps)

On first launch you land on a setup screen:

1. **Connect your vault** — paste the path to your Obsidian vault folder
   (e.g. `~/Documents/Second-Brain` on Mac, `C:\Users\you\Documents\Second-Brain` on Windows).
   It's validated live.

2. **Local AI models** — the app detects Ollama and shows which models you have. Click **Pull**
   on any that are missing (downloads with a progress bar — no terminal needed):
   - **Chat model** — `qwen2.5:3b` (fast, ~1.9 GB) — powers chat, curation, commands
   - **Embedding model** — `nomic-embed-text` (~270 MB) — powers search/retrieval
   - **Vision model** *(optional)* — `llama3.2-vision` (~7.8 GB) — only needed if you want to drop
     **images** and have them summarized/OCR'd. Skip it if you don't. (Lighter alternative:
     `llava:7b`, ~4.7 GB — faster but noticeably less accurate on text-heavy images.)

3. **Build the index** — one click embeds your notes locally so chat can find and cite them.

When the three steps are green, click **Enter your vault**. You can change the vault or swap
models anytime later from **Settings** in the sidebar.

### Recommended models by machine

| RAM | Chat model | Notes |
|-----|------------|-------|
| 16 GB | `qwen2.5:3b` | best speed/quality balance (default) |
| 8 GB | `qwen2.5:1.5b` | lighter, a bit less capable |
| 32 GB+ | `gemma4` / `qwen2.5:7b` | higher quality, slower |

Swap any of these in Settings — no reinstall.

---

## 4. What you get

Once set up, the sidebar gives you:

- **Dashboard** — vault stats, recent files, quick capture.
- **Chat** — ask questions about your vault in natural language. It retrieves the most relevant
  notes locally and answers **with clickable citations** to the source notes. (e.g. *"What did we
  decide about the client audit?"*)
- **Curate** — paste raw notes or a meeting summary; the model proposes structured updates across
  the right notes (project page, daily note, people, decisions). You review a **diff per file** and
  approve before anything is written.
- **Commands** — 10 one-click knowledge workflows, all local:
  Daily Note · Meeting · Person · Project · Task · Dev Log · Board · Recap · Synthesize · **Vault Health**
  (a structural scan that flags missing frontmatter, broken links, etc.). Each proposes changes for
  your approval first.
- **Drag & drop ingest** — drop a file anywhere on the window:
  - **.md / .txt / .pdf** → text is extracted and turned into a clean, structured note
  - **images** → the vision model describes/OCRs them into a note (image saved to `Assets/`)
  - You always review the proposed note before it's saved.
- **Explorer** — browse and preview your vault with rendered Markdown and working `[[wikilinks]]`.
- **Search** — fast full-text search across notes.
- **Light / dark theme** toggle, and an automatic vault `git pull` on load (if applicable).

**Nothing is ever written without your approval** — every AI action shows a diff you confirm first.

---

## 5. Day-to-day

- After editing notes (in Obsidian or here), click **Sync Index** in the top bar so chat stays current.
- Change vault/models anytime in **Settings**.
- Switching vaults automatically resets the search index so vaults never mix.

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Ollama isn't running" in the wizard | Run `ollama serve`, then click **Re-check**. |
| Chat/commands are slow | Expected on first call (model loads into memory). Use a smaller chat model in Settings. |
| A model won't pull | Pull it manually: `ollama pull qwen2.5:3b`, then refresh. |
| Dropped image just saved to Assets, no note | The **vision model** isn't installed — pull `llama3.2-vision` in Settings. |
| Image note got details wrong | Small vision models OCR imperfectly — always review the diff. Use `llama3.2-vision` over `llava:7b` for text-heavy images. |
| Scanned PDF produced an empty note | Image-only PDFs have no text layer; it falls back to a raw save. |
| Port 3000 in use | `npm run dev -- -p 3001` and open http://localhost:3001. |

---

## 7. Privacy summary

**Allowed & used:** local Ollama inference, local SQLite index, your local vault files, your own git remote.
**Never used:** external AI APIs, cloud vector databases, third-party telemetry.

Your knowledge stays on your machine.
