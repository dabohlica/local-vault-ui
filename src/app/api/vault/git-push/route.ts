import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getVaultPath } from '@/lib/vault'

const execFileAsync = promisify(execFile)

type GitError = Error & { stdout?: string; stderr?: string; code?: number }

function git(cwd: string, args: string[]) {
  return execFileAsync('git', ['-C', cwd, ...args], { timeout: 30000 })
}

// Push local vault changes up to the remote so other devices (a second laptop,
// or Obsidian-mobile + Git on a phone) can pull them. The counterpart to
// git-pull/route.ts, and just as robust to the reasons a bare `git push` fails
// from a UI button:
//   - no remote / no upstream → clear message instead of an opaque 500
//   - DIRTY working tree       → the app writes notes and Obsidian rewrites
//                               .obsidian/workspace constantly, so there are
//                               almost always uncommitted edits. We COMMIT them
//                               first (never discarding anything), then push.
//   - rejected (remote ahead)  → tell the user to pull first rather than force.
export async function POST() {
  const cwd = getVaultPath()
  if (!cwd) {
    return NextResponse.json({ error: 'No vault configured.' }, { status: 400 })
  }

  // Must be a git repo with a configured upstream before we attempt anything.
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return NextResponse.json(
      { error: 'This vault is not a git repository — nothing to push.' },
      { status: 400 }
    )
  }
  try {
    await git(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])
  } catch {
    return NextResponse.json(
      { error: 'No upstream/remote configured for this branch — set one with `git branch --set-upstream-to`.' },
      { status: 400 }
    )
  }

  // 0) Commit any local changes first so they're included in the push. Inline
  //    identity so it works even if git user.name/email aren't configured.
  try {
    const { stdout } = await git(cwd, ['status', '--porcelain'])
    if (stdout.trim()) {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await git(cwd, ['add', '-A']) // stage tracked + untracked so nothing is left behind
      await git(cwd, [
        '-c', 'user.name=vault-ui', '-c', 'user.email=vault-ui@local',
        'commit', '--no-verify', '-m', `vault-ui: local vault changes (${stamp})`,
      ])
    }
  } catch (commitErr) {
    const e = commitErr as GitError
    return NextResponse.json(
      { error: `Couldn't commit local vault changes before pushing: ${(e.stderr || e.message || 'commit failed').trim()}` },
      { status: 500 }
    )
  }

  // 1) Nothing to push? Report cleanly instead of running a no-op push.
  try {
    const { stdout } = await git(cwd, ['rev-list', '--count', '@{u}..HEAD'])
    if (stdout.trim() === '0') {
      return NextResponse.json({ stdout: 'Nothing to push — already up to date.' })
    }
  } catch {
    // If the count fails for any reason, fall through and let the push speak.
  }

  // 2) Push. A rejection almost always means the remote has commits we lack —
  //    tell the user to pull/sync first rather than silently force-pushing.
  try {
    const { stdout, stderr } = await git(cwd, ['push'])
    return NextResponse.json({ stdout: stdout || stderr || 'Pushed local changes.' })
  } catch (pushErr) {
    const e = pushErr as GitError
    const text = `${e.stdout ?? ''}\n${e.stderr ?? ''}${e.message ?? ''}`
    if (/\[rejected\]|fetch first|non-fast-forward|behind its remote/i.test(text)) {
      return NextResponse.json(
        { error: 'Push rejected — the remote has changes you don\'t have yet. Pull/sync first, then push again.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: (e.stderr || e.message || 'git push failed').trim() }, { status: 500 })
  }
}
