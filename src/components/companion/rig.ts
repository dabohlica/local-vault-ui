import * as THREE from 'three'
import { paletteFor, type CompanionKind, type Palette } from '@/lib/companion'
import { LiveTube } from './tube'
import { octopus } from './octopus'

// Procedural, toy-like 3D companions built from soft primitives — no model
// files. Each rig exposes the parts the animator drives (head turn, eyes,
// mouth, cheeks) plus a per-kind update for limbs (tentacles, flippers, tail).

export type RigState = {
  t: number        // seconds
  lookX: number    // -1..1 (right +)
  lookY: number    // -1..1 (up +)
  blink: number    // 0 open .. 1 closed
  happy: number    // 0..1 (hover): squinty smile
  think: number    // 0..1
  talk: number     // 0..1 mouth open amount
  wave: number     // 0..1 hello gesture
  excite: number   // 0..1 jump/spin progress envelope
  near: number     // 0..1 how close the cursor is (curiosity, reaching)
  reachX: number   // cursor position in the character's space (world units)
  reachY: number
}

export type Rig = {
  root: THREE.Group
  head: THREE.Group
  update: (s: RigState) => void
  dispose: () => void
}

export type Disposable = { dispose: () => void }

export function clayMaterial(color: string, sheen = '#ffffff', opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    sheen: 0.25,
    sheenColor: new THREE.Color(sheen),
    sheenRoughness: 0.7,
    ...opts,
  })
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Eyes, golden glasses, cheeks and mouth — shared by every creature.
function buildFace(parent: THREE.Group, o: {
  eyeX: number; eyeY: number; eyeZ: number; eyeR: number
  white: string; pupil: string; cheek: string; mouthY: number; mouthZ: number; glassesZ?: number
}, bag: Disposable[]) {
  const sphere = new THREE.SphereGeometry(1, 40, 28)
  bag.push(sphere)
  const white = clayMaterial(o.white, '#ffffff', { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 })
  const pupilM = new THREE.MeshPhysicalMaterial({ color: o.pupil, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 })
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const cheekM = new THREE.MeshBasicMaterial({ color: o.cheek, transparent: true, opacity: 0.55, depthWrite: false })
  const mouthM = new THREE.MeshStandardMaterial({ color: '#5A2A22', roughness: 0.6 })
  const innerM = new THREE.MeshStandardMaterial({ color: '#8E2F33', roughness: 0.7 })
  const brass = new THREE.MeshStandardMaterial({ color: '#C9963F', metalness: 0.85, roughness: 0.28 })
  const lensM = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.05, clearcoat: 1 })
  bag.push(white, pupilM, shine, cheekM, mouthM, innerM, brass, lensM)

  const eyes: Array<{ g: THREE.Group; pupil: THREE.Group }> = []
  for (const side of [-1, 1]) {
    const g = new THREE.Group()
    g.position.set(side * o.eyeX, o.eyeY, o.eyeZ)
    const w = new THREE.Mesh(sphere, white)
    w.scale.set(o.eyeR, o.eyeR * 1.08, o.eyeR * 0.55)
    g.add(w)
    const pupil = new THREE.Group()
    const p = new THREE.Mesh(sphere, pupilM)
    p.scale.set(o.eyeR * 0.66, o.eyeR * 0.74, o.eyeR * 0.3)
    p.position.z = o.eyeR * 0.36
    pupil.add(p)
    const s1 = new THREE.Mesh(sphere, shine)
    s1.scale.setScalar(o.eyeR * 0.2)
    s1.position.set(-o.eyeR * 0.22, o.eyeR * 0.28, o.eyeR * 0.6)
    const s2 = new THREE.Mesh(sphere, shine)
    s2.scale.setScalar(o.eyeR * 0.09)
    s2.position.set(o.eyeR * 0.2, -o.eyeR * 0.2, o.eyeR * 0.6)
    pupil.add(s1, s2)
    g.add(pupil)
    parent.add(g)
    eyes.push({ g, pupil })
  }

  // Round brass glasses with faint lenses.
  const gz = o.glassesZ ?? o.eyeZ + o.eyeR * 0.42
  const rim = new THREE.TorusGeometry(o.eyeR * 1.28, o.eyeR * 0.1, 14, 48)
  const lens = new THREE.CircleGeometry(o.eyeR * 1.24, 40)
  const bridge = new THREE.TorusGeometry(o.eyeX - o.eyeR * 1.28, o.eyeR * 0.08, 10, 24, Math.PI)
  bag.push(rim, lens, bridge)
  for (const side of [-1, 1]) {
    const r = new THREE.Mesh(rim, brass)
    r.position.set(side * o.eyeX, o.eyeY, gz)
    const l = new THREE.Mesh(lens, lensM)
    l.position.set(side * o.eyeX, o.eyeY, gz + 0.005)
    parent.add(r, l)
  }
  const br = new THREE.Mesh(bridge, brass)
  br.position.set(0, o.eyeY + o.eyeR * 0.1, gz)
  parent.add(br)

  const cheeks = [-1, 1].map(side => {
    const c = new THREE.Mesh(sphere, cheekM)
    c.scale.set(o.eyeR * 0.75, o.eyeR * 0.45, o.eyeR * 0.2)
    c.position.set(side * (o.eyeX + o.eyeR * 0.75), o.eyeY - o.eyeR * 1.5, o.eyeZ - o.eyeR * 0.05)
    parent.add(c)
    return c
  })

  const smileGeo = new THREE.TorusGeometry(o.eyeR * 0.5, o.eyeR * 0.11, 10, 28, Math.PI)
  bag.push(smileGeo)
  const smile = new THREE.Mesh(smileGeo, mouthM)
  smile.rotation.z = Math.PI
  smile.position.set(0, o.mouthY, o.mouthZ)
  const open = new THREE.Mesh(sphere, innerM)
  open.position.set(0, o.mouthY - o.eyeR * 0.25, o.mouthZ - 0.01)
  parent.add(smile, open)

  return (s: RigState) => {
    const lid = Math.max(s.blink, s.happy * 0.82, s.think * 0.3)
    for (const e of eyes) {
      e.g.scale.y = 1 - lid * 0.88
      e.g.position.y = o.eyeY + s.happy * o.eyeR * 0.15
      e.pupil.position.x = s.lookX * o.eyeR * 0.3
      e.pupil.position.y = s.lookY * o.eyeR * 0.28
    }
    const blush = 0.45 + s.happy * 0.35 + s.excite * 0.2
    cheeks.forEach(c => { (c.material as THREE.MeshBasicMaterial).opacity = blush })
    const m = Math.max(s.talk, s.excite * 0.7)
    smile.visible = m < 0.25
    smile.scale.setScalar(1 + s.happy * 0.35)
    open.visible = m >= 0.25
    open.scale.set(o.eyeR * (0.38 + m * 0.12), o.eyeR * (0.12 + m * 0.36), o.eyeR * 0.12)
  }
}

