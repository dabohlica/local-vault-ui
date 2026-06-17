import { NextResponse } from 'next/server'
import { getVaultPath, buildFileTree } from '@/lib/vault'

export async function GET() {
  try {
    const tree = buildFileTree(getVaultPath(), getVaultPath())
    return NextResponse.json(tree)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build tree' },
      { status: 500 }
    )
  }
}
