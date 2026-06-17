import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { resolveVaultPath } from '@/lib/vault'

export async function GET(req: NextRequest) {
  const relativePath = req.nextUrl.searchParams.get('path')
  if (!relativePath) {
    return NextResponse.json({ error: 'Missing path param' }, { status: 400 })
  }

  try {
    const absPath = resolveVaultPath(relativePath)
    const content = fs.readFileSync(absPath, 'utf-8')
    return NextResponse.json({ content, path: relativePath })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'File not found' },
      { status: 404 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { path: string; content: string }
    if (!body.path || body.content === undefined) {
      return NextResponse.json({ error: 'Missing path or content' }, { status: 400 })
    }

    const absPath = resolveVaultPath(body.path)
    const dir = path.dirname(absPath)

    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(absPath, body.content, 'utf-8')

    return NextResponse.json({ success: true, path: body.path })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Write failed' },
      { status: 500 }
    )
  }
}
