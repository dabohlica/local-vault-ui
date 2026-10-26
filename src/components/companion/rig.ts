import * as THREE from 'three'
import { paletteFor, type CompanionKind, type Palette } from '@/lib/companion'

// Procedural, toy-like 3D companions built from soft primitives — no model
// files. Each rig exposes the parts the animator drives (head turn, eyes,
// brows, mouth, cheeks) plus a per-kind update for limbs (tentacles, flippers,
// tail).

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

type Disposable = { dispose: () => void }

function clayMaterial(color: string, sheen = '#ffffff', opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
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

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// A tapered tube whose spine is recomputed every frame (tentacles, tails).
// Vertices are updated in place along parallel-transport frames, so there is
// no per-frame allocation. Optional per-vertex colour along its length.
class LiveTube {
  readonly mesh: THREE.Mesh
  readonly pts: THREE.Vector3[]
  private readonly geo: THREE.BufferGeometry
  private readonly segs: number
  private readonly radial: number
  constructor(material: THREE.Material, segs = 30, radial = 14, color?: (u: number) => THREE.Color) {
    this.segs = segs
    this.radial = radial
    this.pts = Array.from({ length: segs + 1 }, () => new THREE.Vector3())
    const count = (segs + 1) * (radial + 1) + 1
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    if (color) {
      const col = new Float32Array(count * 3)
      for (let i = 0; i <= segs; i++) {
        const c = color(i / segs)
        for (let j = 0; j <= radial; j++) col.set([c.r, c.g, c.b], (i * (radial + 1) + j) * 3)
      }
      const c = color(1)
      col.set([c.r, c.g, c.b], (count - 1) * 3)
      this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    const idx: number[] = []
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j, b = a + radial + 1
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    const tip = (segs + 1) * (radial + 1)
    for (let j = 0; j < radial; j++) idx.push(segs * (radial + 1) + j, tip, segs * (radial + 1) + j + 1)
    this.geo.setIndex(idx)
    this.mesh = new THREE.Mesh(this.geo, material)
    this.mesh.frustumCulled = false
  }
  // spine(u, out) fills the point at u∈[0,1]; radius(u) gives thickness.
  update(spine: (u: number, out: THREE.Vector3) => void, radius: (u: number) => number) {
    const { segs, radial, pts } = this
    for (let i = 0; i <= segs; i++) spine(i / segs, pts[i])
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute
    const nor = this.geo.getAttribute('normal') as THREE.BufferAttribute
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3()
    T.subVectors(pts[1], pts[0]).normalize()
    N.set(0, 0, 1).cross(T)
    if (N.lengthSq() < 1e-4) N.set(1, 0, 0).cross(T)
    N.normalize()
    for (let i = 0; i <= segs; i++) {
      if (i < segs) T.subVectors(pts[i + 1], pts[i]).normalize()
      N.sub(d.copy(T).multiplyScalar(N.dot(T))).normalize() // parallel transport
      B.crossVectors(T, N).normalize()
      const r = radius(i / segs)
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2
        d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a))
        const k = i * (radial + 1) + j
        pos.setXYZ(k, pts[i].x + d.x * r, pts[i].y + d.y * r, pts[i].z + d.z * r)
        nor.setXYZ(k, d.x, d.y, d.z)
      }
    }
    const tip = (segs + 1) * (radial + 1)
    const end = pts[segs]
    pos.setXYZ(tip, end.x + T.x * 0.02, end.y + T.y * 0.02, end.z + T.z * 0.02)
    nor.setXYZ(tip, T.x, T.y, T.z)
    pos.needsUpdate = true
    nor.needsUpdate = true
    this.geo.computeBoundingSphere()
  }
  dispose() { this.geo.dispose() }
}

