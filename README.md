# Vault UI — Local RAG + Curation for any Obsidian Vault

A local, single-user web app for browsing, searching, querying, and curating an
Obsidian vault. All AI runs **locally via [Ollama](https://ollama.com)** — vault data
never leaves the device. Point it at *your* vault; nothing is hardcoded.

## Quickstart (for colleagues)

```bash
# 1. Install Ollama (one time) — https://ollama.com — then make sure it's running:
ollama serve            # leave running in the background

# 2. Get the app
git clone <repo-url> vault-ui && cd vault-ui
npm install
npm run dev             # opens http://localhost:3000
```

That's it — **the app walks you through the rest.** On first launch you land on a 3-step
setup wizard:

1. **Connect your vault** — paste the path to your Obsidian folder (e.g. `~/Documents/Second-Brain`). Validated live.
2. **Local AI models** — it detects Ollama and offers a one-click **Pull** for any missing model (chat + embeddings), with download progress. No terminal needed.
3. **Build the index** — one click embeds your notes locally so Chat can cite them.

When all three are green, click **Enter your vault**. You can change the vault or models
anytime from **Settings** in the sidebar. No `.env` editing required.

## Security boundary (read this)

**Allowed:** local inference (Ollama), local storage (SQLite), the local vault filesystem.

**Not allowed / not present in the codebase:** OpenAI / Anthropic / Gemini APIs, external
vector databases, external telemetry. The only module that makes outbound HTTP requests is
[`src/lib/ollama.ts`](src/lib/ollama.ts), and it asserts the target host is `localhost`
(`127.0.0.1`/`::1`) before every call. Everything else is filesystem-only.

> Vault data NEVER leaves the device.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Ollama: `qwen2.5:3b` (chat) + `nomic-embed-text` (embeddings)
- `better-sqlite3` for the local embedding index (cosine similarity over stored chunk vectors)

## Configuration

All config is set **in the app** (the setup wizard / Settings) and stored locally in
`data/config.json` (gitignored): vault path, chat model, embedding model. You never need
to edit files.

`.env.local` is optional and only provides **defaults** the wizard seeds from:

```
OLLAMA_HOST=http://localhost:11434   # only change if Ollama runs on a non-default port
OLLAMA_CHAT_MODEL=qwen2.5:3b         # default offered in the wizard
OLLAMA_EMBED_MODEL=nomic-embed-text  # default offered in the wizard
# VAULT_PATH is optional — colleagues set it in the wizard instead
```

Recommended models on a 16 GB machine: `qwen2.5:3b` (chat) + `nomic-embed-text` (embeddings).
Larger chat models (e.g. `gemma4`) give better quality but are slower; swap anytime in Settings.

## Features

| Page | What it does |
|------|--------------|
| **Dashboard** | Vault stats, recent files, quick capture, AI briefing card |
| **Chat** | Ask questions about the vault. RAG: embeds the question, retrieves the top-k chunks locally, gemma answers with clickable citations to source notes |
| **Curate** | Paste meeting notes / a summary. gemma proposes multi-file vault updates (project page, daily note, decision log, person notes) following the vault's AI-first conventions. Review per-file diffs, approve/reject each, then apply. Applied changes are logged to `Logs/YYYY-MM-DD.md` and re-indexed |
| **Explorer** | File tree + markdown preview |
| **Search** | Keyword/grep search across notes |
| **Commands** | Run vault commands |

## How RAG works

1. **Index** (`src/lib/embeddings.ts`): each `.md` note is split into self-contained chunks
   (frontmatter + each heading section), embedded via `nomic-embed-text`, stored in
   `data/index.sqlite` (gitignored, rebuildable).
2. **Retrieve**: a query is embedded and scored against all chunks by cosine similarity; top-k returned.
3. **Answer**: retrieved chunks + the question go to `qwen2.5:3b`, which is instructed to answer
   only from the provided sources and cite them as `[[wikilinks]]`.

`Sync Index` (top bar) does an incremental re-embed of only notes whose mtime changed.
`POST /api/index/rebuild` does a full rebuild.

## Curation conventions

The curation prompt (`src/lib/prompts.ts`) loads the vault's `_CLAUDE.md` so proposed notes
follow the "AI-first" rules: rich frontmatter, a "For future Claude" preamble, mandatory
`[[wikilinks]]`, recency markers, and confidence levels. Nothing is written until you approve
the diff.

## Notes

- Local-only tool — no auth; bind to localhost only.
- The embedding index (`data/`) is rebuildable and gitignored.
- The chat model is configurable via `OLLAMA_CHAT_MODEL` (default `qwen2.5:3b` — fast on a 16GB M-series machine). Larger models like `gemma4` give better quality but the curation flow (which generates full file contents) can be slow. Curation output is always a proposal to review, not an autonomous write.
