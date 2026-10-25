import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/curate/apply/route'
import { contentHash } from '@/lib/vault'

const { vaultDir } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  return { vaultDir: fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-apply-'))) }
})
vi.mock('@/lib/config', async (orig) => ({
  ...(await orig<typeof import('@/lib/config')>()),
  getConfig: () => ({ vaultPath: vaultDir }),
}))
vi.mock('@/lib/embeddings', () => ({ syncIndex: async () => ({ notes: 0, chunks: 0, skipped: [] }) }))
vi.mock('@/lib/opsLog', () => ({ recordOperation: () => {} }))


function apply(changes: unknown[]) {
  return POST(new NextRequest('http://localhost/api/curate/apply', { method: 'POST', body: JSON.stringify({ changes }) }))
}

describe('apply refuses stale proposals', () => {
  it('writes when the note is unchanged since the proposal', async () => {
    fs.writeFileSync(path.join(vaultDir, 'N.md'), 'v1\n')
    const res = await (await apply([{ action: 'update', path: 'N.md', content: 'v1\nmore\n', baseHash: contentHash('v1\n') }])).json()
    expect(res.errors).toEqual([])
    expect(fs.readFileSync(path.join(vaultDir, 'N.md'), 'utf-8')).toBe('v1\nmore\n')
  })
  it('keeps newer edits when the note changed after the proposal', async () => {
    fs.writeFileSync(path.join(vaultDir, 'M.md'), 'edited in Obsidian\n')
    const res = await (await apply([{ action: 'update', path: 'M.md', content: 'proposal\n', baseHash: contentHash('original\n') }])).json()
    expect(res.errors[0]).toMatch(/changed since/)
    expect(fs.readFileSync(path.join(vaultDir, 'M.md'), 'utf-8')).toBe('edited in Obsidian\n')
  })
  it('refuses a "create" over a file that appeared meanwhile', async () => {
    fs.writeFileSync(path.join(vaultDir, 'C.md'), 'someone else made this\n')
    const res = await (await apply([{ action: 'create', path: 'C.md', content: 'x', baseHash: null }])).json()
    expect(res.errors).toHaveLength(1)
  })
  it('never writes into .git', async () => {
    const res = await (await apply([{ action: 'create', path: '.git/hooks/pre-push', content: 'rm -rf ~' }])).json()
    expect(res.errors[0]).toMatch(/hidden/)
  })
})
