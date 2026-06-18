import fs from 'fs'
import path from 'path'
import { getVaultPath, countMarkdownFiles } from '@/lib/vault'

// First-run scaffolding for a brand-new / empty vault. The rest of the app
// assumes the vault already follows the "AI-first" conventions (rich frontmatter,
// "For future Claude" preamble, [[wikilinks]], a folder skeleton). A colleague who
// points the UI at an empty folder gets none of that — so curation has no
// conventions to follow and Chat has nothing to index. This module lays down a
// minimal, idempotent skeleton so the vault is immediately usable.
//
// Local-only, deterministic: no model, no network. Never overwrites an existing
// file — only creates what's missing.

// Folders every AI-first vault is expected to have. appendToLog already writes to
// Logs/, curation writes Projects/People/Daily, etc.
const FOLDERS = ['Projects', 'Daily', 'Logs', 'People', 'Knowledge', 'Assets']

const CLAUDE_MD = `# _CLAUDE.md — Vault Conventions

> **For future Claude (and any AI working in this vault):** read this first. Every
> note here is written to be *self-contained* and *AI-first* — optimized for an
> assistant to read, retrieve, and update without needing outside context.

## AI-first rules

1. **Self-contained notes.** Each note states its own context — never assume the
   reader has seen another note. Briefly restate who/what is involved.
2. **Rich frontmatter.** Start every note with YAML frontmatter:
   \`\`\`yaml
   ---
   title: <human title>
   type: project | person | daily | log | knowledge | meeting
   created: <YYYY-MM-DD>
   updated: <YYYY-MM-DD>
   tags: [<topic>, ...]
   confidence: high | medium | low
   ---
   \`\`\`
3. **"For future Claude" preamble.** After the frontmatter, add a one-paragraph
   preamble that orients an AI reader: what this note is, why it exists, what's
   authoritative here.
4. **Wikilinks are mandatory.** Link related notes with \`[[Note Name]]\`. Prefer
   linking over duplicating.
5. **Recency + confidence markers.** Keep \`updated:\` current; flag uncertain
   claims with a confidence level inline.

## Folder map

- \`Projects/\`  — one note per active project.
- \`People/\`    — one note per person you collaborate with.
- \`Daily/\`     — one note per day (\`YYYY-MM-DD.md\`).
- \`Logs/\`      — append-only operations log (\`YYYY-MM-DD.md\`).
- \`Knowledge/\` — durable reference notes & briefings.
- \`Assets/\`    — images / PDFs ingested into the vault.

## Auto-save rules

- Curation proposes a multi-file diff; nothing is written until you approve.
- Every applied change appends an entry to \`Logs/<today>.md\`.

*This file was scaffolded by Vault UI on first run. Edit it to match how your team
actually works — every curation and chat call reads it fresh.*
`

export type VaultInitState = {
  empty: boolean
  hasClaudeMd: boolean
  noteCount: number
}

export function vaultInitState(): VaultInitState {
  const base = getVaultPath()
  const hasClaudeMd = !!base && fs.existsSync(path.join(base, '_CLAUDE.md'))
  const noteCount = base ? countMarkdownFiles(base) : 0
  // "Empty" = nothing meaningful to work with: no _CLAUDE.md and no notes.
  return { empty: !hasClaudeMd && noteCount === 0, hasClaudeMd, noteCount }
}

// Create the folder skeleton + _CLAUDE.md if missing. Idempotent: existing files
// are left untouched. Returns the list of paths actually created.
export function scaffoldVault(): { created: string[] } {
  const base = getVaultPath()
  if (!base) throw new Error('No vault configured')
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error('Vault path is not a directory')
  }

  const created: string[] = []

  for (const folder of FOLDERS) {
    const dir = path.join(base, folder)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      // Drop a .gitkeep so empty folders survive git.
      fs.writeFileSync(path.join(dir, '.gitkeep'), '', 'utf-8')
      created.push(`${folder}/`)
    }
  }

  const claudePath = path.join(base, '_CLAUDE.md')
  if (!fs.existsSync(claudePath)) {
    fs.writeFileSync(claudePath, CLAUDE_MD, 'utf-8')
    created.push('_CLAUDE.md')
  }

  return { created }
}
