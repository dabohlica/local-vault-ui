import { NextRequest, NextResponse } from 'next/server'
import { retrieve } from '@/lib/embeddings'
import { buildCurationPrompt } from '@/lib/prompts'
import { ollamaChatStructured } from '@/lib/ollama'
import { normalizeChanges } from '@/lib/healthFix'
import { applyTags } from '@/lib/tags'
import { reconcileUpdates } from '@/lib/merge'

type CurationResult = {
  changes: Array<{ path: string; action: 'create' | 'update' | 'move' | 'delete'; content?: string; from?: string; to?: string }>
  log_entry: string
  summary: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { text: string; tags?: string[] }
    if (!body.text?.trim()) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 })
    }

    const chunks = await retrieve(body.text, 8)
    const messages = buildCurationPrompt(body.text, chunks, [], body.tags)
    const { result, raw } = await ollamaChatStructured<CurationResult>({ messages, role: 'librarian' })

    if (!result) {
      return NextResponse.json(
        { error: 'The model returned an incomplete or unreadable proposal', raw },
        { status: 502 }
      )
    }

    if (!Array.isArray(result.changes)) {
      return NextResponse.json(
        { error: 'Model response missing "changes" array', raw },
        { status: 502 }
      )
    }

    // Guarantee the user's chosen tags land on every touched note (code-enforced,
    // after normalize so frontmatter is present) — independent of the model.
    result.changes = applyTags(normalizeChanges(await reconcileUpdates(result.changes)), body.tags ?? [])
    return NextResponse.json({ ...result, origin: 'add' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Curate failed' },
      { status: 500 }
    )
  }
}
