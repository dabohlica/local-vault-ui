'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { House, MessageCircle, Inbox, Library, Wand2, Settings, type LucideIcon } from 'lucide-react'

// One navigation model for the sidebar, the phone tab bar and the ⌘K palette.
export type NavItem = { href: string; label: string; hint: string; icon: LucideIcon; badge?: 'inbox' }

export const NAV: NavItem[] = [
  { href: '/', label: 'Home', hint: 'Today at a glance', icon: House },
  { href: '/chat', label: 'Ask', hint: 'Ask questions about your notes', icon: MessageCircle },
  { href: '/inbox', label: 'Inbox', hint: 'New reads and suggestions to review', icon: Inbox, badge: 'inbox' },
  { href: '/explorer', label: 'Notes', hint: 'Browse and read your notes', icon: Library },
  { href: '/commands', label: 'Tools', hint: 'Summaries, health check, connect notes', icon: Wand2 },
]

export const SETTINGS_ITEM: NavItem = { href: '/setup', label: 'Settings', hint: 'Vault, models, schedule', icon: Settings }

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  if (href === '/inbox') return pathname.startsWith('/inbox') || pathname.startsWith('/review')
  if (href === '/explorer') return pathname.startsWith('/explorer') || pathname.startsWith('/search')
  return pathname.startsWith(href)
}

// "Waiting for you" count for the Inbox badge: new reads + caretaker suggestions.
export function useInboxBadge(): number {
  const pathname = usePathname()
  const [n, setN] = useState(0)
  useEffect(() => {
    let active = true
    const load = () => Promise.all([
      fetch('/api/inbox?countOnly=1').then(r => r.json()).then((d: { counts?: { byStatus?: { new?: number } } }) => d.counts?.byStatus?.new ?? 0).catch(() => 0),
      fetch('/api/pending').then(r => r.json()).then((d: { count?: number }) => d.count ?? 0).catch(() => 0),
    ]).then(([a, b]) => { if (active) setN(a + b) })
    void load()
    window.addEventListener('vault:updated', load)
    return () => { active = false; window.removeEventListener('vault:updated', load) }
  }, [pathname])
  return n
}

export function openPalette(query = '') {
  window.dispatchEvent(new CustomEvent('palette:open', { detail: { query } }))
}
