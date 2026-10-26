'use client'

import { useEffect, useState } from 'react'
import { CompanionAvatar } from '@/components/companion/Avatar'
import { useCompanion } from '@/components/companion/CompanionContext'
import { useToast } from '@/components/shared/Toast'
import { COMPANIONS, COMPANION_KINDS, type CompanionKind } from '@/lib/companion'

// Choose who keeps your notes, and what they're called.
export function CompanionPicker() {
  const companion = useCompanion()
  const { showToast } = useToast()
  const [name, setName] = useState(companion.name)

  useEffect(() => { setName(companion.name) }, [companion.name])

  async function save(patch: { companionKind?: CompanionKind; companionName?: string }) {
    const res = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) { showToast('Couldn’t save that', 'error'); return }
    window.dispatchEvent(new Event('companion:updated'))
  }

  function pick(kind: CompanionKind) {
    if (kind === companion.kind) return
    // A default name follows the creature (Inka → Fenn); a custom one stays.
    const custom = name.trim() && name.trim() !== COMPANIONS[companion.kind].defaultName
    void save({ companionKind: kind, companionName: custom ? name.trim() : '' })
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Your companion</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>Who keeps your notes, answers your questions and argues with your ideas.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {COMPANION_KINDS.map(kind => {
          const def = COMPANIONS[kind]
          const active = kind === companion.kind
          return (
            <button key={kind} onClick={() => pick(kind)} aria-pressed={active}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors hover-surface"
              style={active ? { borderColor: 'var(--primary)', background: 'var(--primary-tint)' } : { borderColor: 'var(--border)' }}>
              <CompanionAvatar live kind={kind} size={120} />
              <span className="text-sm font-medium" style={{ color: active ? 'var(--primary)' : 'var(--text)' }}>{active ? companion.name : def.defaultName}</span>
              <span className="text-[11px] text-center leading-snug" style={{ color: 'var(--text-subtle)' }}>{def.creature.replace(/^an? /, '')}</span>
            </button>
          )
        })}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Name</span>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={24}
            onKeyDown={e => { if (e.key === 'Enter') void save({ companionName: name.trim() }) }}
            className="field flex-1 min-w-0 px-3 py-2 text-sm" placeholder={COMPANIONS[companion.kind].defaultName} />
          <button onClick={() => void save({ companionName: name.trim() })} disabled={name.trim() === companion.name} className="btn btn-ghost text-xs">Save</button>
        </div>
      </label>
    </div>
  )
}
