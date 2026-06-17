import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { resolveVaultPath, appendToLog } from '@/lib/vault'
import { syncIndex } from '@/lib/embeddings'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      changes: Array<{ path: string; action: 'create' | 'update'; content: string }>
      log_entry?: string
    }

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
    }

    const written: string[] = []
    for (const change of body.changes) {
      if (!change.path || change.content === undefined) continue
      const absPath = resolveVaultPath(change.path)
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
      fs.writeFileSync(absPath, change.content, 'utf-8')
      written.push(change.path)
    }

    if (body.log_entry) {
      appendToLog(`Curated via local AI assistant — affected: ${written.join(', ')}\n\n${body.log_entry}`)
    }

    // Re-embed only the changed notes
    await syncIndex()

    return NextResponse.json({ success: true, written })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Apply failed' },
      { status: 500 }
    )
  }
}
