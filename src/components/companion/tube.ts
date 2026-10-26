import * as THREE from 'three'

// A tapered tube whose spine is recomputed every frame (tentacles, tails).
// Vertices are updated in place along parallel-transport frames, so there is
// no per-frame allocation. Optional per-vertex colour along its length.
export class LiveTube {
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
