import * as THREE from 'three'
import type { Palette } from '@/lib/companion'
import type { Disposable, Rig, RigState } from './rig'
import { LiveTube } from './tube'

// Inka: a quirky, Pixar-ish octopus. Tall egg-shaped head with bumpy skin
// (orange, warming to yellow on top), huge glossy bulging eyes on either side
// of a nose ridge — looking ever so slightly in different directions — under
// chunky rounded-square glasses, and eight thick tentacles splayed on the
// ground with spiral-curled tips and rows of pale suckers. No mouth: she talks
// with her eyes and arms.
//
// Palette fields, for the octopus: body = skin, spots = tint at the top of the
// head, tips = sucker colour, brow = glasses frames.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Fine dimples for the skin (bump map), generated once.
let bumpTex: THREE.CanvasTexture | null = null
function skinBump(): THREE.CanvasTexture {
  if (bumpTex) return bumpTex
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, 256, 256)
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = 1 + rnd() * 2.6
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(128,128,128,0)')
    g.fillStyle = grad
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  bumpTex = new THREE.CanvasTexture(c)
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping
  return bumpTex
}

// Iris + pupil painted along the cap's polar angle (v): black pupil in the
// middle, warm orange iris, a dark rim.
function irisTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 8; c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#08080C')
  grad.addColorStop(0.5, '#0D0D12')
  grad.addColorStop(0.56, '#7A3110')
  grad.addColorStop(0.64, '#E2761F')
  grad.addColorStop(0.84, '#F39A3D')
  grad.addColorStop(0.93, '#B4521A')
  grad.addColorStop(1, '#3A1A0C')
  g.fillStyle = grad
  g.fillRect(0, 0, 8, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Rounded rectangle path.
function roundRect(path: THREE.Shape | THREE.Path, w: number, h: number, r: number) {
  const x = -w / 2, y = -h / 2
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r)
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r)
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y)
}

