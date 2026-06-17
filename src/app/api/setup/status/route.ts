import { NextResponse } from 'next/server'
import fs from 'fs'
import { getConfig } from '@/lib/config'
import { OLLAMA_HOST } from '@/lib/ollama'
import { indexStats } from '@/lib/embeddings'
import { countMarkdownFiles } from '@/lib/vault'

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
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) })
    if (res.ok) {
      ollamaReachable = true
      const data = await res.json() as { models?: Array<{ name: string }> }
      installed = (data.models ?? []).map(m => m.name)
    }
  } catch { /* not running */ }

  const hasModel = (want: string) =>
    installed.some(m => m === want || m === `${want}:latest` || m.split(':')[0] === want.split(':')[0])

  // Index
  let chunks = 0
  try { chunks = indexStats().chunks } catch { /* no index yet */ }

  return NextResponse.json({
    configured: vaultValid,
    vault: { path: cfg.vaultPath, valid: vaultValid, noteCount },
    ollama: {
      host: OLLAMA_HOST,
      reachable: ollamaReachable,
      installed,
      chatModel: cfg.chatModel,
      embedModel: cfg.embedModel,
      visionModel: cfg.visionModel,
      hasChatModel: ollamaReachable && hasModel(cfg.chatModel),
      hasEmbedModel: ollamaReachable && hasModel(cfg.embedModel),
      hasVisionModel: ollamaReachable && hasModel(cfg.visionModel),
    },
    index: { chunks, built: chunks > 0 },
  })
}
