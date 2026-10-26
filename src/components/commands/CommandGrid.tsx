'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { CommandCard } from './CommandCard'
import { LOCAL_COMMANDS, type LocalCommand } from '@/lib/commands'
import { ProposalFlow } from '@/components/shared/ProposalFlow'
import { HealthReport } from './HealthReport'
import { ProposalRunner } from './ProposalRunner'

export function CommandGrid() {
  const [active, setActive] = useState<LocalCommand | null>(null)

  // Deep link from Home / ⌘K: /commands?tool=health — also while this page is
  // already open (the component stays mounted across the push).
  const tool = useSearchParams().get('tool')
  useEffect(() => {
    const cmd = LOCAL_COMMANDS.find(c => c.id === tool)
    if (cmd) setActive(cmd)
  }, [tool])

  function close() {
    setActive(null)
    window.history.replaceState(null, '', '/commands')
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {LOCAL_COMMANDS.map(cmd => (
          <CommandCard key={cmd.id} command={cmd} onRun={() => setActive(cmd)} />
        ))}
      </div>

      {/* Slide-over runner */}
      {active && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={close} />
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
          boxShadow: active ? 'var(--shadow-pop)' : 'none',
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
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{active.desc}</p>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="p-1.5 rounded-lg hover-surface"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              {active.mode === 'local-deterministic' ? (
                <HealthReport key={active.id} />
              ) : active.mode === 'local-proposal' ? (
                <ProposalRunner
                  key={active.id}
                  endpoint={`/api/commands/${active.id}`}
                  runLabel="Find connections"
                  blurb="Looks for notes that mention each other without a link, and for links that point to notes that don’t exist yet. You approve each change."
                />
              ) : (
                <ProposalFlow
                  key={active.id}
                  inputLabel={active.inputLabel}
                  inputPlaceholder={active.inputPlaceholder}
                  submitLabel="Write it"
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
