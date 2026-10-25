// Local-only model client. Security boundary: this is the ONLY module in the
// app that makes outbound HTTP requests, and it only ever talks to OLLAMA_HOST
// (default http://localhost:11434) or, for models named "mlx:<repo>", to a local
// MLX server at MLX_HOST (default http://127.0.0.1:8080, `mlx_vlm.server`). Both
// are asserted to be loopback before every call. No vault data leaves the device.

import { getConfig } from '@/lib/config'
import { parseStructuredOutput } from '@/lib/structuredOutput'

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
export const MLX_HOST = process.env.MLX_HOST ?? 'http://127.0.0.1:8080'

// "mlx:mlx-community/GLM-4.6V-Flash-4bit" → served by MLX (Apple-Silicon native,
// faster than llama.cpp for models Ollama can't run on MLX itself), via the
// OpenAI-compatible API of mlx_vlm.server. Everything else goes to Ollama.
export function isMlxModel(model: string): boolean {
  return model.startsWith('mlx:')
}

// Max new tokens for MLX replies (Ollama has no cap by default; MLX servers do).
// Structured proposals carry FULL note contents, so they get the larger budget.
const MLX_MAX_TOKENS = { prose: 4096, structured: 8192 }

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

function modelFor(role: 'writer' | 'librarian' | undefined): string {
  const cfg = getConfig()
  return role === 'writer' ? cfg.writerModel : role === 'librarian' ? cfg.librarianModel : cfg.chatModel
}

// Some models emit reasoning in <think>…</think> even with thinking disabled, and
// GLM-V wraps final answers in <|begin_of_box|>…<|end_of_box|>. Neither belongs
// in a note or chat answer.
export function stripModelArtifacts(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .replace(/^[\s\S]*?<\/think>\s*/, '') // opening tag consumed by the template
    .replace(/<\|(begin|end)_of_box\|>/g, '')
}

// Streaming counterpart: drops <think>…</think> spans and box tokens across delta
// boundaries. Holds back a short tail that could be the start of a tag.
export function createArtifactFilter(): { push(delta: string): string; flush(): string } {
  let buf = ''
  let thinking = false
  const TAGS = ['<think>', '</think>', '<|begin_of_box|>', '<|end_of_box|>']
  const maxTag = Math.max(...TAGS.map(t => t.length))
  const drain = (final: boolean): string => {
    let out = ''
    for (;;) {
      if (thinking) {
        const end = buf.indexOf('</think>')
        if (end === -1) { if (final) buf = ''; else buf = buf.slice(-maxTag); return out }
        buf = buf.slice(end + '</think>'.length).replace(/^\s+/, '')
        thinking = false
        continue
      }
      const start = buf.indexOf('<think>')
      const cleaned = (start === -1 ? buf : buf.slice(0, start)).replace(/<\|(begin|end)_of_box\|>/g, '')
      if (start !== -1) { out += cleaned; buf = buf.slice(start + '<think>'.length); thinking = true; continue }
      if (final) { out += cleaned; buf = ''; return out }
      // Keep a possible partial tag at the end for the next delta.
      const lt = cleaned.lastIndexOf('<')
      const keep = lt !== -1 && cleaned.length - lt < maxTag ? cleaned.length - lt : 0
      out += cleaned.slice(0, cleaned.length - keep)
      buf = cleaned.slice(cleaned.length - keep)
      return out
    }
  }
  return { push: (d) => { buf += d; return drain(false) }, flush: () => drain(true) }
}

type MlxContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

async function mlxRequest(model: string, messages: Array<{ role: string; content: MlxContent }>, opts: { stream: boolean; maxTokens: number }): Promise<Response> {
  const url = `${MLX_HOST}/v1/chat/completions`
  assertLocalHost(url)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.slice('mlx:'.length),
        messages,
        stream: opts.stream,
        max_tokens: opts.maxTokens,
        enable_thinking: false,
      }),
    })
  } catch {
    throw new Error(`MLX server not reachable at ${MLX_HOST} — start it with scripts/install-models-16gb.sh's server command.`)
  }
  if (!res.ok || (opts.stream && !res.body)) {
    throw new Error(`MLX chat failed: ${res.status} ${res.ok ? 'no response body' : await res.text()}`)
  }
  return res
}

