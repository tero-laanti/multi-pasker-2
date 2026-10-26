import { bakeHand, type BakedMesh } from './handBuild';
import { SOLVER_VERSION, handSource, type SolvedPose } from './handSolve';
import solvedPoses from './handPoses.json';
import { HAND_POSES, type HandKey } from './handSpecs';
import { WeaponSdf, phoneParts, pistolParts, rifleParts, type WeaponPart } from './weaponShapes';

export interface BakedHand {
  key: HandKey;
  glove: BakedMesh;
  sleeve: BakedMesh;
  minClear: number;
  tris: number;
  breadth: number;
  fingerDepth: number;
  fingerWidth: number;
  /** Solver diagnostics (development only). */
  debug: Record<string, unknown>;
}

export interface PoseCache {
  hash: string;
  poses: Partial<Record<HandKey, SolvedPose>>;
}

function fnv1a(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Hash of everything a solved pose depends on: the pose specs, the weapon shapes, the hand
 * model and the solver version. Numbers are rounded so tiny float differences don't matter.
 */
export function poseInputsHash(glb: ArrayBuffer): string {
  const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : v);
  let h = fnv1a(0x811c9dc5, JSON.stringify({ v: SOLVER_VERSION, poses: HAND_POSES, pistol: pistolParts(), rifle: rifleParts(), phone: phoneParts() }, round));
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface BakeResult {
  hands: BakedHand[];
  /** Solved poses with the hash of their inputs (what handPoses.json stores). */
  solutions: PoseCache;
  /** True when the poses came from handPoses.json instead of being solved. */
  fromCache: boolean;
}

/**
 * Bakes every hand pose from the generic hand model (.glb bytes). Solved poses come from
 * handPoses.json when it matches the current inputs (`npm run gen:hands` rewrites it);
 * otherwise they are solved here, which takes a few seconds.
 */
export function bakeAllHands(glb: ArrayBuffer, keys = Object.keys(HAND_POSES) as HandKey[], opts: { solve?: boolean } = {}): BakeResult {
  const src = handSource(glb);
  const hash = poseInputsHash(glb);
  const cache = solvedPoses as PoseCache;
  const fromCache = !opts.solve && cache.hash === hash;
  const parts = { pistol: pistolParts(), rifle: rifleParts(), phone: phoneParts() };
  const sdf = { pistol: new WeaponSdf(parts.pistol), rifle: new WeaponSdf(parts.rifle), phone: new WeaponSdf(parts.phone) };
  // Hands another hand must avoid are baked first.
  const order = [...keys].sort((a, b) => (HAND_POSES[a].avoid ? 1 : 0) - (HAND_POSES[b].avoid ? 1 : 0));
  const bodies = new Map<string, WeaponPart[]>();
  const out = new Map<HandKey, BakedHand>();
  const solutions: PoseCache = { hash, poses: {} };
  for (const key of order) {
    const pose = HAND_POSES[key];
    const other = pose.avoid ? bodies.get(pose.avoid) : undefined;
    const field = other ? new WeaponSdf([...parts[pose.weapon], ...other]) : sdf[pose.weapon];
    const r = bakeHand(src, pose, field, fromCache ? cache.poses[key] : undefined, sdf[pose.weapon]);
    // Another hand avoids this one's actual glove surface.
    bodies.set(key, [{ kind: 'surface', pos: r.glove.pos, nrm: r.glove.nrm }]);
    solutions.poses[key] = r.solution;
    const { minClear, tris, breadth, fingerDepth, fingerWidth, debug } = r.stats;
    out.set(key, { key, glove: r.glove, sleeve: r.sleeve, minClear, tris, breadth, fingerDepth, fingerWidth, debug });
  }
  return { hands: keys.map((k) => out.get(k)!), solutions, fromCache };
}