// --- Pim the penguin ------------------------------------------------------------

function penguin(bag: Disposable[], pal: Palette): Rig {
  const root = new THREE.Group()
  const head = new THREE.Group()
  root.add(head)
  const navy = clayMaterial(pal.body, pal.sheen)
  const cream = clayMaterial('#FFF8EE', '#ffffff')
  const orange = clayMaterial(pal.tips, '#FFE0A8')
  bag.push(navy, cream, orange)
  const profile = [[0, -1.05], [0.72, -0.95], [0.98, -0.45], [0.95, 0.15], [0.78, 0.68], [0.45, 1.02], [0, 1.1]]
    .map(([x, y]) => new THREE.Vector2(x, y))
  const bodyGeo = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(40), 64)
  const sphere = new THREE.SphereGeometry(1, 40, 28)
  bag.push(bodyGeo, sphere)
  head.add(new THREE.Mesh(bodyGeo, navy))
  const belly = new THREE.Mesh(sphere, cream)
  belly.scale.set(0.72, 0.78, 0.55)
  belly.position.set(0, -0.32, 0.5)
  head.add(belly)
  for (const side of [-1, 1]) {
    const mask = new THREE.Mesh(sphere, cream)
    mask.scale.set(0.36, 0.38, 0.3)
    mask.position.set(side * 0.3, 0.38, 0.72)
    head.add(mask)
  }
  const face = buildFace(head, {
    eyeX: 0.3, eyeY: 0.4, eyeZ: 0.92, eyeR: 0.17,
    white: '#FFFFFF', pupil: '#1E1B24', cheek: '#FF6F91', mouthY: 0.04, mouthZ: 1.02,
  }, bag)
  const beakGeo = new THREE.ConeGeometry(0.13, 0.3, 24)
  bag.push(beakGeo)
  const beak = new THREE.Mesh(beakGeo, orange)
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, 0.16, 1.02)
  head.add(beak)
  const flippers = [-1, 1].map(side => {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.9, 0.05, 0)
    const f = new THREE.Mesh(sphere, navy)
    f.scale.set(0.16, 0.55, 0.3)
    f.position.set(side * 0.08, -0.42, 0)
    pivot.add(f)
    root.add(pivot)
    return { pivot, side }
  })
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(sphere, orange)
    foot.scale.set(0.26, 0.09, 0.32)
    foot.position.set(side * 0.34, -1.04, 0.32)
    root.add(foot)
  }
  const tuftGeo = new THREE.ConeGeometry(0.05, 0.22, 12)
  bag.push(tuftGeo)
  for (const [x, rz] of [[-0.07, 0.45], [0, 0], [0.07, -0.45]]) {
    const f = new THREE.Mesh(tuftGeo, navy)
    f.position.set(x, 1.16, 0.02)
    f.rotation.z = rz
    head.add(f)
  }
  return {
    root, head,
    update(s) {
      face(s)
      beak.position.y = 0.16 - s.talk * 0.03
      for (const { pivot, side } of flippers) {
        const flap = Math.sin(s.t * 2.2) * 0.06 + s.excite * 0.9 + (side > 0 ? s.wave : 0) * (1.6 + Math.sin(s.t * 10) * 0.3)
        pivot.rotation.z = side * (0.22 + flap)
      }
    },
    dispose() { bag.forEach(d => d.dispose()) },
  }
}

