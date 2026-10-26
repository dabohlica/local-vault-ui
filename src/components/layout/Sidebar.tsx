'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { CompanionAvatar } from '@/components/companion/Avatar'
import { useCompanion } from '@/components/companion/CompanionContext'
import { cn } from '@/lib/cn'
import { NAV, SETTINGS_ITEM, isActive, useInboxBadge, type NavItem } from './nav'

export function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname()
  const badge = useInboxBadge()
  const companion = useCompanion()

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden />
      )}

      <aside
        className={cn(
          'flex flex-col w-[232px] flex-shrink-0 h-screen border-r',
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <Link href="/chat" className="flex items-center gap-2 px-3 h-16" title={`Talk to ${companion.name}`}>
          <CompanionAvatar live kind={companion.kind} size={48} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight leading-tight" style={{ color: 'var(--text)' }}>{companion.name}</p>
            <p className="text-[11px] leading-tight truncate" style={{ color: 'var(--text-subtle)' }}>{companion.def.tagline}</p>
          </div>
        </Link>
        <div className="absolute top-4 right-3 md:hidden">
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <div className="px-3 pb-3">
          <Link
            href="/add"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            <Plus size={16} /> Add note
          </Link>
        </div>

        <nav className="flex-1 px-3 py-1 space-y-0.5">
          {NAV.map(item => (
            <NavLink key={item.href} item={item.href === '/chat' ? { ...item, label: `Ask ${companion.name}` } : item} active={isActive(pathname, item.href)} count={item.badge === 'inbox' ? badge : 0} />
          ))}
        </nav>

        <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <NavLink item={SETTINGS_ITEM} active={isActive(pathname, SETTINGS_ITEM.href)} count={0} />
        </div>
      </aside>
    </>
  )
}

function NavLink({ item, active, count }: { item: NavItem; active: boolean; count: number }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      title={item.hint}
      className="nav-link flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium"
      data-active={active || undefined}
    >
      <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
      <span className="flex-1">{item.label}</span>
      {count > 0 && (
        <span className="text-[11px] font-semibold px-1.5 py-px rounded-full min-w-[20px] text-center" style={{ background: 'var(--primary)', color: 'white' }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
