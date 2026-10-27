import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HAND_POSES } from './handPoses';

/**
 * First-person gloved hands, built from plain shapes: a palm, three segments per finger and
 * for the thumb (capsules, so the knuckles round off where they bend), a glove cuff and a
 * sleeve. A pose is a few joint angles per finger, each bending only the way a real joint
 * does, and a wrist that stays within a real wrist's range.
 *
 * Hand space (a right hand): origin at the wrist, +Y towards the fingers, +Z out of the back
 * of the hand, +X towards the little finger. Left hands are the mirror image.
 */

export type HandKey = 'pistol.right' | 'pistol.left' | 'pistol.leftRack' | 'rifle.right' | 'rifle.left' | 'phone.left';

export interface HandsModel {
  /** Shooting hand, fixed to the grip. */
  right: THREE.Group;
  /** Support hand; animated separately for reloads. Rest pose is identity. */
  left: THREE.Group;
  /** Optional second support-hand pose used to rack the bolt (rest pose is identity). */
  leftRack?: THREE.Group;
  /**
   * Support hand holding a phone (hidden until the viewmodel shows it). Its local frame is
   * the phone's: origin at the phone's centre, +X right, +Y along the long side, +Z out of the
   * screen. Place the group where the phone should be and attach the phone mesh to
   * `phoneAnchor`.
   */
  phone: THREE.Group;
  /** Child of `phone` at the phone's centre (identity transform): parent the phone mesh here. */
  phoneAnchor: THREE.Object3D;
}

type V3 = [number, number, number];

/** A finger: spread at the knuckle (towards the thumb) and how far each joint curls (radians). */
export interface Curl {
  spread?: number;
  mcp: number;
  pip: number;
  dip: number;
}

/**
 * The thumb, in the holder's space: it points along `dir` with its knuckles towards `knuckle`
 * (the side away from what it presses on). `lift` raises the base bone from `dir` towards the
 * knuckle side; the two joints (`mcp`, `ip`) then curl it back the other way. Both joints bend
 * in the same plane and the same direction, as a thumb's do.
 */
export interface ThumbPose {
  dir: V3;
  knuckle: V3;
  lift: number;
  mcp: number;
  ip: number;
}

export interface GlovePose {
  left?: boolean;
  /** Wrist centre in the holder's space (the weapon's model space, or the phone's). */
  wrist: V3;
  /** Wrist → knuckles, in the holder's space. */
  along: V3;
  /** Out of the back of the hand, in the holder's space. */
  back: V3;
  /** Wrist → elbow in the holder's space (towards that arm's shoulder). */
  forearm: V3;
  index: Curl;
  middle: Curl;
  ring: Curl;
  pinky: Curl;
  thumb: ThumbPose;
}

/** Glove sizes (metres): knuckle positions, bone lengths and thicknesses of a gloved hand. */
export const GLOVE = {
  fingers: {
    index: { mcp: [-0.029, 0.094, 0] as V3, len: [0.045, 0.026, 0.022], r: 0.0102 },
    middle: { mcp: [-0.009, 0.097, 0] as V3, len: [0.049, 0.03, 0.023], r: 0.0105 },
    ring: { mcp: [0.011, 0.093, 0] as V3, len: [0.046, 0.028, 0.022], r: 0.01 },
    pinky: { mcp: [0.029, 0.085, 0] as V3, len: [0.036, 0.022, 0.02], r: 0.009 },
  },
  thumb: { cmc: [-0.024, 0.026, -0.008] as V3, len: [0.045, 0.031, 0.025], r: 0.0105, base: 0.0135 },
  palm: { width: 0.08, length: 0.094, thick: 0.026, round: 0.0125, wristWidth: 0.062, arch: 2.2 },
  /** Knuckles stand a little proud of the back of the hand. */
  knuckle: { r: 1.08, z: 0.0045 },
  cuff: { length: 0.032, rx: 0.03, rz: 0.023 },
  sleeve: { from: 0.03, length: 0.32, r0: 0.037, r1: 0.047 },
};

/** How much the segments of a finger thin out from the knuckle to the tip. */
const TAPER = [1, 0.93, 0.86];

const v = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

