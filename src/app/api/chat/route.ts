import { NextRequest, NextResponse } from 'next/server'
import { retrieve, retrieveNotes, indexStats, syncIndex } from '@/lib/embeddings'
import { buildRagPrompt, buildCurationPrompt } from '@/lib/prompts'
import { normalizeChanges } from '@/lib/healthFix'
import { ollamaChatStream, ollamaChatStructured } from '@/lib/ollama'
import { getConfig } from '@/lib/config'
import { appendToSession, getSession } from '@/lib/chatHistory'

// A cold model load can take minutes; don't let the platform abort the request.
export const maxDuration = 300

// Stream newline-delimited JSON events to the client. Each `write` flushes one JSON
// object + "\n"; the constant byte flow is what keeps a phone/LAN connection from
// being dropped mid-answer. Errors raised inside `producer` are surfaced as a final
// {type:'error'} event rather than tearing the response down. The no-transform /
// X-Accel-Buffering headers tell any intermediary proxy not to buffer the stream.
function ndjsonStream(producer: (write: (obj: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  // If the client disconnects, the stream is cancelled. We let the producer run to
  // completion anyway (so the answer is still generated and persisted to the session
  // — reload then shows it), but make `write` a no-op: enqueueing on a cancelled
  // controller throws, and that throw would otherwise become an unhandled rejection.
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) => {
        if (cancelled) return
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }
      try {
        await producer(write)
      } catch (err) {
        write({ type: 'error', error: err instanceof Error ? err.message : 'Chat failed' })
      } finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() { cancelled = true },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { question: string; mode?: 'ask' | 'edit'; sessionId?: string }
    if (!body.question?.trim()) {
      return NextResponse.json({ error: 'Missing question' }, { status: 400 })
    }

    // Keep the index fresh so newly added/edited notes are answerable without a
    // manual "Sync Index". Incremental: only re-embeds changed notes (fast when
    // nothing changed). If the embed model is down, fall back to the existing index.
    let stats = indexStats()
    if (stats.chunks > 0) {
      try { await syncIndex() } catch { /* embed model unavailable — use existing index */ }
      stats = indexStats()
    }

    // Empty index = nothing to search. This is the usual cause of "I don't know"
    // about something that IS in the notes: the index was never built (often
    // because the embedding model wasn't installed). Say so explicitly.
    if (stats.chunks === 0) {
      const msg =
        `I don't have any of your notes indexed on this machine yet, so I can't search them.\n\n` +
        `**To fix it:** make sure the embedding model \`${getConfig().embedModel}\` is installed ` +
        `(Settings → Embedding model → Pull), then click **Sync Index** in the top bar (or **Build index** ` +
        `in Settings). Ask again once it finishes. The index is per-machine and isn't shared via git.`
      // Streamed (not JSON) so the client has a single ask-mode code path.
      return ndjsonStream(async (write) => {
        write({ type: 'meta', citations: [], indexEmpty: true })
        write({ type: 'token', v: msg })
        write({ type: 'done', sessionId: body.sessionId })
      })
    }

    // Prior turns from THIS session only — context never bleeds across conversations.
    const history = body.sessionId ? (getSession(body.sessionId)?.messages ?? []) : []
    const priorUserTurns = history.filter(m => m.role === 'user').slice(-2).map(m => m.content)

    // Expand the retrieval query with recent user turns so pronouns/topics in a
    // follow-up still fetch the right notes (the embedding of "his role?" alone
    // retrieves nothing useful).
    const retrievalQuery = [...priorUserTurns, body.question].join('\n')

    // EDIT MODE — turn the instruction into a reviewable change-proposal (create /
    // update / move / delete), using the same curation pipeline as the Curate page,
    // with the chat history so "save what we just discussed" resolves. Nothing is
    // written here; the client reviews the diffs and applies via /api/curate/apply.
    // Uses light chunk-level context (not full notes) — a small model produces clean
    // JSON only with a bounded prompt; full-note context overflows it.
    if (body.mode === 'edit') {
      const editChunks = await retrieve(retrievalQuery, 6)
      const editCitations = Array.from(
        new Map(editChunks.map(c => [c.notePath, { path: c.notePath, heading: c.heading }])).values()
      )
      const messages = buildCurationPrompt(body.question, editChunks, history)
      // Curation is the heaviest prompt we build (_CLAUDE.md + 6 chunks + history +
      // a long spec) and asks for FULL file contents back. If the context window is
      // too small the prompt truncates — and the model runs out of room to finish the
      // reply, so the proposal comes back incomplete. Uses the config window
      // (chatNumCtx), tunable per machine + model.
      // Edit mode produces a structured change-proposal — librarian work.
      const { result, raw } = await ollamaChatStructured<{ changes?: unknown[]; log_entry?: string; summary?: string }>({ messages, role: 'librarian' })
      if (!result) {
        return NextResponse.json({
          error:
            'The model returned an incomplete proposal. This is usually the prompt overflowing the ' +
            "model's context window (a large _CLAUDE.md or a long conversation) — the model runs " +
            'out of room to finish the reply. Try a shorter request, start a new chat session, or ' +
            'trim _CLAUDE.md.',
          raw,
        }, { status: 502 })
      }
      if (!Array.isArray(result.changes) || result.changes.length === 0) {
        return NextResponse.json({ error: 'The model proposed no changes — try rephrasing the edit.', raw }, { status: 502 })
      }
      // Conform the proposed notes to the vault structure so the edit can't spawn
      // new frontmatter/preamble health issues.
      result.changes = normalizeChanges(result.changes as Array<{ path: string; action: string; content?: string; from?: string; to?: string }>)
      const sid = appendToSession(body.sessionId, [
        { role: 'user', content: body.question },
        { role: 'assistant', content: `Proposed ${result.changes.length} change(s): ${result.summary ?? ''}`.trim() },
      ])
      return NextResponse.json({ mode: 'edit', changes: result.changes, log_entry: result.log_entry, summary: result.summary, citations: editCitations, sessionId: sid })
    }

    // ASK MODE — grounded answer over full-note hybrid retrieval, streamed token by
    // token. Retrieval runs inside the stream so an embed-model failure surfaces as
    // an in-stream error event rather than a mismatched JSON response.
    return ndjsonStream(async (write) => {
      const chunks = await retrieveNotes(retrievalQuery, { topNotes: 7, perNoteChars: 6000 })
      const citations = Array.from(
        new Map(chunks.map(c => [c.notePath, { path: c.notePath, heading: c.heading }])).values()
      )
      // Citations are known before generation — send them first so the client can
      // render sources as soon as the answer starts.
      write({ type: 'meta', citations })

      const messages = buildRagPrompt(body.question, chunks, history)
      // A grounded prose answer for the user to read — writer work.
      let answer = ''
      for await (const delta of ollamaChatStream({ messages, role: 'writer' })) {
        answer += delta
        write({ type: 'token', v: delta })
      }
      if (!answer.trim()) throw new Error('The model returned an empty answer.')

      // Persist the exchange to this session (created if new) — the same write that,
      // before streaming, let a dropped request still show up on reload.
      const sid = appendToSession(body.sessionId, [
        { role: 'user', content: body.question },
        { role: 'assistant', content: answer, citations },
      ])
      write({ type: 'done', sessionId: sid })
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat failed' },
      { status: 500 }
    )
  }
}
