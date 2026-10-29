// Orrin, the owl: pre-rendered frames (built in Blender, see ~/Desktop/CLAUDE/librarian-owl)
// played on a 2D canvas. The head follows the cursor through a 9×5 grid of rendered head
// poses; clips (reading, petting, dozing, …) are frame sequences that start and end on the
// neutral pose. Two frame sets live in public/orrin: `l` (368×400) and `s` (184×200).
// All drawing is in the full render's coordinates (920×1000); the canvas transform scales.

import type { Mood } from './stage'

export type OrrinSet = 's' | 'l'
type Manifest = {
  fps: number
  yaw: number[]
  pitch: number[]
  size: [number, number]
  blink: Record<string, [number, number, number, number]>
  clips: Record<string, Record<string, number>>
  orb: Record<string, [number, number, number?]>
}

// Where things sit in the frame (normalised, y down).
const FACE = { x: 0.5826, y: 0.36 }
const ORB0 = { x: 0.2922, y: 0.32 }, SIGIL = { x: 0.8026, y: 0.684 }
// The owl's extent over the head grid, for framing him in a square slot.
export const OWL_BOX = { cx: 0.5, cy: 0.53, h: 0.81, aspect: 0.92 }

let manifest: Promise<Manifest> | null = null
export function loadManifest(): Promise<Manifest> {
  manifest ??= fetch('/orrin/manifest.json').then(r => {
    if (!r.ok) throw new Error('no Orrin frames')
    return r.json() as Promise<Manifest>
  })
  manifest.catch(() => { manifest = null })
  return manifest
}

// One image cache for every owl on the page, loaded a few at a time with retries
// (hundreds of parallel requests make some fail, and a missing frame flashes blank).
const cache = new Map<string, Promise<HTMLImageElement | null>>()
const waiting: Array<() => void> = []
let active = 0
function pump() {
  while (active < 6 && waiting.length) { active++; waiting.shift()!() }
}
function image(url: string): Promise<HTMLImageElement | null> {
  let p = cache.get(url)
  if (!p) {
    p = new Promise(resolve => {
      const go = (tries: number) => {
        const im = new Image()
        im.onload = () => { void im.decode().catch(() => {}).then(() => { active--; pump(); resolve(im) }) }
        im.onerror = () => {
          if (tries < 3) setTimeout(() => go(tries + 1), 250 * (tries + 1))
          else { active--; pump(); resolve(null) }
        }
        im.src = url + (tries ? `?r=${tries}` : '')
      }
      waiting.push(() => go(0))
      pump()
    })
    cache.set(url, p)
  }
  return p
}

const frameKey = (clip: string, sec: string, k: number) => clip === 'wink' ? `wink_${k}` : `${clip}_${sec}_${k}`
const IDLE: Array<[string, number]> = [['read', 3], ['tilt', 2], ['peer', 2], ['swivel', 1], ['ruffle', 1], ['wink', 1]]

type Clip = { name: string; order: string[]; si: number; k: number; loops: number; exit: boolean; minLoops: number; maxLoops: number; hold?: () => boolean }

export class Orrin {
  mood: Mood = 'idle'
  reducedMotion = false
  private M: Manifest
  private set: OrrinSet
  private imgs = new Map<string, HTMLImageElement>()
  private crops = new Map<string, { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }>()
  private ready = new Set<string>()   // clips whose frames are all loaded
  private NI: number
  private NJ: number
  private NEUT: [number, number]
  // the head lives in cell-index space: p is where it is (fractional between cells), v how fast it turns
  private p: [number, number]
  private v: [number, number] = [0, 0]
  private aim: [number, number]
  private target: [number, number] | null = null
  private lastMove = -1e9
  private lastActive = performance.now()
  private clip: Clip | null = null
  private pending: { name: string; opts: Partial<Clip> } | null = null
  private acc = 0
  private blink: { t: number; seq: number; slow?: boolean } | null = null
  private nextBlink = performance.now() + 2500
  private nextIdle = 0
  private dozing = false
  private pendingRead = false   // thinking began: read as soon as the head is home
  private lastStroke = -1e9
  private stroke: Array<{ t: number; x: number; y: number }> = []
  private prevMood: Mood = 'idle'
  private shown: Array<[string, number]> = []
  private orb = { ...ORB0, vis: 1 }
  private motes: Array<{ x: number; y: number; vx: number; vy: number; born: number; life: number; gold: boolean; s: number }> = []
  private sigilHeat = 0
  private lastGood: HTMLImageElement | null = null

