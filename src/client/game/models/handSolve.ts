import * as THREE from 'three';
import { parseSkinnedGlb, type SkinnedGlb } from './glb';
import { FINGERS, buildRig, chainNames, jointQuat, poseJoints, skinDq, type FingerName, type JointAngles, type RestRig } from './handRig';
import { boundaryLoops, compact, weldMap } from './meshOps';
import type { WeaponSdf } from './weaponShapes';

/**
 * Posing the WebXR generic hand on a weapon (or the phone):
 *
 *  1. place it from the index knuckle and two directions (or three landmark joints),
 *  2. aim the thumb's bones through a few points, slide the hand out of the weapon until the
 *     palm presses in no more than soft tissue would, aim the thumb again,
 *  3. close the gripping fingers until each segment touches (signed distance from the same part
 *     profiles the weapon is built from),
 *  4. reach the trigger with the index finger's pad (IK that keeps the finger clear).
 *
 * The result is a set of joint rotations, which handPoses.json caches (npm run gen:hands).
 * Model space is the weapon's; left hands are solved as mirrored right hands.
 */

export type V3 = [number, number, number];

export interface FingerPose {
  /** Metacarpal (palm arch). */
  cmc?: JointAngles;
  /** Knuckle: spread and starting flexion. */
  mcp: JointAngles;
  pip: number;
  dip: number;
  /** Close the finger until each segment touches the weapon. */
  wrap?: boolean;
  /** Fingertip pad target (IK), e.g. the trigger face; `normal` points from the pad into the surface. */
  pad?: { at: V3; normal: V3 };
}

export interface ThumbPose {
  /**
   * Aim the thumb's bones through these points (knuckle, middle joint, tip) with the pad facing
   * `pad`; the base of the thumb stays where the hand puts it and bone lengths are kept.
   */
  aim: { mcp: V3; ip: V3; tip: V3; pad: V3 };
}

export interface HandPose {
  /** What the hand holds; its model space is that thing's (the phone's frame for 'phone'). */
  weapon: 'pistol' | 'rifle' | 'phone';
  /** Left hand: solved as a right hand against the mirrored weapon, then mirrored back. */
  left?: boolean;
  /**
   * Placement in model space (a left hand's is given unmirrored): either three landmark
   * joints, or the index knuckle (MCP joint centre) plus the direction the hand points
   * (wrist to middle knuckle) and the direction out of the back of the hand.
   */
  place: { wrist: V3; indexMcp: V3; pinkyMcp: V3 } | { indexMcp: V3; along: V3; back: V3 };
  /** Direction from the wrist towards the elbow (the wrist bends towards it). */
  forearm: V3;
  /** Uniform size of the hand (default HAND_SCALE). */
  scale?: number;
  /** How far the palm may press into the weapon before it is flattened against it. */
  palmPress?: number;
  /** How far the base of the thumb moves towards the palm as the hand cups round the grip. */
  cup?: number;
  /** Axis of the part the hand wraps round: skin inside it is pushed out radially from it. */
  wrapAxis?: { p: V3; d: V3 };
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
  thumb: ThumbPose;
  /** Sleeve: start distance from the wrist along the forearm, length, radius at the cuff. */
  sleeve: { start: number; length: number; radius: number };
  /** Another hand (baked before this one) to keep clear of, e.g. while reloading. */
  avoid?: string;
}

/** Bump when the pose solver changes, so cached poses (handPoses.json) are solved again. */
export const SOLVER_VERSION = 4;

/** Finger segments keep this share of their thickness (see slimFingers). */
const FINGER_SLIM = 0.93;
/** Hand size relative to the model: a gloved hand about 9 cm across the knuckles. */
const HAND_SCALE = 1.03;
/** Glove thickness added along the normals. */
export const GLOVE = 0.0011;

// --------------------------------------------------------------------------- source

export interface HandSource {
  glb: SkinnedGlb;
  rig: RestRig;
  /** Welded rest mesh without the flat wrist cap. */
  pos: Float32Array;
  uv: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  idx: Uint32Array;
  /** Wrist opening, ordered. */
  ring: number[];
  /** Dominant joint per vertex. */
  owner: Int32Array;
}

