'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Code2, ExternalLink, Loader2, FileText } from 'lucide-react'

type FrontmatterData = Record<string, string | number | boolean | string[]>

type FileData = {
  content: string
  path: string
  frontmatter: FrontmatterData
  body: string
}

type Props = {
  filePath: string | null
}

export function MarkdownPreview({ filePath }: Props) {
  const [data, setData] = useState<FileData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!filePath) {
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
          Select a file from the tree to preview
        </p>
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
        className="flex items-center justify-between px-6 py-3 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {filePath.split('/').at(-1)?.replace('.md', '')}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>{filePath}</p>
        </div>
        <button
          onClick={() => void openInVSCode()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-150 hover:scale-[1.02]"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          <Code2 size={12} />
          Edit in VS Code
          <ExternalLink size={10} />
        </button>
      </div>

      {/* Frontmatter */}
      {fmKeys.length > 0 && (
        <div
          className="px-6 py-3 flex-shrink-0 flex flex-wrap gap-2 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--row-alt)' }}
        >
          {fmKeys.map(key => {
            const val = data.frontmatter[key]
            const display = Array.isArray(val) ? val.join(', ') : String(val)
            return (
              <div
                key={key}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--text-subtle)' }}>{key}:</span>
                <span style={{ color: 'var(--text-muted)' }}>{display}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Markdown content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="markdown-body max-w-3xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.body}</ReactMarkdown>
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
