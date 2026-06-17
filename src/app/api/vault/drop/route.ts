import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getVaultPath } from '@/lib/vault'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const ALLOWED_EXTS = new Set(['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.webp'])

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const fileName = file.name
    const ext = path.extname(fileName).toLowerCase()

    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ error: `Unsupported file type: ${ext}` }, { status: 400 })
    }

    // Determine target directory
    const targetDir = IMAGE_EXTS.has(ext)
      ? path.join(getVaultPath(), 'Assets')
      : getVaultPath()

    fs.mkdirSync(targetDir, { recursive: true })

    let targetPath = path.join(targetDir, fileName)

    // If file already exists, save to _inbox/
    if (fs.existsSync(targetPath)) {
      const inboxDir = path.join(getVaultPath(), '_inbox')
      fs.mkdirSync(inboxDir, { recursive: true })
      targetPath = path.join(inboxDir, fileName)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(targetPath, buffer)

    const savedPath = path.relative(getVaultPath(), targetPath)
    return NextResponse.json({ savedPath })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
