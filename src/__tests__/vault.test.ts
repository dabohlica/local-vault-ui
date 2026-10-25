import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveVaultPath, fileHash, contentHash, stampBaseHashes } from '@/lib/vault'
import { unsafeVaultPathReason } from '@/lib/config'

const { vaultDir } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  return { vaultDir: fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))) }
})
vi.mock('@/lib/config', async (orig) => ({
  ...(await orig<typeof import('@/lib/config')>()),
  getConfig: () => ({ vaultPath: vaultDir }),
}))


beforeAll(() => {
  fs.mkdirSync(path.join(vaultDir, 'Projects'), { recursive: true })
  fs.writeFileSync(path.join(vaultDir, 'Projects', 'A.md'), '# A\n')
})

describe('resolveVaultPath containment', () => {
  it('resolves normal notes inside the vault', () => {
    expect(resolveVaultPath('Projects/A.md')).toBe(path.join(vaultDir, 'Projects', 'A.md'))
  })
  it('refuses traversal, the root itself and hidden/system dirs', () => {
    // Leading ../ segments are stripped, so traversal attempts land inside the vault.
    for (const p of ['../outside.md', 'a/../../../etc/passwd', '/Projects/A.md']) {
      expect(resolveVaultPath(p).startsWith(vaultDir + path.sep), p).toBe(true)
    }
    expect(() => resolveVaultPath('')).toThrow()
    expect(() => resolveVaultPath('.git/hooks/pre-push')).toThrow(/hidden/)
    expect(() => resolveVaultPath('x/.obsidian/plugins/p/main.js')).toThrow(/hidden/)
  })
})

describe('base hashes', () => {
  it('fingerprints existing files and marks missing ones null', () => {
    expect(fileHash('Projects/A.md')).toBe(contentHash('# A\n'))
    expect(fileHash('Projects/Missing.md')).toBeNull()
  })
  it('stamps the move source, and prefers hashes of what the model saw', () => {
    const [u, m, c] = stampBaseHashes(
      [
        { action: 'update', path: 'Projects/A.md' },
        { action: 'move', from: 'Projects/A.md', to: 'Archive/A.md' },
        { action: 'create', path: 'New.md' },
      ],
      new Map([['Projects/A.md', 'seen-hash']]),
    )
    expect(u.baseHash).toBe('seen-hash')
    expect(m.baseHash).toBe('seen-hash')
    expect(c.baseHash).toBeNull()
  })
})

describe('unsafeVaultPathReason', () => {
  const home = '/Users/me', app = '/Users/me/code/vault-ui'
  it('rejects root, home, ancestors of home and the app dir', () => {
    expect(unsafeVaultPathReason('/', home, app)).toMatch(/root/)
    expect(unsafeVaultPathReason('/Users', home, app)).toMatch(/home/)
    expect(unsafeVaultPathReason('/Users/me', home, app)).toMatch(/home/)
    expect(unsafeVaultPathReason('/Users/me/code/vault-ui/data', home, app)).toMatch(/app/)
    expect(unsafeVaultPathReason('/Users/me/code', home, app)).toMatch(/app/)
  })
  it('accepts a normal vault folder', () => {
    expect(unsafeVaultPathReason('/Users/me/Documents/Vault', home, app)).toBeNull()
  })
})
