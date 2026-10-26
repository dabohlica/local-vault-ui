'use client'

import { Layers, Activity, Network, Play, ChevronRight } from 'lucide-react'
import type { LocalCommand } from '@/lib/commands'

const ICON_MAP: Record<string, React.ElementType> = { Layers, Activity, Network }

type Props = {
  command: LocalCommand
  onRun: (command: LocalCommand) => void
}

export function CommandCard({ command, onRun }: Props) {
  const Icon = ICON_MAP[command.icon] ?? Play
  return (
    <button onClick={() => onRun(command)} className="card card-interactive p-4 flex items-center gap-4 text-left w-full">
      <span className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-tint)', color: 'var(--primary)' }}>
        <Icon size={20} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>{command.title}</span>
        <span className="block text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{command.desc}</span>
      </span>
      <ChevronRight size={16} style={{ color: 'var(--text-subtle)' }} />
    </button>
  )
}
