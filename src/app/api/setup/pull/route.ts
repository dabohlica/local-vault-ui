import { NextRequest } from 'next/server'
import { OLLAMA_HOST } from '@/lib/ollama'

export const dynamic = 'force-dynamic'

// Proxies `ollama pull <model>` and streams its progress to the browser as SSE,
// so colleagues can install models from the wizard without touching a terminal.
export async function GET(req: NextRequest) {
  const model = req.nextUrl.searchParams.get('model')
  if (!model) return new Response('Missing model', { status: 400 })

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (data: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: true }),
          cache: 'no-store',
        })
        if (!res.ok || !res.body) {
          send({ type: 'error', message: `Pull failed: ${res.status}` })
          controller.close()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const obj = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string }
              if (obj.error) { send({ type: 'error', message: obj.error }); continue }
              const pct = obj.total ? Math.round(((obj.completed ?? 0) / obj.total) * 100) : undefined
              send({ type: 'progress', status: obj.status, pct })
            } catch { /* ignore partial line */ }
          }
        }
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Pull failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
