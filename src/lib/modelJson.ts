// Robustly parse JSON out of a local model's reply. Small models often wrap the
// JSON in ```json fences, add a sentence before/after, or emit trailing commas —
// a bare JSON.parse then fails ("non-JSON response"). This strips fences and
// extracts the outermost {...} object before parsing. Returns null on failure.
export function parseModelJson<T = unknown>(raw: string): T | null {
  if (!raw) return null
  let s = raw.trim()

  // Strip ``` / ```json fences if the whole thing is fenced.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s)
  if (fence) s = fence[1].trim()

  // Direct parse first.
  try { return JSON.parse(s) as T } catch { /* fall through */ }

  // Extract the outermost object spanning the first '{' to the last '}'.
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const candidate = s.slice(start, end + 1)
    try { return JSON.parse(candidate) as T } catch { /* fall through */ }
    // Last resort: drop trailing commas before } or ].
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')) as T } catch { /* give up */ }
  }
  return null
}