export function handSource(buffer: ArrayBuffer): HandSource {
  const glb = parseSkinnedGlb(buffer);
  const rig = buildRig(glb);
  const { map, count } = weldMap(glb.positions);
  const n0 = glb.positions.length / 3;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let v = n0 - 1; v >= 0; v--) {
    const m = map[v]!;
    pos.set(glb.positions.subarray(v * 3, v * 3 + 3), m * 3);
    if (glb.uvs) uv.set(glb.uvs.subarray(v * 2, v * 2 + 2), m * 2);
    joints.set(glb.joints.subarray(v * 4, v * 4 + 4), m * 4);
    weights.set(glb.weights.subarray(v * 4, v * 4 + 4), m * 4);
  }
  // Drop the flat (slightly tilted) cap that closes the wrist: faces looking up the arm,
  // above the wrist joint.
  const wristY = glb.jointWorld[glb.jointNames.indexOf('wrist')]![13]!;
  const tris: number[] = [];
  for (let t = 0; t < glb.indices.length; t += 3) {
    const a = map[glb.indices[t]!]!;
    const b = map[glb.indices[t + 1]!]!;
    const c = map[glb.indices[t + 2]!]!;
    const ys = [pos[a * 3 + 1]!, pos[b * 3 + 1]!, pos[c * 3 + 1]!];
    const e1 = [pos[b * 3]! - pos[a * 3]!, ys[1]! - ys[0]!, pos[b * 3 + 2]! - pos[a * 3 + 2]!];
    const e2 = [pos[c * 3]! - pos[a * 3]!, ys[2]! - ys[0]!, pos[c * 3 + 2]! - pos[a * 3 + 2]!];
    const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    const nl = Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
    if ((ys[0]! + ys[1]! + ys[2]!) / 3 > wristY + 0.004 && ny / nl > 0.85) continue;
    tris.push(a, b, c);
  }
  const packed = compact(Uint32Array.from(tris), count, [
    { a: pos, size: 3, make: (l) => new Float32Array(l) },
    { a: uv, size: 2, make: (l) => new Float32Array(l) },
    { a: joints, size: 4, make: (l) => new Uint16Array(l) },
    { a: weights, size: 4, make: (l) => new Float32Array(l) },
  ]);
  const [p2, uv2, j2, w2] = packed.attrs as [Float32Array, Float32Array, Uint16Array, Float32Array];
  const loops = boundaryLoops(packed.idx);
  loops.sort((a, b) => b.length - a.length);
  const ring = loops[0] ?? [];
  const nv = p2.length / 3;
  slimFingers(rig, p2, j2, w2, FINGER_SLIM);
  const owner = new Int32Array(nv);
  for (let v = 0; v < nv; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (w2[v * 4 + k]! > w2[v * 4 + best]!) best = k;
    owner[v] = j2[v * 4 + best]!;
  }
  return { glb, rig, pos: p2, uv: uv2, joints: j2, weights: w2, idx: packed.idx, ring, owner };
}

/**
 * Pull finger segments towards their bones (rest pose, by skin weight, so knuckles blend):
 * the model's fingers are a little thick for a gloved ~9 cm hand.
 */
