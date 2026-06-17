// Local-only Ollama client. Security boundary: this is the ONLY module in the
// app that makes outbound HTTP requests, and it only ever talks to OLLAMA_HOST
// (default http://localhost:11434). No vault data is sent anywhere else.

import { getConfig } from '@/lib/config'

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'

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
}): Promise<string> {
  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getConfig().chatModel,
      messages: opts.messages,
      stream: false,
      ...(opts.format ? { format: opts.format } : {}),
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { message: { content: string } }
  return data.message.content
}

// Describe/OCR an image with the configured vision model. Images are base64
// (no data: prefix), per Ollama's /api/chat "images" field.
export async function ollamaVisionChat(opts: {
  prompt: string
  imagesBase64: string[]
}): Promise<string> {
  const url = `${OLLAMA_HOST}/api/chat`
  assertLocalHost(url)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getConfig().visionModel,
      messages: [{ role: 'user', content: opts.prompt, images: opts.imagesBase64 }],
      stream: false,
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama vision failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { message: { content: string } }
  return data.message.content
}

export async function ollamaEmbed(text: string): Promise<number[]> {
  const url = `${OLLAMA_HOST}/api/embed`
  assertLocalHost(url)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getConfig().embedModel,
      input: text,
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings[0]
}
