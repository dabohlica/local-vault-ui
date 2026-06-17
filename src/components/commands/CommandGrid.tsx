'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { CommandCard } from './CommandCard'
import { LOCAL_COMMANDS, type LocalCommand } from '@/lib/commands'
import { ProposalFlow } from '@/components/shared/ProposalFlow'
import { HealthReport } from './HealthReport'

export function CommandGrid() {
  const [active, setActive] = useState<LocalCommand | null>(null)

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {LOCAL_COMMANDS.map(cmd => (
          <CommandCard key={cmd.id} command={cmd} onRun={() => setActive(cmd)} />
        ))}
      </div>

      {/* Slide-over runner */}
      {active && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setActive(null)} />
      )}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col overflow-y-auto"
        style={{
          width: '560px',
          maxWidth: '92vw',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          transform: active ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease-out',
          boxShadow: active ? '-8px 0 40px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {active && (
          <>
            <div
              className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0 sticky top-0 z-10"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
            >
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{active.title}</h3>
                <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-subtle)' }}>
                  <span className="font-mono">/{active.id}</span>
                  <span className="px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}>
                    local · on-device
                  </span>
                </p>
              </div>
              <button
                onClick={() => setActive(null)}
                className="p-1.5 rounded-lg transition-all duration-150 hover:scale-110"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              {active.mode === 'local-deterministic' ? (
                <HealthReport key={active.id} />
              ) : (
                <ProposalFlow
                  key={active.id}
                  inputLabel={active.inputLabel}
                  inputPlaceholder={active.inputPlaceholder}
                  submitLabel={`Run ${active.title}`}
                  request={(input) =>
                    fetch('/api/commands/local', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: active.id, input }),
                    })
                  }
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
