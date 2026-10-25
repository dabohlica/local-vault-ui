import fs from 'fs'
import path from 'path'
import { denseSearch, lexicalSearch, getChunk, chunksOfNote, queryTerms, listIndexedNotePaths } from '@/lib/embeddings'
import { searchChunks } from '@/lib/search'
import { ollamaChat } from '@/lib/ollama'
import { getConfig } from '@/lib/config'
import { isMetaNote } from '@/lib/vault'

// Retrieval evaluation against YOUR vault. A golden set of (question → note that
// answers it) is generated once by the local model from sampled note excerpts,
// stored in data/retrieval-eval.json (edit it freely — hand-written questions are
// better), then every retrieval strategy is scored on it. Lets you see whether a
// change (new embedder, reranker, chunking) actually helps instead of guessing.

const EVAL_PATH = path.join(process.cwd(), 'data', 'retrieval-eval.json')
const RESULTS_PATH = path.join(process.cwd(), 'data', 'retrieval-eval-results.json')

export type EvalItem = { q: string; expect: string[]; source?: string }
export type EvalSet = { generatedAt: string; model: string; items: EvalItem[] }
export type Strategy = 'legacy' | 'dense' | 'lexical' | 'hybrid' | 'hybrid+graph' | 'hybrid+rerank' | 'hybrid+graph+rerank'
export type StrategyResult = { hit1: number; hit3: number; hit5: number; mrr10: number; avgMs: number }
export type EvalResults = { ranAt: string; embedModel: string; rerankModel: string; n: number; strategies: Record<string, StrategyResult> }

export function readEvalSet(): EvalSet | null {
  try { return JSON.parse(fs.readFileSync(EVAL_PATH, 'utf-8')) as EvalSet } catch { return null }
}

export function readEvalResults(): EvalResults | null {
  try { return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8')) as EvalResults } catch { return null }
}

// Deterministic PRNG so re-generating with the same n samples the same excerpts.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Sample one substantive excerpt from each of up to n notes and have the model
// write the question that excerpt answers.
export async function generateEvalSet(n = 30): Promise<EvalSet> {
  const rand = mulberry32(42)
  const notes = listIndexedNotePaths().filter(p => !isMetaNote(p)).sort()
  for (let i = notes.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [notes[i], notes[j]] = [notes[j], notes[i]] }

  const items: EvalItem[] = []
  for (const notePath of notes) {
    if (items.length >= n) break
    const candidates = chunksOfNote(notePath).filter(c => c.content.length >= 400)
    if (candidates.length === 0) continue
    const chunk = candidates[Math.floor(rand() * candidates.length)]
    const q = (await ollamaChat({
      role: 'writer',
      messages: [
        { role: 'system', content: 'You write evaluation questions for a search engine over one person\'s private notes.' },
        {
          role: 'user',
          content:
            `Excerpt from one of my notes:\n\n${chunk.content.slice(0, 1800)}\n\n` +
            'Write ONE natural question (at most 20 words) that this excerpt answers, the way I would ask it ' +
            'weeks later without the note in front of me. Paraphrase — do not copy distinctive phrases. Use the ' +
            "excerpt's language. Output only the question.",
        },
      ],
    })).trim().split('\n')[0].replace(/^["'„“]|["'“”]$/g, '').trim()
    if (q.length > 8) items.push({ q, expect: [notePath], source: chunk.heading })
  }
  const set: EvalSet = { generatedAt: new Date().toISOString(), model: getConfig().writerModel, items }
  fs.mkdirSync(path.dirname(EVAL_PATH), { recursive: true })
  fs.writeFileSync(EVAL_PATH, JSON.stringify(set, null, 2), 'utf-8')
  return set
}

// Unique notes in rank order.
function notesOf(ids: number[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    const p = getChunk(id)?.notePath
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

// The pre-upgrade ranking (dense max per note + substring keyword fraction +
// title bonus), kept here only as the baseline to compare against.
async function legacyRanking(query: string): Promise<string[]> {
  const dense = await denseSearch(query, Number.POSITIVE_INFINITY)
  const terms = queryTerms(query)
  const sem = new Map<string, number>()
  const lex = new Map<string, number>()
  for (const { id, score } of dense) {
    const c = getChunk(id)
    if (!c) continue
    if ((sem.get(c.notePath) ?? -1) < score) sem.set(c.notePath, score)
    const hay = c.content.toLowerCase()
    const hits = terms.filter(t => hay.includes(t)).length
    if (hits) lex.set(c.notePath, (lex.get(c.notePath) ?? 0) + hits)
  }
  return Array.from(sem.keys())
    .map(p => {
      const title = path.basename(p, '.md').toLowerCase()
      const lexNorm = Math.min(1, (lex.get(p) ?? 0) / Math.max(1, terms.length))
      return { p, s: (sem.get(p) ?? 0) + 0.5 * lexNorm + (terms.some(t => title.includes(t)) ? 0.6 : 0) }
    })
    .sort((a, b) => b.s - a.s)
    .map(x => x.p)
}

async function rankNotes(strategy: Strategy, query: string): Promise<string[]> {
  switch (strategy) {
    case 'legacy': return legacyRanking(query)
    case 'dense': return notesOf((await denseSearch(query, 50)).map(d => d.id))
    case 'lexical': return notesOf(lexicalSearch(query, 50).map(l => l.id))
    case 'hybrid': return notesOf((await searchChunks(query, { limit: 50, graph: false })).map(h => h.id))
    case 'hybrid+graph': return notesOf((await searchChunks(query, { limit: 50, graph: true })).map(h => h.id))
    case 'hybrid+rerank': return notesOf((await searchChunks(query, { limit: 20, rerank: true, graph: false })).map(h => h.id))
    case 'hybrid+graph+rerank': return notesOf((await searchChunks(query, { limit: 20, rerank: true, graph: true })).map(h => h.id))
  }
}

export async function runEval(
  strategies: Strategy[] = ['legacy', 'dense', 'lexical', 'hybrid', 'hybrid+graph', 'hybrid+rerank', 'hybrid+graph+rerank'],
): Promise<EvalResults> {
  const set = readEvalSet()
  if (!set?.items.length) throw new Error('No eval set yet — generate one first.')
  const cfg = getConfig()
  const active = strategies.filter(s => !s.endsWith('+rerank') || cfg.rerankModel)
  const out: Record<string, StrategyResult> = {}
  for (const strategy of active) {
    let hit1 = 0, hit3 = 0, hit5 = 0, mrr = 0, ms = 0
    for (const item of set.items) {
      const t = Date.now()
      const ranked = (await rankNotes(strategy, item.q)).slice(0, 10)
      ms += Date.now() - t
      const rank = ranked.findIndex(p => item.expect.includes(p))
      if (rank === 0) hit1++
      if (rank !== -1 && rank < 3) hit3++
      if (rank !== -1 && rank < 5) hit5++
      if (rank !== -1) mrr += 1 / (rank + 1)
    }
    const n = set.items.length
    const r = (x: number) => Math.round((x / n) * 1000) / 1000
    out[strategy] = { hit1: r(hit1), hit3: r(hit3), hit5: r(hit5), mrr10: r(mrr), avgMs: Math.round(ms / n) }
  }
  const results: EvalResults = {
    ranAt: new Date().toISOString(),
    embedModel: cfg.embedModel,
    rerankModel: cfg.rerankModel,
    n: set.items.length,
    strategies: out,
  }
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf-8')
  return results
}