/** A capsule from a to b (a rounded rod; its caps overlap the neighbours at the joints). */
function capsule(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 4, 12);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A finger's segments in hand space: knuckle, spread, then three curls towards the palm. */
function fingerParts(name: keyof typeof GLOVE.fingers, c: Curl): THREE.BufferGeometry[] {
  const f = GLOVE.fingers[name];
  const K = GLOVE.knuckle;
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(f.r * K.r, 12, 8).translate(f.mcp[0], f.mcp[1] - 0.003, f.mcp[2] + K.z)];
  const m = new THREE.Matrix4().makeTranslation(f.mcp[0], f.mcp[1], f.mcp[2]);
  m.multiply(new THREE.Matrix4().makeRotationZ(c.spread ?? 0));
  const curls = [c.mcp, c.pip, c.dip];
  for (let i = 0; i < 3; i++) {
    // Curling turns +Y towards the palm (-Z): a negative turn about +X. Never backwards.
    m.multiply(new THREE.Matrix4().makeRotationX(-Math.max(0, curls[i]!)));
    const a = new THREE.Vector3().setFromMatrixPosition(m);
    m.multiply(new THREE.Matrix4().makeTranslation(0, f.len[i]!, 0));
    const b = new THREE.Vector3().setFromMatrixPosition(m);
    parts.push(capsule(a, b, f.r * TAPER[i]!));
  }
  return parts;
}

/** The thumb's joints from its root in the palm: [root, knuckle, middle joint, tip]. */
export function thumbJoints(t: ThumbPose, root: THREE.Vector3): THREE.Vector3[] {
  const d = v(t.dir).normalize();
  const u = v(t.knuckle);
  u.addScaledVector(d, -u.dot(d)).normalize();
  const out = [root.clone()];
  const angles = [t.lift, t.lift - Math.max(0, t.mcp), t.lift - Math.max(0, t.mcp) - Math.max(0, t.ip)];
  for (let i = 0; i < 3; i++) {
    const step = d.clone().multiplyScalar(Math.cos(angles[i]!)).addScaledVector(u, Math.sin(angles[i]!));
    out.push(out[i]!.clone().addScaledVector(step, GLOVE.thumb.len[i]!));
  }
  return out;
}

/** The thumb in the holder's space: the ball of the thumb from its root in the palm, then two segments. */
function thumbParts(t: ThumbPose, root: THREE.Vector3): THREE.BufferGeometry[] {
  const T = GLOVE.thumb;
  const [a, b, c, e] = thumbJoints(t, root);
  return [capsule(a!, b!, T.base), capsule(b!, c!, T.r), capsule(c!, e!, T.r * TAPER[1]!)];
}

/** Where the thumb's root sits in the holder's space. */
export function thumbRoot(p: GlovePose): THREE.Vector3 {
  const root = v(GLOVE.thumb.cmc);
  if (p.left) root.x = -root.x;
  return root.applyMatrix4(handMatrix(p));
}

/** The palm: a rounded slab, narrower at the wrist. */
function palmPart(): THREE.BufferGeometry {
  const P = GLOVE.palm;
  const box = new RoundedBoxGeometry(P.width, P.length, P.thick, 3, P.round);
  box.deleteAttribute('normal');
  box.deleteAttribute('uv');
  // Shared vertices, so the normals come out smooth after the taper.
  const g = mergeVertices(box);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + P.length / 2) / P.length;
    const x = pos.getX(i) * (P.wristWidth / P.width + (1 - P.wristWidth / P.width) * Math.min(1, t * 1.4));
    // Arched across the knuckles: the back of the hand is convex, the palm a little hollow.
    pos.setXYZ(i, x, pos.getY(i), pos.getZ(i) - P.arch * x * x);
  }
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  g.translate(0.001, P.length / 2 - 0.004, -0.002);
  return g;
}

/** Mirror image (left hand): flip X and turn every triangle round so it still faces out. */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
  return g;
}

/** How far a wrist bends at most (radians): past that, the forearm turns with the hand. */
export const WRIST_MAX = (28 * Math.PI) / 180;

/**
 * The forearm's direction in (right-)hand space; its angle from straight back (0, -1, 0) is
 * the wrist's bend, never more than WRIST_MAX.
 */
export function forearmInHand(p: GlovePose): THREE.Vector3 {
  const m = handMatrix(p);
  const f = v(p.forearm).transformDirection(new THREE.Matrix4().copy(m).setPosition(0, 0, 0).invert());
  if (p.left) f.x = -f.x;
  const straight = new THREE.Vector3(0, -1, 0);
  const bend = f.angleTo(straight);
  if (bend <= WRIST_MAX) return f;
  // Turn it back towards straight, in the same plane, until the wrist is within range.
  const side = f.clone().addScaledVector(straight, -f.dot(straight)).normalize();
  return straight.multiplyScalar(Math.cos(WRIST_MAX)).addScaledVector(side, Math.sin(WRIST_MAX));
}

