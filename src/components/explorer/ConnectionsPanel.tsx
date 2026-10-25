'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownLeft, Link2Off, Waypoints } from 'lucide-react'
import type { Connection, GraphNode, SchemaIssue } from '@/lib/graph'

type Data = { node: GraphNode | null; outgoing: Connection[]; backlinks: Connection[]; issues: SchemaIssue[] }

// "body link" reads better than the internal kind name; frontmatter relations
// keep their field name (related-people, project, …).
function kindLabel(kind: string): string {
  return kind === 'link' ? 'mentions' : kind
}

function group(conns: Connection[]): Array<[string, Connection[]]> {
  const m = new Map<string, Connection[]>()
  for (const c of conns) m.set(c.kind, [...(m.get(c.kind) ?? []), c])
  // Typed relations first, plain body links last.
  return Array.from(m).sort(([a], [b]) => (a === 'link' ? 1 : 0) - (b === 'link' ? 1 : 0) || a.localeCompare(b))
}

function Chip({ c }: { c: Connection }) {
  const label = (c.path ?? c.target).replace(/\.md$/, '').split('/').pop()
  if (!c.path) {
    return (
      <span className="text-xs px-2 py-1 rounded-lg flex items-center gap-1" title="No note with this name yet"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)', textDecoration: 'line-through dotted' }}>
        <Link2Off size={11} /> {label}
      </span>
    )
  }
  return (
    <Link href={`/explorer?file=${encodeURIComponent(c.path)}`} title={c.path}
      className="text-xs px-2 py-1 rounded-lg flex items-center gap-1.5 max-w-full transition-colors"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
      <span className="truncate">{label}</span>
      {c.type && <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-subtle)' }}>{c.type}</span>}
    </Link>
  )
}

// Graph neighborhood of the open note: typed relations, mentions, backlinks.
export function ConnectionsPanel({ notePath }: { notePath: string }) {
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    fetch(`/api/graph?note=${encodeURIComponent(notePath)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Data & { error?: string }) => { if (!cancelled && !d.error) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [notePath])

  if (!data) return null
  if (!data.outgoing.length && !data.backlinks.length) {
    return (
      <div className="max-w-3xl mt-8 pt-4 border-t text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-subtle)' }}>
        Not connected to any other note yet. The Interlink command can suggest links.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mt-8 pt-4 border-t flex flex-col gap-4" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-2">
        <Waypoints size={14} style={{ color: 'var(--primary)' }} />
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Connections</h3>
        {data.node?.type && (
          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--primary-tint)', color: 'var(--primary)' }}
            title={data.node.typeInferred ? 'Inferred from the folder (no type: in frontmatter)' : 'From frontmatter'}>
            {data.node.type}{data.node.typeInferred ? '?' : ''}
          </span>
        )}
      </div>

      {data.issues.map((i, n) => (
        <p key={n} className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)', color: 'var(--warning)' }}>{i.detail}</p>
      ))}

      {data.outgoing.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-subtle)' }}><ArrowUpRight size={12} /> Links to</p>
          {group(data.outgoing).map(([kind, conns]) => (
            <div key={kind} className="flex gap-2 items-start">
              <span className="text-xs w-28 flex-shrink-0 pt-1 truncate" style={{ color: 'var(--text-subtle)' }}>{kindLabel(kind)}</span>
              <div className="flex flex-wrap gap-1.5 min-w-0">{conns.map((c, i) => <Chip key={i} c={c} />)}</div>
            </div>
          ))}
        </div>
      )}

      {data.backlinks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-subtle)' }}><ArrowDownLeft size={12} /> Linked from ({data.backlinks.length})</p>
          {group(data.backlinks).map(([kind, conns]) => (
            <div key={kind} className="flex gap-2 items-start">
              <span className="text-xs w-28 flex-shrink-0 pt-1 truncate" style={{ color: 'var(--text-subtle)' }}>{kindLabel(kind)}</span>
              <div className="flex flex-wrap gap-1.5 min-w-0">{conns.map((c, i) => <Chip key={i} c={c} />)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
