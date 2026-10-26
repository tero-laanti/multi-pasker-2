import * as THREE from 'three';

/**
 * Signed-distance modelling for organic shapes (gloved hands): primitives are blended with a
 * smooth union and turned into a mesh with naive surface nets. Normals come from the SDF
 * gradient, so the result shades smoothly with no visible seams between parts.
 */

export type V3 = [number, number, number];

interface Prim {
  /** Signed distance at (x, y, z). */
  d(x: number, y: number, z: number): number;
  min: V3;
  max: V3;
  /** Blend radius with what was added before it (defaults to the shape's). */
  k?: number;
}

/** Tapered capsule from a (radius ra) to b (radius rb). Exact (Inigo Quilez's round cone). */
export function roundCone(a: V3, b: V3, ra: number, rb: number): Prim {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const r = Math.max(ra, rb);
  return {
    min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
    max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
    d(x, y, z) {
      const pax = x - a[0];
      const pay = y - a[1];
      const paz = z - a[2];
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    },
  };
}

/** Ellipsoid with semi-axes along the given orthonormal basis vectors (approximate distance). */
export function ellipsoid(c: V3, axes: [V3, V3, V3], radii: V3): Prim {
  const [u, v, w] = axes;
  const r = Math.max(...radii);
  return {
    min: [c[0] - r, c[1] - r, c[2] - r],
    max: [c[0] + r, c[1] + r, c[2] + r],
    d(x, y, z) {
      const px = x - c[0];
      const py = y - c[1];
      const pz = z - c[2];
      const lx = (px * u[0] + py * u[1] + pz * u[2]) / radii[0];
      const ly = (px * v[0] + py * v[1] + pz * v[2]) / radii[1];
      const lz = (px * w[0] + py * w[1] + pz * w[2]) / radii[2];
      const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
      const k1 = Math.sqrt((lx / radii[0]) ** 2 + (ly / radii[1]) ** 2 + (lz / radii[2]) ** 2);
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...radii);
    },
  };
}

/** Rounded box: centre, orthonormal axes, half sizes, corner radius. */
export function roundBox(c: V3, axes: [V3, V3, V3], half: V3, r: number): Prim {
  const [u, v, w] = axes;
  const ext = Math.hypot(half[0], half[1], half[2]);
  const hx = half[0] - r;
  const hy = half[1] - r;
  const hz = half[2] - r;
  return {
    min: [c[0] - ext, c[1] - ext, c[2] - ext],
    max: [c[0] + ext, c[1] + ext, c[2] + ext],
    d(x, y, z) {
      const px = x - c[0];
      const py = y - c[1];
      const pz = z - c[2];
      const qx = Math.abs(px * u[0] + py * u[1] + pz * u[2]) - hx;
      const qy = Math.abs(px * v[0] + py * v[1] + pz * v[2]) - hy;
      const qz = Math.abs(px * w[0] + py * w[1] + pz * w[2]) - hz;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const oz = Math.max(qz, 0);
      return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
    },
  };
}

/** Exact (unblended) union, e.g. the segments of one finger, blended as a unit with others. */
export function union(parts: Prim[]): Prim {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p.min[i]!);
      max[i] = Math.max(max[i]!, p.max[i]!);
    }
  return {
    min,
    max,
    d(x, y, z) {
      let d = Infinity;
      for (const p of parts) d = Math.min(d, p.d(x, y, z));
      return d;
    },
  };
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** A blended set of primitives with a 1 cm broadphase grid. */
export class SdfShape {
  private prims: Prim[] = [];
  private bins = new Map<number, number[]>();
  private readonly bin = 0.01;
  min: V3 = [Infinity, Infinity, Infinity];
  max: V3 = [-Infinity, -Infinity, -Infinity];

  constructor(
    readonly blend: number,
    /** Distance returned where no primitive is near (outside). */
    private far = 0.02,
  ) {}

