import { NextRequest, NextResponse } from 'next/server'
import { retrieve } from '@/lib/embeddings'
import { buildCurationPrompt } from '@/lib/prompts'
import { ollamaChat } from '@/lib/ollama'

type CurationResult = {
  changes: Array<{ path: string; action: 'create' | 'update'; content: string }>
  log_entry: string
  summary: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { text: string }
    if (!body.text?.trim()) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 })
    }

    const chunks = await retrieve(body.text, 8)
    const messages = buildCurationPrompt(body.text, chunks)
    const raw = await ollamaChat({ messages, format: 'json' })

    let result: CurationResult
    try {
      result = JSON.parse(raw) as CurationResult
    } catch {
      return NextResponse.json(
        { error: 'Model did not return valid JSON', raw },
        { status: 502 }
      )
    }

    if (!Array.isArray(result.changes)) {
      return NextResponse.json(
        { error: 'Model response missing "changes" array', raw },
        { status: 502 }
      )
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Curate failed' },
      { status: 500 }
    )
  }
}
