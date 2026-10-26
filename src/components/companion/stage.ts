import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { CompanionKind } from '@/lib/companion'
import { buildRig, type Rig, type RigState } from './rig'

// Scene, lights and the animator for one companion. The React wrapper owns the
// canvas and feeds in pointer position and mood; everything else (breathing,
// blinking, glances, reactions) lives here.

export type Mood = 'idle' | 'thinking' | 'talking'

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function makeScene(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = env
  scene.environmentIntensity = 0.35
  scene.add(new THREE.HemisphereLight('#ffffff', '#e9b9a6', 0.6))
  const key = new THREE.DirectionalLight('#fff1e4', 2.6)
  key.position.set(2.5, 4, 5)
  const rim = new THREE.DirectionalLight('#ffd9c4', 1.6)
  rim.position.set(-4, 2.5, -3)
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.5)
  fill.position.set(-3, -1, 4)
  scene.add(key, rim, fill)
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50)
  camera.position.set(0, 0.25, 7.3)
  camera.lookAt(0, 0.02, 0)
  const shadowTex = shadowTexture()
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.35 }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -1.18
  scene.add(shadow)
  return {
    scene, camera, shadow,
    dispose() {
      pmrem.dispose(); env.dispose(); shadowTex.dispose()
      shadow.geometry.dispose(); (shadow.material as THREE.Material).dispose()
    },
  }
}

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt))

// Drives one rig over time from inputs.
export class Animator {
  readonly rig: Rig
  private s: RigState = { t: 0, lookX: 0, lookY: 0, blink: 0, happy: 0, think: 0, talk: 0, wave: 0, excite: 0 }
  private nextBlink = 1.5
  private blinkT = -1
  private pokeT = -1
  private lastPointer = -10
  private wander = { x: 0, y: 0, until: 0 }
  // inputs
  pointer: { x: number; y: number } | null = null // -1..1 relative to the avatar
  hover = false
  mood: Mood = 'idle'
  reducedMotion = false

  constructor(kind: CompanionKind) {
    this.rig = buildRig(kind)
  }

  poke() { this.pokeT = this.s.t }
  // Something is happening that deserves full frame rate.
  busy(): boolean { return this.hover || this.pokeT >= 0 || this.mood !== 'idle' || this.s.happy > 0.02 }
  notePointer() { this.lastPointer = this.s.t }

  step(dt: number) {
    const s = this.s
    s.t += dt
    const speed = this.reducedMotion ? 0.25 : 1

    // Where to look: the cursor; up-and-aside while thinking; otherwise an
    // occasional idle glance around.
    let tx = 0, ty = 0
    if (this.mood === 'thinking') { tx = 0.55 + Math.sin(s.t * 0.7) * 0.15; ty = 0.6 }
    else if (this.pointer && s.t - this.lastPointer < 4) { tx = this.pointer.x; ty = this.pointer.y }
    else {
      if (s.t > this.wander.until) this.wander = { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.4) * 0.6, until: s.t + 1.5 + Math.random() * 3 }
      tx = this.wander.x; ty = this.wander.y
    }
    s.lookX = damp(s.lookX, Math.max(-1, Math.min(1, tx)), 7, dt)
    s.lookY = damp(s.lookY, Math.max(-1, Math.min(1, ty)), 7, dt)

    if (this.blinkT < 0 && s.t > this.nextBlink) this.blinkT = s.t
    if (this.blinkT >= 0) {
      const p = (s.t - this.blinkT) / 0.16
      s.blink = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2)
      if (p >= 1) { this.blinkT = -1; s.blink = 0; this.nextBlink = s.t + 2 + Math.random() * 4 * (Math.random() < 0.2 ? 0.15 : 1) }
    }

    s.happy = damp(s.happy, this.hover ? 1 : 0, 6, dt)
    s.wave = damp(s.wave, this.hover && this.mood === 'idle' ? 1 : 0, 4, dt)
    s.think = damp(s.think, this.mood === 'thinking' ? 1 : 0, 3, dt)
    const talkTarget = this.mood === 'talking' ? 0.35 + 0.65 * Math.abs(Math.sin(s.t * 11) * Math.sin(s.t * 4.3)) : 0
    s.talk = damp(s.talk, talkTarget, 18, dt)

    // Poke: hop, spin and squash on landing.
    let hop = 0, spin = 0, squash = 0
    if (this.pokeT >= 0) {
      const p = (s.t - this.pokeT) / 0.9
      if (p >= 1) { this.pokeT = -1; s.excite = 0 } else {
        s.excite = Math.sin(Math.PI * Math.min(1, p * 1.2))
        hop = Math.sin(Math.PI * Math.min(1, p / 0.6)) * 0.32
        spin = (1 - Math.pow(1 - Math.min(1, p / 0.7), 3)) * Math.PI * 2
        squash = p > 0.6 ? Math.sin(Math.PI * (p - 0.6) / 0.4) * 0.12 : 0
      }
    }

    const { root, head } = this.rig
    const breath = Math.sin(s.t * 2.1 * speed)
    root.position.y = Math.sin(s.t * 1.3 * speed) * 0.05 + hop
    root.rotation.y = spin + s.lookX * 0.1
    root.rotation.z = this.mood === 'thinking' ? Math.sin(s.t * 0.9) * 0.06 : Math.sin(s.t * 0.8 * speed) * 0.025
    root.scale.set(1 + breath * 0.012 + squash, 1 + breath * 0.028 - squash * 1.4, 1 + breath * 0.012 + squash)
    head.rotation.y = s.lookX * 0.26
    head.rotation.x = -s.lookY * 0.16 + s.think * -0.06
    head.rotation.z = -s.lookX * 0.05 + s.happy * Math.sin(s.t * 3) * 0.04
    this.rig.update(s)
    return { hop }
  }
}

// One shared offscreen renderer that turns a rig into a still image, for the
// many small avatars (chat history, lists) that shouldn't each hold a WebGL
// context. Cached per kind.
const stills = new Map<string, Promise<string>>()

export function stillImage(kind: CompanionKind, px = 192): Promise<string> {
  const key = `${kind}:${px}`
  const hit = stills.get(key)
  if (hit) return hit
  const job = new Promise<string>((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas')
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
      renderer.setSize(px, px, false)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.95
      renderer.outputColorSpace = THREE.SRGBColorSpace
      const stage = makeScene(renderer)
      const anim = new Animator(kind)
      stage.scene.add(anim.rig.root)
      anim.mood = 'idle'
      anim.pointer = { x: 0.15, y: 0.05 }
      anim.notePointer()
      for (let i = 0; i < 40; i++) anim.step(1 / 30) // settle into a natural pose
      renderer.render(stage.scene, stage.camera)
      const url = canvas.toDataURL('image/png')
      anim.rig.dispose(); stage.dispose(); renderer.dispose(); renderer.forceContextLoss()
      resolve(url)
    } catch (err) { reject(err) }
  })
  stills.set(key, job)
  return job
}
