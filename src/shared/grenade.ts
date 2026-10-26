import { MASK } from './collision/brush';
import { TraceResult, type CollisionWorld } from './collision/world';
import { TUNING } from './config';

export type GrenadeTuning = typeof TUNING.grenade;

export interface Grenade {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds until it explodes. */
  fuse: number;
  resting: boolean;
}

/** Radius used for grenade traces (a small box). */
export const GRENADE_RADIUS = 0.045;

const tr = new TraceResult();

/** Throw velocity from the view angles plus some of the thrower's own velocity. */
export function throwVelocity(yaw: number, pitch: number, pvx: number, pvy: number, pvz: number, T: GrenadeTuning = TUNING.grenade): [number, number, number] {
  const p = pitch + T.throwUp;
  const cp = Math.cos(p);
  return [-Math.sin(yaw) * cp * T.throwSpeed + pvx * 0.6, Math.sin(p) * T.throwSpeed + Math.max(0, pvy) * 0.6, -Math.cos(yaw) * cp * T.throwSpeed + pvz * 0.6];
}

/**
 * Advances a grenade one step: gravity, a box trace against the map, bounce with restitution
 * and tangential friction, then rest. Returns the impact speed of a bounce this step (0 if none).
 */
export function stepGrenade(g: Grenade, world: CollisionWorld, dt: number, T: GrenadeTuning = TUNING.grenade): number {
  g.fuse -= dt;
  if (g.resting) return 0;
  g.vy -= TUNING.move.gravity * dt;
  let remaining = dt;
  let impact = 0;
  const r = GRENADE_RADIUS;
  for (let i = 0; i < 3 && remaining > 1e-6; i++) {
    const ex = g.x + g.vx * remaining;
    const ey = g.y + g.vy * remaining;
    const ez = g.z + g.vz * remaining;
    world.trace(tr, g.x, g.y, g.z, ex, ey, ez, r, r, r, MASK.GRENADE);
    if (tr.allSolid) {
      g.vx = g.vy = g.vz = 0;
      g.resting = true;
      return impact;
    }
    g.x = tr.x;
    g.y = tr.y;
    g.z = tr.z;
    if (tr.fraction >= 1) break;
    remaining *= 1 - tr.fraction;
    // Reflect the normal component, keep part of the tangential one.
    const vn = g.vx * tr.nx + g.vy * tr.ny + g.vz * tr.nz;
    if (vn >= 0) continue;
    impact = Math.max(impact, -vn);
    const tx = g.vx - vn * tr.nx;
    const ty = g.vy - vn * tr.ny;
    const tz = g.vz - vn * tr.nz;
    const bounce = -vn * T.restitution;
    const f = tr.ny > 0.7 ? T.groundFriction : 0.85;
    g.vx = tx * f + tr.nx * bounce;
    g.vy = ty * f + tr.ny * bounce;
    g.vz = tz * f + tr.nz * bounce;
    // Settle on the ground once slow.
    if (tr.ny > 0.7 && Math.hypot(g.vx, g.vy, g.vz) < 0.6) {
      g.vx = g.vy = g.vz = 0;
      g.resting = true;
      break;
    }
  }
  // Rolling resistance on the ground.
  if (!g.resting) {
    world.trace(tr, g.x, g.y, g.z, g.x, g.y - 0.02, g.z, r, r, r, MASK.GRENADE);
    if (tr.fraction < 1 && tr.ny > 0.7) {
      const k = Math.exp(-2.5 * dt);
      g.vx *= k;
      g.vz *= k;
      if (Math.hypot(g.vx, g.vz) < 0.15 && Math.abs(g.vy) < 0.5) {
        g.vx = g.vy = g.vz = 0;
        g.resting = true;
      }
    }
  }
  return impact;
}

/** Explosion damage at a distance, with full damage inside innerRadius. */
export function explosionDamage(dist: number, T: GrenadeTuning = TUNING.grenade): number {
  if (dist >= T.radius) return 0;
  if (dist <= T.innerRadius) return T.damage;
  const k = 1 - (dist - T.innerRadius) / (T.radius - T.innerRadius);
  return Math.round(T.damage * k * k);
}

/** True if nothing static blocks the blast between the explosion and a point. */
export function blastReaches(world: CollisionWorld, ex: number, ey: number, ez: number, x: number, y: number, z: number): boolean {
  world.trace(tr, ex, ey + 0.1, ez, x, y, z, 0, 0, 0, MASK.SHOT);
  return tr.fraction >= 0.999;
}
