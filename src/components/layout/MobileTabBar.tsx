'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'
import { NAV, isActive, useInboxBadge } from './nav'
import { useCompanion } from '@/components/companion/CompanionContext'

// Phone navigation: the four everyday places plus a central "add" button. Tools
// and Settings stay in the ☰ drawer.
export function MobileTabBar() {
  const pathname = usePathname()
  const badge = useInboxBadge()
  const companion = useCompanion()
  const [home, ask, inbox, notes] = NAV
  const tabs = [home, ask, null, inbox, notes]

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t flex items-stretch justify-around"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(item => {
        if (!item) {
          return (
            <Link key="add" href="/add" aria-label="Add note" className="flex items-center justify-center px-3">
              <span className="w-11 h-11 rounded-full flex items-center justify-center shadow-pop" style={{ background: 'var(--primary)', color: 'white' }}>
                <Plus size={22} />
              </span>
            </Link>
          )
        }
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        const count = item.badge === 'inbox' ? badge : 0
        return (
          <Link key={item.href} href={item.href} className="relative flex-1 flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium"
            style={{ color: active ? 'var(--primary)' : 'var(--text-subtle)' }}>
            <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
            {item.href === '/chat' ? companion.name : item.label}
            {count > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2 text-[10px] font-semibold px-1 rounded-full min-w-[16px] text-center" style={{ background: 'var(--primary)', color: 'white' }}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
