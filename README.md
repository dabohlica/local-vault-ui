# Vault UI — Local RAG + Curation for any Obsidian Vault

A local, single-user web app for browsing, searching, querying, and curating an
Obsidian vault. All AI runs **locally via [Ollama](https://ollama.com)** — vault data
never leaves the device. Point it at *your* vault; nothing is hardcoded.

## Quickstart

> **📖 Full walkthrough: [SETUP.md](SETUP.md)** — one guide covering install, setup, and start, with a
> path for **"I already have a vault of notes"** and one for **"starting from scratch"**.

```bash
# 1. Install Ollama (https://ollama.com) and leave it running:
ollama serve

# 2. Get the app:
git clone <repo-url> vault-ui && cd vault-ui
npm install
npm run dev             # opens http://localhost:3000
```

The app walks you through the rest (connect vault → pick/pull models → build index). No `.env`
editing. Then pick your path:

- **Already have a vault full of notes?** Point Step 1 at it → **Build index** → **Enter your vault**.
  Optional polish: **Vault Health → Auto-fix** then **Interlink**.
- **Starting from scratch / notes scattered across tools?** Point Step 1 at an empty folder →
  **Initialize vault** → sidebar **Import** a folder of exports (Markdown/Notion/Evernote/`.docx`/PDF…)
  → **Interlink**.

See [SETUP.md](SETUP.md) for the step-by-step of each path, model recommendations, automatic
caretaking, and troubleshooting.

## Security boundary (read this)

**Allowed:** local inference (Ollama), local storage (SQLite), the local vault filesystem.

**Not allowed / not present in the codebase:** OpenAI / Anthropic / Gemini APIs, external
vector databases, external telemetry. The only module that makes outbound HTTP requests is
[`src/lib/ollama.ts`](src/lib/ollama.ts), and it asserts the target host is `localhost`
(`127.0.0.1`/`::1`) before every call. Everything else is filesystem-only.

> Vault data NEVER leaves the device.

## Use it from your phone

The app runs on your laptop; your phone is just a browser pointed at it (the model stays on the
laptop). Reach it from anywhere with Tailscale, or over the same Wi-Fi, and sync the vault between
devices through a private GitHub repo + Obsidian mobile. The top bar's **Git Pull** / **Git Push**
buttons keep the vault in sync, and the app auto-pulls-then-pushes on load. See
**[MOBILE.md](MOBILE.md)** for the full walkthrough.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Ollama: `qwen2.5:3b` (chat, default) + `nomic-embed-text` (embeddings) — both swappable in Settings
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
Larger chat models (e.g. `qwen2.5:7b`) give better quality but are slower; swap anytime in Settings.
See [SETUP.md](SETUP.md) for per-machine model recommendations.

## Features

| Page | What it does |
|------|--------------|
| **Dashboard** | Vault stats, recent files, quick capture, AI briefing cards |
| **Chat** | Ask the vault (hybrid retrieval, multi-turn, sessions) or flip to **Edit** to change it. Answers cite source notes; edits are diffs you approve |
| **Curate** | Paste raw notes / a meeting summary; the local model proposes multi-file updates (project page, daily note, people, decisions) following the AI-first conventions. Review per-file diffs, approve, apply — logged to `Logs/YYYY-MM-DD.md` and re-indexed |
| **Import** | Bulk-build a vault from a folder of exports (Markdown/Notion/Evernote/`.docx`/PDF/`.csv`…), batch-reviewed |
| **Review** | Proposals the overnight caretaker queued for approval |
| **Commands** | 10 local workflows: Daily · Meeting · Person · Project · Task · Dev Log · Board · Recap · Synthesize · Vault Health · Interlink |
| **Explorer / Search** | File tree + Markdown preview with live `[[wikilinks]]`; full-text search |

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

## The local model as caretaker

The local LLM doesn't just answer questions — it reorganizes the vault, always
behind a reviewable diff:

- **Move / rename / delete.** Curation and every command can emit `move`
  (`{from, to}`) and `delete` (`{path}`) actions, not just `create`/`update`. Ask
  e.g. *"file this stray note under Projects and rename it to match conventions"*
  or *"move the decisions from the meeting note into the project page"* — the model
  proposes the moves/edits, you approve each in the diff view
  (`src/app/api/curate/apply/route.ts`, `src/components/shared/ProposalReview.tsx`).
- **Health auto-fix.** Commands → **Vault Health** → **Auto-fix structure**
  deterministically adds missing frontmatter and a "For future Claude" preamble
  (summarised from each note's own first paragraph), up to 25 notes at a time,
  content preserved verbatim, **and creates stub notes so broken `[[links]]`
  resolve**. Fully local, no model variance. Empty notes are left for a human
  (`src/lib/healthFix.ts`).

## No self-inflicting health issues

Every note a model produces (chat Edit, Curate, Commands, ingest, import, capture) is **normalized**
before you even see the diff (`src/lib/healthFix.ts` → `normalizeChanges` → `ensureStructure`): missing
frontmatter and the "For future Claude" preamble are added deterministically, body preserved. So editing
the vault can't create the very structural issues the health scan then flags.

**Health auto-fix also resolves broken links** now (not only Interlink): the **Auto-fix structure**
button adds frontmatter/preamble **and** creates stub notes so dangling `[[links]]` resolve, all in one
reviewed batch. (The unattended nightly run still only auto-applies the content-preserving structural
fixes — stub creation is manual-only.)

## Chat: Ask or Edit

The chat input has an **Ask / Edit vault** toggle:
- **Ask** — grounded answer from your notes (hybrid retrieval, multi-turn).
- **Edit vault** — your message becomes an instruction; the model proposes vault changes
  (create / update / move / delete) via the same curation pipeline, shown **inline as diffs to
  approve** (nothing is written until you do). Conversation history is included, so "save what we
  just discussed as a note" or "add that to his note" resolve against the chat. Edit mode uses light
  chunk-level context so the small model returns clean JSON.

## Chat: multi-turn + hybrid retrieval

Chat is **multi-turn** — the last few exchanges are sent with each question, so follow-ups resolve
("what about *his* role?", "*that* project") instead of starting cold. The retrieval query is also
expanded with recent user turns so follow-ups still fetch the right notes.

Retrieval is **hybrid** (`src/lib/embeddings.ts` → `retrieveNotes`): semantic similarity **plus** a
lexical/keyword signal and a strong **title-match boost**. This fixes false "I don't know"s on named
entities — asking "who is *<Person>*?" now surfaces `People/<Person>.md` even when pure embedding
similarity ranked it poorly (short name queries embed badly).

## Chat history & capturing conversations

Chat is organized into **sessions** (separate conversations) — a **New chat** button and a sidebar rail
of recent conversations you can reopen, each auto-titled from its first message. Multi-turn context and
retrieval stay **within the open session**, so subjects don't bleed across conversations. Still
lightweight and local (`src/lib/chatHistory.ts`, gitignored `data/chat-sessions.json`): whole sessions
**auto-clear after 7 days** of inactivity, capped at 50 sessions / 200 messages each. Delete any session
from the rail. **Save to vault** runs the open conversation through the normal ingest pipeline
(`/api/chat/to-vault` → `buildIngestPrompt`) and shows the drafted note as a diff to approve.

## Bulk import (building a vault from scratch)

No vault yet? Sidebar → **Import**. Point at a **folder** of exports — Markdown, txt, HTML
(Notion/Evernote), Evernote `.enex` (expands to one note per entry), `.csv`, `.json`, PDF, and `.docx`
(Google Docs/Word, via `mammoth`). Files are structured into AI-first notes **6 at a time**
and shown as diffs to **batch-approve** before anything is written (`src/lib/extract.ts`,
`/api/import/batch`). Typical cold-start: **Init** an empty vault → **Import** your exports →
**Interlink** to connect them → **Vault Health → Auto-fix**. All local.

## Drag-drop ingest (with notes)

Drop a `.md` / `.txt` / `.pdf` / image anywhere in the app. Before the model drafts a note you get a
**compose step** to attach **optional notes** — these are sent with the file at **high priority** and
are treated as authoritative: they're folded into the note's "For future Claude" summary and win over
the extracted/OCR'd text where they conflict (`src/lib/prompts.ts` → `buildIngestPrompt`). Use it to
flag what matters ("this is the signed contract — surface the Aug 15 deadline, link [[Client]]"). The
drafted note is shown as a diff to approve before anything is written.

## Indexing: when it runs & how to debug it

The embedding index updates on several triggers so "I added a note → it's
searchable" just works:

- **Live watcher** (`src/lib/watcher.ts`) — watches the vault dir and incrementally
  re-indexes ~3s after any `.md` add/change/delete, **including edits made in
  Obsidian**. (Recursive watching works on macOS + Windows; on Linux it falls back
  to the periodic sync below.)
- **On every applied change** (curate/command/ingest) and **on chat**.
- **Scheduled** sync every *N* hours + nightly full caretake (see below).

**If notes aren't showing up** (e.g. "chunk totals don't change"), open **Settings →
Diagnostics** (`/api/diagnostics`). It shows, side by side: the configured vault
path, **notes on disk vs. indexed notes vs. chunks**, the embed model + Ollama
reachability, the **exact index DB path and launch cwd**, and a list of on-disk
notes not yet indexed — with a plain-language verdict and a one-click **Rebuild
index**. The usual culprits it surfaces: a wrong/nested vault path, the embed model
not installed, or the app launched from a different working directory (which uses a
different `data/index.sqlite`).

## Vault initialization & caretaking

**Initialize an empty vault.** Point the wizard at a brand-new/empty folder and Step 1 offers
**Initialize vault** — it scaffolds the AI-first skeleton (`_CLAUDE.md` + `Projects/`, `Daily/`,
`Logs/`, `People/`, `Knowledge/`, `Assets/`) so curation has conventions to follow. It's
idempotent and never overwrites an existing file (`src/lib/vaultInit.ts`).

**Automatic caretaking** (Settings → Step 4). While the app is open, an in-app scheduler
(`src/components/layout/AutoCaretake.tsx`) keeps the index fresh and runs a nightly health check —
all local:

- **Index sync** every *N* hours (default 6) — incremental re-embed of changed notes.
- **Nightly full caretake** at a chosen hour (default 03:00). Two tiers — *auto-apply the safe steps,
  queue the risky ones for review*:
  - **Auto-applied (safe, deterministic):** index sync + a health scan + structural health fixes
    (add missing frontmatter / "For future Claude" preamble, body preserved verbatim).
  - **Queued for review (model-driven):** a curation proposal over the notes that changed in the last
    24h (link related notes, file strays via `move`, merge duplicates, synthesize a `Knowledge/` note
    when warranted). It is **never written unattended** — it lands in the **Review** queue.
  - A summary is appended to `Logs/YYYY-MM-DD.md`. If the app was closed past the hour, it catches up
    at next launch.

**Review queue** (sidebar → **Review**, with a count badge). Proposals the overnight caretaker prepared
but did not write. Open each, approve/reject the diffs (`/api/pending`, `data/pending/*.json`,
gitignored). This keeps the propose→review→approve safety model even for unattended runs.

It's a foreground scheduler, not a headless daemon — it only runs while the app is open. For
**always-on** scheduling, point an OS cron/Task Scheduler at the same endpoint:

```bash
# macOS/Linux cron — nightly full caretake at 03:00 (app or no app)
0 3 * * * curl -s -X POST http://localhost:3000/api/caretake -H 'Content-Type: application/json' -d '{"mode":"full"}'
```

`POST /api/caretake` accepts `{"mode":"sync"}` (index only) or `{"mode":"full"}` (sync + health +
log). `GET /api/caretake` returns the current schedule. Disable the in-app scheduler any time from
Settings.

## Notes

- Local-only tool — no auth; bind to localhost only.
- The embedding index (`data/`) is rebuildable and gitignored.
- The chat model is configurable in Settings (default `qwen2.5:3b` — fast on a 16 GB machine). Larger models (e.g. `qwen2.5:7b`) give noticeably better curation/edit quality but are slower. Curation/edit output is always a proposal to review, never an autonomous write.