// Eyes, eyebrows, glasses, cheeks and mouth — shared by every creature.
// `center` is the middle of the head: the glasses are angled to follow its
// curve and their arms run back to the sides of the head.
function buildFace(parent: THREE.Group, o: {
  eyeX: number; eyeY: number; eyeZ: number; eyeR: number
  white: string; pupil: string; cheek: string; brow: string
  mouthY: number; mouthZ: number
  center: THREE.Vector3; headR: number
  glassesZ?: number
}, bag: Disposable[]) {
  const sphere = new THREE.SphereGeometry(1, 40, 28)
  bag.push(sphere)
  const white = clayMaterial(o.white, '#ffffff', { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0 })
  const pupilM = new THREE.MeshPhysicalMaterial({ color: o.pupil, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 })
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const cheekM = new THREE.MeshBasicMaterial({ color: o.cheek, transparent: true, opacity: 0.55, depthWrite: false })
  const mouthM = new THREE.MeshStandardMaterial({ color: '#4A1F25', roughness: 0.6 })
  const innerM = new THREE.MeshStandardMaterial({ color: '#8E2F45', roughness: 0.7 })
  const browM = new THREE.MeshStandardMaterial({ color: o.brow, roughness: 0.6 })
  // Chunky tortoiseshell frames: glossy dark amber.
  const frameM = new THREE.MeshPhysicalMaterial({ color: '#3A2214', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color('#B06A2C') })
  const rivetM = new THREE.MeshStandardMaterial({ color: '#E3B25A', metalness: 0.9, roughness: 0.25 })
  const lensM = new THREE.MeshPhysicalMaterial({ color: '#E8F4FF', transparent: true, opacity: 0.16, roughness: 0.02, clearcoat: 1, depthWrite: false })
  const glintM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false })
  bag.push(white, pupilM, shine, cheekM, mouthM, innerM, browM, frameM, rivetM, lensM, glintM)

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

  // Glasses: each rim faces outward along the head's curve; a curved bridge;
  // arms that wrap back to the sides of the head; gold rivets; a lens glint.
  const rimR = o.eyeR * 1.32
  const gz = o.glassesZ ?? o.eyeZ + o.eyeR * 0.38
  const rim = new THREE.TorusGeometry(rimR, o.eyeR * 0.21, 18, 56)
  const lens = new THREE.CircleGeometry(rimR * 0.97, 48)
  const glint = new THREE.TorusGeometry(rimR * 0.7, o.eyeR * 0.045, 6, 20, Math.PI * 0.35)
  const rivet = new THREE.SphereGeometry(o.eyeR * 0.09, 12, 8)
  bag.push(rim, lens, glint, rivet)
  const rimPos = [-1, 1].map(side => new THREE.Vector3(side * o.eyeX, o.eyeY, gz))
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1
    const at = rimPos[i]
    const g = new THREE.Group()
    g.position.copy(at)
    const outward = at.clone().sub(o.center).setY(0).normalize()
    g.lookAt(at.clone().add(outward.lerp(new THREE.Vector3(0, 0, 1), 0.55)))
    g.add(new THREE.Mesh(rim, frameM))
    const l = new THREE.Mesh(lens, lensM)
    l.position.z = 0.005
    g.add(l)
    const gl = new THREE.Mesh(glint, glintM)
    gl.position.z = 0.012
    gl.rotation.z = Math.PI * 0.55
    g.add(gl)
    const rv = new THREE.Mesh(rivet, rivetM)
    rv.position.set(side * rimR, 0, 0.03)
    g.add(rv)
    parent.add(g)
    // Arm: from the outer edge of the rim, hugging the head, to above the "ear".
    const start = new THREE.Vector3(side * (o.eyeX + rimR * 0.95), o.eyeY + o.eyeR * 0.15, gz - 0.04)
    const end = new THREE.Vector3(side * o.headR * 0.98, o.eyeY + o.eyeR * 0.35, o.center.z - o.headR * 0.12)
    const mid = start.clone().lerp(end, 0.5)
    mid.sub(o.center).setLength(o.headR * 1.03).add(o.center)
    const armGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, mid, end]), 20, o.eyeR * 0.09, 8)
    bag.push(armGeo)
    parent.add(new THREE.Mesh(armGeo, frameM))
  }
  const bridgeGeo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-o.eyeX + rimR * 0.92, o.eyeY + o.eyeR * 0.15, gz),
    new THREE.Vector3(0, o.eyeY + o.eyeR * 0.6, gz + 0.06),
    new THREE.Vector3(o.eyeX - rimR * 0.92, o.eyeY + o.eyeR * 0.15, gz),
  ), 16, o.eyeR * 0.12, 8)
  bag.push(bridgeGeo)
  parent.add(new THREE.Mesh(bridgeGeo, frameM))

  // Eyebrows: soft little capsules above the frames.
  const browGeo = new THREE.CapsuleGeometry(o.eyeR * 0.11, o.eyeR * 0.75, 6, 12)
  bag.push(browGeo)
  const brows = [-1, 1].map(side => {
    const b = new THREE.Mesh(browGeo, browM)
    b.rotation.z = Math.PI / 2
    b.position.set(side * o.eyeX, o.eyeY + rimR + o.eyeR * 0.45, gz - 0.02)
    parent.add(b)
    return { b, side }
  })

  const cheeks = [-1, 1].map(side => {
    const c = new THREE.Mesh(sphere, cheekM)
    c.scale.set(o.eyeR * 0.75, o.eyeR * 0.45, o.eyeR * 0.2)
    c.position.set(side * (o.eyeX + o.eyeR * 0.85), o.eyeY - o.eyeR * 1.6, o.eyeZ - o.eyeR * 0.1)
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
    const curious = s.near * (1 - s.happy)
    for (const e of eyes) {
      e.g.scale.y = 1 - lid * 0.88
      e.g.position.y = o.eyeY + s.happy * o.eyeR * 0.15
      e.pupil.position.x = s.lookX * o.eyeR * 0.3
      e.pupil.position.y = s.lookY * o.eyeR * 0.28
      e.pupil.scale.setScalar(1 + curious * 0.14)
    }
    // Brows: up when curious or happy, one up one down while thinking, a
    // little frown dip during a blink-free stare is left out on purpose.
    for (const { b, side } of brows) {
      const lift = curious * 0.55 + s.happy * 0.35 + s.excite * 0.5 + (s.think * (side > 0 ? 0.6 : -0.15))
      b.position.y = o.eyeY + rimR + o.eyeR * (0.45 + lift * 0.5)
      b.rotation.z = Math.PI / 2 + side * (0.12 + s.happy * 0.18 - curious * 0.1 + (side > 0 ? s.think * 0.25 : -s.think * 0.1))
    }
    const blush = 0.45 + s.happy * 0.35 + s.excite * 0.2 + curious * 0.15
    cheeks.forEach(c => { (c.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, blush) })
    const m = Math.max(s.talk, s.excite * 0.7, curious * 0.3)
    smile.visible = m < 0.25
    smile.scale.setScalar(1 + s.happy * 0.35)
    open.visible = m >= 0.25
    open.scale.set(o.eyeR * (0.3 + m * 0.18), o.eyeR * (0.12 + m * 0.36), o.eyeR * 0.12)
  }
}

