/**
 * Shapes of the weapon parts that the hands touch, as plain data shared by the mesh builders
 * (pistol.ts, rifle.ts) and the signed distance used to pose the hands against them
 * (weaponSdf). No DOM or three.js here, so it also runs in the hand worker and in tests.
 *
 * Model space: X right, Y up, muzzle towards -Z, metres. Side profiles are (z, y) points,
 * optionally with a corner radius, extruded symmetrically across X.
 */

export type ProfilePoint = [number, number, number?];
export type Pt = [number, number];

/** Side profile with rounded corners: each point may carry a corner radius. */
export function roundedProfile(points: ProfilePoint[]): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [z, y, r = 0] = points[i]!;
    if (r <= 0) {
      out.push([z, y]);
      continue;
    }
    const [pz, py] = points[(i - 1 + n) % n]!;
    const [nz, ny] = points[(i + 1) % n]!;
    const d1 = Math.hypot(pz - z, py - y);
    const d2 = Math.hypot(nz - z, ny - y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a: Pt = [z + ((pz - z) / d1) * rr, y + ((py - y) / d1) * rr];
    const b: Pt = [z + ((nz - z) / d2) * rr, y + ((ny - y) / d2) * rr];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      // Quadratic Bezier through the corner.
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * z + t * t * b[0], u * u * a[1] + 2 * u * t * y + t * t * b[1]]);
    }
  }
  return out;
}

/** Extruded side profile (see common.extrudeSide): |x - x0| <= halfWidth, bevelled edges. */
export interface ExtrudePart {
  kind: 'extrude';
  profile: Pt[];
  holes?: Pt[][];
  halfWidth: number;
  /** Bevel depth across X. */
  bevel: number;
  /** How far the bevel pushes the outline out (three.js bevelSize). */
  bevelSize: number;
  x0: number;
  /** Part a hand wraps round (grip, panels, handguard): skin inside it is pushed out radially. */
  wrap?: boolean;
}

export interface CylZPart {
  kind: 'cylZ';
  r0: number;
  r1: number;
  z0: number;
  z1: number;
  y: number;
  x: number;
}

export interface CylXPart {
  kind: 'cylX';
  r: number;
  x0: number;
  x1: number;
  y: number;
  z: number;
}

export interface BoxPart {
  kind: 'box';
  min: [number, number, number];
  max: [number, number, number];
}

/** Ring around the X axis (lanyard ring, aperture ring turned sideways). */
export interface TorusXPart {
  kind: 'torusX';
  c: [number, number, number];
  R: number;
  r: number;
}

export interface SpherePart {
  kind: 'sphere';
  c: [number, number, number];
  r: number;
}

/** Slab with rounded corners in XY and rounded edges, centred on `c` (the phone). */
export interface RoundSlabPart {
  kind: 'roundSlab';
  c: [number, number, number];
  /** Half sizes along X, Y, Z. */
  h: [number, number, number];
  /** Corner radius in XY and edge radius. */
  corner: number;
  edge: number;
}

/**
 * A closed surface given by its vertices and normals (another hand's baked glove): signed
 * distance from the nearest vertex's tangent plane, good near the surface.
 */
export interface SurfacePart {
  kind: 'surface';
  pos: Float32Array;
  nrm: Float32Array;
}

export type WeaponPart = ExtrudePart | CylZPart | CylXPart | BoxPart | TorusXPart | SpherePart | RoundSlabPart | SurfacePart;

export function extrudePart(profile: Pt[], halfWidth: number, bevel = 0.0012, x0 = 0, holes?: Pt[][], bevelSize = bevel * 0.85): ExtrudePart {
  return { kind: 'extrude', profile, holes, halfWidth, bevel, bevelSize, x0 };
}

const wrapped = (p: ExtrudePart): ExtrudePart => ({ ...p, wrap: true });

// ---------------------------------------------------------------- pistol (Lahti L-35)

