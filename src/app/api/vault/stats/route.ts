import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getVaultPath, countMarkdownFiles } from '@/lib/vault'
import fs from 'fs'

const execFileAsync = promisify(execFile)

export async function GET() {
  try {
    const totalFiles = countMarkdownFiles(getVaultPath())

    // Get last modified file time
    let lastModified = 'Unknown'
    try {
      const vaultStat = fs.statSync(getVaultPath())
      lastModified = vaultStat.mtime.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      // ignore
    }

    // Git status
    let gitStatus = ''
    let gitBranch = 'main'
    try {
      const [statusResult, branchResult] = await Promise.all([
        execFileAsync('git', ['-C', getVaultPath(), 'status', '--short'], { timeout: 5000 }).catch(() => ({ stdout: '' })),
        execFileAsync('git', ['-C', getVaultPath(), 'branch', '--show-current'], { timeout: 5000 }).catch(() => ({ stdout: 'main' })),
      ])
      gitStatus = statusResult.stdout.trim()
      gitBranch = branchResult.stdout.trim() || 'main'
    } catch {
      // not a git repo
    }

    return NextResponse.json({ totalFiles, lastModified, gitStatus, gitBranch })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stats failed' },
      { status: 500 }
    )
  }
}
