import * as THREE from 'three';

/**
 * Exact clearance between two triangle meshes for the hand tests: signed distance of every
 * vertex of mesh A to the (closed) weapon mesh B — unsigned distance to the nearest triangle,
 * sign from the generalised winding number — and the number of A/B triangle pairs that
 * intersect (catches a thin weapon edge cutting a hand face between its vertices).
 */

export type Tris = Float64Array; // 9 numbers per triangle

/** World-space triangles of all meshes under `root` (except those `skip` rejects). */
export function collectTriangles(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): Tris {
  root.updateMatrixWorld(true);
  const out: number[] = [];
  const v = new THREE.Vector3();
  const walk = (o: THREE.Object3D) => {
    if (skip(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const g = mesh.geometry;
      const p = g.getAttribute('position');
      const idx = g.getIndex();
      const count = idx ? idx.count : p.count;
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        out.push(v.x, v.y, v.z);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return Float64Array.from(out);
}

/** Uniform grid over triangles for nearest-triangle and overlap queries. */
const cellKey = (i: number, j: number, k: number) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);

export class TriGrid {
  private cells = new Map<number, number[]>();
  constructor(
    readonly tris: Tris,
    readonly cell = 0.004,
  ) {
    const n = tris.length / 9;
    for (let t = 0; t < n; t++) {
      const [lo, hi] = this.box(t);
      for (let i = lo[0]; i <= hi[0]; i++)
        for (let j = lo[1]; j <= hi[1]; j++)
          for (let k = lo[2]; k <= hi[2]; k++) {
            const key = cellKey(i, j, k);
            const list = this.cells.get(key);
            if (list) list.push(t);
            else this.cells.set(key, [t]);
          }
    }
  }

  private box(t: number): [[number, number, number], [number, number, number]] {
    const T = this.tris;
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], T[t * 9 + c * 3 + a]!);
        hi[a] = Math.max(hi[a], T[t * 9 + c * 3 + a]!);
      }
    return [lo.map((x) => Math.floor(x / this.cell)) as [number, number, number], hi.map((x) => Math.floor(x / this.cell)) as [number, number, number]];
  }

  /** Triangles in cells overlapping the box [lo, hi]. */
  near(lo: number[], hi: number[]): Set<number> {
    const out = new Set<number>();
    const a = lo.map((x) => Math.floor(x / this.cell));
    const b = hi.map((x) => Math.floor(x / this.cell));
    for (let i = a[0]!; i <= b[0]!; i++)
      for (let j = a[1]!; j <= b[1]!; j++)
        for (let k = a[2]!; k <= b[2]!; k++) for (const t of this.cells.get(cellKey(i, j, k)) ?? []) out.add(t);
    return out;
  }

  /** Unsigned distance to the nearest triangle (searching up to `max`) and that triangle. */
  closest(p: [number, number, number], max = 0.03): { d: number; tri: number } {
    let best = max;
    let tri = -1;
    for (let r = 0; r * this.cell <= best + this.cell; r++) {
      const ring = this.near(
        p.map((x) => x - (r + 1) * this.cell),
        p.map((x) => x + (r + 1) * this.cell),
      );
      for (const t of ring) {
        const d = Math.sqrt(pointTriDist2(p, this.tris, t));
        if (d < best) {
          best = d;
          tri = t;
        }
      }
      if (best < r * this.cell) break;
    }
    return { d: best, tri };
  }

  distance(p: [number, number, number], max = 0.03): number {
    return this.closest(p, max).d;
  }

  /** Is p behind the plane of triangle t (against its winding normal)? */
  behind(p: [number, number, number], t: number): boolean {
    const T = this.tris;
    const o = t * 9;
    const e1 = [T[o + 3]! - T[o]!, T[o + 4]! - T[o + 1]!, T[o + 5]! - T[o + 2]!];
    const e2 = [T[o + 6]! - T[o]!, T[o + 7]! - T[o + 1]!, T[o + 8]! - T[o + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    return (p[0] - T[o]!) * n[0]! + (p[1] - T[o + 1]!) * n[1]! + (p[2] - T[o + 2]!) * n[2]! < 0;
  }
}

/** Squared distance from p to triangle t (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriDist2(p: [number, number, number], T: Tris, t: number): number {
  const o = t * 9;
  const a = [T[o]!, T[o + 1]!, T[o + 2]!];
  const b = [T[o + 3]!, T[o + 4]!, T[o + 5]!];
  const c = [T[o + 6]!, T[o + 7]!, T[o + 8]!];
  const sub = (u: number[], w: number[]) => [u[0]! - w[0]!, u[1]! - w[1]!, u[2]! - w[2]!];
  const dot = (u: number[], w: number[]) => u[0]! * w[0]! + u[1]! * w[1]! + u[2]! * w[2]!;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q: number[];
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        q = [a[0]! + ab[0]! * v, a[1]! + ab[1]! * v, a[2]! + ab[2]! * v];
      } else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            q = [a[0]! + ac[0]! * w, a[1]! + ac[1]! * w, a[2]! + ac[2]! * w];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0]! + (c[0]! - b[0]!) * w, b[1]! + (c[1]! - b[1]!) * w, b[2]! + (c[2]! - b[2]!) * w];
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den;
              const w = vc * den;
              q = [a[0]! + ab[0]! * v + ac[0]! * w, a[1]! + ab[1]! * v + ac[1]! * w, a[2]! + ab[2]! * v + ac[2]! * w];
            }
          }
        }
      }
    }
  }
  const d = sub(p, q);
  return dot(d, d);
}

/** Generalised winding number of the triangle soup around p (≈1 inside a closed solid). */
export function winding(p: [number, number, number], T: Tris): number {
  let sum = 0;
  for (let o = 0; o < T.length; o += 9) {
    const ax = T[o]! - p[0];
    const ay = T[o + 1]! - p[1];
    const az = T[o + 2]! - p[2];
    const bx = T[o + 3]! - p[0];
    const by = T[o + 4]! - p[1];
    const bz = T[o + 5]! - p[2];
    const cx = T[o + 6]! - p[0];
    const cy = T[o + 7]! - p[1];
    const cz = T[o + 8]! - p[2];
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    const lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    sum += 2 * Math.atan2(det, den);
  }
  return sum / (4 * Math.PI);
}

/** Does segment (px,py,pz)→(qx,qy,qz) cross triangle t of T (Möller–Trumbore)? */
function segTri(px: number, py: number, pz: number, qx: number, qy: number, qz: number, T: ArrayLike<number>, t: number): boolean {
  const o = t * 9;
  const e1x = T[o + 3]! - T[o]!;
  const e1y = T[o + 4]! - T[o + 1]!;
  const e1z = T[o + 5]! - T[o + 2]!;
  const e2x = T[o + 6]! - T[o]!;
  const e2y = T[o + 7]! - T[o + 1]!;
  const e2z = T[o + 8]! - T[o + 2]!;
  const dx = qx - px;
  const dy = qy - py;
  const dz = qz - pz;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-14) return false;
  const f = 1 / a;
  const sx = px - T[o]!;
  const sy = py - T[o + 1]!;
  const sz = pz - T[o + 2]!;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qvx = sy * e1z - sz * e1y;
  const qvy = sz * e1x - sx * e1z;
  const qvz = sx * e1y - sy * e1x;
  const v = f * (dx * qvx + dy * qvy + dz * qvz);
  if (v < 0 || u + v > 1) return false;
  const t2 = f * (e2x * qvx + e2y * qvy + e2z * qvz);
  return t2 >= 0 && t2 <= 1;
}

