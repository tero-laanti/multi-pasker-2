import * as THREE from 'three';
import { makeRng } from '../../../shared/math';
import { SdfShape, ellipsoid, meshShape, roundBox, roundCone, union, type V3 } from './sdf';
import { normalFromHeight } from './common';
import { HAND_SPECS, type HandKey } from './handSpecs';

/** Grip frame: origin at the top centre of the grip, `down` along it, `fwd` towards the front strap. */
export interface GripFrame {
  origin: V3;
  down: V3;
  fwd: V3;
}

function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Point in grip space: `a` along the grip, `f` forward, `s` to the right (+X). */
export function gp(g: GripFrame, a: number, f: number, s: number): V3 {
  const d = unit(g.down);
  const fw = unit(g.fwd);
  return [g.origin[0] + d[0] * a + fw[0] * f + s, g.origin[1] + d[1] * a + fw[1] * f, g.origin[2] + d[2] * a + fw[2] * f];
}

/** Grip-frame joint: [a, f, s]. */
type J = [number, number, number];

/** A finger as one exact union of tapered bones (no bulges at the joints). */
function finger(g: GripFrame, joints: J[], radii: number[]) {
  const parts = [];
  for (let i = 0; i + 1 < joints.length; i++) {
    const a = joints[i]!;
    const b = joints[i + 1]!;
    parts.push(roundCone(gp(g, a[0], a[1], a[2]), gp(g, b[0], b[1], b[2]), radii[i]!, radii[i + 1]!));
  }
  return union(parts);
}

function blob(shape: SdfShape, g: GripFrame, c: J, radii: [number, number, number], k?: number): void {
  // Axes: along the grip, forward, right.
  const d = unit(g.down);
  const f = unit(g.fwd);
  shape.add(ellipsoid(gp(g, c[0], c[1], c[2]), [d, f, [1, 0, 0]], radii), k);
}

export interface FingerSpec {
  joints: J[];
  radii: number[];
}

export interface HandSpec {
  wrist: J;
  /** Forearm end, far from the wrist (sleeve). */
  elbow: J;
  /** Knuckle (MCP) joints: index, middle, ring, little. Fingers start here. */
  knuckles: [J, J, J, J];
  /** Rough direction out of the back of the hand (grip-frame vector). */
  back: J;
  /** Small soft masses: web, heel of the hand, base of the thumb. */
  pads: { c: J; r: [number, number, number] }[];
  /** Index, middle, ring, little (joints after the knuckle). */
  fingers: FingerSpec[];
  thumb: FingerSpec;
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Grip-frame direction to model space. */
function gdir(g: GripFrame, d: J): V3 {
  const o = gp(g, 0, 0, 0);
  return unit(sub(gp(g, d[0], d[1], d[2]), o));
}

let gloveMat: THREE.MeshStandardMaterial | null = null;
let sleeveMat: THREE.MeshStandardMaterial | null = null;

function materials(): { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial } {
  if (!gloveMat || !sleeveMat) {
    const r = makeRng(31);
    const cells = 48;
    const jitter = Array.from({ length: cells * cells }, () => r());
    const leather = normalFromHeight(
      256,
      (u, v) => {
        // Fine pebbled grain: one soft bump per cell.
        const x = u * cells;
        const y = v * cells;
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        const fx = x - cx - 0.5;
        const fy = y - cy - 0.5;
        const j = jitter[(cy % cells) * cells + (cx % cells)]!;
        return Math.max(0, 0.25 - (fx * fx + fy * fy)) * (0.6 + 0.4 * j);
      },
      0.9,
    );
    gloveMat = new THREE.MeshStandardMaterial({
      color: 0x4d4436,
      roughness: 0.58,
      metalness: 0,
      envMapIntensity: 0.55,
      normalMap: leather,
      normalScale: new THREE.Vector2(0.25, 0.25),
    });
    sleeveMat = new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });
  }
  return { glove: gloveMat, sleeve: sleeveMat };
}