  constructor(M: Manifest, set: OrrinSet) {
    this.M = M
    this.set = set
    this.NI = M.yaw.length
    this.NJ = M.pitch.length
    this.NEUT = [M.yaw.indexOf(0), M.pitch.indexOf(0)]
    this.p = [...this.NEUT]
    this.aim = [...this.NEUT]
  }

  private url(key: string) { return `/orrin/${this.set}/${key}.webp` }
  private async get(key: string) {
    const im = await image(this.url(key))
    if (im) this.imgs.set(key, im)
    return im
  }

  // The head grid and blink crops first (enough to come alive: onGrid), then — for a live owl — the clips.
  async load(withClips: boolean, onGrid?: () => void): Promise<void> {
    const first: string[] = []
    for (let j = 0; j < this.NJ; j++) for (let i = 0; i < this.NI; i++) {
      first.push(`g_${i}_${j}`)
      if (this.M.blink[`${i}_${j}`]) first.push(`bh_${i}_${j}`, `bc_${i}_${j}`)
    }
    // neutral first so something shows straight away
    first.unshift(`g_${this.NEUT[0]}_${this.NEUT[1]}`)
    await Promise.all(first.map(k => this.get(k)))
    onGrid?.()
    if (!withClips) return
    for (const name of ['pet', 'surprise', 'wink', 'read', 'tilt', 'peer', 'ruffle', 'swivel', 'doze']) {
      const secs = this.M.clips[name]
      if (!secs) continue
      const keys = Object.entries(secs).flatMap(([sec, n]) => Array.from({ length: n }, (_, k) => frameKey(name, sec, k)))
      const got = await Promise.all(keys.map(k => this.get(k)))
      if (got.every(Boolean)) this.ready.add(name)
    }
  }

  // ------------------------------------------------------------------ input
  // The cursor, anywhere on the page, relative to the canvas (its on-screen rect).
  pointer(x: number, y: number, r: DOMRect) {
    const now = performance.now()
    this.lastMove = this.lastActive = now
    if (this.dozing && this.clip?.name === 'doze') { this.exitClip(); this.dozing = false }
    const dx = x - (r.left + FACE.x * r.width), dy = y - (r.top + FACE.y * r.height)
    // a small avatar still turns towards a cursor across the page
    const depth = Math.max(380, r.height * 0.9)
    const yaw = Math.atan2(dx, depth) * 180 / Math.PI * 1.25
    const pitch = -Math.atan2(dy, depth) * 180 / Math.PI * 1.15
    this.target = [fracIndex(this.M.yaw, yaw), fracIndex(this.M.pitch, pitch)]
  }
  // Typing counts as company: he stays awake, but keeps his eyes where they were.
  activity() {
    this.lastActive = performance.now()
    if (this.dozing && this.clip?.name === 'doze') { this.exitClip(); this.dozing = false }
  }
  // Moving over the avatar strokes his head; enough of it and he leans into it.
  strokeAt(x: number, y: number, slot: number) {
    const now = performance.now()
    this.stroke.push({ t: now, x, y })
    this.stroke = this.stroke.filter(s => now - s.t < 900)
    let d = 0
    for (let k = 1; k < this.stroke.length; k++) d += Math.hypot(this.stroke[k].x - this.stroke[k - 1].x, this.stroke[k].y - this.stroke[k - 1].y)
    if (d < Math.max(60, slot * 1.4)) return false
    this.lastStroke = now
    if (!this.clip) this.play('pet')
    else if (this.clip.name !== 'pet' && this.clip.name !== 'read') this.exitClip()
    return true
  }
  endStroke() { this.stroke = [] }
  poke() {
    if (this.clip) { this.exitClip(); return }
    this.play(Math.random() < 0.35 ? 'wink' : 'surprise')
  }
  busy() { return !!this.clip || !this.atRest() || !!this.blink }

