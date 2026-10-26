import type { Vec3 } from '../math';

/**
 * Convex brushes: the collision and render primitive of every map.
 * A brush is the intersection of half-spaces `n·p <= d`. `planes` holds the real faces
 * first (`faceCount` of them) followed by axial bevel planes, which make box traces exact
 * (see world.ts).
 */

export interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

/** Trace mask bits. A brush blocks a trace when `brush.flags & mask` is non-zero. */
export const MASK = {
  MOVE: 1,
  SHOT: 2,
  GRENADE: 4,
  ALL: 7,
} as const;

export interface Brush {
  index: number;
  planes: Plane[];
  faceCount: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  flags: number;
  surface: number;
  /** Render material id; empty for invisible brushes. */
  mat: string;
  /** Used by traces to avoid testing a brush twice. */
  stamp: number;
}

const EPS = 1e-6;

function plane(nx: number, ny: number, nz: number, d: number): Plane {
  const l = Math.hypot(nx, ny, nz);
  return { nx: nx / l, ny: ny / l, nz: nz / l, d: d / l };
}

function planeThrough(nx: number, ny: number, nz: number, px: number, py: number, pz: number): Plane {
  const l = Math.hypot(nx, ny, nz);
  const ux = nx / l;
  const uy = ny / l;
  const uz = nz / l;
  return { nx: ux, ny: uy, nz: uz, d: ux * px + uy * py + uz * pz };
}

function intersect3(a: Plane, b: Plane, c: Plane): Vec3 | null {
  // Solve [a;b;c] p = [da;db;dc] with Cramer's rule via cross products.
  const bcx = b.ny * c.nz - b.nz * c.ny;
  const bcy = b.nz * c.nx - b.nx * c.nz;
  const bcz = b.nx * c.ny - b.ny * c.nx;
  const det = a.nx * bcx + a.ny * bcy + a.nz * bcz;
  if (Math.abs(det) < 1e-9) return null;
  const cax = c.ny * a.nz - c.nz * a.ny;
  const cay = c.nz * a.nx - c.nx * a.nz;
  const caz = c.nx * a.ny - c.ny * a.nx;
  const abx = a.ny * b.nz - a.nz * b.ny;
  const aby = a.nz * b.nx - a.nx * b.nz;
  const abz = a.nx * b.ny - a.ny * b.nx;
  return {
    x: (a.d * bcx + b.d * cax + c.d * abx) / det,
    y: (a.d * bcy + b.d * cay + c.d * aby) / det,
    z: (a.d * bcz + b.d * caz + c.d * abz) / det,
  };
}

/** Corner points of the convex region bounded by `planes`. */
export function brushVertices(planes: Plane[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const p = intersect3(planes[i]!, planes[j]!, planes[k]!);
        if (!p) continue;
        let inside = true;
        for (const q of planes) {
          if (q.nx * p.x + q.ny * p.y + q.nz * p.z - q.d > 1e-5) {
            inside = false;
            break;
          }
        }
        if (inside && !out.some((o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y) + Math.abs(o.z - p.z) < 1e-6)) {
          out.push(p);
        }
      }
    }
  }
  return out;
}

export interface BrushOptions {
  flags?: number;
  surface?: number;
  mat?: string;
}

/** Builds a brush from its face planes, computing bounds and adding axial bevels. */
export function brushFromPlanes(faces: Plane[], opts: BrushOptions = {}): Brush {
  const verts = brushVertices(faces);
  if (verts.length < 4) throw new Error('degenerate brush');
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }
  const planes = faces.slice();
  const axial: Plane[] = [
    { nx: 1, ny: 0, nz: 0, d: maxX },
    { nx: -1, ny: 0, nz: 0, d: -minX },
    { nx: 0, ny: 1, nz: 0, d: maxY },
    { nx: 0, ny: -1, nz: 0, d: -minY },
    { nx: 0, ny: 0, nz: 1, d: maxZ },
    { nx: 0, ny: 0, nz: -1, d: -minZ },
  ];
  for (const a of axial) {
    const exists = faces.some(
      (f) => Math.abs(f.nx - a.nx) < EPS && Math.abs(f.ny - a.ny) < EPS && Math.abs(f.nz - a.nz) < EPS,
    );
    if (!exists) planes.push(a);
  }
  return {
    index: -1,
    planes,
    faceCount: faces.length,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    flags: opts.flags ?? MASK.ALL,
    surface: opts.surface ?? 0,
    mat: opts.mat ?? '',
    stamp: 0,
  };
}