export function octopus(bag: Disposable[], pal: Palette): Rig {
  const root = new THREE.Group()
  const head = new THREE.Group()
  root.add(head)

  const bump = skinBump()
  const skin = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', vertexColors: true, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35,
    sheen: 0.35, sheenColor: new THREE.Color(pal.sheen), bumpMap: bump, bumpScale: 1.4,
  })
  const armSkin = skin.clone()
  armSkin.bumpMap = bump
  armSkin.bumpScale = 0.6 // softer on the arms, which catch light at a grazing angle
  // Same skin without vertex colours, for parts that have no colour attribute.
  const plainSkin = new THREE.MeshPhysicalMaterial({
    color: pal.body, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35,
    sheen: 0.35, sheenColor: new THREE.Color(pal.sheen), bumpMap: bump, bumpScale: 1.4,
  })
  const sucker = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(pal.tips).lerp(new THREE.Color(pal.body), 0.35), roughness: 0.45, clearcoat: 0.5 })
  const sclera = new THREE.MeshPhysicalMaterial({ color: '#F4EEE4', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 })
  const irisTex = irisTexture()
  const iris = new THREE.MeshPhysicalMaterial({ map: irisTex, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 })
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const frame = new THREE.MeshPhysicalMaterial({ color: pal.brow, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.2 })
  const lensM = new THREE.MeshPhysicalMaterial({ color: '#dfeefe', transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1, depthWrite: false })
  bag.push(skin, armSkin, plainSkin, sucker, sclera, irisTex, iris, shine, frame, lensM)

  const bodyCol = new THREE.Color(pal.body), topCol = new THREE.Color(pal.spots)

  // Head: one lathe from the tentacle crown (narrow), through the face,
  // up into the tall egg-shaped mantle. Colour warms toward the top.
  // The bottom flares into a wide skirt the arms grow out of (no gap).
  const profile = [
    [0.0, -0.98], [0.5, -0.97], [0.74, -0.9], [0.72, -0.72], [0.6, -0.5], [0.56, -0.2], [0.66, 0.2], [0.86, 0.6], [0.95, 0.98],
    [0.9, 1.32], [0.72, 1.6], [0.42, 1.78], [0.0, 1.84],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const headGeo = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(60), 72)
  {
    const pos = headGeo.getAttribute('position')
    const col = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      c.copy(bodyCol).lerp(topCol, smooth(0.6, 1.8, pos.getY(i)))
      col.set([c.r, c.g, c.b], i * 3)
    }
    headGeo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const uv = headGeo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 5)
  }
  bag.push(headGeo)
  head.add(new THREE.Mesh(headGeo, skin))
  head.scale.setScalar(0.9) // a touch smaller, so the arms carry more of the silhouette

  const sphere = new THREE.SphereGeometry(1, 40, 28)
  bag.push(sphere)

  // Eyes: big glossy balls that turn (iris cap + pupil), a fixed catchlight,
  // and a skin-coloured lid that slides down to blink.
  const EYE_R = 0.4, EYE_Y = 0.32, EYE_X = 0.5, EYE_Z = 0.46
  const capGeo = new THREE.SphereGeometry(EYE_R * 1.004, 40, 20, 0, Math.PI * 2, 0, 0.62)
  const lidGeo = new THREE.SphereGeometry(EYE_R * 1.045, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.58)
  bag.push(capGeo, lidGeo)
  const eyes = [-1, 1].map(side => {
    const socket = new THREE.Group()
    socket.position.set(side * EYE_X, EYE_Y, EYE_Z)
    socket.rotation.y = side * 0.32 // set on the sides of the face
    const ball = new THREE.Group()
    const w = new THREE.Mesh(sphere, sclera)
    w.scale.setScalar(EYE_R)
    const cap = new THREE.Mesh(capGeo, iris)
    cap.rotation.x = Math.PI / 2 // cap axis → +Z (forward)
    ball.add(w, cap)
    socket.add(ball)
    const s1 = new THREE.Mesh(sphere, shine)
    s1.scale.setScalar(EYE_R * 0.12)
    s1.position.set(-EYE_R * 0.32, EYE_R * 0.38, EYE_R * 0.86)
    const s2 = new THREE.Mesh(sphere, shine)
    s2.scale.setScalar(EYE_R * 0.05)
    s2.position.set(EYE_R * 0.3, -EYE_R * 0.12, EYE_R * 0.95)
    socket.add(s1, s2)
    const lid = new THREE.Mesh(lidGeo, plainSkin)
    socket.add(lid)
    head.add(socket)
    return { socket, ball, lid, side, sx: 0, sy: 0, nextSaccade: 0 }
  })

  // Glasses: chunky rounded-square frames, wider than the head, with arms
  // running back past the head.
  const LW = 0.98, LH = 0.86
  const ring = new THREE.Shape()
  roundRect(ring, LW, LH, 0.34)
  const hole = new THREE.Path()
  roundRect(hole, LW - 0.2, LH - 0.2, 0.26)
  ring.holes.push(hole)
  const frameGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 4, curveSegments: 24 })
  frameGeo.translate(0, 0, -0.035)
  const lensShape = new THREE.Shape()
  roundRect(lensShape, LW - 0.2, LH - 0.2, 0.26)
  const lensGeo = new THREE.ShapeGeometry(lensShape, 24)
  const bridgeGeo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.1, 0.36, 0.86), new THREE.Vector3(0, 0.44, 0.9), new THREE.Vector3(0.1, 0.36, 0.86),
  ), 12, 0.055, 10)
  bag.push(frameGeo, lensGeo, bridgeGeo)
  const glasses = new THREE.Group()
  for (const side of [-1, 1]) {
    const g = new THREE.Group()
    g.position.set(side * 0.6, 0.34, 0.84)
    g.rotation.y = side * 0.2
    g.add(new THREE.Mesh(frameGeo, frame))
    const l = new THREE.Mesh(lensGeo, lensM)
    l.position.z = 0.01
    g.add(l)
    glasses.add(g)
    // Arm: from the outer edge back along the side of the head, poking out behind.
    const armGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 1.07, 0.46, 0.72),
      new THREE.Vector3(side * 1.12, 0.48, 0.25),
      new THREE.Vector3(side * 1.08, 0.44, -0.3),
      new THREE.Vector3(side * 1.12, 0.3, -0.55),
    ]), 24, 0.05, 10)
    bag.push(armGeo)
    glasses.add(new THREE.Mesh(armGeo, frame))
  }
  glasses.add(new THREE.Mesh(bridgeGeo, frame))
  head.add(glasses)

  // Tentacles: eight thick arms splayed on the ground, tips rolled up into
  // spirals. Each has its own length, curl and phase so the pose looks natural.
  const CROWN_Y = -0.66, GROUND_Y = -1.0
  const arms = Array.from({ length: 8 }, (_, i) => {
    const tube = new LiveTube(armSkin, 46, 16, u => bodyCol.clone().lerp(topCol, 0.45 * (1 - u) + 0.25))
    root.add(tube.mesh)
    bag.push(tube)
    // Spread mostly sideways and toward the viewer, like the reference.
    const ang = [-0.25, 0.55, 1.15, 1.95, 2.55, 3.35, 4.2, 5.4][i]
    return {
      tube, ang,
      reach: 1.08 + ((i * 37) % 7) * 0.05,
      curlR: 0.25 + ((i * 53) % 5) * 0.025,
      turns: 1.5 + ((i * 29) % 4) * 0.3,
      tilt: ((i % 3) - 1) * 0.35,
      phase: i * 1.37,
    }
  })

  // Suckers: two rows along each arm's edges, from mid-arm into the curl.
  const ROWS = 2, PER_ROW = 16
  const suckerGeo = new THREE.SphereGeometry(1, 12, 8)
  bag.push(suckerGeo)
  const suckers = new THREE.InstancedMesh(suckerGeo, sucker, arms.length * ROWS * PER_ROW)
  suckers.frustumCulled = false
  root.add(suckers)

  const P = new THREE.Vector3(), R = new THREE.Vector3(), Q = new THREE.Vector3(), C = new THREE.Vector3(), tmp = new THREE.Vector3()
  const T = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1)
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3()

  // Rest pose of arm `a` at u∈[0,1]: down from the crown, out along the
  // ground, then a spiral that rolls up and back over itself.
  const SPLIT = 0.5
  const restPoint = (s: RigState, a: typeof arms[number], u: number, out: THREE.Vector3, crownY: number) => {
    const sway = Math.sin(s.t * 1.2 + a.phase) * 0.08
    const ang = a.ang + sway
    const dx = Math.cos(ang), dz = Math.sin(ang)
    const lift = s.excite * 0.35 + s.happy * 0.08
    let h: number, y: number
    if (u <= SPLIT) {
      const v = u / SPLIT
      h = 0.28 + v * a.reach
      y = crownY + (GROUND_Y - crownY) * smooth(0, 0.6, v) + lift * v * 0.4
    } else {
      // spiral in the plane of the arm's direction, tilted a little sideways
      const v = (u - SPLIT) / (1 - SPLIT)
      const breathe = 1 + Math.sin(s.t * 1.6 + a.phase) * 0.06 - s.excite * 0.25 - s.happy * 0.1
      const turns = a.turns * breathe
      const phi = v * turns * Math.PI
      const r0 = a.curlR * (1 + s.excite * 0.4)
      const rr = r0 * (1 - 0.78 * v)
      const h0 = 0.28 + a.reach
      h = h0 + Math.sin(phi) * rr
      y = GROUND_Y + r0 - Math.cos(phi) * rr + lift * 0.5
      const t = Math.sin(phi) * rr * a.tilt
      out.set(dx * h - dz * t, y, dz * h * 0.9 + dx * t)
      return
    }
    out.set(dx * h, y, dz * h * 0.9)
  }

  const eyeLook = new THREE.Vector2()

  return {
    root, head,
    update(s) {
      // --- eyes ---------------------------------------------------------------
      const curious = s.near * (1 - s.happy)
      for (const e of eyes) {
        if (s.t > e.nextSaccade) { // tiny independent darts: alive, a bit odd
          e.sx = (Math.random() - 0.5) * 0.12
          e.sy = (Math.random() - 0.5) * 0.08
          e.nextSaccade = s.t + 0.6 + Math.random() * 2.2
        }
        // quirk: each eye drifts slightly outward
        eyeLook.set(s.lookX * 0.55 + e.side * 0.07 + e.sx, s.lookY * 0.45 + e.sy + s.think * 0.3)
        e.ball.rotation.y += (eyeLook.x - e.ball.rotation.y) * 0.35
        e.ball.rotation.x += (-eyeLook.y - e.ball.rotation.x) * 0.35
        // lid: open (tucked back) → closed (over the front); happy = half;
        // thinking droops one lid; curious opens wide
        const closed = Math.max(s.blink, s.happy * 0.55, s.think * (e.side > 0 ? 0.42 : 0.18))
        const open = -1.25 - curious * 0.22
        e.lid.rotation.x = open + closed * 2.35
        const bulge = 1 + curious * 0.07 + s.excite * 0.08
        e.socket.scale.setScalar(bulge)
      }
      glasses.position.y = curious * 0.02 + s.excite * 0.03
      glasses.rotation.z = Math.sin(s.t * 0.7) * 0.012 + s.think * 0.04

      // --- arms -------------------------------------------------------------------
      const crownY = CROWN_Y + head.position.y
      const reachIdx = s.reachX >= 0 ? 1 : 3 // front-right / front-left arm
      const k = smooth(0, 0.7, s.near)
      const target = tmp.set(s.reachX, s.reachY, 0.75)
      const talk = s.talk
      let n = 0
      arms.forEach((a, ai) => {
        const reaching = ai === reachIdx && k > 0.01
        a.tube.update((u, out) => {
          restPoint(s, a, u, out, crownY)
          if (talk > 0.01) out.y += Math.sin(s.t * 9 + a.phase + u * 4) * 0.035 * talk * u // arms "talk"
          if (!reaching) return
          restPoint(s, a, 0, P, crownY)
          // up and around toward the cursor, the tip curling over it
          C.copy(P).lerp(target, 0.5).add(R.set(Math.sign(s.reachX || 1) * 0.3, 0.7, 0.2))
          const iu = 1 - u
          Q.copy(P).multiplyScalar(iu * iu).addScaledVector(C, 2 * iu * u).addScaledVector(target, u * u)
          const curl = smooth(0.8, 1, u)
          Q.y += curl * 0.16 + Math.sin(s.t * 6 + u * 7) * 0.03 * u
          Q.x -= Math.sign(s.reachX || 1) * curl * 0.12
          out.lerp(Q, k * Math.min(1, u * 2.5))
        }, u => {
          const base = 0.27 * Math.pow(1 - u, 0.72) + 0.035
          return reaching ? base * (1 - 0.18 * k * smooth(0.2, 0.9, u)) : base
        })
        // suckers along both edges
        const pts = a.tube.pts
        for (let row = 0; row < ROWS; row++) {
          for (let j = 0; j < PER_ROW; j++) {
            const u = 0.28 + (j / (PER_ROW - 1)) * 0.66
            const idx = Math.round(u * (pts.length - 1))
            const p = pts[idx]
            T.subVectors(pts[Math.min(pts.length - 1, idx + 1)], pts[Math.max(0, idx - 1)]).normalize()
            side.crossVectors(T, up)
            if (side.lengthSq() < 1e-4) side.set(1, 0, 0)
            side.normalize().multiplyScalar(row === 0 ? 1 : -1)
            // tilt the rows toward the top/viewer so they read from the front
            side.addScaledVector(up, 0.55).addScaledVector(zAxis, 0.25).normalize()
            const r = 0.27 * Math.pow(1 - u, 0.72) + 0.035
            const size = r * 0.27
            P.copy(p).addScaledVector(side, r * 0.86)
            q4.setFromUnitVectors(zAxis, side)
            s3.set(size, size, size * 0.6)
            suckers.setMatrixAt(n++, m4.compose(P, q4, s3))
          }
        }
      })
      suckers.instanceMatrix.needsUpdate = true
    },
    dispose() { bag.forEach(d => d.dispose()) },
  }
}