/** Hand space → holder space for a pose. */
function handMatrix(p: GlovePose): THREE.Matrix4 {
  const y = v(p.along).normalize();
  const z = v(p.back);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(v(p.wrist));
}

/** An elliptical tube along +Y from y0 to y1 (cuff, sleeve). */
function tube(y0: number, y1: number, rx0: number, rz0: number, rx1: number, rz1: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, y1 - y0, 18, 1, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + (y1 - y0) / 2) / (y1 - y0);
    pos.setX(i, pos.getX(i) * (rx0 + (rx1 - rx0) * t));
    pos.setZ(i, pos.getZ(i) * (rz0 + (rz1 - rz0) * t));
  }
  g.computeVertexNormals();
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

export type GlovePiece = 'palm' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

/** The pieces of a pose's glove, each in the holder's space (for measuring and tuning). */
export function glovePieces(p: GlovePose): Record<GlovePiece, THREE.BufferGeometry> {
  const m = handMatrix(p);
  const place = (parts: THREE.BufferGeometry[]) => {
    for (const g of parts) g.deleteAttribute('uv');
    const g = mergeGeometries(parts)!;
    if (p.left) mirrorX(g);
    return g.applyMatrix4(m);
  };
  const thumb = thumbParts(p.thumb, thumbRoot(p));
  for (const g of thumb) g.deleteAttribute('uv');
  return {
    palm: place([palmPart()]),
    thumb: mergeGeometries(thumb)!,
    index: place(fingerParts('index', p.index)),
    middle: place(fingerParts('middle', p.middle)),
    ring: place(fingerParts('ring', p.ring)),
    pinky: place(fingerParts('pinky', p.pinky)),
  };
}

/** Glove and sleeve geometry of a pose, in the holder's space. */
export function gloveGeometry(p: GlovePose): { glove: THREE.BufferGeometry; sleeve: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  // The cuff and sleeve run up the forearm (given in the holder's space, so into hand space).
  const fore = forearmInHand(p);
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), fore);
  const C = GLOVE.cuff;
  const cuff = tube(-C.length, 0.012, C.rx * 1.06, C.rz * 1.08, C.rx, C.rz).applyQuaternion(turn);
  parts.push(cuff);
  const S = GLOVE.sleeve;
  const sleeve = mergeGeometries([
    tube(-S.from - S.length, -S.from, S.r1, S.r1 * 0.85, S.r0, S.r0 * 0.82),
    new THREE.TorusGeometry(S.r0 * 0.96, 0.0045, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 0.84).translate(0, -S.from, 0),
  ])!.applyQuaternion(turn);
  for (const g of parts) g.deleteAttribute('uv');
  const cuffs = mergeGeometries(parts)!;
  sleeve.deleteAttribute('uv');
  if (p.left) {
    mirrorX(cuffs);
    mirrorX(sleeve);
  }
  const m = handMatrix(p);
  cuffs.applyMatrix4(m);
  sleeve.applyMatrix4(m);
  const glove = mergeGeometries([cuffs, ...Object.values(glovePieces(p))])!;
  glove.computeBoundingSphere();
  sleeve.computeBoundingSphere();
  return { glove, sleeve };
}

let mats: { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial } | null = null;

/** Dark brown leather gloves and an olive sleeve. */
function materials(): { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial } {
  if (mats) return mats;
  mats = {
    glove: new THREE.MeshStandardMaterial({ color: 0x5c4835, roughness: 0.55, metalness: 0, envMapIntensity: 0.6 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x56603f, roughness: 0.93, metalness: 0, envMapIntensity: 0.3 }),
  };
  return mats;
}

/** One gloved hand with its sleeve, in the holder's space. */
export function buildHand(key: HandKey): THREE.Group {
  const group = new THREE.Group();
  group.name = key;
  const geo = gloveGeometry(HAND_POSES[key]);
  const m = materials();
  group.add(new THREE.Mesh(geo.glove, m.glove), new THREE.Mesh(geo.sleeve, m.sleeve));
  return group;
}

/** The support hand holding a phone (phone space), with a `phoneAnchor` at the phone's centre. Hidden. */
export function buildPhoneHand(): THREE.Group {
  const group = buildHand('phone.left');
  const anchor = new THREE.Object3D();
  anchor.name = 'phoneAnchor';
  group.add(anchor);
  group.userData.phoneAnchor = anchor;
  group.visible = false;
  return group;
}
