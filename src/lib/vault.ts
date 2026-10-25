import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { getConfig } from '@/lib/config'

// Resolved at call time (not import time) so changing the vault in the UI takes
// effect immediately, without a server restart.
export function getVaultPath(): string {
  return getConfig().vaultPath
}

export const SKIP_DIRS = new Set([
  '.obsidian',
  '.git',
  'obsidian-second-brain',
  'node_modules',
  '.trash',
])

// Notes that aren't "content" — scaffolding docs and append-only operational logs.
// Their structure and example/ephemeral [[links]] shouldn't be health-flagged or
// auto-fixed (logs have no frontmatter by design, and reference throwaway things;
// flagging them caused a fix→reflag loop). Shared by the health scan and the
// link-graph builder so both treat the exact same notes as non-content.
export function isMetaNote(notePath: string): boolean {
  if (path.basename(notePath).toLowerCase() === '_claude.md') return true
  // Any note under a Logs/ or Dev Logs/ directory (operational logs).
  return notePath.split('/').some(seg => /^(dev )?logs$/i.test(seg))
}

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

// Image extensions shown in the explorer tree. Kept local (not imported from
// lib/images) to avoid a vault ↔ images import cycle.
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif)$/i

export function sanitizePath(relativePath: string): string {
  // Prevent path traversal
  // (and a leading "/" — models sometimes write vault paths as "/Projects/X.md")
  const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  return normalized
}

// Resolve a vault-relative path to an absolute one, refusing anything that could
// reach outside the vault's content. Every read/write/move/delete funnels through
// here, so this is the containment boundary for model-proposed (and possibly
// prompt-injected) paths:
//   - no vault configured → throw (path.join('', p) would land in the app's cwd)
//   - the result must stay strictly inside the vault root
//   - no dot-segments: .git/hooks/* runs on the app's git pull/push and
//     .obsidian/plugins/* is code Obsidian executes, so neither is ever writable
export function resolveVaultPath(relativePath: string): string {
  const root = getVaultPath()
  if (!root) throw new Error('No vault configured')
  const safe = sanitizePath(relativePath)
  if (safe.split(/[/\\]/).some(seg => seg.startsWith('.') && seg !== '.')) {
    throw new Error(`Refusing hidden/system path: ${relativePath}`)
  }
  const base = path.resolve(root)
  const abs = path.resolve(base, safe)
  if (abs === base || !abs.startsWith(base + path.sep)) {
    throw new Error(`Path escapes the vault: ${relativePath}`)
  }
  return abs
}

// Short content fingerprint used to detect that a note changed between when a
// proposal was generated and when it is applied (see /api/curate/apply).
export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

// Fingerprint of a note as it is on disk right now; null when it doesn't exist.
export function fileHash(relativePath: string): string | null {
  try {
    return contentHash(fs.readFileSync(resolveVaultPath(relativePath), 'utf-8'))
  } catch {
    return null
  }
}

// The file a proposed change acts on and must find unchanged: a move's source,
// otherwise its path.
export function changeTarget(c: { action?: string; path?: string; from?: string }): string | undefined {
  return c.action === 'move' ? c.from : c.path
}

// Pin each change to the version of its target the proposal was built from
// (`known` = hashes of content the model actually saw; otherwise read from disk
// now). null = "file didn't exist". Checked again at apply time.
export function stampBaseHashes<T extends { action?: string; path?: string; from?: string }>(
  changes: T[],
  known: Map<string, string> = new Map(),
): Array<T & { baseHash: string | null }> {
  return changes.map(c => {
    const target = changeTarget(c)
    return { ...c, baseHash: target ? (known.get(target) ?? fileHash(target)) : null }
  })
}

// Read a note's current content; null when it's missing, unreadable, or blank.
// The shared read-with-fallback used by merge/guard/caretake code paths.
export function readNote(relativePath: string): string | null {
  try {
    const content = fs.readFileSync(resolveVaultPath(relativePath), 'utf-8')
    return content.trim() ? content : null
  } catch {
    return null
  }
}

// YAML frontmatter at the very start of a note ("---" fences, CRLF-tolerant).
export const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, '')
}

export function buildFileTree(dirPath: string, vaultBase: string): FileNode {
  const name = path.basename(dirPath)
  const relativePath = path.relative(vaultBase, dirPath)

  const stat = fs.statSync(dirPath)
  if (stat.isFile()) {
    return { name, path: relativePath, type: 'file' }
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const children: FileNode[] = []

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      children.push(buildFileTree(fullPath, vaultBase))
    } else if (entry.isFile() && (entry.name.endsWith('.md') || IMAGE_FILE_RE.test(entry.name))) {
      // Images appear in the explorer tree (previewable) — but are never notes:
      // listAllNotes/indexing stay .md-only.
      children.push({
        name: entry.name,
        path: path.relative(vaultBase, fullPath),
        type: 'file',
      })
    }
  }

  // Sort: folders first, then files alphabetically
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return { name, path: relativePath, type: 'folder', children }
}

export function countMarkdownFiles(dirPath: string): number {
  let count = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const fullPath = `${dirPath}/${entry.name}`
      if (entry.isDirectory()) {
        count += countMarkdownFiles(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return count
}

export function listAllNotes(dirPath?: string): Array<{ path: string; mtime: Date }> {
  const base = getVaultPath()
  const root = dirPath ?? base
  const files: Array<{ path: string; mtime: Date }> = []

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const stat = fs.statSync(fullPath)
          files.push({ path: path.relative(base, fullPath), mtime: stat.mtime })
        }
      }
    } catch {
      // ignore
    }
  }

  if (!base) return files
  walk(root)
  return files
}

// Move/rename a note within the vault. Both ends are path-contained. Creates the
// destination folder if needed; refuses to clobber an existing destination.
export function moveNote(from: string, to: string): void {
  const src = resolveVaultPath(from)
  const dst = resolveVaultPath(to)
  if (!fs.existsSync(src)) throw new Error(`Source not found: ${from}`)
  if (fs.existsSync(dst)) throw new Error(`Destination already exists: ${to}`)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.renameSync(src, dst)
}

// Delete a note from the vault (path-contained).
export function deleteNote(target: string): void {
  const abs = resolveVaultPath(target)
  if (!fs.existsSync(abs)) return // already gone — idempotent
  fs.rmSync(abs)
}

export function appendToLog(entry: string) {
  const today = new Date().toISOString().slice(0, 10)
  const logPath = path.join(getVaultPath(), 'Logs', `${today}.md`)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })

  const stamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const block = `\n\n## ${stamp} — ${entry.split('\n')[0]}\n\n${entry}\n`

  if (fs.existsSync(logPath)) {
    fs.appendFileSync(logPath, block, 'utf-8')
  } else {
    fs.writeFileSync(logPath, `# Vault Operations Log — ${today}${block}`, 'utf-8')
  }
}

export function getRecentFiles(dirPath: string, limit = 6): Array<{ path: string; mtime: Date }> {
  const files: Array<{ path: string; mtime: Date }> = []

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const fullPath = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const stat = fs.statSync(fullPath)
          files.push({ path: path.relative(dirPath, fullPath), mtime: stat.mtime })
        }
      }
    } catch {
      // ignore
    }
  }

  walk(dirPath)
  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  return files.slice(0, limit)
}