/** Planar UVs along the dominant normal axis so the leather grain has somewhere to sit. */
function addUvs(geo: THREE.BufferGeometry, scale: number): void {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Glove and sleeve geometry for one hand (no materials, so it can run anywhere). */
export function handGeometry(g: GripFrame, h: HandSpec, cell = 0.002): { glove: THREE.BufferGeometry; sleeve: THREE.BufferGeometry } {
  const shape = new SdfShape(0.011);
  const W = gp(g, ...h.wrist);
  const K = h.knuckles.map((k) => gp(g, ...k)) as [V3, V3, V3, V3];
  // Palm: one smooth rounded slab from the wrist to the knuckle line.
  const mid: V3 = [(K[0][0] + K[3][0]) / 2, (K[0][1] + K[3][1]) / 2, (K[0][2] + K[3][2]) / 2];
  const L = unit(sub(mid, W));
  let Wd = unit(sub(K[0], K[3]));
  Wd = unit(sub(Wd, [L[0] * dot(Wd, L), L[1] * dot(Wd, L), L[2] * dot(Wd, L)]));
  let T = cross(L, Wd);
  const back = gdir(g, h.back);
  if (dot(T, back) < 0) T = [-T[0], -T[1], -T[2]];
  const len = Math.hypot(...sub(mid, W));
  const width = Math.hypot(...sub(K[0], K[3]));
  const c: V3 = [W[0] + L[0] * len * 0.55 + T[0] * 0.002, W[1] + L[1] * len * 0.55 + T[1] * 0.002, W[2] + L[2] * len * 0.55 + T[2] * 0.002];
  shape.add(roundBox(c, [L, Wd, T], [len * 0.5 + 0.004, width / 2 + 0.008, 0.0115], 0.0095));
  // Slim metacarpal ridges give the knuckles a little shape.
  for (const k of K) shape.add(roundCone([W[0] + L[0] * len * 0.25, W[1] + L[1] * len * 0.25, W[2] + L[2] * len * 0.25], k, 0.0085, 0.0088), 0.008);
  for (const p of h.pads) blob(shape, g, p.c, p.r, 0.009);
  h.fingers.forEach((f, i) => shape.add(finger(g, [h.knuckles[i]!, ...f.joints], f.radii), 0.005));
  shape.add(finger(g, h.thumb.joints, h.thumb.radii), 0.009);
  // Wrist and glove cuff, a little past the wrist towards the elbow.
  const e = h.elbow;
  const w = h.wrist;
  const cuff: J = [w[0] + (e[0] - w[0]) * 0.2, w[1] + (e[1] - w[1]) * 0.2, w[2] + (e[2] - w[2]) * 0.2];
  shape.add(roundCone(W, gp(g, ...cuff), 0.023, 0.027), 0.012);
  const glove = meshShape(shape, cell);
  addUvs(glove, 14);
  const sleeveShape = new SdfShape(0.01);
  const start: J = [w[0] + (e[0] - w[0]) * 0.14, w[1] + (e[1] - w[1]) * 0.14, w[2] + (e[2] - w[2]) * 0.14];
  sleeveShape.add(roundCone(gp(g, ...start), gp(g, ...e), 0.031, 0.042));
  const sleeve = meshShape(sleeveShape, 0.004);
  return { glove, sleeve };
}

export interface HandsModel {
  /** Shooting hand, fixed to the grip. */
  right: THREE.Group;
  /** Support hand; animated separately for reloads. Rest pose is identity. */
  left: THREE.Group;
}

const cache = new Map<string, { glove: THREE.BufferGeometry; sleeve: THREE.BufferGeometry }>();

export interface HandArrays {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
}

export function toArrays(geo: THREE.BufferGeometry): HandArrays {
  return {
    pos: geo.getAttribute('position').array as Float32Array,
    nrm: geo.getAttribute('normal').array as Float32Array,
    uv: (geo.getAttribute('uv')?.array as Float32Array) ?? new Float32Array(0),
    idx: Uint32Array.from(geo.getIndex()!.array as ArrayLike<number>),
  };
}

export function fromArrays(a: HandArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.nrm, 3));
  if (a.uv.length) g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setIndex(new THREE.BufferAttribute(a.idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Meshes every hand in a worker (parallel to other loading) and caches the results. */
export function prepareHands(): Promise<void> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve();
      return;
    }
    const done = () => {
      worker.terminate();
      resolve();
    };
    worker.onmessage = (ev: MessageEvent<{ key: string; glove: HandArrays; sleeve: HandArrays } | { done: true }>) => {
      const m = ev.data;
      if ('done' in m) return done();
      cache.set(m.key, { glove: fromArrays(m.glove), sleeve: fromArrays(m.sleeve) });
    };
    worker.onerror = done;
    worker.postMessage('go');
  });
}

/** One gloved hand with its sleeve (model space), from the worker cache or built here. */
export function buildHand(key: HandKey): THREE.Group {
  let geo = cache.get(key);
  if (!geo) {
    const h = HAND_SPECS[key];
    geo = handGeometry(h.grip, h.spec);
    cache.set(key, geo);
  }
  const mats = materials();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo.glove, mats.glove));
  group.add(new THREE.Mesh(geo.sleeve, mats.sleeve));
  return group;
}