function slimFingers(rig: RestRig, pos: Float32Array, joints: Uint16Array, weights: Float32Array, keep: number): void {
  const seg = new Map<number, [THREE.Vector3, THREE.Vector3]>();
  for (const f of [...FINGERS, 'thumb'] as FingerName[]) {
    const ch = chainNames(f);
    for (let i = 1; i + 1 < ch.length; i++) {
      const j = rig.index(ch[i]!);
      seg.set(j, [new THREE.Vector3().setFromMatrixPosition(rig.rest[j]!), new THREE.Vector3().setFromMatrixPosition(rig.rest[rig.index(ch[i + 1]!)]!)]);
    }
  }
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  for (let v = 0; v < pos.length / 3; v++) {
    p.set(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
    let dx = 0,
      dy = 0,
      dz = 0;
    for (let k = 0; k < 4; k++) {
      const s = seg.get(joints[v * 4 + k]!);
      const w = weights[v * 4 + k]!;
      if (!s || w <= 0) continue;
      ab.subVectors(s[1], s[0]);
      const t = Math.max(0, Math.min(1, c.subVectors(p, s[0]).dot(ab) / ab.lengthSq()));
      c.copy(s[0]).addScaledVector(ab, t);
      dx += (c.x - p.x) * w * (1 - keep);
      dy += (c.y - p.y) * w * (1 - keep);
      dz += (c.z - p.z) * w * (1 - keep);
    }
    pos[v * 3] = p.x + dx;
    pos[v * 3 + 1] = p.y + dy;
    pos[v * 3 + 2] = p.z + dz;
  }
}

// --------------------------------------------------------------------------- weapon distance

/** The weapon's distance field seen from a hand (mirrored in X for left hands). */
export class Field {
  constructor(
    private sdf: WeaponSdf,
    private mirror: boolean,
  ) {}
  d(x: number, y: number, z: number): number {
    return this.sdf.d(this.mirror ? -x : x, y, z);
  }
  grad(x: number, y: number, z: number): V3 {
    const g = this.sdf.grad(this.mirror ? -x : x, y, z);
    return this.mirror ? [-g[0], g[1], g[2]] : g;
  }
  inWrapPart(x: number, y: number, z: number): boolean {
    return this.sdf.inWrapPart(this.mirror ? -x : x, y, z);
  }
}

// --------------------------------------------------------------------------- posing

export const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
export const mir = (a: V3, on: boolean): V3 => (on ? [-a[0], a[1], a[2]] : a);

export interface Posed {
  joints: THREE.Matrix4[];
  skin: THREE.Matrix4[];
}

export class Poser {
  readonly rot: (THREE.Quaternion | null)[];
  readonly shift: (THREE.Vector3 | null)[];
  placement = new THREE.Matrix4();
  /** Vertex lists per joint (dominant weight). */
  readonly byJoint: number[][];

  constructor(
    readonly src: HandSource,
    readonly field: Field,
  ) {
    this.rot = src.rig.names.map(() => null);
    this.shift = src.rig.names.map(() => null);
    this.byJoint = src.rig.names.map(() => []);
    src.owner.forEach((j, v) => this.byJoint[j]!.push(v));
  }

  j(name: string): number {
    return this.src.rig.index(name);
  }

  pose(): Posed {
    const joints = poseJoints(this.src.rig, this.placement, this.rot, this.shift);
    const skin = joints.map((m, i) => m.clone().multiply(this.src.rig.restInv[i]!));
    return { joints, skin };
  }

  /** Skins only the listed vertices. */
  skinSome(p: Posed, verts: number[]): Float32Array {
    const s = this.src;
    const sub = new Float32Array(verts.length * 3);
    const jj = new Uint16Array(verts.length * 4);
    const ww = new Float32Array(verts.length * 4);
    verts.forEach((v, i) => {
      sub.set(s.pos.subarray(v * 3, v * 3 + 3), i * 3);
      jj.set(s.joints.subarray(v * 4, v * 4 + 4), i * 4);
      ww.set(s.weights.subarray(v * 4, v * 4 + 4), i * 4);
    });
    const out = new Float32Array(sub.length);
    skinDq(sub, jj, ww, p.skin, out);
    return out;
  }

  /** Smallest weapon distance over the given vertices. */
  minDist(p: Posed, verts: number[]): number {
    const q = this.skinSome(p, verts);
    let m = Infinity;
    for (let i = 0; i < q.length; i += 3) m = Math.min(m, this.field.d(q[i]!, q[i + 1]!, q[i + 2]!));
    return m;
  }

  /** Sum of squared penetrations below `clear` over the given vertices. */
  penetration(p: Posed, verts: number[], clear: number): number {
    const q = this.skinSome(p, verts);
    let s = 0;
    for (let i = 0; i < q.length; i += 3) {
      const d = clear - this.field.d(q[i]!, q[i + 1]!, q[i + 2]!);
      if (d > 0) s += d * d;
    }
    return s;
  }
}

/** Rigid transform best mapping points `a` onto `b` (Horn's quaternion method). */
function fitRigid(a: THREE.Vector3[], b: THREE.Vector3[]): THREE.Matrix4 {
  const ca = new THREE.Vector3();
  const cb = new THREE.Vector3();
  a.forEach((p) => ca.add(p));
  b.forEach((p) => cb.add(p));
  ca.divideScalar(a.length);
  cb.divideScalar(b.length);
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  a.forEach((p, i) => {
    const x = p.clone().sub(ca);
    const y = b[i]!.clone().sub(cb);
    const xa = [x.x, x.y, x.z];
    const ya = [y.x, y.y, y.z];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c]! += xa[r]! * ya[c]!;
  });
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S as [number, number, number, number, number, number, number, number, number];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = largestEigenvector(N);
  const rot = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
  const t = cb.clone().sub(ca.clone().applyQuaternion(rot));
  return new THREE.Matrix4().compose(t, rot, new THREE.Vector3(1, 1, 1));
}

