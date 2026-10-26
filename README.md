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

**Allowed:** local inference (Ollama, or MLX via `mlx_vlm.server` for `mlx:` models), local storage
(SQLite), the local vault filesystem.

**Not allowed / not present in the codebase:** OpenAI / Anthropic / Gemini APIs, external
vector databases, external telemetry. Two modules make HTTP requests:
- [`src/lib/ollama.ts`](src/lib/ollama.ts) talks to the model servers and asserts the target host is
  loopback (`localhost`/`127.0.0.1`/`::1`) before every call.
- [`src/lib/egress.ts`](src/lib/egress.ts) fetches the feeds you add in the **Inbox**, and nothing else.
  It sends GET requests only, with no request body, so all that goes out is the feed URL or your arXiv
  query. The first hop must be a host from your configured sources. Private and loopback addresses are
  refused, even after a redirect, so a feed can't be used to reach Ollama or the app. Every request is
  logged to `data/egress.jsonl`. With no sources configured, it never runs.

Everything else is filesystem-only.

**Network access** (`src/middleware.ts`, `src/lib/access.ts`):
- `npm run dev` / `start` bind to `127.0.0.1` only. `dev:lan` / `start:lan` bind to this machine's
  **Tailscale IP only**, so it's reachable from your tailnet devices (governed by Tailscale ACLs), not from
  whatever Wi-Fi you're on. `VAULT_BIND=0.0.0.0` deliberately opts back into LAN exposure.
- Cross-site requests are blocked (Origin check), as is DNS rebinding (Host allowlist: loopback, IP
  literals, `*.ts.net`, plus `VAULT_ALLOWED_HOSTS`). So a web page open in your browser can't drive the API.
- The vault can't be pointed at `/`, your home folder or the app's own directory, and no path under
  `.git/` / `.obsidian/` (or any dot-folder) is ever readable or writable through the app.
- Applying a proposal re-checks each note's fingerprint: if it changed since the proposal was made
  (e.g. you edited it in Obsidian before approving the overnight queue), that change is refused instead
  of overwriting your newer text.

> Vault data NEVER leaves the device.

## Use it from your phone

The app runs on your laptop; your phone is just a browser pointed at it (the model stays on the
laptop). Reach it from anywhere with Tailscale, or over the same Wi-Fi, and sync the vault between
devices through a private GitHub repo + Obsidian mobile. The app pulls then pushes on load; the
cloud icon in the top bar shows the sync state and has **Sync now**. On a phone, a bottom tab bar
replaces the sidebar. See
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
| **⌘K** | One box from anywhere: find a note by name or content, ask a question, save a thought, jump to a page or tool |
| **Home** | Greeting + one input: Enter asks your notes, ⌘Enter jots the text into today's daily note (append-only). "Waiting for you" tiles (new reads, overnight suggestions, notes to tidy), the briefing, recently edited notes, and what changed |
| **Ask** | Ask the vault (hybrid retrieval, multi-turn, sessions). Answers render as formatted text and cite the notes they're based on; **Save as note** turns a conversation into a reviewed note |
| **Add note** | Paste raw notes / a meeting summary; the local model proposes multi-file updates (project page, daily note, people, decisions) following the AI-first conventions. Review per-file diffs, approve, apply — logged to `Logs/YYYY-MM-DD.md` and re-indexed |
| **Import** | Bulk-build a vault from a folder of exports (Markdown/Notion/Evernote/`.docx`/PDF/`.csv`…), batch-reviewed |
| **Inbox → To read** | New papers and articles from your sources (arXiv searches, RSS/Atom feeds), ranked by how close they are to your vault and to what you kept before. Swipe right to keep: the item is saved as a new note under `Knowledge/Sources/<Section>/`. Swipe left to skip: future ranking learns from it. Swipe down to park it for later. |
| **Morning briefing** | Built every morning (time set under Inbox → Sources) from the best new inbox items per section, with a sentence on why each matters to you. Shown on Home. |
| **Inbox → Suggestions** | Proposals the overnight caretaker queued for approval (`/review` redirects here) |
| **Tools** | Write a summary (topic or time period) · Health check · Connect notes |
| **Notes** | Filterable file tree + reader with clickable `[[wikilinks]]`, folded properties, Connections, and **Open in Obsidian** |

