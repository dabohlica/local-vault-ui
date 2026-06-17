'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      title={dark ? 'Switch to light' : 'Switch to dark'}
      className="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150 hover:scale-[1.05]"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
    >
      {/* Avoid hydration mismatch: render a neutral icon until mounted */}
      {mounted && dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
