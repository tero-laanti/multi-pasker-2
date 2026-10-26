/**
 * Small triangle-mesh operations for baking the first-person hands (no DOM, no three.js):
 * welding, boundary loops, Loop subdivision, vertex normals and neighbour lists.
 */

export interface TriMesh {
  pos: Float32Array;
  idx: Uint32Array;
}

/** Merges vertices at the same position; returns the new index of every old vertex. */
export function weldMap(pos: Float32Array, eps = 1e-6): { map: Int32Array; count: number } {
  const n = pos.length / 3;
  const map = new Int32Array(n);
  const seen = new Map<string, number>();
  let count = 0;
  const q = (v: number) => Math.round(v / eps);
  for (let v = 0; v < n; v++) {
    const k = `${q(pos[v * 3]!)},${q(pos[v * 3 + 1]!)},${q(pos[v * 3 + 2]!)}`;
    let m = seen.get(k);
    if (m === undefined) {
      m = count++;
      seen.set(k, m);
    }
    map[v] = m;
  }
  return { map, count };
}

/** Removes vertices no triangle uses; `attrs` are per-vertex arrays with their item sizes. */
export function compact(idx: Uint32Array, n: number, attrs: { a: ArrayLike<number> & { length: number }; size: number; make: (len: number) => any }[]): { idx: Uint32Array; attrs: any[]; remap: Int32Array } {
  const remap = new Int32Array(n).fill(-1);
  let count = 0;
  for (const i of idx) if (remap[i]! < 0) remap[i] = count++;
  const out = attrs.map(({ size, make }) => make(count * size));
  for (let v = 0; v < n; v++) {
    const r = remap[v]!;
    if (r < 0) continue;
    attrs.forEach(({ a, size }, k) => {
      for (let c = 0; c < size; c++) out[k][r * size + c] = a[v * size + c]!;
    });
  }
  return { idx: Uint32Array.from(idx, (i) => remap[i]!), attrs: out, remap };
}

const ekey = (a: number, b: number) => (a < b ? a * 1048576 + b : b * 1048576 + a);

/** Ordered boundary loops (vertex indices) of a triangle mesh. */
export function boundaryLoops(idx: Uint32Array): number[][] {
  const count = new Map<number, number>();
  const dir = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]!;
      const b = idx[t + ((e + 1) % 3)]!;
      const k = ekey(a, b);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]!;
      const b = idx[t + ((e + 1) % 3)]!;
      // Boundary edges keep the triangle's winding: a -> b.
      if (count.get(ekey(a, b)) === 1) dir.set(a, b);
    }
  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of dir.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let v = start;
    while (!used.has(v)) {
      used.add(v);
      loop.push(v);
      const nx = dir.get(v);
      if (nx === undefined) break;
      v = nx;
    }
    loops.push(loop);
  }
  return loops;
}

/** Per-vertex neighbour lists. */
export function neighbours(idx: Uint32Array, n: number): number[][] {
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]!;
      const b = idx[t + ((e + 1) % 3)]!;
      nb[a]!.add(b);
      nb[b]!.add(a);
    }
  return nb.map((s) => [...s]);
}

/** Area-weighted vertex normals. */
export function vertexNormals(pos: Float32Array, idx: Uint32Array, out = new Float32Array(pos.length)): Float32Array {
  out.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!;
    const uy = pos[b + 1]! - pos[a + 1]!;
    const uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!;
    const vy = pos[c + 1]! - pos[a + 1]!;
    const vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v]! += nx;
      out[v + 1]! += ny;
      out[v + 2]! += nz;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v]!, out[v + 1]!, out[v + 2]!) || 1;
    out[v]! /= l;
    out[v + 1]! /= l;
    out[v + 2]! /= l;
  }
  return out;
}

/**
 * One step of Loop subdivision (boundary edges stay sharp creases of the limit curve).
 * `attrs` (e.g. UVs) are interpolated linearly at the new edge points.
 */
export function loopSubdivide(pos: Float32Array, idx: Uint32Array, attrs: { a: Float32Array; size: number }[] = []): { pos: Float32Array; idx: Uint32Array; attrs: Float32Array[] } {
  const n = pos.length / 3;
  // Edges: key -> [a, b, opposite1, opposite2, newIndex]
  const edges = new Map<number, number[]>();
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e]!;
      const b = idx[t + ((e + 1) % 3)]!;
      const c = idx[t + ((e + 2) % 3)]!;
      const k = ekey(a, b);
      const rec = edges.get(k);
      if (rec) rec[3] = c;
      else edges.set(k, [a, b, c, -1, -1]);
    }
  const ne = edges.size;
  const out = new Float32Array((n + ne) * 3);
  const outAttrs = attrs.map(({ a, size }) => {
    const o = new Float32Array((n + ne) * size);
    o.set(a.subarray(0, n * size));
    return o;
  });
  // Neighbours and boundary flags of the old vertices.
  const nb: number[][] = Array.from({ length: n }, () => []);
  const bnb: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b, , d] of edges.values()) {
    nb[a!]!.push(b!);
    nb[b!]!.push(a!);
    if (d! < 0) {
      bnb[a!]!.push(b!);
      bnb[b!]!.push(a!);
    }
  }
  for (let v = 0; v < n; v++) {
    const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
    let r: number[];
    if (bnb[v]!.length >= 2) {
      const [b0, b1] = bnb[v]!;
      r = p.map((x, c) => 0.75 * x + 0.125 * (pos[b0! * 3 + c]! + pos[b1! * 3 + c]!));
    } else {
      const k = nb[v]!.length;
      const beta = k > 3 ? 3 / (8 * k) : 3 / 16;
      r = p.map((x, c) => {
        let s = 0;
        for (const u of nb[v]!) s += pos[u * 3 + c]!;
        return (1 - k * beta) * x + beta * s;
      });
    }
    out[v * 3] = r[0]!;
    out[v * 3 + 1] = r[1]!;
    out[v * 3 + 2] = r[2]!;
  }
  let next = n;
  for (const rec of edges.values()) {
    const [a, b, c, d] = rec as [number, number, number, number, number];
    rec[4] = next;
    for (let k = 0; k < 3; k++) {
      out[next * 3 + k] = d < 0 ? 0.5 * (pos[a * 3 + k]! + pos[b * 3 + k]!) : 0.375 * (pos[a * 3 + k]! + pos[b * 3 + k]!) + 0.125 * (pos[c * 3 + k]! + pos[d * 3 + k]!);
    }
    attrs.forEach(({ a: arr, size }, i) => {
      for (let k = 0; k < size; k++) outAttrs[i]![next * size + k] = 0.5 * (arr[a * size + k]! + arr[b * size + k]!);
    });
    next++;
  }
  const outIdx = new Uint32Array(idx.length * 4);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const c = idx[t + 2]!;
    const ab = edges.get(ekey(a, b))![4]!;
    const bc = edges.get(ekey(b, c))![4]!;
    const ca = edges.get(ekey(c, a))![4]!;
    outIdx.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o);
    o += 12;
  }
  return { pos: out, idx: outIdx, attrs: outAttrs };
}
