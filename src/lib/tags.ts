import fs from 'fs'
import { listAllNotes, resolveVaultPath } from '@/lib/vault'

// User-chosen tags for a capture. The UI lets the user pick/typo tags (e.g.
// "#AWS_genAI_Cert") and we GUARANTEE they land in the frontmatter `tags:` array of
// every note a capture creates or updates — enforced here in code, not left to the
// small model, so the tag is always present even when the model forgets. Runs AFTER
// normalizeChanges, which guarantees every create/update note already has frontmatter.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n?)/

// Obsidian tags allow letters, digits, _, -, / and must not contain spaces or a
// leading '#'. Coerce free user input into a valid tag; drop anything that empties out.
export function sanitizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')          // strip the hashtag the user typed/sees in the UI
    .replace(/\s+/g, '_')        // spaces aren't allowed inside a tag
    // keep tag-legal chars: word chars (incl. _), accented Latin letters, - and /
    .replace(/[^\wÀ-ɏ/-]/g, '')
    .replace(/^[-/]+|[-/]+$/g, '') // no leading/trailing separators
}

export function sanitizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    const clean = sanitizeTag(t)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

// Parse the tag values already present in a frontmatter block, supporting both the
// inline form (`tags: [a, b]`) and the block list form (`tags:\n  - a\n  - b`).
function parseExistingTags(frontmatter: string): string[] {
  const inline = /^tags:[ \t]*\[(.*)\][ \t]*$/m.exec(frontmatter)
  if (inline) {
    return inline[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  const block = /^tags:[ \t]*\r?\n((?:[ \t]+-[ \t]*.*\r?\n?)+)/m.exec(frontmatter)
  if (block) {
    return block[1]
      .split(/\r?\n/)
      .map(l => l.replace(/^[ \t]+-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return []
}

// Merge `tags` into the note's frontmatter `tags:` field, preserving the existing
// style (inline vs block) and de-duplicating case-insensitively. If the note somehow
// has no frontmatter (shouldn't happen post-normalize), the content is returned as-is.
export function mergeTagsIntoFrontmatter(content: string, tags: string[]): string {
  const add = sanitizeTags(tags)
  if (add.length === 0) return content

  const fm = FRONTMATTER_RE.exec(content)
  if (!fm) return content

  const block = fm[1]
  const existing = parseExistingTags(block)
  const seen = new Set(existing.map(t => t.toLowerCase()))
  const merged = [...existing]
  for (const t of add) {
    if (!seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); merged.push(t) }
  }
  if (merged.length === existing.length) return content // nothing new to add

  const inlineRe = /^tags:[ \t]*\[.*\][ \t]*$/m
  const blockRe = /^tags:[ \t]*\r?\n(?:[ \t]+-[ \t]*.*\r?\n?)+/m
  const hasKeyRe = /^tags:.*$/m

  let newBlock: string
  if (blockRe.test(block)) {
    const list = merged.map(t => `  - ${t}`).join('\n')
    newBlock = block.replace(blockRe, `tags:\n${list}\n`).replace(/\n+$/, '\n').replace(/\n$/, '')
  } else if (inlineRe.test(block)) {
    newBlock = block.replace(inlineRe, `tags: [${merged.join(', ')}]`)
  } else if (hasKeyRe.test(block)) {
    // A bare/empty `tags:` key — normalize to inline.
    newBlock = block.replace(/^tags:.*$/m, `tags: [${merged.join(', ')}]`)
  } else {
    // No tags key at all — append one to the end of the frontmatter block.
    newBlock = `${block}\ntags: [${merged.join(', ')}]`
  }

  return content.replace(FRONTMATTER_RE, `---\n${newBlock}\n---${fm[2] ?? '\n'}`)
}

// Every distinct frontmatter tag already used across the vault, sorted by frequency
// (most-used first) — powers the capture tag picker's autocomplete so the user reuses
// "#AWS_genAI_Cert" instead of also coining "#aws-genai-cert". Reads only the
// frontmatter block of each note, not the whole body.
export function listVaultTags(): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const { path: notePath } of listAllNotes()) {
    let head: string
    try {
      // Frontmatter is at the very top — read a small prefix, not the whole file.
      const fd = fs.openSync(resolveVaultPath(notePath), 'r')
      const buf = Buffer.alloc(4096)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      head = buf.toString('utf-8', 0, n)
    } catch { continue }
    const fm = FRONTMATTER_RE.exec(head)
    if (!fm) continue
    for (const t of parseExistingTags(fm[1])) {
      const key = t.toLowerCase()
      const hit = counts.get(key)
      if (hit) hit.count++
      else counts.set(key, { tag: t, count: 1 })
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

type TaggableChange = { path?: string; action?: string; content?: string; to?: string }

// Inject the user's tags into every note a proposal creates or updates (and into a
// move that also rewrites content). move-without-content and delete are untouched —
// there's no body to tag. Deterministic: the model's cooperation is not required.
export function applyTags<T extends TaggableChange>(changes: T[], tags: string[]): T[] {
  const clean = sanitizeTags(tags)
  if (clean.length === 0) return changes
  return changes.map(c =>
    (c.action === 'create' || c.action === 'update' || c.action === 'move') && typeof c.content === 'string' && c.content
      ? { ...c, content: mergeTagsIntoFrontmatter(c.content, clean) }
      : c
  )
}