// --- Fenn the fox ------------------------------------------------------------------

function fox(bag: Disposable[], pal: Palette): Rig {
  const root = new THREE.Group()
  const head = new THREE.Group()
  root.add(head)
  const fur = clayMaterial(pal.body, pal.sheen)
  const cream = clayMaterial('#FFF6EC', '#ffffff')
  const dark = clayMaterial(pal.tips, '#8C6A60')
  bag.push(fur, cream, dark)
  const sphere = new THREE.SphereGeometry(1, 48, 32)
  bag.push(sphere)
  const skull = new THREE.Mesh(sphere, fur)
  skull.scale.set(1.0, 0.86, 0.88)
  skull.position.y = 0.2
  head.add(skull)
  for (const side of [-1, 1]) {
    const fluff = new THREE.Mesh(sphere, cream)
    fluff.scale.set(0.3, 0.2, 0.24)
    fluff.position.set(side * 0.66, -0.2, 0.36)
    fluff.rotation.z = side * 0.5
    head.add(fluff)
  }
  const snout = new THREE.Mesh(sphere, cream)
  snout.scale.set(0.36, 0.26, 0.36)
  snout.position.set(0, -0.12, 0.72)
  head.add(snout)
  const nose = new THREE.Mesh(sphere, dark)
  nose.scale.set(0.1, 0.075, 0.08)
  nose.position.set(0, -0.02, 1.07)
  head.add(nose)
  const earGeo = new THREE.ConeGeometry(0.3, 0.62, 32)
  const innerGeo = new THREE.ConeGeometry(0.17, 0.4, 24)
  const tipGeo = new THREE.ConeGeometry(0.12, 0.2, 24)
  bag.push(earGeo, innerGeo, tipGeo)
  const ears = [-1, 1].map(side => {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.5, 0.78, -0.05)
    pivot.rotation.z = -side * 0.32
    const e = new THREE.Mesh(earGeo, fur)
    e.position.y = 0.26
    const inner = new THREE.Mesh(innerGeo, dark)
    inner.position.set(0, 0.2, 0.12)
    inner.scale.z = 0.4
    const tip = new THREE.Mesh(tipGeo, dark)
    tip.position.y = 0.52
    pivot.add(e, inner, tip)
    head.add(pivot)
    return { pivot, side }
  })
  const face = buildFace(head, {
    eyeX: 0.34, eyeY: 0.3, eyeZ: 0.76, eyeR: 0.17,
    white: '#2A1E1B', pupil: '#120D0C', cheek: '#FF5C7A', mouthY: -0.26, mouthZ: 1.0, glassesZ: 0.86,
  }, bag)
  const body = new THREE.Mesh(sphere, fur)
  body.scale.set(0.6, 0.5, 0.5)
  body.position.set(0, -0.82, -0.05)
  root.add(body)
  const chest = new THREE.Mesh(sphere, cream)
  chest.scale.set(0.36, 0.34, 0.3)
  chest.position.set(0, -0.78, 0.28)
  root.add(chest)
  const tail = new LiveTube(fur, 26, 14)
  bag.push(tail)
  root.add(tail.mesh)
  const tailTip = new THREE.Mesh(sphere, cream)
  root.add(tailTip)
  const tmp = new THREE.Vector3()
  return {
    root, head,
    update(s) {
      face(s)
      ears.forEach(({ pivot, side }) => {
        const twitch = Math.max(0, Math.sin(s.t * 0.9 + side) - 0.96) * 6
        pivot.rotation.z = -side * (0.32 - s.happy * 0.12 + twitch * 0.2) + s.lookX * 0.05
      })
      const swish = Math.sin(s.t * 1.8) * 0.35 + s.wave * Math.sin(s.t * 9) * 0.4 + s.excite * 0.6
      const spine = (u: number, out: THREE.Vector3) => {
        const a = -0.6 + u * 2.2 + swish * u
        out.set(0.35 + u * 0.8 + Math.sin(a) * 0.25 * u, -1.0 + u * 0.95 + Math.sin(u * Math.PI) * 0.12, -0.3 + u * 0.3 - Math.cos(a) * 0.25 * u)
      }
      tail.update(spine, u => 0.12 + Math.sin(u * Math.PI * 0.9) * 0.24)
      spine(1, tmp)
      tailTip.position.copy(tmp)
      tailTip.scale.setScalar(0.17)
    },
    dispose() { bag.forEach(d => d.dispose()) },
  }
}

export function buildRig(kind: CompanionKind, color?: string): Rig {
  const bag: Disposable[] = []
  const pal = paletteFor(kind, color)
  return kind === 'penguin' ? penguin(bag, pal) : kind === 'fox' ? fox(bag, pal) : octopus(bag, pal)
}