## How RAG works

1. **Index** (`src/lib/embeddings.ts`): each `.md` note is split into chunks per heading section,
   each prefixed with a breadcrumb (`Projects/Foo › Status › Next steps`). Chunks are embedded (with the
   model's query/document prefixes) and stored in `data/index.sqlite` (gitignored, rebuildable),
   alongside an **FTS5 keyword index** over the same chunks.
2. **Retrieve** (`src/lib/search.ts`): three rankings are fused with reciprocal-rank fusion:
   - **dense**: embedding similarity
   - **keyword**: BM25, with note name and heading weighted above body text
   - **title**: the query names a note ("who is Alex" → `People/Alex.md`)

   The top 20 are then re-scored by a **cross-encoder reranker** (`qwen3-reranker:0.6b` via Ollama,
   optional), which reads query and excerpt together.
3. **Answer**: the relevant excerpts are grouped by note (small notes are sent whole) within a character
   budget (`retrievalBudgetChars`, default 12 000), and the writer model answers only from them, citing
   `[[wikilinks]]`.

**Measure it on your own vault:** `npm run eval:retrieval` (app running) generates ~30 questions from
your notes with the local model (once, saved to `data/retrieval-eval.json`, which you can edit) and scores
every strategy. The 142-note reference vault, 28 questions, `qwen3-embedding:0.6b`:

| strategy | hit@1 | hit@3 | MRR@10 | ms/query |
|---|---|---|---|---|
| previous ranking | 0.64 | 0.93 | 0.775 | 40 |
| hybrid (dense + BM25 + title) | 0.82 | 0.96 | 0.893 | 36 |
| hybrid + rerank | **0.96** | **1.00** | **0.976** | ~3 900 |

Plain hybrid ties dense on these descriptive questions. It wins on named entities: "who is Alex" style probes went from hit@1 0.50
to 1.00, though only 4 probes, since the vault has two People notes. It also helps on exact terms
(standards numbers, codes). The reranker adds ~4 s per query
but lets the answer prompt shrink from ~5–7k to ~2k tokens, so time-to-first-token still drops by about
half on a 16 GB Mac.

The index follows file changes on its own (a watcher re-embeds changed notes). The sync popover in the
top bar has **Update** for an explicit incremental re-embed of notes whose mtime changed.
`POST /api/index/rebuild` does a full rebuild.

## Inbox & morning briefing

Sources are configured on the **Inbox → Sources** tab. Each source has a *section* (`research`,
`work`, `tech`…), which is how ranking, the briefing and the note folder are grouped. The source list
is stored in `data/sources.json`.

1. **Fetch:** the server scheduler polls every `feedIntervalHours` (default 6). Items older than 30 days
   are ignored. Duplicates are dropped by identity (arXiv id across versions and abs/pdf links, or the URL
   with tracking parameters removed) and by title.
2. **Score:** each item is embedded once with the same model as the index. Its *vault match* is its
   similarity to your closest note. After a few swipes in a section, the score also blends in similarity
   to what you kept there, and items that look more like your skips than your keeps are pushed down.
3. **Explain:** the writer model adds a two-sentence "why this matters to you" to the top items. If the
   model is down, the abstract is shown instead.
4. **Swipe:** keeping an item creates a note (never overwriting; the file name gets a suffix if it is
   taken) with AI-first frontmatter (`type: research`, `source`, `confidence: stated`), the source's
   abstract and links to the closest notes. Undo deletes that note only if you haven't edited it since.
5. **Briefing:** daily at `briefingHour` (default 07:00), the app polls once more and takes the top 5 new
   items per section. Any of them without a "why" get one, and a 2–3 sentence overview is added. The
   briefing is saved to `data/briefings/YYYY-MM-DD.json`.

Candidates live in `data/inbox.sqlite`, **not** in the vault, so nothing you haven't kept can show up in
chat answers or search.

## Graph & note types

The vault is also read as a graph ([`src/lib/graph.ts`](src/lib/graph.ts)). Notes are the nodes, and the
edges come from two places:
- `[[wikilinks]]` in the note body, recorded as "mentions";
- frontmatter fields that hold links (`related-people`, `project`, `attendees`, …), recorded as edges
  named after the field.

The graph is built from the files alone, with no model and no embedder, and is refreshed incrementally.
Note types come from `type:` in the frontmatter, or from the folder when that's missing (`People/` →
person, `Projects/` → project…). The type vocabulary is defined in
[`src/lib/schema.ts`](src/lib/schema.ts) and mirrors `_CLAUDE.md`.

