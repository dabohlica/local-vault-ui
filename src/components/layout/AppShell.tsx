'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { DropZoneOverlay } from '@/components/shared/DropZoneOverlay'
import { AutoGitSync } from '@/components/layout/AutoGitSync'
import { AutoCaretake } from '@/components/layout/AutoCaretake'
import { ModelWarmup } from '@/components/layout/ModelWarmup'

// Decides between the onboarding screen (no chrome) and the full app, and
// redirects to /setup until a vault is configured.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isSetup = pathname === '/setup'
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close the mobile nav drawer whenever the route changes.
  useEffect(() => { setMobileNavOpen(false) }, [pathname])

  useEffect(() => {
    let active = true
    fetch('/api/setup/status')
      .then(r => r.json())
      .then((d: { configured: boolean }) => {
        if (!active) return
        setConfigured(d.configured)
        if (!d.configured && !isSetup) router.replace('/setup')
      })
      .catch(() => { if (active) setConfigured(false) })
    return () => { active = false }
  }, [pathname, isSetup, router])

  // Onboarding: full-bleed, no sidebar/topbar.
  if (isSetup) {
    return <main className="min-h-screen overflow-y-auto p-8">{children}</main>
  }

  // Brief hold while we check, to avoid flashing the app before a redirect.
  if (configured === null) {
    return <div className="min-h-screen" style={{ background: 'var(--bg-base)' }} />
  }

  return (
    <>
      {configured && <AutoGitSync />}
      {configured && <AutoCaretake />}
      {configured && <ModelWarmup />}
      <div className="flex h-screen overflow-hidden">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} />
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">{children}</main>
        </div>
      </div>
      <DropZoneOverlay />
    </>
  )
}