export function boxPlanes(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Plane[] {
  if (!(maxX > minX && maxY > minY && maxZ > minZ)) throw new Error('empty box');
  return [
    plane(1, 0, 0, maxX),
    plane(-1, 0, 0, -minX),
    plane(0, 1, 0, maxY),
    plane(0, -1, 0, -minY),
    plane(0, 0, 1, maxZ),
    plane(0, 0, -1, -minZ),
  ];
}

/** Box rotated by `yaw` radians around the vertical axis through its centre. */
export function obbPlanes(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number): Plane[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Local +X axis maps to (c, 0, -s), local +Z to (s, 0, c) (right-handed, Y up).
  const ax = { x: c, z: -s };
  const az = { x: s, z: c };
  const planes: Plane[] = [];
  const pushPair = (nx: number, nz: number, h: number) => {
    const dc = nx * cx + nz * cz;
    planes.push({ nx, ny: 0, nz, d: dc + h });
    planes.push({ nx: -nx, ny: 0, nz: -nz, d: -dc + h });
  };
  pushPair(ax.x, ax.z, hx);
  pushPair(az.x, az.z, hz);
  planes.push({ nx: 0, ny: 1, nz: 0, d: cy + hy });
  planes.push({ nx: 0, ny: -1, nz: 0, d: -(cy - hy) });
  return planes;
}

export type SlopeDir = '+x' | '-x' | '+z' | '-z';

/**
 * Ramp inside the given bounds. The top surface rises towards `dir`, from `lowY`
 * (defaults to minY, a full wedge) at the low end to maxY at the high end.
 */
export function wedgePlanes(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  dir: SlopeDir,
  lowY = minY,
): Plane[] {
  const planes: Plane[] = [plane(0, -1, 0, -minY)];
  const along = dir === '+x' || dir === '-x' ? 'x' : 'z';
  if (along === 'x') {
    planes.push(plane(0, 0, 1, maxZ), plane(0, 0, -1, -minZ));
  } else {
    planes.push(plane(1, 0, 0, maxX), plane(-1, 0, 0, -minX));
  }
  const rise = maxY - lowY;
  let lowEdge: number;
  let highEdge: number;
  switch (dir) {
    case '+x':
      planes.push(plane(1, 0, 0, maxX));
      if (lowY > minY) planes.push(plane(-1, 0, 0, -minX));
      lowEdge = minX;
      highEdge = maxX;
      break;
    case '-x':
      planes.push(plane(-1, 0, 0, -minX));
      if (lowY > minY) planes.push(plane(1, 0, 0, maxX));
      lowEdge = maxX;
      highEdge = minX;
      break;
    case '+z':
      planes.push(plane(0, 0, 1, maxZ));
      if (lowY > minY) planes.push(plane(0, 0, -1, -minZ));
      lowEdge = minZ;
      highEdge = maxZ;
      break;
    case '-z':
      planes.push(plane(0, 0, -1, -minZ));
      if (lowY > minY) planes.push(plane(0, 0, 1, maxZ));
      lowEdge = maxZ;
      highEdge = minZ;
      break;
  }
  // Slope plane through the low edge (height lowY) and the high edge (height maxY).
  const run = highEdge - lowEdge; // signed
  // Normal is perpendicular to (run along axis, rise in y): (-rise, run) in (axis, y), sign so it points up.
  let na = -rise * Math.sign(run);
  let ny = Math.abs(run);
  const l = Math.hypot(na, ny);
  na /= l;
  ny /= l;
  const px = along === 'x' ? lowEdge : minX;
  const pz = along === 'z' ? lowEdge : minZ;
  if (along === 'x') planes.push(planeThrough(na, ny, 0, px, lowY, pz));
  else planes.push(planeThrough(0, ny, na, px, lowY, pz));
  return planes;
}

/** Triangular prism with a ridge along `axis` at the top centre (tent, roof). */
export function prismPlanes(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  axis: 'x' | 'z',
): Plane[] {
  const planes: Plane[] = [plane(0, -1, 0, -minY)];
  const h = maxY - minY;
  if (axis === 'x') {
    planes.push(plane(1, 0, 0, maxX), plane(-1, 0, 0, -minX));
    const half = (maxZ - minZ) / 2;
    const mid = (minZ + maxZ) / 2;
    planes.push(planeThrough(0, half, h, 0, maxY, mid));
    planes.push(planeThrough(0, half, -h, 0, maxY, mid));
  } else {
    planes.push(plane(0, 0, 1, maxZ), plane(0, 0, -1, -minZ));
    const half = (maxX - minX) / 2;
    const mid = (minX + maxX) / 2;
    planes.push(planeThrough(h, half, 0, mid, maxY, 0));
    planes.push(planeThrough(-h, half, 0, mid, maxY, 0));
  }
  return planes;
}

/** Vertical n-sided prism approximating a cylinder (posts, trunks, the flagpole). */
export function cylinderPlanes(cx: number, cz: number, radius: number, minY: number, maxY: number, sides = 8): Plane[] {
  const planes: Plane[] = [plane(0, 1, 0, maxY), plane(0, -1, 0, -minY)];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    planes.push({ nx, ny: 0, nz, d: nx * cx + nz * cz + radius });
  }
  return planes;
}

