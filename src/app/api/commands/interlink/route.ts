import { NextRequest, NextResponse } from 'next/server'
import { buildInterlinkChanges } from '@/lib/interlink'

// Deterministic graph builder. Proposes wikilinks for unlinked mentions of existing
// notes + stub notes for broken-link targets. Standard change-proposal contract, so
// it flows through the review/diff/approve UI before anything is written.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: number; createStubs?: boolean }
    const { changes, linksAdded, stubsProposed, scanned } = buildInterlinkChanges({
      limit: Math.min(80, Math.max(1, body.limit ?? 40)),
      createStubs: body.createStubs ?? true,
    })

    const parts: string[] = []
    if (linksAdded) parts.push(`${linksAdded} new [[wikilink]](s) across ${changes.filter(c => c.action === 'update').length} note(s)`)
    if (stubsProposed) parts.push(`${stubsProposed} stub note(s) to resolve broken links`)

    return NextResponse.json({
      origin: 'interlink',
      changes,
      log_entry: `Interlink — grew the vault graph: ${parts.join(', ') || 'no changes needed'} (scanned ${scanned} notes).`,
      summary: parts.length ? `Proposed ${parts.join(' and ')}.` : 'No new connections found — the graph is already well-linked.',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Interlink failed' },
      { status: 500 }
    )
  }
}
