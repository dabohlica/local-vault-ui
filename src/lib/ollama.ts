// Local-only Ollama client. Security boundary: this is the ONLY module in the
// app that makes outbound HTTP requests, and it only ever talks to OLLAMA_HOST
// (default http://localhost:11434). No vault data is sent anywhere else.

import { getConfig } from '@/lib/config'
import { parseStructuredOutput } from '@/lib/structuredOutput'

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'

// Keep the model resident between requests so back-to-back calls don't pay a cold
// model-load each time. Cold loads (and swapping between the chat and embed models)
// are the main reason a request runs long enough for the browser to drop it with a
// bare "Failed to fetch". Overridable via OLLAMA_KEEP_ALIVE (e.g. "0" to disable).
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '30m'

function assertLocalHost(url: string) {
  const { hostname } = new URL(url)
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error(`Refusing to call non-local Ollama host: ${hostname}`)
  }
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function ollamaChat(opts: {
  messages: ChatMessage[]
  format?: 'json'
  // Context window. Ollama defaults to a tiny 2048 tokens, which silently TRUNCATES
  // big prompts (e.g. a dropped PDF + _CLAUDE.md + retrieved notes) — dropping the
  // "return JSON" instructions and leaving no room to finish the reply, so JSON
  // comes back incomplete/unparseable. Defaults to the user-tunable config value
  // (chatNumCtx); callers can still override for unusually large-document work.
  numCtx?: number
  // Which side of the writer/librarian split handles this call (see MODEL-SELECTION.md):
  //   'writer'    — prose (chat answers, note merges)        → writerModel
  //   'librarian' — structured/JSON work (curation, ingest…) → librarianModel
  // Both resolve to chatModel unless the user configured a split, so omitting it (or
  // any legacy caller) just uses chatModel — unchanged behavior.
  role?: 'writer' | 'librarian'
  // Reasoning ("thinking") models emit a long hidden chain-of-thought before the
  // answer — pure latency that, on a cold/slow machine, runs the request long
  // enough for the browser to drop it ("NetworkError"/"Failed to fetch"). These
  // are extraction/curation tasks that don't need it, so we DISABLE thinking by
  // default. Pass think:true only where reasoning genuinely helps. (Ignored by
  // non-thinking models.)
  think?: boolean
}): Promise<string> {
  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const cfg = getConfig()
  const model = opts.role === 'writer' ? cfg.writerModel
    : opts.role === 'librarian' ? cfg.librarianModel
    : cfg.chatModel

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream: false,
      keep_alive: KEEP_ALIVE,
      think: opts.think ?? false,
      ...(opts.format ? { format: opts.format } : {}),
      options: { num_ctx: opts.numCtx ?? getConfig().chatNumCtx },
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { message: { content: string } }
  return data.message.content
}

// Streaming counterpart to ollamaChat: yields the answer as content deltas instead
// of returning it whole. This is what keeps a phone (or any non-localhost client)
// connection alive — bytes flow continuously as the model generates, so an idle
// network hop can't drop the request the way a 30-60s silent POST gets dropped
// ("Failed to fetch"). Same local-only guarantees and options as ollamaChat.
export async function* ollamaChatStream(opts: {
  messages: ChatMessage[]
  numCtx?: number
  role?: 'writer' | 'librarian'
  think?: boolean
}): AsyncGenerator<string> {
  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const cfg = getConfig()
  const model = opts.role === 'writer' ? cfg.writerModel
    : opts.role === 'librarian' ? cfg.librarianModel
    : cfg.chatModel

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream: true,
      keep_alive: KEEP_ALIVE,
      think: opts.think ?? false,
      options: { num_ctx: opts.numCtx ?? cfg.chatNumCtx },
    }),
  })

  if (!res.ok || !res.body) {
    throw new Error(`Ollama chat failed: ${res.status} ${res.ok ? 'no response body' : await res.text()}`)
  }

  // Ollama streams newline-delimited JSON, one object per token-ish chunk:
  //   {"message":{"role":"assistant","content":"He"},"done":false}\n
  // ...ending with {"done":true,...}. Buffer partial lines across reads.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let obj: { message?: { content?: string }; error?: string }
        try { obj = JSON.parse(line) } catch { continue } // ignore a partial/garbled line
        if (obj.error) throw new Error(`Ollama chat failed: ${obj.error}`)
        const delta = obj.message?.content
        if (delta) yield delta
      }
    }
  } finally {
    // If the consumer stops early (an error downstream, or the route's client
    // disconnecting), cancel the upstream read so we don't leak the connection to
    // Ollama. Harmless once the stream has already completed.
    await reader.cancel().catch(() => {})
  }
}

