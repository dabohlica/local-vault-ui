'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Code2, Loader2, FileText, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import { ConnectionsPanel } from '@/components/explorer/ConnectionsPanel'

type FrontmatterData = Record<string, string | number | boolean | string[]>

type FileData = {
  content: string
  path: string
  frontmatter: FrontmatterData
  body: string
}

type Props = {
  filePath: string | null
  // Mobile master/detail: clears the selection to return to the file tree.
  onBack?: () => void
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i

function assetUrl(vaultPath: string): string {
  return `/api/vault/asset?path=${encodeURIComponent(vaultPath)}`
}

// Obsidian image embeds — ![[Knowledge/Images/x.png]] or ![[x.png|alt]] — are not
// standard markdown; rewrite them to ![alt](/api/vault/asset?…) so ReactMarkdown
// renders the actual image. Non-image [[wikilinks]] are left untouched.
function renderImageEmbeds(body: string): string {
  return body.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (whole, target: string, alt?: string) =>
    IMAGE_RE.test(target.trim()) ? `![${alt ?? target.trim().split('/').pop()}](${assetUrl(target.trim())})` : whole
  )
}

// [[Target|alias]] → a markdown link: to the note when it resolves (per the link
// graph), else to "#missing" which renders as a muted, dashed "not written yet".
function renderWikilinks(body: string, resolved: Map<string, string>): string {
  return body.replace(/(?<!!)\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => {
    const t = target.trim()
    const label = (alias ?? t.split('/').pop() ?? t).replace(/[[\]]/g, '')
    const hit = resolved.get(t.toLowerCase())
    return hit ? `[${label}](/explorer?file=${encodeURIComponent(hit)})` : `[${label}](#missing)`
  })
}

function obsidianUrl(vaultPath: string, notePath: string): string {
  const vault = vaultPath.split('/').filter(Boolean).pop() ?? ''
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(notePath.replace(/\.md$/, ''))}`
}

export function MarkdownPreview({ filePath, onBack }: Props) {
  const [data, setData] = useState<FileData | null>(null)
  const [resolved, setResolved] = useState<Map<string, string>>(new Map())
  const [vaultPath, setVaultPath] = useState('')
  const [showProps, setShowProps] = useState(false)

  useEffect(() => {
    fetch('/api/setup/status').then(r => r.json()).then(d => setVaultPath(d.vault?.path ?? '')).catch(() => {})
  }, [])

  // Where this note's [[links]] point, so they can be clicked.
  useEffect(() => {
    setResolved(new Map())
    if (!filePath || IMAGE_RE.test(filePath)) return
    fetch(`/api/graph?note=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then((d: { outgoing?: Array<{ target: string; path: string | null }> }) => {
        const m = new Map<string, string>()
        for (const c of d.outgoing ?? []) if (c.path) m.set(c.target.toLowerCase(), c.path)
        setResolved(m)
      })
      .catch(() => {})
  }, [filePath])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isImageFile = !!filePath && IMAGE_RE.test(filePath)

  useEffect(() => {
    if (!filePath || IMAGE_RE.test(filePath)) {
      setData(null)
      return
    }

    setLoading(true)
    setError(null)

    async function load() {
      try {
        const res = await fetch(`/api/vault/file?path=${encodeURIComponent(filePath!)}`)
        if (!res.ok) throw new Error('File not found')
        const raw = await res.json() as { content: string; path: string }

        // Parse frontmatter
        const { frontmatter, body } = parseFrontmatter(raw.content)
        setData({ content: raw.content, path: raw.path, frontmatter, body })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading file')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [filePath])

  async function openInVSCode() {
    if (!filePath) return
    await fetch('/api/vault/open-vscode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    })
  }

  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--bg-elevated)' }}
        >
          <FileText size={28} style={{ color: 'var(--text-subtle)' }} />
        </div>
        <p className="text-sm" style={{ color: 'var(--text-subtle)' }}>
          Pick a note on the left, or press ⌘K to find one
        </p>
      </div>
    )
  }

  // Direct image preview — vault images (e.g. Knowledge/Images/…) open like notes.
  if (isImageFile) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div
          className="flex items-center gap-2 px-4 md:px-6 py-3 flex-shrink-0 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        >
          {onBack && (
            <button onClick={onBack} className="md:hidden p-1.5 -ml-1 rounded-lg flex-shrink-0" style={{ color: 'var(--text-muted)' }} aria-label="Back to files">
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{filePath.split('/').at(-1)}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{filePath}</p>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetUrl(filePath)} alt={filePath} className="max-w-full rounded-xl" style={{ border: '1px solid var(--border)' }} />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <p className="p-6 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
    )
  }

  if (!data) return null

  const fmKeys = Object.keys(data.frontmatter)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* File header */}
      <div
        className="flex items-center justify-between gap-2 px-4 md:px-6 py-3 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Back to the file tree — mobile only. */}
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 rounded-lg flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Back to files"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
              {filePath.split('/').at(-1)?.replace('.md', '')}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{filePath}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {vaultPath && (
            <a href={obsidianUrl(vaultPath, data.path)} className="btn btn-ghost text-xs py-1.5 px-2.5" title="Open this note in Obsidian to edit it">
              Open in Obsidian
            </a>
          )}
          <button onClick={() => void openInVSCode()} className="p-2 rounded-lg hover-surface" style={{ color: 'var(--text-subtle)' }} title="Edit in VS Code" aria-label="Edit in VS Code">
            <Code2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 md:px-10 py-6">
          {/* Properties (frontmatter), folded away by default. */}
          {fmKeys.length > 0 && (
            <div className="mb-5">
              <button onClick={() => setShowProps(v => !v)} className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>
                {showProps ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Properties
                {!showProps && data.frontmatter.type && <span className="ml-1.5 px-1.5 rounded" style={{ background: 'var(--bg-elevated)' }}>{String(data.frontmatter.type)}</span>}
              </button>
              {showProps && (
                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                  {fmKeys.map(key => {
                    const val = data.frontmatter[key]
                    return (
                      <div key={key} className="contents">
                        <dt style={{ color: 'var(--text-subtle)' }}>{key}</dt>
                        <dd className="break-words" style={{ color: 'var(--text-muted)' }}>{Array.isArray(val) ? val.join(', ') : String(val)}</dd>
                      </div>
                    )
                  })}
                </dl>
              )}
            </div>
          )}

          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  if (href === '#missing') return <span className="wikilink-missing" title="No note with this name yet">{children}</span>
                  if (href?.startsWith('/')) return <Link href={href} className="wikilink">{children}</Link>
                  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                },
              }}
            >
              {renderWikilinks(renderImageEmbeds(data.body), resolved)}
            </ReactMarkdown>
          </div>
          <ConnectionsPanel notePath={data.path} />
        </div>
      </div>
    </div>
  )
}

function parseFrontmatter(content: string): { frontmatter: FrontmatterData; body: string } {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
  const match = fmRegex.exec(content)

  if (!match) return { frontmatter: {}, body: content }

  const yamlText = match[1]
  const body = content.slice(match[0].length)
  const frontmatter: FrontmatterData = {}

  for (const line of yamlText.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    if (!key) continue

    // Simple array detection
    if (val.startsWith('[') && val.endsWith(']')) {
      frontmatter[key] = val
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
    } else {
      frontmatter[key] = val.replace(/^["']|["']$/g, '')
    }
  }

  return { frontmatter, body }
}
