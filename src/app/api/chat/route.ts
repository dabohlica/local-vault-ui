import { NextRequest, NextResponse } from 'next/server'
import { retrieve } from '@/lib/embeddings'
import { buildRagPrompt } from '@/lib/prompts'
import { ollamaChat } from '@/lib/ollama'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { question: string }
    if (!body.question?.trim()) {
      return NextResponse.json({ error: 'Missing question' }, { status: 400 })
    }

    const chunks = await retrieve(body.question, 6)
    const messages = buildRagPrompt(body.question, chunks)
    const answer = await ollamaChat({ messages })

    const citations = Array.from(
      new Map(chunks.map(c => [c.notePath, { path: c.notePath, heading: c.heading }])).values()
    )

    return NextResponse.json({ answer, citations })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat failed' },
      { status: 500 }
    )
  }
}