export const PISTOL = {
  receiver: roundedProfile([
    [0.0, -0.016, 0.003],
    [0.0, 0.012, 0.004],
    [-0.012, 0.016, 0.002],
    [-0.118, 0.016, 0.002],
    [-0.138, 0.0125, 0.003],
    [-0.142, -0.006, 0.002],
    [-0.13, -0.016, 0.002],
  ]),
  lowerFrame: roundedProfile([
    [-0.126, -0.016],
    [-0.004, -0.016],
    [-0.002, -0.028, 0.004],
    [-0.046, -0.029, 0.003],
    [-0.06, -0.026],
    [-0.112, -0.026, 0.003],
  ]),
  guardOuter: roundedProfile([
    [-0.046, -0.028],
    [-0.05, -0.05, 0.012],
    [-0.106, -0.052, 0.016],
    [-0.112, -0.026],
  ]),
  guardInner: roundedProfile([
    [-0.106, -0.0275],
    [-0.1005, -0.0465, 0.012],
    [-0.055, -0.0455, 0.009],
    [-0.0515, -0.0285],
  ]),
  /** Trigger guard: extruded 6.6 mm plus 0.9 mm bevels each side. */
  guard: { depth: 0.0066, bevelThickness: 0.0009, bevelSize: 0.0008 },
  /** Grip frame (raked back like the L-35) under the panels. */
  grip: roundedProfile([
    [-0.047, -0.027],
    [-0.04, -0.06, 0.02],
    [-0.012, -0.112, 0.006],
    [0.034, -0.109, 0.006],
    [0.03, -0.075, 0.03],
    [0.006, -0.03, 0.01],
    [0.004, -0.016],
  ]),
  gripHalfWidth: 0.0128,
  /** Checkered grip panels, slightly proud of the frame. */
  panel: roundedProfile([
    [-0.04, -0.034],
    [-0.035, -0.06, 0.016],
    [-0.012, -0.101, 0.005],
    [0.024, -0.099, 0.005],
    [0.022, -0.074, 0.02],
    [0.0, -0.034, 0.004],
  ]),
  panelX: 0.0138,
  panelHalfWidth: 0.0018,
  trigger: roundedProfile([
    [-0.072, -0.026],
    [-0.066, -0.026],
    [-0.069, -0.036, 0.004],
    [-0.075, -0.045, 0.002],
    [-0.078, -0.044],
    [-0.074, -0.036, 0.004],
  ]),
  magBase: roundedProfile([
    [-0.013, -0.111],
    [0.033, -0.108],
    [0.034, -0.116, 0.002],
    [-0.014, -0.119, 0.002],
  ]),
  /**
   * Magazine body (8.8 x 3.2 cm, raked with the grip): hidden inside the grip when seated,
   * from the base plate up to the frame. A box turned about X, so a side profile here.
   */
  magBody: ((): Pt[] => {
    const a = Math.atan2(0.423, 0.906);
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Box corners (y along the magazine, z across), turned with the grip, top centre at (y, z).
    const top: Pt = [-0.0262, -0.0283];
    return (
      [
        [0, -0.016],
        [0, 0.016],
        [-0.088, 0.016],
        [-0.088, -0.016],
      ] as [number, number][]
    ).map(([y, z]) => [top[0] - y * s + z * c, top[1] + y * c + z * s] as Pt);
  })(),
  magHalfWidth: 0.0105,
  frontSightRamp: [
    [-0.212, 0.0078],
    [-0.231, 0.0078],
    [-0.231, 0.0112],
    [-0.219, 0.0112],
  ] as Pt[],
  sightY: 0.0195,
  screw: { r: 0.0028, len: 0.0012, x: 0.0158, y: -0.067, z: 0.008 },
  lanyard: { c: [0, -0.106, 0.04] as [number, number, number], R: 0.0055, r: 0.0011 },
};

