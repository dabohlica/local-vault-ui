'use client'

import { useEffect, useRef, useState } from 'react'
import type { CompanionKind } from '@/lib/companion'
import { FlatAvatar } from './FlatAvatar'
import { OwlAvatar } from './OwlAvatar'
import type { Mood } from './stage'

// The companion. `live` renders the interactive 3D character (follows the
// cursor, reacts to hover and clicks, thinks, talks); otherwise a still render
// of the same model, so long lists don't each hold a WebGL context. Without
// WebGL it falls back to the flat drawing. Orrin the owl is pre-rendered frames
// on a 2D canvas instead, so he needs no WebGL.

type Props = {
  kind: CompanionKind
  color?: string
  size?: number
  live?: boolean
  thinking?: boolean
  talking?: boolean
  title?: string
  className?: string
  onPoke?: () => void
}

let webgl: boolean | null = null
function hasWebgl(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas')
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch { webgl = false }
  }
  return webgl
}

export function CompanionAvatar(props: Props) {
  const [mode, setMode] = useState<'pending' | '3d' | 'flat'>('pending')
  useEffect(() => { setMode(hasWebgl() ? '3d' : 'flat') }, [])
  const { kind, size = 40, thinking, title, className = '' } = props
  if (kind === 'owl') {
    return mode === 'pending'
      ? <span className={`companion relative inline-flex flex-shrink-0 ${className}`} style={{ width: size, height: size }} />
      : <OwlAvatar {...props} />
  }
  if (mode !== '3d') return <FlatAvatar kind={kind} size={size} thinking={thinking} title={title} className={className} />
  return props.live ? <Live {...props} /> : <Still {...props} />
}

function Still({ kind, color = '', size = 40, thinking, title, className = '' }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void import('./stage')
      .then(m => m.stillImage(kind, color, Math.min(384, Math.ceil(size * Math.min(2, window.devicePixelRatio || 1) * 1.25))))
      .then(url => { if (alive) setSrc(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [kind, color, size])
  if (!src) return <FlatAvatar kind={kind} size={size} thinking={thinking} title={title} className={className} />
  return (
    <span className={`companion relative inline-flex flex-shrink-0 ${thinking ? 'companion-thinking' : ''} ${className}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={size} height={size} alt={title ?? ''} aria-hidden={title ? undefined : true} draggable={false} />
      {thinking && <span className="companion-bubble" aria-hidden><i /><i /><i /></span>}
    </span>
  )
}

// The live canvas is PAD× the slot so a reaching arm isn't clipped; it ignores
// the pointer, and only the slot itself reacts to hover and clicks.
const PAD = 2.2

function Live({ kind, color = '', size = 64, thinking, talking, title, className = '', onPoke }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const slot = useRef<HTMLSpanElement>(null)
  const canvasPx = Math.round(size * PAD)
  const moodRef = useRef<Mood>('idle')
  const api = useRef<{ poke: () => void; hover: (h: boolean) => void } | null>(null)
  moodRef.current = thinking ? 'thinking' : talking ? 'talking' : 'idle'

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let disposed = false
    let cleanup = () => {}
    void import('./stage').then(({ Animator, makeScene, worldPerPx }) => import('three').then(THREE => {
      if (disposed) return
      const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: 'low-power' })
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      renderer.setPixelRatio(dpr)
      renderer.setSize(canvasPx, canvasPx, false)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.95
      renderer.outputColorSpace = THREE.SRGBColorSpace
      const stage = makeScene(renderer, PAD)
      const anim = new Animator(kind, color)
      anim.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      stage.scene.add(anim.rig.root)

      // Look at the cursor anywhere on the page, relative to where we sit.
      const onMove = (e: PointerEvent) => {
        const r = (slot.current ?? el).getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42
        const reach = Math.max(260, r.width * 3)
        anim.pointer = { x: (e.clientX - cx) / reach, y: -(e.clientY - cy) / reach }
        anim.notePointer()
        // Close by? Then a tentacle reaches for it (kept inside the frame).
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
        const d = Math.hypot(dx, dy)
        const far = r.width * 2.4, close = r.width * 1.1
        anim.near = Math.min(1, Math.max(0, (far - d) / (far - close)))
        const w = worldPerPx(r.width)
        let tx = dx * w, ty = -dy * w + 0.08
        const lim = 2.5, len = Math.hypot(tx, ty)
        if (len > lim) { tx *= lim / len; ty *= lim / len }
        anim.reach = { x: tx, y: ty }
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      api.current = { poke: () => anim.poke(), hover: h => { anim.hover = h } }

      // Only animate while visible on screen and the tab is in front.
      let visible = true
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting })
      io.observe(el)
      // 30 fps while idle (battery), 60 while hovered, poked, thinking or talking.
      let raf = 0, last = performance.now(), acc = 0
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame)
        acc += Math.min(0.1, (now - last) / 1000)
        last = now
        if (!visible || document.hidden) { acc = 0; return }
        anim.mood = moodRef.current
        if (acc < (anim.busy() ? 1 / 60 : 1 / 30) - 0.002) return
        const dt = Math.min(0.05, acc)
        acc = 0
        const { hop } = anim.step(dt)
        stage.shadow.scale.setScalar(1 - hop * 0.45)
        ;(stage.shadow.material as import('three').MeshBasicMaterial).opacity = 0.35 - hop * 0.2
        renderer.render(stage.scene, stage.camera)
      }
      raf = requestAnimationFrame(frame)

      cleanup = () => {
        cancelAnimationFrame(raf)
        io.disconnect()
        window.removeEventListener('pointermove', onMove)
        anim.rig.dispose()
        stage.dispose()
        renderer.dispose()
        renderer.forceContextLoss()
        api.current = null
      }
    })).catch(() => {})
    return () => { disposed = true; cleanup() }
  }, [kind, color, size, canvasPx])

  const off = (canvasPx - size) / 2
  return (
    <span ref={slot} className={`companion relative inline-flex flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
      <canvas
        ref={canvas}
        width={canvasPx}
        height={canvasPx}
        aria-hidden
        style={{ position: 'absolute', left: -off, top: -off, width: canvasPx, height: canvasPx, pointerEvents: 'none', zIndex: 5 }}
      />
      <span
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className="absolute inset-0 rounded-full"
        style={{ cursor: 'pointer', touchAction: 'manipulation', zIndex: 6 }}
        onPointerEnter={() => api.current?.hover(true)}
        onPointerLeave={() => api.current?.hover(false)}
        onClick={e => { e.preventDefault(); e.stopPropagation(); api.current?.poke(); onPoke?.() }}
      />
      {thinking && <span className="companion-bubble" aria-hidden><i /><i /><i /></span>}
    </span>
  )
}
