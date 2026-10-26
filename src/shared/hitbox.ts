/**
 * Hit shapes for players and range targets. Players are a head sphere plus a vertical body
 * capsule; range silhouettes use the same head and torso dimensions on a flat board, so
 * practice on the range transfers to combat.
 */

export type HitZone = 'head' | 'body';

export const PLAYER_HITBOX = {
  headRadius: 0.15,
  headStand: 1.64,
  headCrouch: 1.04,
  bodyRadius: 0.28,
  bodyBottom: 0.1,
  bodyTopStand: 1.44,
  bodyTopCrouch: 0.9,
};

/** Silhouette board outline in board space (u right, v up from the base). */
export const SILHOUETTE = {
  headV: 1.62,
  headR: 0.14,
  shoulderV: 1.42,
  torsoTop: 1.5,
  torsoHalf: 0.26,
  waistV: 0.95,
  legHalf: 0.2,
  bottom: 0.08,
};

/** Ray-sphere intersection: distance along the (unit) ray, or -1. */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  maxT: number,
): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > maxT) return -1;
  return t;
}

/** Ray against a vertical capsule from (cx, y0, cz) to (cx, y1, cz). */
export function rayVerticalCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  y0: number,
  y1: number,
  cz: number,
  r: number,
  maxT: number,
): number {
  let best = -1;
  // Infinite cylinder in XZ.
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (t < 0 || t > maxT) continue;
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) {
          best = t;
          break;
        }
      }
    }
  }
  for (const cy of [y0, y1]) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

export interface PlayerHit {
  t: number;
  zone: HitZone;
}

/** Ray against a player standing with feet at (x, y, z); `inflate` grows the shapes (server tolerance). */
export function rayPlayer(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x: number,
  y: number,
  z: number,
  crouched: boolean,
  maxT: number,
  inflate = 0,
): PlayerHit | null {
  const H = PLAYER_HITBOX;
  const headY = y + (crouched ? H.headCrouch : H.headStand);
  const th = raySphere(ox, oy, oz, dx, dy, dz, x, headY, z, H.headRadius + inflate, maxT);
  const top = y + (crouched ? H.bodyTopCrouch : H.bodyTopStand);
  const r = H.bodyRadius + inflate;
  const tb = rayVerticalCapsule(ox, oy, oz, dx, dy, dz, x, y + H.bodyBottom + H.bodyRadius, top - H.bodyRadius, z, r, maxT);
  if (th >= 0 && (tb < 0 || th <= tb + 0.02)) return { t: th, zone: 'head' };
  if (tb >= 0) return { t: tb, zone: 'body' };
  return null;
}

/** Which zone of a silhouette board the point (u, v) is in, or null for a miss. */
export function silhouetteZone(u: number, v: number): HitZone | null {
  const S = SILHOUETTE;
  const du = u;
  const dv = v - S.headV;
  if (du * du + dv * dv <= S.headR * S.headR) return 'head';
  if (v >= S.waistV && v <= S.torsoTop) {
    // Rounded shoulders: narrow towards the top.
    const k = v > S.shoulderV ? 1 - (v - S.shoulderV) / (S.torsoTop - S.shoulderV) : 1;
    const half = S.torsoHalf * (0.55 + 0.45 * Math.sqrt(Math.max(0, k)));
    return Math.abs(u) <= half ? 'body' : null;
  }
  if (v >= S.bottom && v < S.waistV) return Math.abs(u) <= S.legHalf ? 'body' : null;
  return null;
}
