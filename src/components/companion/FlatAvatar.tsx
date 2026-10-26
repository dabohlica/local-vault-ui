'use client'

import type { CompanionKind } from '@/lib/companion'

// Flat fallback (no WebGL) for the 3D companion. Hand-drawn companions, all wearing the same round reading glasses (the
// "keeper of the notes" motif). Fixed colours so they read the same in light
// and dark mode. `thinking` adds a gentle bob and a thought bubble; the eyes
// blink on their own. Both animations respect prefers-reduced-motion.

const INK = '#2B2B33'

function Glasses({ lx, rx, y, r = 6.5 }: { lx: number; rx: number; y: number; r?: number }) {
  return (
    <g fill="none" stroke={INK} strokeWidth="1.8">
      <circle cx={lx} cy={y} r={r} fill="rgba(255,255,255,0.18)" />
      <circle cx={rx} cy={y} r={r} fill="rgba(255,255,255,0.18)" />
      <path d={`M${lx + r} ${y} Q${(lx + rx) / 2} ${y - 2.4} ${rx - r} ${y}`} strokeLinecap="round" />
    </g>
  )
}

function Octopus() {
  return (
    <>
      <g fill="#DC5B37">
        <path d="M15 39 C10 47 8 54 12 58 C14.5 60.5 18 58.5 16.5 55.5 C15 52 18 47.5 21 43 Z" />
        <path d="M25 43 C23 51 23 57 26.5 59.5 C29.5 61 31 58 29 56 C27.5 53 28.5 48.5 30.5 44.5 Z" />
        <path d="M39 43 C41 51 41 57 37.5 59.5 C34.5 61 33 58 35 56 C36.5 53 35.5 48.5 33.5 44.5 Z" />
        <path d="M49 39 C54 47 56 54 52 58 C49.5 60.5 46 58.5 47.5 55.5 C49 52 46 47.5 43 43 Z" />
      </g>
      <path d="M10 31 C10 15.5 20 5.5 32 5.5 C44 5.5 54 15.5 54 31 C54 41.5 45.5 46 32 46 C18.5 46 10 41.5 10 31 Z" fill="#F2734B" />
      <ellipse cx="23" cy="14" rx="7" ry="3.6" fill="#FFB49C" opacity="0.55" transform="rotate(-24 23 14)" />
      <g className="companion-eyes">
        <circle cx="24" cy="29.5" r="4.6" fill="#fff" />
        <circle cx="40" cy="29.5" r="4.6" fill="#fff" />
        <circle cx="24.8" cy="30.2" r="2.3" fill={INK} />
        <circle cx="40.8" cy="30.2" r="2.3" fill={INK} />
      </g>
      <Glasses lx={24} rx={40} y={29.5} />
      <ellipse cx="16.5" cy="37" rx="3" ry="1.8" fill="#FF9E8A" opacity="0.75" />
      <ellipse cx="47.5" cy="37" rx="3" ry="1.8" fill="#FF9E8A" opacity="0.75" />
      <path d="M28.5 39 Q32 41.8 35.5 39" stroke="#7A2E1E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  )
}

function Fox() {
  return (
    <>
      <path d="M11 7 L27 19 L14 29 Z" fill="#E8742F" />
      <path d="M53 7 L37 19 L50 29 Z" fill="#E8742F" />
      <path d="M14.5 12.5 L23.5 19.5 L16 25 Z" fill="#7A3A1A" opacity="0.45" />
      <path d="M49.5 12.5 L40.5 19.5 L48 25 Z" fill="#7A3A1A" opacity="0.45" />
      <path d="M9 27 C9 17 20 14 32 14 C44 14 55 17 55 27 C55 41 44.5 52 32 57 C19.5 52 9 41 9 27 Z" fill="#E8742F" />
      <path d="M17 35.5 C22 33.5 28 35.5 32 40 C36 35.5 42 33.5 47 35.5 C45 46 38.5 52.5 32 55 C25.5 52.5 19 46 17 35.5 Z" fill="#FFF6EE" />
      <g className="companion-eyes">
        <circle cx="24" cy="28.5" r="2.6" fill={INK} />
        <circle cx="40" cy="28.5" r="2.6" fill={INK} />
        <circle cx="24.9" cy="27.6" r="0.8" fill="#fff" />
        <circle cx="40.9" cy="27.6" r="0.8" fill="#fff" />
      </g>
      <Glasses lx={24} rx={40} y={28.5} r={6} />
      <ellipse cx="32" cy="42" rx="3.2" ry="2.3" fill={INK} />
      <path d="M28.8 46 Q32 48.4 35.2 46" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  )
}

function Penguin() {
  return (
    <>
      <path d="M11 34 C6 40 7 49 11.5 52 C11.5 46 12.5 40 14.5 35 Z" fill="#2E3440" />
      <path d="M53 34 C58 40 57 49 52.5 52 C52.5 46 51.5 40 49.5 35 Z" fill="#2E3440" />
      <ellipse cx="32" cy="34" rx="21" ry="25" fill="#2E3440" />
      <path d="M17.5 31 C17.5 21 23.5 15 32 15 C40.5 15 46.5 21 46.5 31 C46.5 46 40.5 56.5 32 56.5 C23.5 56.5 17.5 46 17.5 31 Z" fill="#F7F7F2" />
      <ellipse cx="25.5" cy="61" rx="4.2" ry="1.8" fill="#F2A23B" />
      <ellipse cx="38.5" cy="61" rx="4.2" ry="1.8" fill="#F2A23B" />
      <g className="companion-eyes">
        <circle cx="25.5" cy="29" r="2.5" fill={INK} />
        <circle cx="38.5" cy="29" r="2.5" fill={INK} />
        <circle cx="26.3" cy="28.2" r="0.8" fill="#fff" />
        <circle cx="39.3" cy="28.2" r="0.8" fill="#fff" />
      </g>
      <Glasses lx={25.5} rx={38.5} y={29} r={5.8} />
      <path d="M28 36 L36 36 L32 41.5 Z" fill="#F2A23B" />
      <ellipse cx="21" cy="37" rx="2.6" ry="1.6" fill="#FF9E8A" opacity="0.7" />
      <ellipse cx="43" cy="37" rx="2.6" ry="1.6" fill="#FF9E8A" opacity="0.7" />
    </>
  )
}

const DRAW: Record<CompanionKind, () => JSX.Element> = { octopus: Octopus, fox: Fox, penguin: Penguin }

export function FlatAvatar({
  kind,
  size = 40,
  thinking = false,
  title,
  className = '',
}: {
  kind: CompanionKind
  size?: number
  thinking?: boolean
  title?: string
  className?: string
}) {
  const Draw = DRAW[kind] ?? Octopus
  return (
    <span className={`companion relative inline-flex flex-shrink-0 ${thinking ? 'companion-thinking' : ''} ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        <Draw />
      </svg>
      {thinking && (
        <span className="companion-bubble" aria-hidden>
          <i /><i /><i />
        </span>
      )}
    </span>
  )
}
