import { NextRequest, NextResponse } from 'next/server'
import { generateEvalSet, readEvalResults, readEvalSet, runEval } from '@/lib/retrievalEval'

// Retrieval evaluation (see src/lib/retrievalEval.ts).
//   GET                          → current eval set size + last results
//   POST { action: 'generate', n } → (re)build the question set with the local model
//   POST { action: 'run' }         → score every strategy on it
export const maxDuration = 300

export async function GET() {
  const set = readEvalSet()
  return NextResponse.json({ items: set?.items.length ?? 0, generatedAt: set?.generatedAt ?? null, results: readEvalResults() })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; n?: number }
    if (body.action === 'generate') {
      const set = await generateEvalSet(Math.min(100, Math.max(5, Math.floor(body.n ?? 30))))
      return NextResponse.json({ items: set.items.length, sample: set.items.slice(0, 5) })
    }
    if (body.action === 'run') return NextResponse.json(await runEval())
    return NextResponse.json({ error: "action must be 'generate' or 'run'" }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Eval failed' }, { status: 500 })
  }
}
