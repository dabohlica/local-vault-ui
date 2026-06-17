import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getVaultPath } from '@/lib/vault'

const execFileAsync = promisify(execFile)

export async function POST() {
  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['-C', getVaultPath(), 'pull'],
      { timeout: 30000 }
    )
    return NextResponse.json({ stdout: stdout || stderr || 'Already up to date.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'git pull failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
