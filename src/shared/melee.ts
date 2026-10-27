import { TUNING } from './config';
import { PLAYER_HITBOX } from './hitbox';
import { DEG, clamp } from './math';

/** A player as far as a knife is concerned: where they stand (feet) and whether they crouch. */
export interface MeleeBody {
  x: number;
  y: number;
  z: number;
  crouched: boolean;
}

/**
 * How a stab from the eye `o` along the view `d` meets a body: the distance to the body's
 * surface at the height nearest the blade, and how far off the view the body is (radians; 0
 * when the view crosses it).
 */
export function meleeReach(o: readonly [number, number, number], d: readonly [number, number, number], b: MeleeBody): { dist: number; angle: number } {
  const H = PLAYER_HITBOX;
  const top = b.y + (b.crouched ? H.bodyTopCrouch : H.bodyTopStand);
  const cy = clamp(o[1], b.y + H.bodyBottom, top);
  const dx = b.x - o[0];
  const dy = cy - o[1];
  const dz = b.z - o[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const cos = clamp((dx * d[0] + dy * d[1] + dz * d[2]) / len, -1, 1);
  return { dist: Math.max(0, len - H.bodyRadius), angle: Math.max(0, Math.acos(cos) - Math.atan2(H.bodyRadius, len)) };
}

/** Within reach and in front: the stab lands on this body. */
export function meleeReaches(o: readonly [number, number, number], d: readonly [number, number, number], b: MeleeBody, slack = 0): boolean {
  const M = TUNING.melee;
  const r = meleeReach(o, d, b);
  return r.dist <= M.range + slack && r.angle <= M.cone * DEG + slack * 0.25;
}

/** The body a stab lands on: the nearest one within reach and in front, or null. */
export function meleeTarget<T extends MeleeBody>(o: readonly [number, number, number], d: readonly [number, number, number], bodies: Iterable<T>): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const b of bodies) {
    if (!meleeReaches(o, d, b)) continue;
    const { dist } = meleeReach(o, d, b);
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return best;
}
