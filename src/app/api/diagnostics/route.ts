import { NextResponse } from 'next/server'
import fs from 'fs'
import { getConfig } from '@/lib/config'
import { OLLAMA_HOST } from '@/lib/ollama'
import { listAllNotes } from '@/lib/vault'
import { indexStats, listIndexedNotePaths, indexDbPath } from '@/lib/embeddings'

// One-shot wiring check. Answers "why don't my notes show up / why don't the
// chunk totals change" by comparing what's ON DISK against what's INDEXED, and
// surfacing the exact vault path, DB path, and embed-model reachability. All local.
export async function GET() {
  const cfg = getConfig()

  // Vault path + on-disk notes.
  let vaultExists = false
  try { vaultExists = !!cfg.vaultPath && fs.statSync(cfg.vaultPath).isDirectory() } catch { /* no */ }
  const onDisk = vaultExists ? listAllNotes() : []
  const onDiskPaths = new Set(onDisk.map(n => n.path))

  // Index.
  let chunks = 0, indexedNotes = 0
  let indexedPaths: string[] = []
  let indexModel: string | null = null, modelMatches = true
  try {
    const s = indexStats(); chunks = s.chunks; indexedNotes = s.notes
    indexModel = s.model; modelMatches = s.modelMatches
    indexedPaths = listIndexedNotePaths()
  } catch { /* no index yet */ }
  const indexedSet = new Set(indexedPaths)

  // The smoking guns:
  const unindexed = onDisk.map(n => n.path).filter(p => !indexedSet.has(p)) // on disk, not indexed
  const stale = indexedPaths.filter(p => !onDiskPaths.has(p))               // indexed, no longer on disk

  // Embed model reachability.
  let ollamaReachable = false
  let embedInstalled = false
  let rerankInstalled = !cfg.rerankModel
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500), cache: 'no-store' })
    if (res.ok) {
      ollamaReachable = true
      const data = await res.json() as { models?: Array<{ name: string }> }
      const names = (data.models ?? []).map(m => m.name)
      embedInstalled = names.some(m => m === cfg.embedModel || m.split(':')[0] === cfg.embedModel.split(':')[0])
      rerankInstalled = !cfg.rerankModel || names.some(m => m === cfg.rerankModel || m === `${cfg.rerankModel}:latest`)
    }
  } catch { /* not running */ }

  // Plain-language verdict so a non-developer can act on it.
  const problems: string[] = []
  if (!vaultExists) problems.push(`Vault path is not a valid directory: "${cfg.vaultPath || '(unset)'}". Re-connect it in Settings.`)
  if (vaultExists && onDisk.length === 0) problems.push('No .md notes found under the vault path — is this the right folder? (Check for a nested subfolder.)')
  if (!ollamaReachable) problems.push(`Ollama isn't reachable at ${OLLAMA_HOST} — start it, then re-sync.`)
  if (ollamaReachable && !embedInstalled) problems.push(`Embedding model "${cfg.embedModel}" isn't installed — pull it in Settings, then Sync Index.`)
  if (vaultExists && ollamaReachable && embedInstalled && unindexed.length > 0) problems.push(`${unindexed.length} note(s) on disk aren't indexed yet — click Sync Index (or wait for auto-sync).`)
  if (ollamaReachable && !rerankInstalled) problems.push(`Reranker "${cfg.rerankModel}" isn't installed — search falls back to hybrid ranking. Build it with scripts/install-models-16gb.sh, or turn it off in Settings.`)
  if (indexModel && !modelMatches) problems.push(`The index was built with "${indexModel}" but the embedding model is now "${cfg.embedModel}" — it re-embeds on the next sync (or click Rebuild index).`)
  if (stale.length > 0) problems.push(`${stale.length} indexed note(s) no longer exist on disk — they'll be pruned on next sync.`)

  return NextResponse.json({
    vault: { path: cfg.vaultPath, exists: vaultExists, notesOnDisk: onDisk.length },
    index: { chunks, indexedNotes, model: indexModel, modelMatches, dbPath: indexDbPath(), cwd: process.cwd() },
    embed: { model: cfg.embedModel, ollamaReachable, embedInstalled, host: OLLAMA_HOST },
    rerank: { model: cfg.rerankModel || null, installed: rerankInstalled },
    unindexed: unindexed.slice(0, 50),
    unindexedCount: unindexed.length,
    stale: stale.slice(0, 50),
    staleCount: stale.length,
    ok: problems.length === 0,
    problems,
  })
}
