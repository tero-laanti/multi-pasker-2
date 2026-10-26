import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { weaponMaterials } from './common';

type P = [number, number, number];

/** Grip frame: origin at the top centre of the grip, `down` along it, `fwd` towards the front strap. */
export interface GripFrame {
  origin: P;
  down: P;
  fwd: P;
}

function v(p: P): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

function norm(p: P): THREE.Vector3 {
  return v(p).normalize();
}

/** Point in grip space: `a` along the grip, `f` forward, `r` to the right. */
export function gp(g: GripFrame, a: number, f: number, r: number): P {
  const d = norm(g.down);
  const fw = norm(g.fwd);
  return [g.origin[0] + d.x * a + fw.x * f + r, g.origin[1] + d.y * a + fw.y * f, g.origin[2] + d.z * a + fw.z * f];
}

function capsule(a: P, b: P, r: number): THREE.BufferGeometry {
  const A = v(a);
  const B = v(b);
  const len = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 4, 10);
  const dir = B.clone().sub(A).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  const mid = A.add(B).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g.toNonIndexed();
}

/** A finger as a chain of capsules through the given joints, tapering towards the tip. */
export function finger(points: P[], r0: number, r1 = r0 * 0.82): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const t = i / Math.max(1, points.length - 2);
    out.push(capsule(points[i]!, points[i + 1]!, r0 + (r1 - r0) * t));
  }
  return out;
}

/** Rounded box centred at `c`, rotated so its local Y runs along `up` and Z along `fwd`. */
export function palm(c: P, size: P, up: P, fwd: P, radius = 0.012): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius);
  const Y = norm(up);
  const Z = norm(fwd);
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  const Zc = new THREE.Vector3().crossVectors(X, Y).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Zc);
  g.applyMatrix4(m);
  g.translate(c[0], c[1], c[2]);
  return g.toNonIndexed();
}

export function forearm(from: P, to: P, rGlove: number, rSleeve: number): { glove: THREE.BufferGeometry[]; sleeve: THREE.BufferGeometry[] } {
  const A = v(from);
  const B = v(to);
  const cuffEnd = A.clone().lerp(B, 0.22);
  const glove = [capsule(from, [cuffEnd.x, cuffEnd.y, cuffEnd.z], rGlove)];
  const sleeve = [capsule([cuffEnd.x, cuffEnd.y, cuffEnd.z], to, rSleeve)];
  return { glove, sleeve };
}

export interface HandsModel {
  /** Shooting hand, fixed to the grip. */
  right: THREE.Group;
  /** Support hand; animated separately for reloads. Rest pose is identity. */
  left: THREE.Group;
}

export function buildMeshGroup(glove: THREE.BufferGeometry[], sleeve: THREE.BufferGeometry[]): THREE.Group {
  const M = weaponMaterials();
  const g = new THREE.Group();
  if (glove.length) g.add(new THREE.Mesh(mergeGeometries(glove)!, M.glove));
  if (sleeve.length) g.add(new THREE.Mesh(mergeGeometries(sleeve)!, M.sleeve));
  return g;
}

/**
 * Two-handed pistol grip around a raked grip: the right hand wraps the grip with the index
 * finger on the trigger and the thumb forward along the frame; the left hand cups the right
 * hand's fingers from the front-left with its thumb forward under the right thumb.
 */
export function pistolHands(g: GripFrame, trigger: P): HandsModel {
  const rg: THREE.BufferGeometry[] = [];
  const rs: THREE.BufferGeometry[] = [];
  // Right hand.
  rg.push(palm(gp(g, 0.047, -0.025, 0.011), [0.032, 0.088, 0.046], g.down.map((x) => -x) as P, g.fwd, 0.013));
  rg.push(palm(gp(g, 0.012, -0.03, 0.002), [0.034, 0.03, 0.03], g.down.map((x) => -x) as P, g.fwd, 0.012));
  const fingers: [number, number][] = [
    [0.03, 0.0088],
    [0.05, 0.0084],
    [0.069, 0.0076],
  ];
  for (const [a, r] of fingers) {
    rg.push(...finger([gp(g, a, -0.004, 0.023), gp(g, a, 0.024, 0.021), gp(g, a + 0.002, 0.038, 0.002), gp(g, a + 0.004, 0.03, -0.015)], r, r * 0.85));
  }
  rg.push(...finger([gp(g, 0.004, -0.002, 0.021), gp(g, -0.004, 0.026, 0.017), trigger], 0.0082, 0.0072));
  rg.push(...finger([gp(g, 0.006, -0.026, -0.006), gp(g, -0.006, 0.0, -0.02), gp(g, -0.012, 0.035, -0.021)], 0.0098, 0.0086));
  const rf = forearm(gp(g, 0.07, -0.04, 0.015), gp(g, 0.24, -0.27, 0.07), 0.026, 0.034);
  rg.push(...rf.glove);
  rs.push(...rf.sleeve);

  // Left hand.
  const lg: THREE.BufferGeometry[] = [];
  const ls: THREE.BufferGeometry[] = [];
  lg.push(palm(gp(g, 0.058, 0.004, -0.034), [0.03, 0.085, 0.05], g.down.map((x) => -x) as P, g.fwd, 0.013));
  for (const [a, r] of [
    [0.042, 0.0088],
    [0.06, 0.0086],
    [0.078, 0.008],
    [0.095, 0.0072],
  ] as [number, number][]) {
    lg.push(...finger([gp(g, a, 0.012, -0.036), gp(g, a, 0.047, -0.025), gp(g, a + 0.002, 0.054, 0.002), gp(g, a + 0.003, 0.042, 0.022)], r, r * 0.86));
  }
  lg.push(...finger([gp(g, 0.035, -0.006, -0.035), gp(g, 0.018, 0.022, -0.029), gp(g, 0.012, 0.05, -0.024)], 0.0098, 0.0086));
  const lf = forearm(gp(g, 0.085, 0.0, -0.045), gp(g, 0.26, -0.13, -0.17), 0.026, 0.034);
  lg.push(...lf.glove);
  ls.push(...lf.sleeve);

  return { right: buildMeshGroup(rg, rs), left: buildMeshGroup(lg, ls) };
}