// --- Inka the octopus ---------------------------------------------------------

function octopus(bag: Disposable[], pal: Palette): Rig {
  const root = new THREE.Group()
  const head = new THREE.Group()
  root.add(head)
  const skin = clayMaterial(pal.body, pal.sheen)
  const spots = clayMaterial(pal.spots, pal.sheen)
  // Tentacles use vertex colours: body colour, fading into ink-dipped tips.
  const armM = clayMaterial('#ffffff', pal.sheen, { vertexColors: true })
  bag.push(skin, spots, armM)

  const profile = [
    [0, -0.42], [0.62, -0.4], [0.92, -0.18], [1.0, 0.18], [0.92, 0.6], [0.7, 0.92], [0.38, 1.1], [0, 1.15],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const mantleGeo = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(40), 64)
  bag.push(mantleGeo)
  head.add(new THREE.Mesh(mantleGeo, skin))

  const sphere = new THREE.SphereGeometry(1, 24, 16)
  bag.push(sphere)
  for (const [x, y, z, r] of [[0.48, 0.86, 0.48, 0.1], [0.66, 0.6, 0.6, 0.065], [-0.56, 0.8, 0.46, 0.08], [0.12, 1.04, 0.38, 0.055], [-0.3, 1.0, 0.4, 0.04]]) {
    const f = new THREE.Mesh(sphere, spots)
    f.scale.set(r, r, r * 0.35)
    f.position.set(x, y, z)
    f.lookAt(x * 2, y * 2 - 0.35, z * 2)
    head.add(f)
  }

  const face = buildFace(head, {
    eyeX: 0.37, eyeY: 0.3, eyeZ: 0.86, eyeR: 0.22,
    white: '#FFFFFF', pupil: '#17142A', cheek: '#FF5A9A', brow: pal.brow, mouthY: -0.07, mouthZ: 0.97,
    center: new THREE.Vector3(0, 0.3, 0), headR: 1.0,
  }, bag)

  const body = new THREE.Color(pal.body), tips = new THREE.Color(pal.tips)
  const armColor = (u: number) => body.clone().lerp(tips, smooth(0.55, 0.95, u))
  const arms = Array.from({ length: 8 }, () => new LiveTube(armM, 32, 14, armColor))
  arms.forEach(a => { root.add(a.mesh); bag.push(a) })

  // Suckers: little pale dots along the underside of every arm.
  const SUCKERS = [12, 16, 20, 24, 27]
  const suckerGeo = new THREE.SphereGeometry(1, 12, 8)
  const suckerM = clayMaterial(body.clone().lerp(new THREE.Color('#ffffff'), 0.3).getStyle(), '#ffffff', { roughness: 0.45 })
  bag.push(suckerGeo, suckerM)
  const suckers = new THREE.InstancedMesh(suckerGeo, suckerM, arms.length * SUCKERS.length)
  suckers.frustumCulled = false
  root.add(suckers)
  const m4 = new THREE.Matrix4(), sq = new THREE.Quaternion(), sp = new THREE.Vector3(), ss = new THREE.Vector3()
  const tan = new THREE.Vector3(), down = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1)
  const placeSuckers = (radius: (i: number, u: number) => number) => {
    let n = 0
    arms.forEach((arm, ai) => {
      const P = arm.pts
      for (const si of SUCKERS) {
        const u = si / (P.length - 1)
        tan.subVectors(P[Math.min(P.length - 1, si + 1)], P[si - 1]).normalize()
        // the side facing down (and a bit toward the viewer), perpendicular to the arm
        down.set(0, -1, 0.15).addScaledVector(tan, -tan.dot(down.set(0, -1, 0.15))).normalize()
        const r = radius(ai, u)
        sp.copy(P[si]).addScaledVector(down, r * 0.88)
        sq.setFromUnitVectors(zAxis, down)
        const k = r * 0.3
        ss.set(k, k, k * 0.45)
        suckers.setMatrixAt(n++, m4.compose(sp, sq, ss))
      }
    })
    suckers.instanceMatrix.needsUpdate = true
  }

  // A quill pen held in the side-right arm: she writes your notes.
  const quill = new THREE.Group()
  const featherM = clayMaterial('#FFB347', '#FFE3B0', { roughness: 0.6 })
  const featherTipM = clayMaterial('#FF6A2B', '#FFC09A', { roughness: 0.6 })
  const shaftM = new THREE.MeshStandardMaterial({ color: '#E9DFC8', roughness: 0.5 })
  const nibM = new THREE.MeshStandardMaterial({ color: '#E3B25A', metalness: 0.9, roughness: 0.25 })
  const vane = new THREE.SphereGeometry(1, 20, 12)
  const shaft = new THREE.CylinderGeometry(0.014, 0.02, 0.8, 8)
  const nib = new THREE.ConeGeometry(0.03, 0.09, 12)
  bag.push(featherM, featherTipM, shaftM, nibM, vane, shaft, nib)
  const v = new THREE.Mesh(vane, featherM)
  v.scale.set(0.12, 0.4, 0.022)
  v.position.y = 0.24
  v.rotation.z = 0.14
  const vt = new THREE.Mesh(vane, featherTipM)
  vt.scale.set(0.085, 0.14, 0.024)
  vt.position.set(-0.05, 0.56, 0)
  vt.rotation.z = 0.25
  quill.add(vt)
  const sh = new THREE.Mesh(shaft, shaftM)
  const nb = new THREE.Mesh(nib, nibM)
  nb.rotation.x = Math.PI
  nb.position.y = -0.44
  quill.add(v, sh, nb)
  root.add(quill)

  const base = new THREE.Vector3(), rest = new THREE.Vector3(), reach = new THREE.Vector3()
  const p0 = new THREE.Vector3(), c = new THREE.Vector3(), target = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion()
  const QUILL_ARM = 0

  const restPoint = (s: RigState, i: number, u: number, out: THREE.Vector3) => {
    const ang = (i / 8) * Math.PI * 2 + Math.PI / 8
    const sway = Math.sin(s.t * 1.7 + i * 0.9 + u * 3.2) * 0.22 * u
    const a = ang + sway * 0.6
    const r = 0.48 + u * (0.55 + 0.1 * Math.sin(s.t * 1.1 + i))
    let y = -0.25 - Math.sin(u * Math.PI * 0.55) * 0.78 + smooth(0.62, 1, u) * 0.42
    y += Math.sin(s.t * 2.1 + i * 1.3) * 0.05 * u
    y += s.excite * 0.35 * u
    if (i === 1) y += s.wave * (u * 1.25 + Math.sin(s.t * 9) * 0.12 * u) // hello
    if (i === QUILL_ARM) y += smooth(0.5, 1, u) * 0.35 // holds the quill up a bit
    base.set(Math.cos(a) * r, y, Math.sin(a) * r * 0.9)
    const curl = smooth(0.7, 1, u) * (0.22 + 0.05 * Math.sin(s.t * 2 + i))
    out.set(base.x * (1 - curl * 0.6), base.y, base.z * (1 - curl * 0.6))
  }

  return {
    root, head,
    update(s) {
      face(s)
      // The front arm on the cursor's side reaches out to it when it's near.
      const reachArm = s.reachX >= 0 ? 1 : 2
      const k = smooth(0, 0.7, s.near)
      const armRadius = (i: number, u: number) =>
        (0.25 * Math.pow(1 - u, 0.8) + 0.035) * (i === reachArm ? 1 - 0.22 * k * smooth(0.15, 0.9, u) : 1)
      target.set(s.reachX, s.reachY, 0.55)
      const side = s.reachX >= 0 ? 1 : -1
      arms.forEach((arm, i) => {
        arm.update((u, out) => {
          restPoint(s, i, u, rest)
          if (i !== reachArm || k < 0.01) { out.copy(rest); return }
          restPoint(s, i, 0, p0)
          // From the root of the arm, arching out sideways and up around the
          // head, to the cursor — with an S-bend, a slow ripple and a tip that
          // curls up as if holding it.
          c.copy(p0).lerp(target, 0.45).add(dir.set(side * 0.35, 0.6, 0.15))
          const iu = 1 - u
          reach.copy(p0).multiplyScalar(iu * iu).addScaledVector(c, 2 * iu * u).addScaledVector(target, u * u)
          const dx = target.x - p0.x, dy = target.y - p0.y, len = Math.hypot(dx, dy) || 1
          const px = -dy / len, py = dx / len
          const bend = Math.sin(u * Math.PI * 2) * 0.12 * side + Math.sin(s.t * 3.2 + u * 5) * 0.05 * u
          reach.x += px * bend
          reach.y += py * bend
          const curl = smooth(0.82, 1, u)
          reach.x -= (dx / len) * curl * 0.1
          reach.y += curl * 0.14 + Math.sin(s.t * 7 + u * 6) * 0.025 * u
          out.copy(rest).lerp(reach, k * Math.min(1, u * 3))
        }, u => armRadius(i, u))
      })
      placeSuckers(armRadius)
      // Quill sits in the curl of its arm's tip, leaning up and out.
      const pts = arms[QUILL_ARM].pts
      const tip = pts[pts.length - 3]
      quill.position.copy(tip)
      dir.subVectors(tip, pts[pts.length - 8]).normalize().add(up.clone().multiplyScalar(1.6)).normalize()
      q.setFromUnitVectors(up, dir)
      quill.quaternion.copy(q)
      quill.rotateY(-0.6)
      // in front of the body, so it isn't hidden behind the head
      quill.position.x -= 0.12
      quill.position.y += 0.1
      quill.position.z += 0.55
    },
    dispose() { bag.forEach(d => d.dispose()) },
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
    white: '#FFFFFF', pupil: '#1E1B24', cheek: '#FF6F91', brow: pal.brow, mouthY: 0.04, mouthZ: 1.02,
    center: new THREE.Vector3(0, 0.3, 0), headR: 0.9,
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
        // The flipper on the cursor's side lifts toward it when it's near.
        const toward = (side > 0) === (s.reachX >= 0) ? s.near * 0.9 : 0
        const flap = Math.sin(s.t * 2.2) * 0.06 + s.excite * 0.9 + toward + (side > 0 ? s.wave : 0) * (1.6 + Math.sin(s.t * 10) * 0.3)
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
    white: '#2A1E1B', pupil: '#120D0C', cheek: '#FF5C7A', brow: pal.brow, mouthY: -0.26, mouthZ: 1.0, glassesZ: 0.86,
    center: new THREE.Vector3(0, 0.2, 0), headR: 0.95,
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
        // Ears prick up when the cursor comes close.
        pivot.rotation.z = -side * (0.32 - s.happy * 0.12 - s.near * 0.14 + twitch * 0.2) + s.lookX * 0.05
      })
      const swish = Math.sin(s.t * 1.8) * 0.35 + s.wave * Math.sin(s.t * 9) * 0.4 + s.excite * 0.6 + s.near * Math.sin(s.t * 6) * 0.25
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