export interface FacePolygon {
  plane: Plane;
  /** Counter-clockwise when seen from outside the brush. */
  verts: Vec3[];
}

/** Polygons of the real faces of a brush, for rendering. */
export function brushFaces(brush: Brush): FacePolygon[] {
  const out: FacePolygon[] = [];
  for (let i = 0; i < brush.faceCount; i++) {
    const p = brush.planes[i]!;
    let poly = baseWinding(p);
    for (let j = 0; j < brush.planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      poly = clipPolygon(poly, brush.planes[j]!);
    }
    if (poly.length >= 3 && polygonArea(poly) > 1e-6) out.push({ plane: p, verts: poly });
  }
  return out;
}

function baseWinding(p: Plane): Vec3[] {
  // Tangent basis with u x v = n.
  let ux: number, uy: number, uz: number;
  if (Math.abs(p.ny) > 0.9) {
    ux = 1;
    uy = 0;
    uz = 0;
  } else {
    ux = 0;
    uy = 1;
    uz = 0;
  }
  // u = normalize(ref - n (n·ref)), then v = n x u.
  const dr = ux * p.nx + uy * p.ny + uz * p.nz;
  ux -= p.nx * dr;
  uy -= p.ny * dr;
  uz -= p.nz * dr;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = p.ny * uz - p.nz * uy;
  const vy = p.nz * ux - p.nx * uz;
  const vz = p.nx * uy - p.ny * ux;
  // With v = n x u we have u x v = n.
  const S = 4096;
  const ox = p.nx * p.d;
  const oy = p.ny * p.d;
  const oz = p.nz * p.d;
  const corner = (a: number, b: number): Vec3 => ({
    x: ox + (ux * a + vx * b) * S,
    y: oy + (uy * a + vy * b) * S,
    z: oz + (uz * a + vz * b) * S,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

function clipPolygon(poly: Vec3[], p: Plane): Vec3[] {
  const out: Vec3[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const da = p.nx * a.x + p.ny * a.y + p.nz * a.z - p.d;
    const db = p.nx * b.x + p.ny * b.y + p.nz * b.z - p.d;
    const aIn = da <= 1e-7;
    const bIn = db <= 1e-7;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function polygonArea(poly: Vec3[]): number {
  let ax = 0,
    ay = 0,
    az = 0;
  const o = poly[0]!;
  for (let i = 1; i + 1 < poly.length; i++) {
    const b = poly[i]!;
    const c = poly[i + 1]!;
    const ux = b.x - o.x,
      uy = b.y - o.y,
      uz = b.z - o.z;
    const vx = c.x - o.x,
      vy = c.y - o.y,
      vz = c.z - o.z;
    ax += uy * vz - uz * vy;
    ay += uz * vx - ux * vz;
    az += ux * vy - uy * vx;
  }
  return Math.hypot(ax, ay, az) / 2;
}
