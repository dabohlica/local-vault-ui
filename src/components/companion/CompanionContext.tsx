'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { COMPANIONS, resolveCompanion, type Companion, type CompanionDef } from '@/lib/companion'

type Value = Companion & { def: CompanionDef; refresh: () => void }

const DEFAULT = resolveCompanion('octopus', '')
const Ctx = createContext<Value>({ ...DEFAULT, def: COMPANIONS.octopus, refresh: () => {} })

// Loads the chosen character once per page load; Settings calls refresh() (or
// fires "companion:updated") after a change.
export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const [c, setC] = useState<Companion>(DEFAULT)
  const refresh = useCallback(() => {
    fetch('/api/companion', { cache: 'no-store' }).then(r => r.json()).then((d: Companion) => setC(resolveCompanion(d.kind, d.name, d.color))).catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
    window.addEventListener('companion:updated', refresh)
    return () => window.removeEventListener('companion:updated', refresh)
  }, [refresh])
  return <Ctx.Provider value={{ ...c, def: COMPANIONS[c.kind], refresh }}>{children}</Ctx.Provider>
}

export function useCompanion(): Value {
  return useContext(Ctx)
}
