// Client-side fetch with retry for transient network failures. A long-running
// local-model request that the browser drops surfaces as a bare "Failed to fetch"
// — a TypeError thrown by fetch() with no Response at all. We retry ONLY those
// (and not HTTP error responses, which are real and shouldn't be re-sent), so a
// momentary blip while Ollama is loading a model doesn't bubble up to the user.
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: { attempts?: number; backoffMs?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 2
  const backoffMs = opts.backoffMs ?? 800
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init)
    } catch (err) {
      // Only TypeError is a transport-level failure ("Failed to fetch"). Anything
      // else (e.g. AbortError) is intentional and must not be retried.
      if (!(err instanceof TypeError) || i === attempts - 1) throw err
      lastErr = err
      await new Promise(r => setTimeout(r, backoffMs * (i + 1)))
    }
  }
  throw lastErr
}
