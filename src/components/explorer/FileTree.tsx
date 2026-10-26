'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type FileNode = {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

type Props = {
  selectedPath: string | null
  onSelect: (path: string) => void
  filter?: string
}

// Keep files whose name/path contains the filter (and the folders leading to them).
function prune(node: FileNode, q: string): FileNode | null {
  if (node.type === 'file') return node.path.toLowerCase().includes(q) ? node : null
  const children = (node.children ?? []).map(c => prune(c, q)).filter((c): c is FileNode => !!c)
  return children.length ? { ...node, children } : null
}

export function FileTree({ selectedPath, onSelect, filter = '' }: Props) {
  const [tree, setTree] = useState<FileNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/vault/tree')
        if (!res.ok) throw new Error('Failed to load tree')
        const data = await res.json() as FileNode
        setTree(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading tree')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-subtle)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-xs p-4" style={{ color: 'var(--danger)' }}>{error}</p>
    )
  }

  if (!tree) return null

  const q = filter.trim().toLowerCase()
  const shown = q ? prune(tree, q) : tree

  return (
    <div className="overflow-y-auto h-full py-2 px-1">
      {!shown?.children?.length && (
        <p className="text-xs px-3 py-4" style={{ color: 'var(--text-subtle)' }}>No note names match. Press ⌘K to search inside notes.</p>
      )}
      {shown?.children?.map(node => (
        <TreeNode
          key={`${q}:${node.path}`}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          open={!!q}
        />
      ))}
    </div>
  )
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  open = false,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  open?: boolean
}) {
  // Expand folders on the way to the open note, and everything while filtering.
  const [expanded, setExpanded] = useState(open || (!!selectedPath && selectedPath.startsWith(node.path + '/')))

  const isSelected = node.path === selectedPath
  const indent = depth * 12

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-left rounded-md hover-surface"
          style={{
            paddingLeft: `${8 + indent}px`,
            color: 'var(--text-muted)',
          }}
        >
          {expanded ? (
            <ChevronDown size={12} style={{ flexShrink: 0 }} />
          ) : (
            <ChevronRight size={12} style={{ flexShrink: 0 }} />
          )}
          {expanded ? (
            <FolderOpen size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
          ) : (
            <Folder size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                open={open}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-left rounded-md',
        !isSelected && 'hover-surface'
      )}
      style={{
        paddingLeft: `${8 + indent}px`,
        background: isSelected ? 'var(--primary-tint)' : 'transparent',
        color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
      }}
    >
      <FileText size={12} style={{ flexShrink: 0 }} />
      <span className="truncate">{node.name.replace('.md', '')}</span>
    </button>
  )
}
