'use client'

import {
  Calendar, Zap, CheckSquare, Layout, User, Users,
  Folder, FileText, Search, Globe, RefreshCw, Activity,
  Save, Layers, Play, ShieldCheck
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { LocalCommand } from '@/lib/commands'

const ICON_MAP: Record<string, React.ElementType> = {
  Calendar, Zap, CheckSquare, Layout, User, Users,
  Folder, FileText, Search, Globe, RefreshCw, Activity, Save, Layers,
}

type Props = {
  command: LocalCommand
  onRun: (command: LocalCommand) => void
}

export function CommandCard({ command, onRun }: Props) {
  const Icon = ICON_MAP[command.icon] ?? Play

  return (
    <div className={cn('card card-interactive p-4 flex flex-col gap-3')}>
      <div className="flex items-start justify-between">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--icon-grad)' }}
        >
          <Icon size={18} style={{ color: 'var(--primary)' }} />
        </div>
        <span
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}
          title="Runs entirely on-device via Ollama"
        >
          <ShieldCheck size={10} />
          local
        </span>
      </div>

      <div className="flex-1">
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{command.title}</h3>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{command.desc}</p>
      </div>

      <button
        onClick={() => onRun(command)}
        className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all duration-150 hover:scale-[1.02]"
        style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', color: 'white' }}
      >
        <Play size={11} />
        Run
      </button>
    </div>
  )
}