/** Static parts of the pistol at rest (bolt closed, magazine seated). */
export function pistolParts(): WeaponPart[] {
  const P = PISTOL;
  const S = P.sightY;
  const cylZ = (r0: number, r1: number, z0: number, z1: number, y = 0, x = 0): CylZPart => ({ kind: 'cylZ', r0, r1, z0, z1, y, x });
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BoxPart => ({
    kind: 'box',
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
  });
  const g = P.guard;
  return [
    extrudePart(P.receiver, 0.0112, 0.0014),
    cylZ(0.0094, 0.0094, -0.128, -0.158, 0.0015),
    cylZ(0.0101, 0.0101, -0.15, -0.158, 0.0015),
    cylZ(0.0074, 0.007, -0.158, -0.236, 0.0015),
    extrudePart(P.frontSightRamp, 0.003, 0.0004),
    box(-0.0013, 0.0013, 0.011, S, -0.229, -0.221),
    box(-0.0056, 0.0056, 0.0158, S, -0.0135, -0.0045),
    box(-0.0056, -0.0019, S, S + 0.0024, -0.0135, -0.0045),
    box(0.0019, 0.0056, S, S + 0.0024, -0.0135, -0.0045),
    extrudePart(P.lowerFrame, 0.0104, 0.0012),
    extrudePart(P.guardOuter, g.depth / 2 + g.bevelThickness, g.bevelThickness, 0, [P.guardInner], g.bevelSize),
    wrapped(extrudePart(P.grip, P.gripHalfWidth, 0.0015)),
    // Bolt cocking piece with its grip rings and end cap.
    cylZ(0.0085, 0.0085, -0.004, 0.012, 0.004),
    cylZ(0.0094, 0.0094, 0.0005, 0.0106, 0.004),
    cylZ(0.0062, 0.0062, 0.012, 0.0145, 0.004),
    // Takedown lever and safety on the left.
    cylZ(0.0035, 0.0035, -0.124, -0.116, -0.004, -0.0122),
    box(-0.0128, -0.0112, -0.012, -0.004, -0.02, 0.0),
    { kind: 'cylX', r: P.screw.r, x0: P.screw.x - P.screw.len / 2, x1: P.screw.x + P.screw.len / 2, y: P.screw.y, z: P.screw.z },
    { kind: 'cylX', r: P.screw.r, x0: -P.screw.x - P.screw.len / 2, x1: -P.screw.x + P.screw.len / 2, y: P.screw.y, z: P.screw.z },
    { kind: 'torusX', c: P.lanyard.c, R: P.lanyard.R, r: P.lanyard.r },
    wrapped(extrudePart(P.panel, P.panelHalfWidth, 0.0008, P.panelX)),
    wrapped(extrudePart(P.panel, P.panelHalfWidth, 0.0008, -P.panelX)),
    extrudePart(P.trigger, 0.0028, 0.0006),
    wrapped(extrudePart(P.magBase, 0.0128, 0.001)),
    wrapped(extrudePart(P.magBody, P.magHalfWidth, 0, 0, undefined, 0)),
  ];
}

// ---------------------------------------------------------------- rifle (Rk 62)

export const RIFLE = {
  receiver: roundedProfile([
    [0.03, -0.03, 0.004],
    [0.03, 0.014, 0.002],
    [-0.215, 0.014, 0.002],
    [-0.222, 0.004, 0.003],
    [-0.222, -0.022, 0.003],
    [-0.15, -0.032, 0.004],
    [-0.02, -0.032, 0.004],
  ]),
  cover: roundedProfile([
    [0.032, 0.013],
    [0.03, 0.026, 0.006],
    [-0.19, 0.03, 0.01],
    [-0.205, 0.013],
  ]),
  handguard: roundedProfile([
    [-0.225, 0.008],
    [-0.418, 0.008],
    [-0.425, -0.006, 0.006],
    [-0.418, -0.026, 0.008],
    [-0.232, -0.028, 0.008],
    [-0.225, -0.012, 0.004],
  ]),
  handguardHalfWidth: 0.0215,
  grip: roundedProfile([
    [-0.012, -0.03],
    [-0.042, -0.03, 0.006],
    [-0.032, -0.07, 0.02],
    [-0.012, -0.128, 0.008],
    [0.026, -0.124, 0.008],
    [0.014, -0.07, 0.03],
    [0.008, -0.034, 0.004],
  ]),
  gripHalfWidth: 0.0145,
  /** Open-front "winter" trigger guard. */
  guard: roundedProfile([
    [-0.04, -0.032],
    [-0.046, -0.055, 0.006],
    [-0.1, -0.058, 0.004],
    [-0.104, -0.052, 0.002],
    [-0.052, -0.05, 0.004],
    [-0.046, -0.032],
  ]),
  trigger: roundedProfile([
    [-0.058, -0.03],
    [-0.052, -0.03],
    [-0.054, -0.038, 0.004],
    [-0.06, -0.047, 0.002],
    [-0.063, -0.046],
    [-0.06, -0.038, 0.004],
  ]),
  selector: [
    [-0.02, 0.006],
    [-0.12, 0.002],
    [-0.12, -0.006],
    [-0.02, -0.006],
  ] as Pt[],
  /** Front of the magwell (the magazine rocks about it), just ahead of the trigger guard. */
  magPivot: [0, -0.03, -0.144] as [number, number, number],
};

