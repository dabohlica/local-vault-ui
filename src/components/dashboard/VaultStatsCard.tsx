'use client'

import { useEffect, useState } from 'react'
import { Database, GitBranch, FileText, Clock } from 'lucide-react'

type Stats = {
  totalFiles: number
  lastModified: string
  gitStatus: string
  gitBranch: string
}

export function VaultStatsCard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/vault/stats')
        if (res.ok) {
          const data = await res.json() as Stats
          setStats(data)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const statusLines = stats?.gitStatus
    ? stats.gitStatus.trim().split('\n').filter(Boolean)
    : []

  return (
    <div className="card p-4 flex flex-col gap-3 self-start">
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(20,184,166,0.15)' }}
        >
          <Database size={14} style={{ color: 'var(--teal)' }} />
        </div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Vault Stats</h2>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Loading…</p>
        </div>
      ) : stats ? (
        <div className="space-y-2.5">
          <StatRow icon={<FileText size={12} />} label="MD Files" value={String(stats.totalFiles)} />
          <StatRow icon={<Clock size={12} />} label="Last Modified" value={stats.lastModified} />
          <StatRow icon={<GitBranch size={12} />} label="Branch" value={stats.gitBranch || 'main'} />
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-subtle)' }}>Git Status</p>
            {statusLines.length === 0 ? (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--success)' }}
              >
                Clean
              </span>
            ) : (
              <div className="space-y-0.5">
                {statusLines.slice(0, 4).map((line, i) => (
                  <p key={i} className="text-xs font-mono truncate" style={{ color: 'var(--warning)' }}>
                    {line}
                  </p>
                ))}
                {statusLines.length > 4 && (
                  <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                    +{statusLines.length - 4} more
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Could not load stats</p>
      )}
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5" style={{ color: 'var(--text-subtle)' }}>
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{value}</span>
    </div>
  )
}