async function mlxChat(model: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
  const res = await mlxRequest(model, messages, { stream: false, maxTokens })
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return stripModelArtifacts(data.choices?.[0]?.message?.content ?? '')
}

// OpenAI-style SSE: "data: {json}\n\n" … "data: [DONE]".
async function* mlxChatStream(model: string, messages: ChatMessage[]): AsyncGenerator<string> {
  const res = await mlxRequest(model, messages, { stream: true, maxTokens: MLX_MAX_TOKENS.prose })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const filter = createArtifactFilter()
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
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') { const tail = filter.flush(); if (tail) yield tail; return }
        let obj: { choices?: Array<{ delta?: { content?: string } }>; error?: unknown }
        try { obj = JSON.parse(payload) } catch { continue }
        if (obj.error) throw new Error(`MLX chat failed: ${JSON.stringify(obj.error)}`)
        const delta = obj.choices?.[0]?.delta?.content
        if (delta) { const out = filter.push(delta); if (out) yield out }
      }
    }
    const tail = filter.flush()
    if (tail) yield tail
  } finally {
    await reader.cancel().catch(() => {})
  }
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
  const model = modelFor(opts.role)
  if (isMlxModel(model)) {
    return mlxChat(model, opts.messages, opts.role === 'librarian' ? MLX_MAX_TOKENS.structured : MLX_MAX_TOKENS.prose)
  }

  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

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
  return stripModelArtifacts(data.message.content)
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
  const model = modelFor(opts.role)
  if (isMlxModel(model)) {
    yield* mlxChatStream(model, opts.messages)
    return
  }

  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream: true,
      keep_alive: KEEP_ALIVE,
      think: opts.think ?? false,
      options: { num_ctx: opts.numCtx ?? getConfig().chatNumCtx },
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
  const filter = createArtifactFilter()
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
        if (delta) { const out = filter.push(delta); if (out) yield out }
      }
    }
    const tail = filter.flush()
    if (tail) yield tail
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
    isMlxModel(model)
      // MLX loads on first request; a 1-token completion makes that happen now.
      ? mlxChat(model, [{ role: 'user', content: 'hi' }], 1).catch(() => { /* server down — non-fatal */ })
      : fetch(url, {
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
  const model = opts.model ?? getConfig().visionModel
  if (isMlxModel(model)) {
    const content: MlxContent = [
      { type: 'text', text: opts.prompt },
      ...opts.imagesBase64.map(b64 => ({ type: 'image_url' as const, image_url: { url: `data:${sniffImageMime(b64)};base64,${b64}` } })),
    ]
    const res = await mlxRequest(model, [{ role: 'user', content }], { stream: false, maxTokens: MLX_MAX_TOKENS.prose })
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return stripModelArtifacts(data.choices?.[0]?.message?.content ?? '')
  }

  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
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
  return stripModelArtifacts(data.message.content)
}

// Data-URI type from the base64 magic bytes (PNG/JPEG/WebP/GIF).
function sniffImageMime(b64: string): string {
  if (b64.startsWith('iVBOR')) return 'image/png'
  if (b64.startsWith('/9j/')) return 'image/jpeg'
  if (b64.startsWith('UklGR')) return 'image/webp'
  if (b64.startsWith('R0lGOD')) return 'image/gif'
  return 'image/png'
}

// Stable marker we tag onto genuine context-window-overflow errors, so the caller
// can decide to split-and-retry on THOSE only — not on transient failures (model
// still loading, server busy) that happen to contain "400"/"too long" in the body.
// Misclassifying those as overflow is what silently exploded the index into tiny
// chunks and made the chunk count non-deterministic across rebuilds.
export const EMBED_CONTEXT_OVERFLOW = 'EMBED_CONTEXT_OVERFLOW'

// Real context-overflow signatures from Ollama / llama.cpp. Deliberately narrow.
const CONTEXT_OVERFLOW_RE = /context (length|window)|maximum context|exceeds?.*context|input (length|is too) /i

const EMBED_NUM_CTX = Number(process.env.OLLAMA_EMBED_NUM_CTX) || 2048

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
      // Chunks are ≤2000 chars (~600 tokens). Without a cap Ollama loads the
      // embedder with the server's default context (16k), which for
      // qwen3-embedding:0.6b costs ~2.7 GB instead of ~0.7 GB — RAM a 16 GB
      // machine needs for the generative model. Longer inputs hit the overflow
      // split-and-retry path in embeddings.ts.
      options: { num_ctx: EMBED_NUM_CTX },
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

// --- Reranking ---------------------------------------------------------------
// Cross-encoder relevance scoring with a Qwen3-Reranker model served by Ollama.
// Ollama has no rerank endpoint, but it returns token logprobs: the reranker is
// trained to answer "yes"/"no" to "does this document answer the query?", so
// P(yes) / (P(yes) + P(no)) for the single generated token IS the relevance score
// (the same computation as the model card). Requires a correctly converted model
// whose LM head is intact — see scripts/install-models-16gb.sh, which builds one
// from the official weights (some community GGUFs return uniform logprobs).

const RERANK_PREFIX =
  '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct ' +
  'provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
const RERANK_SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
const RERANK_INSTRUCT = 'Given a question about a personal knowledge base, judge whether this note excerpt helps answer it'
const RERANK_DOC_CHARS = 3000 // chunks are ≤2000 chars; guard the 2048-token window
const RERANK_CONCURRENCY = 4

// Relevance from the first generated token's top logprobs (case/space-insensitive).
export function yesProbability(top: Array<{ token: string; logprob: number }>): number {
  let yes = 0, no = 0
  for (const t of top) {
    const tok = t.token.trim().toLowerCase()
    if (tok === 'yes') yes += Math.exp(t.logprob)
    else if (tok === 'no') no += Math.exp(t.logprob)
  }
  return yes + no > 0 ? yes / (yes + no) : 0
}

async function rerankOne(model: string, query: string, doc: string): Promise<number> {
  const url = `${OLLAMA_HOST}/api/generate`
  assertLocalHost(url)
  const prompt = `${RERANK_PREFIX}<Instruct>: ${RERANK_INSTRUCT}\n<Query>: ${query}\n<Document>: ${doc.slice(0, RERANK_DOC_CHARS)}${RERANK_SUFFIX}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      raw: true,
      stream: false,
      logprobs: true,
      top_logprobs: 20,
      keep_alive: KEEP_ALIVE,
      options: { num_predict: 1, temperature: 0, num_ctx: 2048 },
    }),
  })
  if (!res.ok) throw new Error(`Ollama rerank failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { logprobs?: Array<{ top_logprobs?: Array<{ token: string; logprob: number }> }> }
  const top = data.logprobs?.[0]?.top_logprobs
  if (!top) throw new Error('Ollama rerank failed: no logprobs returned (Ollama too old, or not a reranker model)')
  return yesProbability(top)
}

// Scores aligned with `docs`. Throws if the model is missing/unsuitable — callers
// fall back to the fused ranking.
export async function ollamaRerank(query: string, docs: string[], model = getConfig().rerankModel): Promise<number[]> {
  const scores = new Array<number>(docs.length)
  let next = 0
  const worker = async () => {
    while (next < docs.length) {
      const i = next++
      scores[i] = await rerankOne(model, query, docs[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(RERANK_CONCURRENCY, docs.length) }, worker))
  return scores
}
