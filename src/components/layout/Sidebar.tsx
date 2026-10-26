'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, X, Sparkles } from 'lucide-react'
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
        <div className="flex items-center gap-2.5 px-4 h-14">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)' }}>
            <Sparkles size={14} className="text-white" />
          </div>
          <p className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Vault</p>
          <button onClick={onClose} className="ml-auto md:hidden p-1 rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Close navigation">
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
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} count={item.badge === 'inbox' ? badge : 0} />
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