  add(p: Prim, k?: number): this {
    if (k !== undefined) p.k = k;
    this.prims.push(p);
    for (let i = 0; i < 3; i++) {
      this.min[i] = Math.min(this.min[i]!, p.min[i]!);
      this.max[i] = Math.max(this.max[i]!, p.max[i]!);
    }
    return this;
  }

  private key(i: number, j: number, k: number): number {
    return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  }

  build(): void {
    const pad = this.blend + this.far;
    this.bins.clear();
    this.prims.forEach((p, idx) => {
      const i0 = Math.floor((p.min[0] - pad) / this.bin);
      const i1 = Math.floor((p.max[0] + pad) / this.bin);
      const j0 = Math.floor((p.min[1] - pad) / this.bin);
      const j1 = Math.floor((p.max[1] + pad) / this.bin);
      const k0 = Math.floor((p.min[2] - pad) / this.bin);
      const k1 = Math.floor((p.max[2] + pad) / this.bin);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++)
          for (let k = k0; k <= k1; k++) {
            const key = this.key(i, j, k);
            const list = this.bins.get(key);
            if (list) list.push(idx);
            else this.bins.set(key, [idx]);
          }
    });
  }

  d(x: number, y: number, z: number): number {
    const list = this.bins.get(this.key(Math.floor(x / this.bin), Math.floor(y / this.bin), Math.floor(z / this.bin)));
    if (!list) return this.far;
    let d = this.far;
    for (const i of list) {
      const p = this.prims[i]!;
      d = smin(d, p.d(x, y, z), p.k ?? this.blend);
    }
    return d;
  }
}