/** Do triangles i of A and j of B intersect (an edge of one through the other)? */
function trisCross(A: ArrayLike<number>, i: number, B: ArrayLike<number>, j: number): boolean {
  for (const [X, x, Y, y] of [
    [A, i, B, j],
    [B, j, A, i],
  ] as const) {
    const o = x * 9;
    for (let e = 0; e < 3; e++) {
      const a = o + e * 3;
      const b = o + ((e + 1) % 3) * 3;
      if (segTri(X[a]!, X[a + 1]!, X[a + 2]!, X[b]!, X[b + 1]!, X[b + 2]!, Y, y)) return true;
    }
  }
  return false;
}

export interface Clearance {
  /** Smallest signed distance of any A vertex to B (negative = inside), metres. */
  minSigned: number;
  /** Where that vertex is. */
  at: [number, number, number];
  /** A vertices inside B. */
  inside: number;
  /** Intersecting A/B triangle pairs. */
  crossings: number;
  /** Where crossings happen (centres of the weapon triangles, rounded to 5 mm) with counts. */
  where: Map<string, number>;
}

/**
 * Clearance of mesh A from mesh B. With `crossingsOnly` (B is not a closed solid, e.g. another
 * hand) only intersecting triangle pairs are counted.
 */
export function clearance(aTris: Tris, b: Tris, grid = new TriGrid(b), crossingsOnly = false): Clearance {
  let minSigned = Infinity;
  let at: [number, number, number] = [0, 0, 0];
  let inside = 0;
  const seen = new Map<string, number>();
  for (let o = 0; o < aTris.length && !crossingsOnly; o += 3) {
    const p: [number, number, number] = [aTris[o]!, aTris[o + 1]!, aTris[o + 2]!];
    const key = `${p[0].toFixed(7)},${p[1].toFixed(7)},${p[2].toFixed(7)}`;
    let sd = seen.get(key);
    if (sd === undefined) {
      const { d, tri } = grid.closest(p);
      // Anything 2.5 cm from every surface is outside (no part of the guns is that thick); the
      // exact winding number decides for points near a surface or behind the nearest face.
      const suspect = d < 0.025 && (d < 0.003 || (tri >= 0 && grid.behind(p, tri)));
      sd = suspect && winding(p, b) > 0.5 ? -d : d;
      seen.set(key, sd);
      if (sd < 0) inside++;
    }
    if (sd < minSigned) {
      minSigned = sd;
      at = p;
    }
  }
  let crossings = 0;
  const where = new Map<string, number>();
  for (let o = 0; o < aTris.length; o += 9) {
    const lo = [0, 1, 2].map((a) => Math.min(aTris[o + a]!, aTris[o + 3 + a]!, aTris[o + 6 + a]!));
    const hi = [0, 1, 2].map((a) => Math.max(aTris[o + a]!, aTris[o + 3 + a]!, aTris[o + 6 + a]!));
    for (const t of grid.near(lo, hi)) {
      if (!trisCross(aTris, o / 9, b, t)) continue;
      crossings++;
      const centre = (a: number) => (b[t * 9 + a]! + b[t * 9 + 3 + a]! + b[t * 9 + 6 + a]!) / 3;
      const k = [0, 1, 2].map((a) => (Math.round(centre(a) / 0.005) * 0.005).toFixed(3)).join(',');
      where.set(k, (where.get(k) ?? 0) + 1);
    }
  }
  return { minSigned, at, inside, crossings, where };
}