/** Curved magazine side profile (front edge then back edge reversed), in model space. */
export function rifleMagProfile(): Pt[] {
  const dz = RIFLE.magPivot[2] + 0.086;
  const bez = (p0: Pt, p1: Pt, p2: Pt, t: number): Pt => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];
  const front: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    front.push(bez([-0.086, -0.026], [-0.092, -0.13], [-0.158, -0.21], t));
    back.push(bez([-0.044, -0.026], [-0.048, -0.13], [-0.115, -0.218], t));
  }
  return [...front, ...back.reverse()].map(([z, y]) => [z + dz, y] as Pt);
}

export function rifleParts(): WeaponPart[] {
  const R = RIFLE;
  const cylZ = (r0: number, r1: number, z0: number, z1: number, y = 0, x = 0): CylZPart => ({ kind: 'cylZ', r0, r1, z0, z1, y, x });
  return [
    extrudePart(R.receiver, 0.0152, 0.0012),
    extrudePart(R.cover, 0.0138, 0.0012),
    cylZ(0.0108, 0.0098, -0.215, -0.66),
    cylZ(0.0108, 0.0108, -0.205, -0.432, 0.028),
    wrapped(extrudePart(R.handguard, R.handguardHalfWidth, 0.0025)),
    wrapped(extrudePart(R.grip, R.gripHalfWidth, 0.0022)),
    extrudePart(R.guard, 0.0042, 0.0008),
    extrudePart(R.trigger, 0.0028, 0.0006),
    extrudePart(R.selector, 0.0009, 0.0004, 0.0162),
    // Bolt carrier and charging handle.
    { kind: 'box', min: [0.0148, -0.005, -0.16], max: [0.0166, 0.01, -0.06] },
    { kind: 'cylX', r: 0.0034, x0: 0.016, x1: 0.038, y: 0.004, z: -0.136 },
    { kind: 'sphere', c: [0.039, 0.004, -0.136], r: 0.0055 },
    extrudePart(rifleMagProfile(), 0.0115, 0.0012),
  ];
}

// ---------------------------------------------------------------- phone

/**
 * The phone the support hand holds while the player chats (the mesh itself is built by the
 * viewmodel): 7 x 14 x 0.9 cm, centred on the hand's phone anchor, long side along Y, screen
 * facing +Z. The hand clears this slab with 8 mm rounded corners and square edges, so any phone
 * mesh inside it fits (a plain box only pokes out at its four corners, away from the fingers).
 */
export const PHONE = { size: [0.07, 0.14, 0.009] as [number, number, number], corner: 0.008, edge: 0 };

export function phoneParts(): WeaponPart[] {
  const [w, h, t] = PHONE.size;
  return [{ kind: 'roundSlab', c: [0, 0, 0], h: [w / 2, h / 2, t / 2], corner: PHONE.corner, edge: PHONE.edge }];
}

// ---------------------------------------------------------------- signed distance