/** Naive surface nets: a smooth triangle mesh of the zero level set of `sdf`. */
export function meshSdf(sdf: (x: number, y: number, z: number) => number, min: V3, max: V3, cell: number): THREE.BufferGeometry {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 2;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 2;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 2;
  const ox = min[0] - cell;
  const oy = min[1] - cell;
  const oz = min[2] - cell;
  const val = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // Narrow band: sample a coarse grid first and only evaluate fine points near the surface.
  const C = 4;
  const cx = Math.ceil((nx - 1) / C) + 1;
  const cy = Math.ceil((ny - 1) / C) + 1;
  const cz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) coarse[(k * cy + j) * cx + i] = sdf(ox + i * C * cell, oy + j * C * cell, oz + k * C * cell);
  const band = C * cell * 1.8;
  for (let k = 0; k < nz; k++) {
    const k0 = Math.min(cz - 2, Math.floor(k / C));
    for (let j = 0; j < ny; j++) {
      const j0 = Math.min(cy - 2, Math.floor(j / C));
      for (let i = 0; i < nx; i++) {
        const i0 = Math.min(cx - 2, Math.floor(i / C));
        let near = false;
        let sample = 0;
        for (let c = 0; c < 8 && !near; c++) {
          const v = coarse[((k0 + (c >> 2)) * cy + (j0 + ((c >> 1) & 1))) * cx + (i0 + (c & 1))]!;
          if (Math.abs(v) < band) near = true;
          sample = v;
        }
        val[idx(i, j, k)] = near ? sdf(ox + i * cell, oy + j * cell, oz + k * cell) : sample;
      }
    }
  }

  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const corners: V3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corners[c]!;
          cv[c] = val[idx(i + a, j + b, k + d)]!;
          if (cv[c]! < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [e0, e1] of edges) {
          const v0 = cv[e0]!;
          const v1 = cv[e1]!;
          if (v0 < 0 === v1 < 0) continue;
          const t = v0 / (v0 - v1);
          const c0 = corners[e0]!;
          const c1 = corners[e1]!;
          sx += c0[0] + (c1[0] - c0[0]) * t;
          sy += c0[1] + (c1[1] - c0[1]) * t;
          sz += c0[2] + (c1[2] - c0[2]) * t;
          n++;
        }
        cellVert[cidx(i, j, k)] = pos.length / 3;
        pos.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
      }
    }
  }

  // Pull vertices onto the surface along the gradient for accuracy.
  const h = cell * 0.5;
  const grad = (x: number, y: number, z: number): V3 => {
    const gx = sdf(x + h, y, z) - sdf(x - h, y, z);
    const gy = sdf(x, y + h, z) - sdf(x, y - h, z);
    const gz = sdf(x, y, z + h) - sdf(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  for (let v = 0; v < pos.length; v += 3) {
    for (let it = 0; it < 2; it++) {
      const d = sdf(pos[v]!, pos[v + 1]!, pos[v + 2]!);
      const g = grad(pos[v]!, pos[v + 1]!, pos[v + 2]!);
      pos[v]! -= g[0] * d;
      pos[v + 1]! -= g[1] * d;
      pos[v + 2]! -= g[2] * d;
    }
  }

  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v0 = val[idx(i, j, k)]!;
        const v1 = val[idx(i + 1, j, k)]!;
        if (v0 < 0 === v1 < 0) continue;
        quad(cellVert[cidx(i, j - 1, k - 1)]!, cellVert[cidx(i, j, k - 1)]!, cellVert[cidx(i, j, k)]!, cellVert[cidx(i, j - 1, k)]!, v0 >= 0);
      }
    }
  }
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = val[idx(i, j, k)]!;
        const v1 = val[idx(i, j + 1, k)]!;
        if (v0 < 0 === v1 < 0) continue;
        quad(cellVert[cidx(i - 1, j, k - 1)]!, cellVert[cidx(i - 1, j, k)]!, cellVert[cidx(i, j, k)]!, cellVert[cidx(i, j, k - 1)]!, v0 >= 0);
      }
    }
  }
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = val[idx(i, j, k)]!;
        const v1 = val[idx(i, j, k + 1)]!;
        if (v0 < 0 === v1 < 0) continue;
        quad(cellVert[cidx(i - 1, j - 1, k)]!, cellVert[cidx(i, j - 1, k)]!, cellVert[cidx(i, j, k)]!, cellVert[cidx(i - 1, j, k)]!, v0 >= 0);
      }
    }
  }

  const normals = new Float32Array(pos.length);
  for (let v = 0; v < pos.length; v += 3) {
    const g = grad(pos[v]!, pos[v + 1]!, pos[v + 2]!);
    normals[v] = g[0];
    normals[v + 1] = g[1];
    normals[v + 2] = g[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(index);
  // Keep the triangle winding consistent with the outward gradient.
  const p = geo.getAttribute('position');
  const ix = geo.getIndex()!;
  let agree = 0;
  for (let t = 0; t < Math.min(ix.count, 600); t += 3) {
    const a = ix.getX(t);
    const b = ix.getX(t + 1);
    const c = ix.getX(t + 2);
    const e1 = [p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a)];
    const e2 = [p.getX(c) - p.getX(a), p.getY(c) - p.getY(a), p.getZ(c) - p.getZ(a)];
    const nxv = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    const nyv = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    const nzv = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    agree += nxv * normals[a * 3]! + nyv * normals[a * 3 + 1]! + nzv * normals[a * 3 + 2]! > 0 ? 1 : -1;
  }
  if (agree < 0) {
    const arr = ix.array as Uint32Array | Uint16Array;
    for (let t = 0; t < arr.length; t += 3) {
      const tmp = arr[t + 1]!;
      arr[t + 1] = arr[t + 2]!;
      arr[t + 2] = tmp;
    }
  }
  geo.computeBoundingSphere();
  return geo;
}

/** Meshes a shape over its own bounds. */
export function meshShape(shape: SdfShape, cell: number): THREE.BufferGeometry {
  shape.build();
  const pad = shape.blend + cell * 2;
  return meshSdf(
    (x, y, z) => shape.d(x, y, z),
    [shape.min[0] - pad, shape.min[1] - pad, shape.min[2] - pad],
    [shape.max[0] + pad, shape.max[1] + pad, shape.max[2] + pad],
    cell,
  );
}