/** Eigenvector of the largest eigenvalue of a symmetric matrix (cyclic Jacobi rotations). */
function largestEigenvector(M: number[][]): number[] {
  const n = M.length;
  const a = M.map((r) => r.slice());
  const v: number[][] = M.map((_, i) => M.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (a[i]![i]! > a[best]![best]!) best = i;
  return v.map((r) => r[best]!);
}

function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 400): number[] {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i]! += step[i]!;
    pts.push(p);
  }
  let vals = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a]! - vals[b]!);
    pts = order.map((i) => pts[i]!);
    vals = order.map((i) => vals[i]!);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += pts[i]![k]! / n;
    const worst = pts[n]!;
    const xr = c.map((v, k) => v + (v - worst[k]!));
    const fr = f(xr);
    if (fr < vals[0]!) {
      const xe = c.map((v, k) => v + 2 * (v - worst[k]!));
      const fe = f(xe);
      if (fe < fr) {
        pts[n] = xe;
        vals[n] = fe;
      } else {
        pts[n] = xr;
        vals[n] = fr;
      }
    } else if (fr < vals[n - 1]!) {
      pts[n] = xr;
      vals[n] = fr;
    } else {
      const xc = c.map((v, k) => v + 0.5 * (worst[k]! - v));
      const fc = f(xc);
      if (fc < vals[n]!) {
        pts[n] = xc;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i]!.map((v, k) => pts[0]![k]! + 0.5 * (v - pts[0]![k]!));
          vals[i] = f(pts[i]!);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return pts[best]!;
}

interface FingerJoints {
  cmc: number;
  mcp: number;
  pip: number;
  dip: number;
  tip: number;
}

function fingerJoints(poser: Poser, f: (typeof FINGERS)[number]): FingerJoints {
  const c = chainNames(f).map((n) => poser.j(n));
  return { cmc: c[0]!, mcp: c[1]!, pip: c[2]!, dip: c[3]!, tip: c[4]! };
}

/** Pad point (palm side of the last segment) and its inward normal for a posed finger. */
function padOf(p: Posed, fj: FingerJoints, depth: number): { at: THREE.Vector3; normal: THREE.Vector3 } {
  const m = p.joints[fj.dip]!;
  const tip = new THREE.Vector3().setFromMatrixPosition(p.joints[fj.tip]!);
  const base = new THREE.Vector3().setFromMatrixPosition(m);
  const e = m.elements;
  const yAxis = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  const at = base.clone().lerp(tip, 0.75).addScaledVector(yAxis, -depth);
  return { at, normal: yAxis.clone().negate() };
}

/** A solved pose: hand placement, local joint rotations and joint shifts (cacheable). */
export interface SolvedPose {
  placement: number[];
  rot: (number[] | null)[];
  shift: (number[] | null)[];
}

export interface SolvedHand {
  poser: Poser;
  posed: Posed;
  /** Skinning transform of the forearm end (the wrist bends towards `forearmDir`). */
  forearm: THREE.Matrix4;
  wristPos: THREE.Vector3;
  forearmDir: THREE.Vector3;
  debug: Record<string, unknown>;
  solution: SolvedPose;
}

