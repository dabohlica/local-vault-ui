import { NextRequest, NextResponse } from 'next/server'
import { retrieve } from '@/lib/embeddings'
import { buildIngestPrompt } from '@/lib/prompts'
import { ollamaChatStructured } from '@/lib/ollama'
import { normalizeChanges } from '@/lib/healthFix'
import { applyTags } from '@/lib/tags'
import { reconcileUpdates } from '@/lib/merge'

// "Include conversation in the vault" — runs the current chat transcript through
// the SAME ingest pipeline a dropped document uses (retrieve context → draft a
// structured AI-first note → return a proposal for review). Nothing is written
// here; the client reviews the diff and applies it via /api/curate/apply.
export async function POST(req: NextRequest) {
  try {
    const { transcript, notes, tags } = (await req.json()) as { transcript?: string; notes?: string; tags?: string[] }
    if (!transcript?.trim()) {
      return NextResponse.json({ error: 'Empty conversation' }, { status: 400 })
    }

    const filename = `Conversation ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.md`
    const clipped = transcript.slice(0, 12000)
    const retrievalQuery = `${notes ? notes + ' ' : ''}${clipped}`.slice(0, 2000)
    const chunks = await retrieve(retrievalQuery, 6)
    const messages = buildIngestPrompt(filename, clipped, chunks, undefined, notes, tags)
    const { result, raw } = await ollamaChatStructured<{ changes?: unknown[]; log_entry?: string; summary?: string }>({ messages, role: 'librarian' })

    if (!result) {
      return NextResponse.json({ error: 'The model returned an incomplete or unreadable proposal', raw }, { status: 502 })
    }
    if (!Array.isArray(result.changes) || result.changes.length === 0) {
      return NextResponse.json({ error: 'Model proposed no note', raw }, { status: 502 })
    }
    result.changes = applyTags(normalizeChanges(await reconcileUpdates(result.changes as Array<{ path: string; action: string; content?: string }>)), tags ?? [])
    return NextResponse.json({ ...result, origin: 'chat' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to capture conversation' },
      { status: 500 }
    )
  }
}
