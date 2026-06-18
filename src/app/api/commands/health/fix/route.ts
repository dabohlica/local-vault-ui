import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { scanVaultHealth, type HealthIssue } from '@/lib/health'
import { resolveVaultPath } from '@/lib/vault'
import { deterministicFix } from '@/lib/healthFix'

// Repair vault-health issues deterministically (no model, fully local, always a
// correct fix). Handles the two bulk structural issues — missing frontmatter and
// missing "For future Claude" preamble — by ADDING what's missing while preserving
// the note body verbatim. Broken wikilinks and empty notes need human judgment and
// are left alone. Output is the standard change-proposal contract, so fixes flow
// through the same review/diff/approve UI before anything is written.
const DETERMINISTIC: HealthIssue['kind'][] = ['missing-frontmatter', 'missing-preamble']

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: number }
    const limit = Math.min(50, Math.max(1, body.limit ?? 12))

    const report = scanVaultHealth()

    // Group deterministically-fixable issues by note.
    const byNote = new Map<string, Set<HealthIssue['kind']>>()
    for (const issue of report.issues) {
      if (!DETERMINISTIC.includes(issue.kind)) continue
      const set = byNote.get(issue.path) ?? new Set<HealthIssue['kind']>()
      set.add(issue.kind)
      byNote.set(issue.path, set)
    }

    const allFiles = Array.from(byNote.keys())
    const batch = allFiles.slice(0, limit)

    const changes: Array<{ path: string; action: 'update'; content: string }> = []
    for (const notePath of batch) {
      let content: string
      try {
        content = fs.readFileSync(resolveVaultPath(notePath), 'utf-8')
      } catch {
        continue
      }
      const fixed = deterministicFix(notePath, content, byNote.get(notePath)!)
      if (fixed && fixed !== content) {
        changes.push({ path: notePath, action: 'update', content: fixed })
      }
    }

    const remaining = Math.max(0, allFiles.length - batch.length)

    // How many issues this run can't touch (need human judgment), for an honest summary.
    const otherKinds = report.issues.filter(i => !DETERMINISTIC.includes(i.kind)).length

    return NextResponse.json({
      changes,
      log_entry: `Vault health auto-fix — added missing frontmatter / "For future Claude" preamble on ${changes.length} note(s), preserving existing content.`,
      summary:
        `Proposed structural fixes for ${changes.length} note(s)` +
        (remaining > 0 ? ` — ${remaining} more fixable note(s) after you apply these.` : '.') +
        (otherKinds > 0 ? ` ${otherKinds} issue(s) (broken links / empty notes) need a human and are left as-is.` : ''),
      remaining,
      fixableTotal: allFiles.length,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Health fix failed' },
      { status: 500 }
    )
  }
}