export function solveHand(src: HandSource, pose: HandPose, field: Field, cached?: SolvedPose): SolvedHand {
  const L = !!pose.left;
  const poser = new Poser(src, field);
  const scale = pose.scale ?? HAND_SCALE;
  const rig = src.rig;
  const restPos = (name: string) => new THREE.Vector3().setFromMatrixPosition(rig.rest[rig.index(name)]!);
  const debug: Record<string, unknown> = {};
  const r3 = (v: THREE.Vector3) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];

  if (cached) {
    poser.placement.fromArray(cached.placement);
    cached.rot.forEach((q, j) => (poser.rot[j] = q ? new THREE.Quaternion(q[0], q[1], q[2], q[3]) : null));
    cached.shift.forEach((v, j) => (poser.shift[j] = v ? new THREE.Vector3(v[0], v[1], v[2]) : null));
    debug.cached = true;
  } else {
    // 1. Placement (scale about the wrist first).
    const w0 = restPos('wrist');
    const S = new THREE.Matrix4().makeTranslation(w0.x, w0.y, w0.z).multiply(new THREE.Matrix4().makeScale(scale, scale, scale)).multiply(new THREE.Matrix4().makeTranslation(-w0.x, -w0.y, -w0.z));
    const pl = pose.place;
    if ('along' in pl) {
      const Lr = restPos('middle-finger-phalanx-proximal').sub(w0).normalize();
      const Dr = new THREE.Vector3(1, 0, 0).addScaledVector(Lr, -Lr.x).normalize();
      const La = v3(mir(pl.along, L)).normalize();
      const Da = v3(mir(pl.back, L));
      Da.addScaledVector(La, -Da.dot(La)).normalize();
      const mr = new THREE.Matrix4().makeBasis(Lr, Dr, Lr.clone().cross(Dr));
      const ma = new THREE.Matrix4().makeBasis(La, Da, La.clone().cross(Da));
      const R = ma.multiply(mr.transpose());
      const knuckle = restPos('index-finger-phalanx-proximal').sub(w0).multiplyScalar(scale).add(w0).applyMatrix4(R);
      const t = v3(mir(pl.indexMcp, L)).sub(knuckle);
      poser.placement.copy(new THREE.Matrix4().makeTranslation(t.x, t.y, t.z).multiply(R)).multiply(S);
    } else {
      const from = ['wrist', 'index-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal'].map((n) => restPos(n).sub(w0).multiplyScalar(scale).add(w0));
      const to = [pl.wrist, pl.indexMcp, pl.pinkyMcp].map((p) => v3(mir(p, L)));
      poser.placement.copy(fitRigid(from, to)).multiply(S);
    }
    // The base of the thumb moves towards the palm (wrist frame: +Y is the back of the hand).
    if (pose.cup) poser.shift[poser.j('thumb-metacarpal')] = new THREE.Vector3(0, -pose.cup, -pose.cup * 0.3);
    for (const f of FINGERS) {
      const fs = pose[f];
      const fj = fingerJoints(poser, f);
      poser.rot[fj.cmc] = fs.cmc ? jointQuat(fs.cmc) : null;
      poser.rot[fj.mcp] = jointQuat(fs.mcp);
      poser.rot[fj.pip] = jointQuat({ flex: fs.pip });
      poser.rot[fj.dip] = jointQuat({ flex: fs.dip });
    }
    const clear = GLOVE + 0.0006;

    // 2. Thumb, then slide the hand out of the weapon until the palm presses in at most
    // `allow` (the rest is flattened later, like soft tissue in a firm grip), thumb again.
    const palm = ['wrist', ...FINGERS.map((f) => `${f}-finger-metacarpal`)].flatMap((n) => poser.byJoint[poser.j(n)]!);
    const allow = pose.palmPress ?? 0.006;
    const snap = () => {
      const shift = new THREE.Vector3();
      for (let it = 0; it < 40; it++) {
        const q = poser.skinSome(poser.pose(), palm);
        let worst = 0;
        let wi = -1;
        for (let i = 0; i < q.length; i += 3) {
          const d = field.d(q[i]!, q[i + 1]!, q[i + 2]!) - GLOVE;
          if (-allow - d > worst) {
            worst = -allow - d;
            wi = i;
          }
        }
        if (wi < 0) break;
        const g = field.grad(q[wi]!, q[wi + 1]!, q[wi + 2]!);
        const step = new THREE.Vector3(g[0], g[1], g[2]).multiplyScalar(Math.max(worst, 0.0002));
        shift.add(step);
        poser.placement.premultiply(new THREE.Matrix4().makeTranslation(step.x, step.y, step.z));
      }
      return r3(shift);
    };
    // Aim a chain of bones through points, pad (−Y) towards `padDir`, keeping bone lengths.
    const aimChain = (f: FingerName, points: V3[], padDir: V3) => {
      const chain = chainNames(f).map((n) => poser.j(n));
      const pad = v3(mir(padDir, L)).normalize();
      for (let k = 0; k < points.length; k++) {
        const j = chain[k]!;
        const joints = poser.pose().joints;
        const P = new THREE.Vector3().setFromMatrixPosition(joints[j]!);
        const u = v3(mir(points[k]!, L)).sub(P).normalize();
        const pp = pad.clone().addScaledVector(u, -pad.dot(u)).normalize();
        const Zw = u.clone().negate();
        const Yw = pp.clone().negate();
        const want = new THREE.Matrix4().makeBasis(Yw.clone().cross(Zw), Yw, Zw);
        const par = rig.parent[j]!;
        const sh = poser.shift[j];
        // World frame of the joint before its own rotation: parent * (shift) * rest-local.
        const frame = par < 0 ? poser.placement.clone().multiply(rig.rest[j]!) : joints[par]!.clone();
        if (par >= 0) {
          if (sh) frame.multiply(new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z));
          frame.multiply(rig.local[j]!);
        }
        const base = new THREE.Matrix4().extractRotation(frame);
        poser.rot[j] = new THREE.Quaternion().setFromRotationMatrix(base.transpose().multiply(want));
      }
    };
    const aim = pose.thumb.aim;
    aimChain('thumb', [aim.mcp, aim.ip, aim.tip], aim.pad);
    debug.snap = snap();
    aimChain('thumb', [aim.mcp, aim.ip, aim.tip], aim.pad);
    {
      const pj = poser.pose().joints;
      debug.thumb = chainNames('thumb').map((nm) => r3(new THREE.Vector3().setFromMatrixPosition(pj[poser.j(nm)]!)));
    }

    // 3. Wrap: close all joints together; when a segment touches, the joints before it stop and
    // the ones after it keep closing (only segments that still move are tested).
    const wrap = (f: (typeof FINGERS)[number]) => {
      const fs = pose[f];
      const fj = fingerJoints(poser, f);
      // Segment vertices away from the joint they turn about (flesh right at a knuckle already
      // rests on the weapon when the palm does; it is flattened later).
      const along = (verts: number[], j0: number, j1: number, from: number) => {
        const a = new THREE.Vector3().setFromMatrixPosition(rig.rest[j0]!);
        const ab = new THREE.Vector3().setFromMatrixPosition(rig.rest[j1]!).sub(a);
        const l2 = ab.lengthSq();
        return verts.filter((v) => new THREE.Vector3(src.pos[v * 3], src.pos[v * 3 + 1], src.pos[v * 3 + 2]).sub(a).dot(ab) / l2 > from);
      };
      const links = [
        along(poser.byJoint[fj.mcp]!, fj.mcp, fj.pip, 0.35),
        along(poser.byJoint[fj.pip]!, fj.pip, fj.dip, 0.25),
        along([...poser.byJoint[fj.dip]!, ...poser.byJoint[fj.tip]!], fj.dip, fj.tip, 0.15),
      ];
      const ang = [fs.mcp.flex ?? 0, fs.pip, fs.dip];
      const rate = [1, 1.05, 0.8];
      const max = [1.75, 1.95, 1.45];
      const active = [true, true, true];
      const apply = (a: number[]) => {
        poser.rot[fj.mcp] = jointQuat({ ...fs.mcp, flex: a[0] });
        poser.rot[fj.pip] = jointQuat({ flex: a[1] });
        poser.rot[fj.dip] = jointQuat({ flex: a[2] });
      };
      const touching = (a: number[], from: number) => {
        apply(a);
        const p = poser.pose();
        for (let k = 2; k >= from; k--) if (poser.minDist(p, links[k]!) < clear) return k;
        return -1;
      };
      // Open up first if the starting angles already dig in.
      for (let it = 0; it < 60 && touching(ang, 0) >= 0; it++) for (let k = 0; k < 3; k++) ang[k] = Math.max(-0.2, ang[k]! - 0.03);
      for (let it = 0; it < 400; it++) {
        const first = active.indexOf(true);
        if (first < 0) break;
        const next = ang.map((v, k) => (active[k] ? Math.min(max[k]!, v + 0.012 * rate[k]!) : v));
        const hit = touching(next, first);
        if (hit >= 0) {
          for (let k = 0; k <= hit; k++) active[k] = false;
        } else {
          for (let k = 0; k < 3; k++) {
            if (active[k] && next[k]! >= max[k]!) active[k] = false;
            ang[k] = next[k]!;
          }
        }
      }
      apply(ang);
      debug[f] = { angles: ang.map((a) => +a.toFixed(3)) };
    };
    for (const f of FINGERS) if (pose[f].wrap) wrap(f);

    // 4. Fingertip pad on a target (the trigger): coarse search, reach ignoring collisions, then
    // settle with them.
    const reach = (f: (typeof FINGERS)[number]) => {
      const fs = pose[f];
      const pad = fs.pad!;
      const fj = fingerJoints(poser, f);
      const verts = [...poser.byJoint[fj.mcp]!, ...poser.byJoint[fj.pip]!, ...poser.byJoint[fj.dip]!, ...poser.byJoint[fj.tip]!];
      const target = v3(mir(pad.at, L));
      const nrm = v3(mir(pad.normal, L)).normalize();
      // Knuckle flexion, spread, middle and last joint flexion, knuckle twist.
      const x0 = [fs.mcp.flex ?? 0, fs.mcp.abd ?? 0, fs.pip, fs.dip, fs.mcp.twist ?? 0];
      const lo = [-0.3, -0.35, 0, 0, -0.25];
      const hi = [1.6, 0.35, 1.9, 1.4, 0.25];
      const apply = (x: number[]) => {
        poser.rot[fj.mcp] = jointQuat({ flex: x[0], abd: x[1], twist: x[4] });
        poser.rot[fj.pip] = jointQuat({ flex: x[2] });
        poser.rot[fj.dip] = jointQuat({ flex: x[3] });
      };
      const cost = (x: number[], penW: number) => {
        apply(x);
        const p = poser.pose();
        const pd = padOf(p, fj, 0.0068 + GLOVE);
        let c = pd.at.distanceToSquared(target) * 1e4;
        c += (1 - pd.normal.dot(nrm)) * 0.6;
        if (penW > 0) c += poser.penetration(p, verts, clear) * penW;
        for (let k = 0; k < x.length; k++) {
          c += (x[k]! - x0[k]!) ** 2 * 0.01;
          c += (Math.max(0, lo[k]! - x[k]!) + Math.max(0, x[k]! - hi[k]!)) ** 2 * 200;
        }
        return c;
      };
      let best = x0;
      let bestC = cost(x0, 2e5);
      const scored: [number, number[]][] = [];
      for (const a of [-0.6, -0.2, 0.2, 0.6, 1.0]) for (const b of [-0.3, 0, 0.3]) for (const c2 of [0.3, 0.9]) scored.push([cost([a + 0.6, b, c2, 0.5, 0], 2e5), [a + 0.6, b, c2, 0.5, 0]]);
      scored.sort((a, b) => a[0] - b[0]);
      for (const s0 of [x0, ...scored.slice(0, 4).map((s2) => s2[1])]) {
        const r = nelderMead((x) => cost(x, 0), s0, [0.15, 0.1, 0.15, 0.15, 0.1], 300);
        const r2 = nelderMead((x) => cost(x, 2e5), r, [0.05, 0.05, 0.05, 0.05, 0.05], 300);
        const r3b = nelderMead((x) => cost(x, 2e5), s0, [0.1, 0.1, 0.1, 0.1, 0.1], 300);
        for (const cand of [r2, r3b]) {
          const c = cost(cand, 2e5);
          if (c < bestC) {
            bestC = c;
            best = cand;
          }
        }
      }
      apply(best);
      const p = poser.pose();
      const pd = padOf(p, fj, 0.0068 + GLOVE);
      debug[f] = { x: best.map((a) => +a.toFixed(3)), miss: +pd.at.distanceTo(target).toFixed(4), facing: +pd.normal.dot(nrm).toFixed(3), pen: +poser.penetration(p, verts, clear).toExponential(2) };
    };
    for (const f of FINGERS) if (pose[f].pad) reach(f);
  }

  const posed = poser.pose();
  // Forearm: rotate about the wrist from the hand's own axis to the requested direction.
  const wristPos = new THREE.Vector3().setFromMatrixPosition(posed.joints[poser.j('wrist')]!);
  const midMcp = new THREE.Vector3().setFromMatrixPosition(posed.joints[poser.j('middle-finger-phalanx-proximal')]!);
  const handBack = wristPos.clone().sub(midMcp).normalize();
  const forearmDir = v3(mir(pose.forearm, L)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(handBack, forearmDir);
  const forearm = new THREE.Matrix4()
    .makeTranslation(wristPos.x, wristPos.y, wristPos.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-wristPos.x, -wristPos.y, -wristPos.z))
    .multiply(posed.joints[poser.j('wrist')]!)
    .multiply(rig.restInv[poser.j('wrist')]!);
  const solution: SolvedPose = {
    placement: [...poser.placement.elements],
    rot: poser.rot.map((r) => (r ? [r.x, r.y, r.z, r.w] : null)),
    shift: poser.shift.map((v) => (v ? [v.x, v.y, v.z] : null)),
  };
  return { poser, posed, forearm, wristPos, forearmDir, debug, solution };
}