/** Signed distance to a closed polygon (negative inside). */
export function sdPolygon(poly: Pt[], px: number, py: number): number {
  const n = poly.length;
  let d = Infinity;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vi = poly[i]!;
    const vj = poly[j]!;
    const ex = vj[0] - vi[0];
    const ey = vj[1] - vi[1];
    const wx = px - vi[0];
    const wy = py - vi[1];
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= vi[1];
    const c2 = py < vj[1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

interface CompiledPart {
  min: [number, number, number];
  max: [number, number, number];
  d(x: number, y: number, z: number): number;
  wrap?: boolean;
}

function compile(p: WeaponPart): CompiledPart {
  switch (p.kind) {
    case 'extrude': {
      let zmin = Infinity,
        zmax = -Infinity,
        ymin = Infinity,
        ymax = -Infinity;
      for (const [z, y] of p.profile) {
        zmin = Math.min(zmin, z);
        zmax = Math.max(zmax, z);
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
      }
      const r = p.bevel;
      const grow = p.bevelSize - r;
      const hx = p.halfWidth - r;
      const pad = p.bevelSize + 1e-4;
      return {
        wrap: p.wrap,
        min: [p.x0 - p.halfWidth, ymin - pad, zmin - pad],
        max: [p.x0 + p.halfWidth, ymax + pad, zmax + pad],
        d(x, y, z) {
          let d2 = sdPolygon(p.profile, z, y);
          if (p.holes) for (const h of p.holes) d2 = Math.max(d2, -sdPolygon(h, z, y));
          d2 -= grow;
          const dx = Math.abs(x - p.x0) - hx;
          const ox = Math.max(d2, 0);
          const oy = Math.max(dx, 0);
          return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(d2, dx), 0) - r;
        },
      };
    }
    case 'cylZ': {
      const za = Math.min(p.z0, p.z1);
      const zb = Math.max(p.z0, p.z1);
      const rmax = Math.max(p.r0, p.r1);
      // CylinderGeometry rotated to Z puts r1 at the -Z end.
      const rLo = p.r1;
      const rHi = p.r0;
      return {
        min: [p.x - rmax, p.y - rmax, za],
        max: [p.x + rmax, p.y + rmax, zb],
        d(x, y, z) {
          const t = zb > za ? Math.max(0, Math.min(1, (z - za) / (zb - za))) : 0;
          const rad = rLo + (rHi - rLo) * t;
          const dr = Math.hypot(x - p.x, y - p.y) - rad;
          const dz = Math.max(za - z, z - zb);
          const ox = Math.max(dr, 0);
          const oz = Math.max(dz, 0);
          return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(dr, dz), 0);
        },
      };
    }
    case 'cylX':
      return {
        min: [p.x0, p.y - p.r, p.z - p.r],
        max: [p.x1, p.y + p.r, p.z + p.r],
        d(x, y, z) {
          const dr = Math.hypot(y - p.y, z - p.z) - p.r;
          const dx = Math.max(p.x0 - x, x - p.x1);
          const ox = Math.max(dr, 0);
          const oz = Math.max(dx, 0);
          return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(dr, dx), 0);
        },
      };
    case 'box': {
      const c = [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2];
      const h = [(p.max[0] - p.min[0]) / 2, (p.max[1] - p.min[1]) / 2, (p.max[2] - p.min[2]) / 2];
      return {
        min: p.min,
        max: p.max,
        d(x, y, z) {
          const qx = Math.abs(x - c[0]!) - h[0]!;
          const qy = Math.abs(y - c[1]!) - h[1]!;
          const qz = Math.abs(z - c[2]!) - h[2]!;
          const ox = Math.max(qx, 0);
          const oy = Math.max(qy, 0);
          const oz = Math.max(qz, 0);
          return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
        },
      };
    }
    case 'torusX': {
      const e = p.R + p.r;
      return {
        min: [p.c[0] - p.r, p.c[1] - e, p.c[2] - e],
        max: [p.c[0] + p.r, p.c[1] + e, p.c[2] + e],
        d(x, y, z) {
          const q = Math.hypot(y - p.c[1], z - p.c[2]) - p.R;
          return Math.hypot(q, x - p.c[0]) - p.r;
        },
      };
    }
    case 'surface': {
      const cell = 0.003;
      const coarse = 0.009;
      const n = p.pos.length / 3;
      const bins = new Map<number, number[]>();
      const occupied = new Set<number>();
      const key = (i: number, j: number, k: number) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < n; v++) {
        const x = p.pos[v * 3]!;
        const y = p.pos[v * 3 + 1]!;
        const z = p.pos[v * 3 + 2]!;
        min[0] = Math.min(min[0], x);
        min[1] = Math.min(min[1], y);
        min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x);
        max[1] = Math.max(max[1], y);
        max[2] = Math.max(max[2], z);
        const kk = key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
        const list = bins.get(kk);
        if (list) list.push(v);
        else bins.set(kk, [v]);
        occupied.add(key(Math.floor(x / coarse), Math.floor(y / coarse), Math.floor(z / coarse)));
      }
      return {
        min,
        max,
        d(x, y, z) {
          // Nothing within a coarse cell or two: far enough away to say so cheaply.
          const oi = Math.floor(x / coarse);
          const oj = Math.floor(y / coarse);
          const ok = Math.floor(z / coarse);
          let near = false;
          for (let i = oi - 1; i <= oi + 1 && !near; i++) for (let j = oj - 1; j <= oj + 1 && !near; j++) for (let k = ok - 1; k <= ok + 1 && !near; k++) if (occupied.has(key(i, j, k))) near = true;
          if (!near) return coarse;
          const ci = Math.floor(x / cell);
          const cj = Math.floor(y / cell);
          const ck = Math.floor(z / cell);
          let best = -1;
          let bd = Infinity;
          for (let r = 1; r <= 3 && best < 0; r++)
            for (let i = ci - r; i <= ci + r; i++)
              for (let j = cj - r; j <= cj + r; j++)
                for (let k = ck - r; k <= ck + r; k++) {
                  const list = bins.get(key(i, j, k));
                  if (!list) continue;
                  for (const v of list) {
                    const dd = (x - p.pos[v * 3]!) ** 2 + (y - p.pos[v * 3 + 1]!) ** 2 + (z - p.pos[v * 3 + 2]!) ** 2;
                    if (dd < bd) {
                      bd = dd;
                      best = v;
                    }
                  }
                }
          if (best < 0) return 3 * cell;
          const qx = x - p.pos[best * 3]!;
          const qy = y - p.pos[best * 3 + 1]!;
          const qz = z - p.pos[best * 3 + 2]!;
          const along = qx * p.nrm[best * 3]! + qy * p.nrm[best * 3 + 1]! + qz * p.nrm[best * 3 + 2]!;
          const dist = Math.sqrt(bd);
          // Near the vertex the tangent plane is the better estimate; further away, the distance.
          return dist < 0.002 ? along : Math.sign(along) * dist;
        },
      };
    }
    case 'roundSlab': {
      const { c, h, corner, edge } = p;
      return {
        min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
        max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
        d(x, y, z) {
          // Rounded rectangle in XY, extruded across Z with rounded edges.
          const qx = Math.abs(x - c[0]) - (h[0] - corner);
          const qy = Math.abs(y - c[1]) - (h[1] - corner);
          const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner + edge;
          const dz = Math.abs(z - c[2]) - (h[2] - edge);
          return Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) + Math.min(Math.max(d2, dz), 0) - edge;
        },
      };
    }
    case 'sphere':
      return {
        min: [p.c[0] - p.r, p.c[1] - p.r, p.c[2] - p.r],
        max: [p.c[0] + p.r, p.c[1] + p.r, p.c[2] + p.r],
        d: (x, y, z) => Math.hypot(x - p.c[0], y - p.c[1], z - p.c[2]) - p.r,
      };
  }
}