- **Notes → Connections:** below each note, shows its typed relations, mentions, links that don't
  resolve to a note yet, and backlinks.
- **Health:** flags relations pointing at the wrong kind of note (for example `related-people` linking
  a meeting) and notes with no links in or out.
- **Chat context:** each source note is listed with its linked notes, so the model can follow
  relationships across notes, e.g. meeting → project → person.
- **Graph boost (Settings, off by default):** search candidates linked to the top results get an extra
  vote in the ranking. Compare `hybrid` with `hybrid+graph` in `npm run eval:retrieval` before turning
  it on. On a 75-note vault (29 generated questions, qwen3-embedding + qwen3-reranker 0.6b) it hurt:
  hit@1 0.79 → 0.59 without the reranker, and no change (0.90) with it, at +0.7 s per query. Linked
  notes still reach the answer prompt as context, which is where the graph helps.

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
- **Health auto-fix.** Tools → **Health check** → **Auto-fix structure**
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

**Automatic caretaking** (Settings → Step 4). A server-side scheduler (`src/lib/scheduler.ts`, started
from `src/instrumentation.ts`) keeps the index fresh and runs a nightly health check while the server
is running — no browser tab needed. All local:

- **Index sync** every *N* hours (default 6) — incremental re-embed of changed notes.
- **Nightly full caretake** at a chosen hour (default 03:00). Two tiers — *auto-apply the safe steps,
  queue the risky ones for review*:
  - **Auto-applied (safe, deterministic):** index sync + a health scan + structural health fixes
    (add missing frontmatter / "For future Claude" preamble, body preserved verbatim).
  - **Queued for review (model-driven):** a curation proposal over the notes that changed in the last
    24h (link related notes, file strays via `move`, merge duplicates, synthesize a `Knowledge/` note
    when warranted). It is **never written unattended** — it lands in **Inbox → Suggestions**.
  - A summary is appended to `Logs/YYYY-MM-DD.md`. If the server was down past the hour, it catches up
    on its first check after starting (state in `data/scheduler.json`).

**Suggestions** (sidebar → **Inbox → Suggestions**; the Inbox badge counts them). Proposals the overnight caretaker prepared
but did not write. Open each, approve/reject the diffs (`/api/pending`, `data/pending/*.json`,
gitignored). This keeps the propose→review→approve safety model even for unattended runs.

It runs inside the Next.js server process, so it needs the server running (not a tab). If you don't
keep the server up, point an OS cron/Task Scheduler at the same endpoint:

```bash
# macOS/Linux cron — nightly full caretake at 03:00 (app or no app)
0 3 * * * curl -s -X POST http://localhost:3000/api/caretake -H 'Content-Type: application/json' -d '{"mode":"full"}'
```

`POST /api/caretake` accepts `{"mode":"sync"}` (index only) or `{"mode":"full"}` (sync + health +
log). `GET /api/caretake` returns the schedule and the last nightly result. Disable the scheduler any
time from Settings.

## Notes

- Single-user tool: access control = loopback/Tailscale binding + Tailscale ACLs + the origin checks above.
- Tests: `npm test` (vitest) covers path containment, origin/host checks, stale-write refusal, embedding
  prefixes/encoding, the scheduler and model-output cleanup.
- The embedding index (`data/`) is rebuildable and gitignored.
- The chat model is configurable in Settings (default `qwen2.5:3b` — fast on a 16 GB machine). Larger models (e.g. `qwen2.5:7b`) give noticeably better curation/edit quality but are slower. Curation/edit output is always a proposal to review, never an autonomous write.
