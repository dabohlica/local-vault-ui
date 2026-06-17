import { NextRequest, NextResponse } from 'next/server'
import { retrieve } from '@/lib/embeddings'
import { buildCommandPrompt } from '@/lib/prompts'
import { ollamaChat } from '@/lib/ollama'
import { getLocalCommand } from '@/lib/commands'

type CommandResult = {
  changes: Array<{ path: string; action: 'create' | 'update'; content: string }>
  log_entry: string
  summary: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { id: string; input: string }
    const command = getLocalCommand(body.id)
    if (!command) {
      return NextResponse.json({ error: `Unknown command: ${body.id}` }, { status: 404 })
    }
    if (!body.input?.trim()) {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 })
    }

    const chunks = command.retrieveK > 0
      ? await retrieve(body.input, command.retrieveK)
      : []

    const messages = buildCommandPrompt(command, body.input, chunks)
    const raw = await ollamaChat({ messages, format: 'json' })

    let result: CommandResult
    try {
      result = JSON.parse(raw) as CommandResult
    } catch {
      return NextResponse.json({ error: 'Model did not return valid JSON', raw }, { status: 502 })
    }

    if (!Array.isArray(result.changes)) {
      return NextResponse.json({ error: 'Model response missing "changes" array', raw }, { status: 502 })
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Command failed' },
      { status: 500 }
    )
  }
}