/** Signed distance to the union of parts; exact enough near the surface, capped at `far`. */
export class WeaponSdf {
  private parts: CompiledPart[];
  constructor(
    parts: WeaponPart[],
    private far = 0.05,
  ) {
    this.parts = parts.map(compile);
  }

  d(x: number, y: number, z: number): number {
    let best = this.far;
    for (const p of this.parts) {
      // Distance to the part's box is a lower bound on the distance to the part.
      const bx = Math.max(p.min[0] - x, 0, x - p.max[0]);
      const by = Math.max(p.min[1] - y, 0, y - p.max[1]);
      const bz = Math.max(p.min[2] - z, 0, z - p.max[2]);
      if (bx * bx + by * by + bz * bz >= best * best) continue;
      const d = p.d(x, y, z);
      if (d < best) best = d;
    }
    return best;
  }

  /** Is the part closest to (x, y, z) (or most deeply containing it) one a hand wraps round? */
  inWrapPart(x: number, y: number, z: number): boolean {
    let best = Infinity;
    let wrap = false;
    for (const p of this.parts) {
      const bx = Math.max(p.min[0] - x, 0, x - p.max[0]);
      const by = Math.max(p.min[1] - y, 0, y - p.max[1]);
      const bz = Math.max(p.min[2] - z, 0, z - p.max[2]);
      if (bx * bx + by * by + bz * bz >= best * best && best > 0) continue;
      const d = p.d(x, y, z);
      if (d < best) {
        best = d;
        wrap = !!p.wrap;
      }
    }
    return wrap;
  }

  /** Outward unit gradient by central differences. */
  grad(x: number, y: number, z: number, h = 2e-4): [number, number, number] {
    const gx = this.d(x + h, y, z) - this.d(x - h, y, z);
    const gy = this.d(x, y + h, z) - this.d(x, y - h, z);
    const gz = this.d(x, y, z + h) - this.d(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  }
}

export function weaponSdf(id: 'pistol' | 'rifle'): WeaponSdf {
  return new WeaponSdf(id === 'pistol' ? pistolParts() : rifleParts());
}
