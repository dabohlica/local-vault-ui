import { NextResponse } from 'next/server'
import { listVaultTags } from '@/lib/tags'

// Existing frontmatter tags across the vault, most-used first — feeds the capture
// tag picker's autocomplete so users reuse tags instead of coining near-duplicates.
export async function GET() {
  try {
    return NextResponse.json({ tags: listVaultTags() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list tags', tags: [] },
      { status: 500 }
    )
  }
}