  // ------------------------------------------------------------------ clips
  private play(name: string, opts: Partial<Clip> = {}) {
    const secs = this.M.clips[name]
    if (!secs || !this.ready.has(name) || this.pending) return
    // every clip starts from the neutral head pose: the head first turns home
    if (!this.atRest(this.NEUT)) { this.pending = { name, opts }; return }
    this.p = [...this.NEUT]; this.v = [0, 0]; this.aim = [...this.NEUT]
    this.clip = { name, order: secs.all ? ['all'] : ['in', 'loop'], si: 0, k: 0, loops: 0, exit: false, minLoops: 0, maxLoops: 1, ...opts }
    this.blink = null
    this.acc = 0
  }
  private exitClip() { if (this.clip) this.clip.exit = true }
  private advance() {
    const c = this.clip!, sec = c.order[c.si], n = this.M.clips[c.name][sec]
    c.k++
    if (c.k < n) return
    c.k = 0
    if (sec === 'loop') {
      c.loops++
      const done = c.name === 'pet' ? performance.now() - this.lastStroke > 700
        : c.hold ? !c.hold() || c.exit
        : c.name === 'doze' ? c.exit
        : c.exit || c.loops >= c.maxLoops
      if (!done || c.loops < c.minLoops) return
      c.order = ['in', 'loop', 'out']; c.si = 2; return
    }
    if (c.si + 1 < c.order.length) { c.si++; return }
    this.clip = null
    this.p = [...this.NEUT]; this.v = [0, 0]; this.aim = [...this.NEUT]
    if (c.name === 'pet') this.blink = { t: performance.now(), seq: 1, slow: true }   // the owl's slow "I trust you" blink
  }

