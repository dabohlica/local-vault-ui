'use client'

import { useEffect, useRef, useState } from 'react'
import { OWL_BOX, type OrrinSet } from './orrin'

// Orrin in a square avatar slot. The frame is bigger than the slot (the owl stands a
// little taller than it, with his orb arm and tome reaching out), centred on him; it
// ignores the pointer, and only the slot reacts to hover, strokes and clicks.
// `live` plays the frames (follows the cursor, blinks, reads while thinking, dozes when
// left alone); otherwise a still of the neutral pose.

type Props = {
  size?: number
  live?: boolean
  thinking?: boolean
  talking?: boolean
  title?: string
  className?: string
  onPoke?: () => void
}

const FILL = 1.2   // the owl's height relative to the slot

function frame(size: number) {
  const h = (FILL * size) / OWL_BOX.h, w = h * OWL_BOX.aspect
  return { w, h, left: size / 2 - OWL_BOX.cx * w, top: size / 2 - OWL_BOX.cy * h }
}
function pickSet(cssH: number): OrrinSet {
  return cssH * Math.min(2, window.devicePixelRatio || 1) <= 230 ? 's' : 'l'
}

export function OwlAvatar({ size = 40, live, thinking, talking, title, className = '', onPoke }: Props) {
  const f = frame(size)
  return (
    <span className={`companion relative inline-flex flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
      {live
        ? <LiveOwl size={size} f={f} thinking={thinking} talking={talking} title={title} onPoke={onPoke} />
        : <StillOwl f={f} title={title} />}
      {thinking && !live && <span className="companion-bubble" aria-hidden><i /><i /><i /></span>}
    </span>
  )
}

// Client-only (the avatar mounts after hydration), so window is there.
function StillOwl({ f, title, hidden }: { f: ReturnType<typeof frame>; title?: string; hidden?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/orrin/${pickSet(f.h)}/g_4_2.webp`} alt={title ?? ''} aria-hidden={title ? undefined : true} draggable={false}
      width={Math.round(f.w)} height={Math.round(f.h)}
      style={{ position: 'absolute', left: f.left, top: f.top, width: f.w, height: f.h, maxWidth: 'none', pointerEvents: 'none', visibility: hidden ? 'hidden' : undefined }} />
  )
}

type LiveProps = { size: number; f: ReturnType<typeof frame>; thinking?: boolean; talking?: boolean; title?: string; onPoke?: () => void }

function LiveOwl({ size, f, thinking, talking, title, onPoke }: LiveProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const api = useRef<{ poke: () => void; stroke: (x: number, y: number) => void; endStroke: () => void } | null>(null)
  const [started, setStarted] = useState(false)
  const moodRef = useRef<'idle' | 'thinking' | 'talking'>('idle')
  moodRef.current = thinking ? 'thinking' : talking ? 'talking' : 'idle'

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let disposed = false
    let cleanup = () => {}
    void import('./orrin').then(async ({ Orrin, loadManifest }) => {
      const M = await loadManifest()
      if (disposed) return
      const owl = new Orrin(M, pickSet(f.h))
      owl.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const ctx = el.getContext('2d')!
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      el.width = Math.round(f.w * dpr); el.height = Math.round(f.h * dpr)
      ctx.setTransform(el.width / M.size[0], 0, 0, el.height / M.size[1], 0, 0)
      ctx.imageSmoothingQuality = 'high'

      const onMove = (e: PointerEvent) => owl.pointer(e.clientX, e.clientY, el.getBoundingClientRect())
      const onKey = () => owl.activity()
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('keydown', onKey)
      api.current = { poke: () => owl.poke(), stroke: (x, y) => { owl.strokeAt(x, y, size) }, endStroke: () => owl.endStroke() }

      // Only animate while visible on screen and the tab is in front;
      // 30 fps when settled (the orb still breathes), 60 while he moves.
      let visible = true
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting })
      io.observe(el)
      let raf = 0, last = performance.now(), acc = 0, ready = false
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        acc += Math.min(0.1, (now - last) / 1000)
        last = now
        if (!visible || document.hidden || !ready) { acc = 0; return }
        owl.mood = moodRef.current
        if (acc < (owl.busy() ? 1 / 60 : 1 / 30) - 0.002) return
        owl.step(ctx, now, acc)
        acc = 0
      }
      raf = requestAnimationFrame(tick)
      // the head grid is enough to start; clips keep loading behind it
      void owl.load(true, () => { if (!disposed) { ready = true; setStarted(true) } })

      cleanup = () => {
        cancelAnimationFrame(raf)
        io.disconnect()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('keydown', onKey)
        api.current = null
      }
    }).catch(() => {})
    return () => { disposed = true; cleanup() }
  }, [size, f.w, f.h])

  return (
    <>
      {/* the still shows until the first live frame is drawn over it */}
      <StillOwl f={f} hidden={started} />
      <canvas ref={canvas} aria-hidden
        style={{ position: 'absolute', left: f.left, top: f.top, width: f.w, height: f.h, pointerEvents: 'none', zIndex: 5 }} />
      <span
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className="absolute inset-0 rounded-full"
        style={{ cursor: 'pointer', touchAction: 'manipulation', zIndex: 6 }}
        onPointerMove={e => api.current?.stroke(e.clientX, e.clientY)}
        onPointerLeave={() => api.current?.endStroke()}
        onClick={e => { e.preventDefault(); e.stopPropagation(); api.current?.poke(); onPoke?.() }}
      />
    </>
  )
}
