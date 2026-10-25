import { NextResponse } from 'next/server'
import fs from 'fs'
import { getConfig } from '@/lib/config'
import { OLLAMA_HOST, MLX_HOST, isMlxModel } from '@/lib/ollama'
import { indexStats } from '@/lib/embeddings'
import { countMarkdownFiles } from '@/lib/vault'
import { vaultInitState } from '@/lib/vaultInit'

// One call that tells the onboarding wizard exactly what's ready and what isn't.
export async function GET() {
  const cfg = getConfig()

  // Vault
  let vaultValid = false
  let noteCount = 0
  if (cfg.vaultPath) {
    try {
      if (fs.statSync(cfg.vaultPath).isDirectory()) {
        vaultValid = true
        noteCount = countMarkdownFiles(cfg.vaultPath)
      }
    } catch { /* invalid path */ }
  }

  // Ollama + installed models
  let ollamaReachable = false
  let installed: string[] = []
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500), cache: 'no-store' })
    if (res.ok) {
      ollamaReachable = true
      const data = await res.json() as { models?: Array<{ name: string }> }
      installed = (data.models ?? []).map(m => m.name)
    }
  } catch { /* not running */ }

  // MLX-served models ("mlx:<repo>") live outside Ollama; count them as present
  // when the local MLX server answers (it loads the repo on first request).
  let mlxReachable = false
  const cfgModels = [cfg.chatModel, cfg.writerModel, cfg.librarianModel, cfg.visionModel]
  if (cfgModels.some(isMlxModel)) {
    try {
      const res = await fetch(`${MLX_HOST}/health`, { signal: AbortSignal.timeout(2500), cache: 'no-store' })
      mlxReachable = res.ok
    } catch { /* not running */ }
    if (mlxReachable) installed = Array.from(new Set([...installed, ...cfgModels.filter(isMlxModel)]))
  }

  const hasModel = (want: string) => isMlxModel(want) ? mlxReachable
    : installed.some(m => m === want || m === `${want}:latest` || m.split(':')[0] === want.split(':')[0])

  // Index
  let chunks = 0
  try { chunks = indexStats().chunks } catch { /* no index yet */ }

  // First-run scaffolding state (only meaningful once a valid vault is set).
  let init = { empty: false, hasClaudeMd: false, noteCount }
  if (vaultValid) {
    try { init = vaultInitState() } catch { /* leave defaults */ }
  }

  return NextResponse.json({
    configured: vaultValid,
    vault: { path: cfg.vaultPath, valid: vaultValid, noteCount },
    init,
    schedule: {
      caretakeEnabled: cfg.caretakeEnabled,
      caretakeHour: cfg.caretakeHour,
      syncIntervalHours: cfg.syncIntervalHours,
    },
    ollama: {
      host: OLLAMA_HOST,
      reachable: ollamaReachable,
      installed,
      chatModel: cfg.chatModel,
      writerModel: cfg.writerModel,
      librarianModel: cfg.librarianModel,
      embedModel: cfg.embedModel,
      visionModel: cfg.visionModel,
      rerankModel: cfg.rerankModel,
      hasRerankModel: ollamaReachable && !!cfg.rerankModel && hasModel(cfg.rerankModel),
      hasChatModel: (ollamaReachable || isMlxModel(cfg.chatModel)) && hasModel(cfg.chatModel),
      hasWriterModel: (ollamaReachable || isMlxModel(cfg.writerModel)) && hasModel(cfg.writerModel),
      hasLibrarianModel: (ollamaReachable || isMlxModel(cfg.librarianModel)) && hasModel(cfg.librarianModel),
      hasEmbedModel: ollamaReachable && hasModel(cfg.embedModel),
      hasVisionModel: (ollamaReachable || isMlxModel(cfg.visionModel)) && hasModel(cfg.visionModel),
      mlx: { host: MLX_HOST, reachable: mlxReachable },
      chatNumCtx: cfg.chatNumCtx,
      // True when the two roles point at the same model as chat (single-model setup).
      splitActive: cfg.writerModel !== cfg.chatModel || cfg.librarianModel !== cfg.chatModel,
    },
    index: { chunks, built: chunks > 0 },
  })
}
