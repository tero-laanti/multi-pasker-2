import * as THREE from 'three';
import type { SkinnedGlb } from './glb';

/**
 * Skeleton of the WebXR "generic-hand" model (25 joints, stored flat in the file) rebuilt as
 * finger chains, posed with local joint rotations and skinned with dual quaternions so bent
 * knuckles keep their volume. Joint frames follow the WebXR convention: -Z points along the
 * bone towards the tip, +Y out of the back of the hand, +X towards the little finger (right hand).
 */

export const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGERS)[number] | 'thumb';

const FINGER_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'];

export function chainNames(f: FingerName): string[] {
  return f === 'thumb' ? THUMB_JOINTS.map((j) => `thumb-${j}`) : FINGER_JOINTS.map((j) => `${f}-finger-${j}`);
}

export interface RestRig {
  names: string[];
  parent: Int32Array;
  /** Rest world transform of each joint. */
  rest: THREE.Matrix4[];
  restInv: THREE.Matrix4[];
  /** Rest transform relative to the parent. */
  local: THREE.Matrix4[];
  index(name: string): number;
}

export function buildRig(g: SkinnedGlb): RestRig {
  const names = g.jointNames;
  const idx = new Map(names.map((n, i) => [n, i]));
  const parent = new Int32Array(names.length).fill(-1);
  for (const f of [...FINGERS, 'thumb'] as FingerName[]) {
    const chain = chainNames(f);
    chain.forEach((n, i) => {
      const j = idx.get(n);
      if (j === undefined) throw new Error(`hand joint ${n} missing`);
      parent[j] = i === 0 ? idx.get('wrist')! : idx.get(chain[i - 1]!)!;
    });
  }
  const rest = g.jointWorld.map((m) => new THREE.Matrix4().fromArray(m));
  const restInv = rest.map((m) => m.clone().invert());
  const local = rest.map((m, j) => (parent[j]! >= 0 ? restInv[parent[j]!]!.clone().multiply(m) : m.clone()));
  return {
    names,
    parent,
    rest,
    restInv,
    local,
    index(name: string) {
      const j = idx.get(name);
      if (j === undefined) throw new Error(`hand joint ${name} missing`);
      return j;
    },
  };
}

/** Local joint rotation: abduction about Y, then flexion (positive curls towards the palm), then twist about Z. */
export interface JointAngles {
  flex?: number;
  abd?: number;
  twist?: number;
}

export function jointQuat(a: JointAngles | undefined, out = new THREE.Quaternion()): THREE.Quaternion {
  if (!a) return out.identity();
  const e = new THREE.Euler(-(a.flex ?? 0), a.abd ?? 0, a.twist ?? 0, 'YXZ');
  return out.setFromEuler(e);
}

/** World transforms of all joints for a placement (applied to the rest wrist) and local rotations. */
export function poseJoints(rig: RestRig, placement: THREE.Matrix4, rot: (THREE.Quaternion | null)[], shift?: (THREE.Vector3 | null)[]): THREE.Matrix4[] {
  const n = rig.names.length;
  const out: THREE.Matrix4[] = new Array(n);
  const R = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  // Parents come before children in each chain; the wrist has no parent.
  const order = [...Array(n).keys()].sort((a, b) => depth(rig, a) - depth(rig, b));
  for (const j of order) {
    const p = rig.parent[j]!;
    // Optional small translation in the parent's frame (the palm cupping round a grip).
    const sh = shift?.[j];
    const base = p < 0 ? placement.clone().multiply(rig.rest[j]!) : sh ? out[p]!.clone().multiply(T.makeTranslation(sh.x, sh.y, sh.z)).multiply(rig.local[j]!) : out[p]!.clone().multiply(rig.local[j]!);
    const q = rot[j];
    out[j] = q ? base.multiply(R.makeRotationFromQuaternion(q)) : base;
  }
  return out;
}

function depth(rig: RestRig, j: number): number {
  let d = 0;
  for (let p = rig.parent[j]!; p >= 0; p = rig.parent[p]!) d++;
  return d;
}

/** Rigid transform as a unit dual quaternion [real xyzw, dual xyzw]. */
export function dualQuat(m: THREE.Matrix4, out = new Float64Array(8)): Float64Array {
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const t = new THREE.Vector3().setFromMatrixPosition(m);
  out[0] = q.x;
  out[1] = q.y;
  out[2] = q.z;
  out[3] = q.w;
  // dual = 0.5 * (t, 0) * q
  out[4] = 0.5 * (t.x * q.w + t.y * q.z - t.z * q.y);
  out[5] = 0.5 * (-t.x * q.z + t.y * q.w + t.z * q.x);
  out[6] = 0.5 * (t.x * q.y - t.y * q.x + t.z * q.w);
  out[7] = 0.5 * (-t.x * q.x - t.y * q.y - t.z * q.z);
  return out;
}

/**
 * Dual quaternion skinning of points (and optionally normals). `skin[j]` is the joint's
 * posed * restInverse transform. Extra per-vertex blends (the forearm) are given as
 * additional (transform, weight) pairs that replace part of the skin weight.
 */
export function skinDq(
  pos: Float32Array,
  joints: Uint16Array,
  weights: Float32Array,
  skin: THREE.Matrix4[],
  outPos: Float32Array,
  extra?: { dq: Float64Array; weight: Float32Array },
): void {
  const dqs = skin.map((m) => dualQuat(m));
  const n = pos.length / 3;
  const b = new Float64Array(8);
  for (let v = 0; v < n; v++) {
    b.fill(0);
    let ref: Float64Array | null = null;
    const ew = extra ? extra.weight[v]! : 0;
    const add = (d: Float64Array, w: number) => {
      if (w <= 0) return;
      if (!ref) ref = d;
      const s = d[0]! * ref[0]! + d[1]! * ref[1]! + d[2]! * ref[2]! + d[3]! * ref[3]! < 0 ? -w : w;
      for (let k = 0; k < 8; k++) b[k]! += d[k]! * s;
    };
    for (let k = 0; k < 4; k++) add(dqs[joints[v * 4 + k]!]!, weights[v * 4 + k]! * (1 - ew));
    if (extra && ew > 0) add(extra.dq, ew);
    const len = Math.hypot(b[0]!, b[1]!, b[2]!, b[3]!);
    const [rx, ry, rz, rw] = [b[0]! / len, b[1]! / len, b[2]! / len, b[3]! / len];
    const [dx, dy, dz, dw] = [b[4]! / len, b[5]! / len, b[6]! / len, b[7]! / len];
    // Translation = 2 * dual * conj(real).
    const tx = 2 * (-dw * rx + dx * rw - dy * rz + dz * ry);
    const ty = 2 * (-dw * ry + dx * rz + dy * rw - dz * rx);
    const tz = 2 * (-dw * rz - dx * ry + dy * rx + dz * rw);
    const px = pos[v * 3]!;
    const py = pos[v * 3 + 1]!;
    const pz = pos[v * 3 + 2]!;
    // Rotate p by the real part: p + 2w(r x p) + 2 r x (r x p).
    const cx = ry * pz - rz * py;
    const cy = rz * px - rx * pz;
    const cz = rx * py - ry * px;
    const ccx = ry * cz - rz * cy;
    const ccy = rz * cx - rx * cz;
    const ccz = rx * cy - ry * cx;
    outPos[v * 3] = px + 2 * (rw * cx + ccx) + tx;
    outPos[v * 3 + 1] = py + 2 * (rw * cy + ccy) + ty;
    outPos[v * 3 + 2] = pz + 2 * (rw * cz + ccz) + tz;
  }
}
