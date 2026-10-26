'use client'

import { usePathname } from 'next/navigation'
import { Search, Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { SyncStatus } from './SyncStatus'
import { NAV, SETTINGS_ITEM, isActive, openPalette } from './nav'
import { useCompanion } from '@/components/companion/CompanionContext'

export function TopBar({ onMenuClick, configured = true }: { onMenuClick?: () => void; configured?: boolean }) {
  const pathname = usePathname()
  const current = [...NAV, SETTINGS_ITEM].find(i => isActive(pathname, i.href))
  const companion = useCompanion()
  const title = pathname.startsWith('/add') ? 'Add note' : current?.href === '/chat' ? companion.name : current?.label ?? ''

  return (
    <header
      className="flex items-center gap-3 px-3 md:px-6 border-b flex-shrink-0"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', height: '56px' }}
    >
      <button onClick={onMenuClick} className="md:hidden p-1.5 rounded-lg flex-shrink-0" style={{ color: 'var(--text-muted)' }} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <span className="md:hidden text-[15px] font-semibold truncate" style={{ color: 'var(--text)' }}>{title}</span>

      {/* One search box for everything: notes, questions, actions. */}
      <button
        onClick={() => openPalette()}
        className="hidden md:flex items-center gap-2.5 flex-1 max-w-md h-9 px-3 rounded-lg text-sm transition-colors"
        style={{ background: 'var(--bg-base)', color: 'var(--text-subtle)', border: '1px solid var(--border-subtle)' }}
      >
        <Search size={15} />
        <span className="flex-1 text-left">Find a note, or ask {companion.name}…</span>
        <kbd className="text-[11px] px-1.5 py-0.5 rounded font-sans" style={{ background: 'var(--bg-elevated)', color: 'var(--text-subtle)' }}>⌘K</kbd>
      </button>

      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
        <button onClick={() => openPalette()} className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Search">
          <Search size={18} />
        </button>
        <SyncStatus enabled={configured} />
        <ThemeToggle />
      </div>
    </header>
  )
}