// Structured chat with retry. The prompt asks the model for the @@@ block format
// (see structuredOutput.ts) instead of JSON, so the model only has to write the
// note "parts" — the JSON punctuation is assembled in code. This removes the whole
// class of "Model did not return valid JSON" failures from mismatched quotes/braces
// in long note bodies. We still retry: if a reply has no usable blocks (empty/cut
// off), a plain re-ask usually succeeds. NOT format:'json' — that would force JSON
// and defeat the point. parseStructuredOutput also falls back to JSON, so a model
// that ignores the format and emits JSON anyway still works. Returns the parsed
// object plus the last raw reply, or { result: null } if every attempt failed.
export async function ollamaChatStructured<T = unknown>(opts: {
  messages: ChatMessage[]
  numCtx?: number
  role?: 'writer' | 'librarian'
  // Total attempts (default 3). The first uses the prompt as-is; later attempts
  // append a terse corrective instruction.
  attempts?: number
}): Promise<{ result: T | null; raw: string }> {
  const attempts = opts.attempts ?? 3
  let raw = ''
  for (let i = 0; i < attempts; i++) {
    const messages = i === 0 ? opts.messages : [
      ...opts.messages,
      {
        role: 'system' as const,
        content:
          'Your previous reply was incomplete or did not use the block format. Re-send it using the ' +
          'exact @@@SUMMARY / @@@LOG / @@@CHANGE / @@@CONTENT / @@@END markers, each on its own line. ' +
          'Do not truncate — finish every @@@CONTENT block and end with @@@END.',
      },
    ]
    try {
      raw = await ollamaChat({ messages, numCtx: opts.numCtx, role: opts.role })
    } catch (err) {
      // Transient call failure (model loading, server busy) — retry if attempts remain.
      if (i === attempts - 1) throw err
      continue
    }
    const result = parseStructuredOutput<T>(raw)
    if (result) return { result, raw }
  }
  return { result: null, raw }
}

// Preload the generative models into memory so the FIRST real request doesn't pay
// a cold model-load — which for a multi-GB model can take minutes and blow past the
// browser's connection timeout (the "NetworkError"/"Failed to fetch" the user hits
// right after opening the app). Sending /api/generate with just a model + keep_alive
// loads it and returns immediately without generating. Best-effort and fast to fail
// if Ollama isn't up. Warms the librarian and writer models (deduped).
export async function ollamaWarm(): Promise<void> {
  const url = `${OLLAMA_HOST}/api/generate`
  assertLocalHost(url)
  const cfg = getConfig()
  const models = Array.from(new Set([cfg.librarianModel, cfg.writerModel, cfg.chatModel].filter(Boolean)))
  await Promise.all(models.map(model =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: KEEP_ALIVE }),
    }).catch(() => { /* Ollama down / model missing — non-fatal */ })
  ))
}

// Describe/OCR an image with a vision-capable model. Images are base64 (no data:
// prefix), per Ollama's /api/chat "images" field. `model` lets the caller pick the
// model — so a multimodal CHAT model (e.g. Gemma 3) can read images directly,
// without requiring a separate vision model to be installed.
export async function ollamaVisionChat(opts: {
  prompt: string
  imagesBase64: string[]
  model?: string
}): Promise<string> {
  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? getConfig().visionModel,
      messages: [{ role: 'user', content: opts.prompt, images: opts.imagesBase64 }],
      stream: false,
      keep_alive: KEEP_ALIVE,
      options: { num_ctx: 8192 },
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama vision failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { message: { content: string } }
  return data.message.content
}

// Stable marker we tag onto genuine context-window-overflow errors, so the caller
// can decide to split-and-retry on THOSE only — not on transient failures (model
// still loading, server busy) that happen to contain "400"/"too long" in the body.
// Misclassifying those as overflow is what silently exploded the index into tiny
// chunks and made the chunk count non-deterministic across rebuilds.
export const EMBED_CONTEXT_OVERFLOW = 'EMBED_CONTEXT_OVERFLOW'

// Real context-overflow signatures from Ollama / llama.cpp. Deliberately narrow.
const CONTEXT_OVERFLOW_RE = /context (length|window)|maximum context|exceeds?.*context|input (length|is too) /i

export async function ollamaEmbed(text: string): Promise<number[]> {
  const url = `${OLLAMA_HOST}/api/embed`
  assertLocalHost(url)

  // An empty/whitespace input makes Ollama 400 with a non-context error; never send
  // one (and never store a bogus embedding for it).
  if (!text.trim()) throw new Error('Ollama embed failed: empty input')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getConfig().embedModel,
      input: text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    // Only a genuine context overflow is tagged for split-and-retry. Everything
    // else (model loading, OOM, server busy) propagates as a plain failure so the
    // note is skipped — not silently shredded into sub-300-char fragments.
    const overflow = (res.status === 400 || res.status === 413) && CONTEXT_OVERFLOW_RE.test(body)
    throw new Error(`Ollama embed failed: ${res.status} ${body}${overflow ? ` [${EMBED_CONTEXT_OVERFLOW}]` : ''}`)
  }

  const data = await res.json() as { embeddings?: number[][] }
  const embedding = data.embeddings?.[0]
  if (!embedding?.length) throw new Error('Ollama embed failed: model returned no embedding')
  return embedding
}
