import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { readSources, SOURCE_PRESETS, validateSource, writeSources, type Source } from '@/lib/sources'
import { sourceStates } from '@/lib/inbox'

// Reads live state — never prerender at build time (next build would freeze it).
export const dynamic = 'force-dynamic'

// GET → configured sources, presets, per-source fetch state, schedule settings
// PUT { sources: [...] } → replace the list (validated; ids kept stable)
export async function GET() {
  const cfg = getConfig()
  return NextResponse.json({
    sources: readSources(),
    presets: SOURCE_PRESETS,
    states: sourceStates(),
    settings: {
      feedsEnabled: cfg.feedsEnabled,
      feedIntervalHours: cfg.feedIntervalHours,
      briefingHour: cfg.briefingHour,
      feedNoteFolder: cfg.feedNoteFolder,
    },
  })
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { sources?: unknown }
  if (!Array.isArray(body.sources)) return NextResponse.json({ error: 'sources must be an array' }, { status: 400 })
  if (body.sources.length > 50) return NextResponse.json({ error: 'At most 50 sources' }, { status: 400 })
  const out: Source[] = []
  for (const raw of body.sources) {
    const v = validateSource(raw)
    if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
    if (out.some(s => s.id === v.id)) v.id = Math.random().toString(36).slice(2, 10)
    out.push(v)
  }
  writeSources(out)
  return NextResponse.json({ sources: out })
}