  // ------------------------------------------------------------------ gaze
  // The head chases the cursor continuously while it moves (dissolving between rendered cells), then
  // settles on the nearest cell once it stops, so at rest there is always one sharp frame. A damped
  // spring drives it: no waiting before a turn, no fixed per-cell steps, ease-in and ease-out for free.
  private stepGaze(tgt: [number, number], moving: boolean, dt: number) {
    for (let a = 0; a < 2; a++) this.aim[a] = moving ? tgt[a] : Math.round(tgt[a])
    const W = 24, Z = 0.9   // ~0.17 s to arrive, a hint of overshoot like a real head
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120)
      for (let a = 0; a < 2; a++) {
        this.v[a] += (W * W * (this.aim[a] - this.p[a]) - 2 * Z * W * this.v[a]) * h
        this.p[a] = Math.min(Math.max(this.p[a] + this.v[a] * h, 0), (a ? this.NJ : this.NI) - 1)
      }
    }
  }
  // settled on one cell (optionally a given one): the only time blinks play and clips may start
  private atRest(cell?: [number, number]) {
    const c = cell ?? [Math.round(this.p[0]), Math.round(this.p[1])]
    return Math.abs(this.p[0] - c[0]) < 0.03 && Math.abs(this.p[1] - c[1]) < 0.03 && Math.hypot(this.v[0], this.v[1]) < 0.3
  }
  // the cells around p and how much of each to show: each cell stays solid for the outer fifth of
  // the way and they dissolve across the middle, so a turn never shows two faces for long
  private gazeMix(): Array<[number, number, number]> {
    const ax = (x: number, n: number): [number, number] => {
      const i = Math.min(Math.floor(x), n - 2), f = Math.min(Math.max((x - i - 0.2) / 0.6, 0), 1)
      return [i, f * f * (3 - 2 * f)]
    }
    const [i, si] = ax(this.p[0], this.NI), [j, sj] = ax(this.p[1], this.NJ)
    const mix: Array<[number, number, number]> = [[i, j, (1 - si) * (1 - sj)], [i + 1, j, si * (1 - sj)], [i, j + 1, (1 - si) * sj], [i + 1, j + 1, si * sj]]
    return mix.filter(c => c[2] > 0.004).sort((a, b) => b[2] - a[2])
  }

  // ------------------------------------------------------------------ the loop
  // Advance by dt seconds and draw. ctx must already be scaled to the render's 920×1000 space.
  step(ctx: CanvasRenderingContext2D, now: number, dt: number) {
    const idle = now - this.lastMove, quiet = now - this.lastActive
    if (this.mood !== this.prevMood) {
      if (this.mood === 'thinking') {
        if (this.clip?.name === 'read') this.clip.hold = () => this.mood === 'thinking'
        else { this.exitClip(); this.pendingRead = true }
      }
      else if (this.clip?.hold) this.exitClip()
      if (this.mood === 'talking' && !this.clip && Math.random() < 0.5) this.play('tilt')
      this.prevMood = this.mood
    }
    if (this.mood !== 'thinking') this.pendingRead = false
    if (!this.clip) {
      // while he looks things up he reads his tome
      if (this.pendingRead && !this.pending && this.ready.has('read')) {
        this.play('read', { hold: () => this.mood === 'thinking' })
        if (this.clip) this.pendingRead = false
      }
      if (this.pending && this.atRest(this.NEUT)) { const q = this.pending; this.pending = null; this.play(q.name, q.opts) }
    }
    if (!this.clip) {
      const home = !this.target || idle > 4000 || !!this.pending || this.pendingRead
      this.stepGaze(home ? [...this.NEUT] : this.target!, !home && idle < 140, Math.min(dt, 0.05))
      if (!this.reducedMotion && quiet > 7000 && now > this.nextIdle && this.atRest(this.NEUT)) {
        if (quiet > 45000 && this.ready.has('doze')) { this.play('doze'); this.dozing = true }
        else {
          const pool = IDLE.filter(([n]) => this.ready.has(n))
          let t = Math.random() * pool.reduce((a, [, w]) => a + w, 0)
          const pick = pool.find(([, w]) => (t -= w) < 0)
          if (pick) this.play(pick[0], { maxLoops: 1 + Number(Math.random() < 0.5) })
        }
        this.nextIdle = now + 6000 + Math.random() * 8000
      }
      if (!this.blink && now > this.nextBlink) this.blink = { t: now, seq: Math.random() < 0.2 ? 2 : 1 }
    } else {
      this.acc += dt
      const per = 1 / this.M.fps
      while (this.acc >= per && this.clip) { this.acc -= per; this.advance() }
    }
    this.draw(ctx, now)
  }

  private paint(ctx: CanvasRenderingContext2D, key: string) {
    const im = this.imgs.get(key)
    if (im) { this.lastGood = im; this.shown = [[key, 1]] }
    if (this.lastGood) ctx.drawImage(this.lastGood, 0, 0, this.M.size[0], this.M.size[1])
    return !!im
  }
  private draw(ctx: CanvasRenderingContext2D, now: number) {
    const [W, H] = this.M.size
    ctx.clearRect(0, 0, W, H)
    if (this.clip) {
      const c = this.clip, sec = c.order[c.si]
      this.paint(ctx, frameKey(c.name, sec, Math.min(c.k, this.M.clips[c.name][sec] - 1)))
      this.magic(ctx, now)
      return
    }
    // mid-turn: a weighted dissolve of the (up to four) cells around the head's position
    const mix = this.gazeMix()
    if (mix.length > 1) {
      let sum = 0
      for (const [i, j, w] of mix) {
        const im = this.imgs.get(`g_${i}_${j}`)
        if (!im) continue
        sum += w
        ctx.globalAlpha = w / sum
        ctx.drawImage(im, 0, 0, W, H)
      }
      ctx.globalAlpha = 1
      this.shown = mix.map(([i, j, w]) => [`g_${i}_${j}`, w])
      if (this.blink) { this.blink = null; this.nextBlink = now + 1200 + Math.random() * 2500 }
      this.magic(ctx, now)
      return
    }
    const [i, j] = mix[0]
    if (this.paint(ctx, `g_${i}_${j}`) && this.blink && this.atRest()) {
      const b = this.blink, t = (now - b.t) / (b.slow ? 2.6 : 1)
      // half 55ms, shut 75ms, half 55ms (× seq)
      const k = t % 185, n = Math.floor(t / 185)
      if (n >= b.seq) { this.blink = null; this.nextBlink = now + 2200 + Math.random() * 4500 }
      else {
        const cr = this.crop(k < 55 || k > 130 ? `bh_${i}_${j}` : `bc_${i}_${j}`, `${i}_${j}`)
        if (cr) ctx.drawImage(cr.c, cr.x, cr.y, cr.w, cr.h)
      }
    }
    this.magic(ctx, now)
  }

  // Blink crops get feathered edges so they melt into the frame they sit on.
  private crop(key: string, cell: string) {
    const hit = this.crops.get(key)
    if (hit) return hit
    const im = this.imgs.get(key), box = this.M.blink[cell]
    if (!im || !box) return null
    const c = document.createElement('canvas')
    c.width = im.naturalWidth; c.height = im.naturalHeight
    const g = c.getContext('2d')!
    g.drawImage(im, 0, 0)
    g.globalCompositeOperation = 'destination-in'
    const f = Math.min(c.width, c.height) * 0.18
    for (const horiz of [true, false]) {
      const len = horiz ? c.width : c.height
      const gr = horiz ? g.createLinearGradient(0, 0, len, 0) : g.createLinearGradient(0, 0, 0, len)
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(f / len, '#000')
      gr.addColorStop(1 - f / len, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height)
    }
    // Blender's border render: box = [minX, maxX, minY, maxY], y counted from the bottom
    const [W, H] = this.M.size
    const x = Math.floor(box[0] * W), w = Math.floor(box[1] * W) - x, h = Math.floor(box[3] * H) - Math.floor(box[2] * H)
    const out = { c, x, y: H - Math.floor(box[2] * H) - h, w, h }
    this.crops.set(key, out)
    return out
  }

  // Ambient magic on top of the frames: the orb breathes, motes drift up, the tome's sigil glows.
  private magic(ctx: CanvasRenderingContext2D, now: number) {
    const [W, H] = this.M.size
    let x = 0, y = 0, v = 0, n = 0
    for (const [key, w] of this.shown) {
      const o = this.M.orb[key]
      if (o) { x += o[0] * w; y += o[1] * w; v += (o[2] ?? 1) * w; n += w }
    }
    if (n) { x /= n; y /= n; v /= n } else { x = this.orb.x; y = this.orb.y; v = this.orb.vis }
    const o = this.orb
    o.x += (x - o.x) * 0.5; o.y += (y - o.y) * 0.5; o.vis += (v - o.vis) * 0.5
    const t = now / 1000
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    glow(ctx, o.x * W, o.y * H, W * 0.07 * o.vis, '120,235,220', (0.12 + 0.07 * Math.sin(t * 2.1) + 0.03 * Math.sin(t * 5.3)) * o.vis)
    if (!this.reducedMotion && this.motes.length < 26 && Math.random() < 0.18 * o.vis) {
      const a = Math.random() * Math.PI * 2, r = W * (0.03 + Math.random() * 0.08)
      this.motes.push({ x: o.x * W + Math.cos(a) * r, y: o.y * H + Math.sin(a) * r * 0.7, vx: (Math.random() - 0.5) * 6,
        vy: -(8 + Math.random() * 16), born: now, life: 1800 + Math.random() * 2200, gold: Math.random() < 0.55, s: 0.6 + Math.random() * 1.4 })
    }
    for (let k = this.motes.length - 1; k >= 0; k--) {
      const m = this.motes[k], u = (now - m.born) / m.life
      if (u >= 1) { this.motes.splice(k, 1); continue }
      // motes are drawn bigger than in the full player so they still read at avatar size
      glow(ctx, m.x + m.vx * u * 3 + Math.sin(u * 9 + m.born) * 3, m.y + m.vy * u * 3, W * 0.009 * m.s,
        m.gold ? '255,215,140' : '150,245,230', Math.sin(u * Math.PI) * 0.9)
    }
    // the tome leaves its resting place while he reads, so the cover glow fades out with it
    this.sigilHeat += ((this.clip?.name === 'read' ? 1 : 0) - this.sigilHeat) * 0.25
    glow(ctx, SIGIL.x * W, SIGIL.y * H, W * 0.035, '255,170,70', (0.1 + 0.05 * Math.sin(t * 1.3)) * (1 - this.sigilHeat))
    ctx.restore()
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
}

// A value's fractional position in a sorted list (2.5 = halfway between the third and fourth).
export function fracIndex(arr: number[], v: number): number {
  if (v <= arr[0]) return 0
  for (let k = 0; k + 1 < arr.length; k++) if (v <= arr[k + 1]) return k + (v - arr[k]) / (arr[k + 1] - arr[k])
  return arr.length - 1
}
