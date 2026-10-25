import {
  denseSearch, lexicalSearch, titleMatches, getChunk, chunksOfNote,
  type IndexedChunk, type RetrievedChunk, type ScoredId,
} from '@/lib/embeddings'
import { ollamaRerank } from '@/lib/ollama'
import { getConfig } from '@/lib/config'
import { readNote, stripFrontmatter } from '@/lib/vault'

// Retrieval pipeline over the chunk index (src/lib/embeddings.ts):
//
//   query ─┬─ dense (embedding cosine)      ─┐
//          ├─ lexical (FTS5 BM25)            ├─ reciprocal-rank fusion ─ rerank (optional) ─ hits
//          └─ title match (People/<Name>.md) ┘
//
// Fusion uses ranks, not raw scores, so the three signals don't need calibrating
// against each other. The reranker (a cross-encoder) then reads query + excerpt
// together, which is far more precise than comparing two independent vectors —
// and gives a calibrated relevance probability used to drop irrelevant context.

const RRF_K = 60          // standard RRF constant: damps the gap between rank 1 and rank 2
const CANDIDATES = 50     // per-signal candidate depth fed into fusion
const RERANK_TOP = 20     // fused hits the cross-encoder re-scores
const MIN_RELEVANCE = 0.05 // reranked hits below this are dropped from chat context…
const MIN_KEEP = 3        // …but never below this many, so the model always has something

export type SearchHit = IndexedChunk & { score: number; rerankScore?: number }
export type SearchMode = 'dense' | 'lexical' | 'hybrid'

// Reciprocal-rank fusion: each list contributes 1/(k + rank) per item.
export function reciprocalRankFusion(lists: number[][], k = RRF_K): Map<number, number> {
  const fused = new Map<number, number>()
  for (const list of lists) {
    list.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank + 1)))
  }
  return fused
}

// Title matches are note-level; represent each by the note's best-ranked dense
// chunk (or its first chunk) so it can join the chunk-level fusion.
function titleList(query: string, dense: ScoredId[]): number[] {
  const out: number[] = []
  for (const { notePath } of titleMatches(query).slice(0, CANDIDATES)) {
    const inDense = dense.find(d => getChunk(d.id)?.notePath === notePath)
    const id = inDense?.id ?? chunksOfNote(notePath)[0]?.id
    if (id !== undefined) out.push(id)
  }
  return out
}

let warnedRerank = false

export async function searchChunks(
  query: string,
  opts: { mode?: SearchMode; rerank?: boolean; limit?: number } = {},
): Promise<SearchHit[]> {
  const mode = opts.mode ?? 'hybrid'
  const limit = opts.limit ?? 20

  let ranked: ScoredId[]
  if (mode === 'dense') ranked = await denseSearch(query, CANDIDATES)
  else if (mode === 'lexical') ranked = lexicalSearch(query, CANDIDATES)
  else {
    const dense = await denseSearch(query, CANDIDATES)
    const lexical = lexicalSearch(query, CANDIDATES)
    const fused = reciprocalRankFusion([dense.map(d => d.id), lexical.map(l => l.id), titleList(query, dense)])
    ranked = Array.from(fused, ([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
  }

  let hits: SearchHit[] = ranked
    .slice(0, Math.max(limit, opts.rerank ? RERANK_TOP : 0))
    .flatMap(r => { const c = getChunk(r.id); return c ? [{ ...c, score: r.score }] : [] })

  const model = getConfig().rerankModel
  if (opts.rerank && model && hits.length > 1) {
    try {
      const scores = await ollamaRerank(query, hits.map(h => h.content), model)
      hits = hits
        .map((h, i) => ({ ...h, rerankScore: scores[i] }))
        .sort((a, b) => b.rerankScore! - a.rerankScore! || b.score - a.score)
    } catch (err) {
      // Reranker missing/unsuitable: keep the fused order rather than failing chat.
      if (!warnedRerank) { warnedRerank = true; console.warn(`[search] reranker unavailable, using fused ranking: ${err}`) }
    }
  }
  return hits.slice(0, limit)
}

// Chunk-level context for curation/edit prompts (small, bounded).
export async function retrieve(query: string, k = 6, opts: { rerank?: boolean } = {}): Promise<RetrievedChunk[]> {
  const hits = await searchChunks(query, { limit: k, rerank: opts.rerank })
  return hits.map(h => ({ notePath: h.notePath, heading: h.heading, content: h.content, score: h.rerankScore ?? h.score }))
}

// Below this size a note is sent whole: the surrounding sections cost little and
// often hold the answer a single chunk missed.
const SMALL_NOTE_CHARS = 2500
const MAX_NOTE_CHARS = 5000

// Note-grouped context for chat answers, within a character budget. Replaces
// "7 full notes × 6000 chars": on a 16 GB machine the prompt prefill was the bulk
// of time-to-first-token, and most of those characters were irrelevant.
export async function retrieveContext(
  query: string,
  opts: { budgetChars?: number; maxNotes?: number; rerank?: boolean } = {},
): Promise<RetrievedChunk[]> {
  const budgetTotal = opts.budgetChars ?? getConfig().retrievalBudgetChars
  const maxNotes = opts.maxNotes ?? 6
  let hits = await searchChunks(query, { limit: RERANK_TOP, rerank: opts.rerank ?? true })

  // With calibrated reranker scores, drop clearly irrelevant excerpts.
  if (hits.some(h => h.rerankScore !== undefined)) {
    const relevant = hits.filter(h => (h.rerankScore ?? 0) >= MIN_RELEVANCE)
    hits = relevant.length >= MIN_KEEP ? relevant : hits.slice(0, MIN_KEEP)
  }

  // Group by note, in order of each note's best hit.
  const byNote = new Map<string, SearchHit[]>()
  for (const h of hits) byNote.set(h.notePath, [...(byNote.get(h.notePath) ?? []), h])

  const out: RetrievedChunk[] = []
  const seen = new Set<string>() // near-duplicate notes (duplicate imports)
  let budget = budgetTotal
  for (const [notePath, noteHits] of Array.from(byNote)) {
    if (out.length >= maxNotes || budget < 400) break
    const score = noteHits[0].rerankScore ?? noteHits[0].score
    const full = stripFrontmatter(readNote(notePath) ?? '').trim()
    if (!full) continue
    const key = full.slice(0, 400)
    if (seen.has(key)) continue
    seen.add(key)

    let content: string
    let heading: string
    if (full.length <= Math.min(SMALL_NOTE_CHARS, budget)) {
      content = full
      heading = '(full note)'
    } else {
      // The note's matching excerpts in document order (ids follow chunk order).
      content = [...noteHits].sort((a, b) => a.id - b.id).map(h => h.content).join('\n\n…\n\n')
      content = content.slice(0, Math.min(MAX_NOTE_CHARS, budget))
      heading = noteHits.map(h => h.heading).join(' · ')
    }
    budget -= content.length
    out.push({ notePath, heading, content, score })
  }
  return out
}
