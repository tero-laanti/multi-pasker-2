import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { WeaponId } from '../../shared/config';
import type { Upgrades } from '../../shared/upgrades';
import { clamp, damp } from '../../shared/math';

/**
 * Third-person soldier for remote players and bots: one rigid-skinned mesh (a single draw
 * call) posed procedurally. Plain dark uniform so players stand out from greenery and
 * concrete; the per-player accent colour is on the beret, arm bands and chest band.
 * Faces -Z like the camera; +X is the character's right.
 */

const B = {
  root: 0,
  hips: 1,
  spine: 2,
  head: 3,
  aim: 4,
  armUR: 5,
  armFR: 6,
  armUL: 7,
  armFL: 8,
  thighR: 9,
  shinR: 10,
  thighL: 11,
  shinL: 12,
  rifle: 13,
  pistol: 14,
  sniper: 15,
  count: 16,
} as const;

const PARENT: number[] = [-1, B.root, B.hips, B.spine, B.spine, B.aim, B.armUR, B.aim, B.armUL, B.hips, B.thighR, B.hips, B.thighL, B.aim, B.aim, B.aim];
const OFFSET: [number, number, number][] = [
  [0, 0, 0],
  [0, 0.95, 0],
  [0, 0.08, 0],
  [0, 0.47, 0],
  [0, 0.4, 0],
  [0.2, 0, 0],
  [0, -0.29, 0],
  [-0.2, 0, 0],
  [0, -0.29, 0],
  [0.1, -0.05, 0],
  [0, -0.42, 0],
  [-0.1, -0.05, 0],
  [0, -0.42, 0],
  [0.12, -0.06, -0.05],
  [0.03, -0.15, -0.48],
  [0.12, -0.06, -0.05],
];

/** Which bone carries each gun. */
const GUN_BONE: Record<WeaponId, number> = { rifle: B.rifle, pistol: B.pistol, sniper: B.sniper };

const UPPER_ARM = 0.29;
const FOREARM = 0.29;
const HIP_STAND = 0.95;
const HIP_CROUCH = 0.44;

const COL = {
  uniform: 0x4d5868,
  trousers: 0x3f4855,
  vest: 0x353c47,
  hair: 0x3a2a1e,
  eyes: 0x1a1512,
  boots: 0x1b1c1e,
  belt: 0x5b4632,
  skin: 0xd9a688,
  glove: 0x232324,
  metal: 0x2b2d30,
  wood: 0x4a3a2a,
};

const MUZZLE: Record<WeaponId, THREE.Vector3> = {
  rifle: new THREE.Vector3(0, 0.02, -0.95),
  pistol: new THREE.Vector3(0, 0.012, -0.17),
  sniper: new THREE.Vector3(0, 0.02, -1.16),
};

/** Hand targets in aim-bone space for each weapon: [right, left]. */
const GRIP: Record<WeaponId, [THREE.Vector3, THREE.Vector3]> = {
  rifle: [new THREE.Vector3(0.12, -0.15, -0.26), new THREE.Vector3(0.07, -0.1, -0.47)],
  pistol: [new THREE.Vector3(0.03, -0.21, -0.47), new THREE.Vector3(0.0, -0.23, -0.43)],
  sniper: [new THREE.Vector3(0.12, -0.15, -0.26), new THREE.Vector3(0.07, -0.1, -0.52)],
};

/** The phone in the left hand, in aim-bone space, its screen turned up towards the face. */
const PHONE_AT = new THREE.Vector3(-0.05, -0.16, -0.3);
const PHONE_HAND = new THREE.Vector3(-0.05, -0.2, -0.29);

const MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.04, emissive: 0x111419 });

interface Part {
  geo: THREE.BufferGeometry;
  bone: number;
  color: number;
}

function bindPositions(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < B.count; i++) {
    const o = OFFSET[i]!;
    const p = new THREE.Vector3(o[0], o[1], o[2]);
    if (PARENT[i]! >= 0) p.add(out[PARENT[i]!]!);
    out.push(p);
  }
  return out;
}

const BIND = bindPositions();

function capsule(r: number, len: number, seg = 8): THREE.BufferGeometry {
  // Hangs from the joint along -Y.
  return new THREE.CapsuleGeometry(r, len, 3, seg).translate(0, -len / 2, 0);
}

function rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
}

function buildParts(accent: number): Part[] {
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, bone: number, color: number) => parts.push({ geo, bone, color });

  // Pelvis and belt.
  add(rbox(0.34, 0.22, 0.22, 0.06).translate(0, -0.03, 0), B.hips, COL.trousers);
  add(rbox(0.355, 0.05, 0.235, 0.02).translate(0, 0.07, 0), B.hips, COL.belt);
  // Torso, vest and the accent chest band.
  add(rbox(0.42, 0.5, 0.24, 0.08).translate(0, 0.25, 0), B.spine, COL.uniform);
  add(rbox(0.38, 0.3, 0.27, 0.05).translate(0, 0.2, 0), B.spine, COL.vest);
  add(rbox(0.43, 0.06, 0.28, 0.025).translate(0, 0.37, 0), B.spine, accent);
  for (const x of [-0.11, 0, 0.11]) add(rbox(0.08, 0.09, 0.05, 0.015).translate(x, 0.12, -0.15), B.spine, COL.vest);
  // Neck, head and beret.
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10).translate(0, 0.04, 0), B.head, COL.skin);
  add(new THREE.SphereGeometry(0.115, 16, 12).scale(0.92, 1.08, 1).translate(0, 0.14, 0), B.head, COL.skin);
  add(new THREE.SphereGeometry(0.03, 8, 6).scale(0.6, 1, 0.8).translate(0, 0.125, -0.112), B.head, COL.skin);
  // Eyes and brows on the front, hair on the back: which way someone faces reads at a glance.
  for (const x of [-0.04, 0.04]) {
    add(new THREE.SphereGeometry(0.014, 8, 6).translate(x, 0.155, -0.103), B.head, COL.eyes);
    add(new THREE.BoxGeometry(0.038, 0.009, 0.012).translate(x, 0.177, -0.104), B.head, COL.hair);
  }
  add(new THREE.SphereGeometry(0.119, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(0.95, 1.07, 1.03).translate(0, 0.145, 0.004), B.head, COL.hair);
  for (const x of [-0.108, 0.108]) add(new THREE.SphereGeometry(0.028, 8, 6).scale(0.5, 1, 0.8).translate(x, 0.135, 0.005), B.head, COL.skin);
  const beret = new THREE.SphereGeometry(0.132, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.02, 0.42, 1.08);
  beret.rotateZ(-0.16).translate(-0.012, 0.215, 0.005);
  add(beret, B.head, accent);
  add(new THREE.TorusGeometry(0.116, 0.012, 6, 20).rotateX(Math.PI / 2).rotateZ(-0.1).translate(0, 0.205, 0.0), B.head, COL.vest);
  // Arms with accent bands, gloves.
  for (const [u, f] of [
    [B.armUR, B.armFR],
    [B.armUL, B.armFL],
  ] as const) {
    add(new THREE.SphereGeometry(0.075, 10, 8), u, COL.uniform);
    add(capsule(0.056, UPPER_ARM - 0.06), u, COL.uniform);
    add(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10).translate(0, -0.08, 0), u, accent);
    add(capsule(0.049, FOREARM - 0.1), f, COL.uniform);
    add(rbox(0.075, 0.1, 0.045, 0.02).translate(0, -FOREARM + 0.02, 0), f, COL.glove);
  }
  // Legs and boots.
  for (const [t, s] of [
    [B.thighR, B.shinR],
    [B.thighL, B.shinL],
  ] as const) {
    add(capsule(0.078, 0.36), t, COL.trousers);
    add(capsule(0.062, 0.34), s, COL.trousers);
    add(rbox(0.115, 0.11, 0.27, 0.03).translate(0, -0.4, -0.05), s, COL.boots);
  }
  // Rifle along -Z from the shoulder.
  add(rbox(0.05, 0.085, 0.42, 0.012).translate(0, 0, -0.42), B.rifle, COL.metal);
  add(rbox(0.045, 0.09, 0.26, 0.015).translate(0, -0.02, -0.08), B.rifle, COL.wood);
  add(rbox(0.058, 0.065, 0.2, 0.015).translate(0, -0.005, -0.66), B.rifle, COL.wood);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8).rotateX(Math.PI / 2).translate(0, 0.012, -0.85), B.rifle, COL.metal);
  add(rbox(0.03, 0.1, 0.045, 0.01).rotateX(0.35).translate(0, -0.09, -0.24), B.rifle, COL.wood);
  add(rbox(0.032, 0.18, 0.075, 0.012).rotateX(-0.3).translate(0, -0.13, -0.42), B.rifle, COL.metal);
  // Sniper rifle: a long heavy barrel, a wooden stock and forend, and the scope on top.
  add(rbox(0.05, 0.075, 0.36, 0.012).translate(0, 0, -0.3), B.sniper, COL.metal);
  add(rbox(0.05, 0.1, 0.34, 0.015).translate(0, -0.03, -0.06), B.sniper, COL.wood);
  add(rbox(0.056, 0.06, 0.32, 0.015).translate(0, -0.012, -0.58), B.sniper, COL.wood);
  add(new THREE.CylinderGeometry(0.013, 0.015, 0.46, 8).rotateX(Math.PI / 2).translate(0, 0.014, -0.93), B.sniper, COL.metal);
  add(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 10).rotateX(Math.PI / 2).translate(0, 0.085, -0.3), B.sniper, COL.metal);
  add(new THREE.CylinderGeometry(0.034, 0.03, 0.06, 10).rotateX(Math.PI / 2).translate(0, 0.085, -0.47), B.sniper, COL.metal);
  add(rbox(0.03, 0.09, 0.045, 0.01).rotateX(0.35).translate(0, -0.1, -0.2), B.sniper, COL.wood);
  // Pistol.
  add(rbox(0.03, 0.036, 0.19, 0.008).translate(0, 0, -0.07), B.pistol, COL.metal);
  add(rbox(0.028, 0.1, 0.045, 0.01).rotateX(0.25).translate(0, -0.055, 0.0), B.pistol, COL.metal);
  return parts;
}

const geometryCache = new Map<number, THREE.BufferGeometry>();

function characterGeometry(accent: number): THREE.BufferGeometry {
  const cached = geometryCache.get(accent);
  if (cached) return cached;
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const p of buildParts(accent)) {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo).translate(BIND[p.bone]!.x, BIND[p.bone]!.y, BIND[p.bone]!.z);
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    // setHex takes sRGB and stores linear (colour management is on).
    c.setHex(p.color);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = p.bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geos.push(g);
  }
  const merged = mergeGeometries(geos)!;
  geometryCache.set(accent, merged);
  return merged;
}

/** Two-bone arm: rotations that put the hand (forearm end) on `target`, elbow towards `pole`. */
function solveArm(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, upper: THREE.Quaternion, fore: THREE.Quaternion): void {
  const down = new THREE.Vector3(0, -1, 0);
  const to = target.clone().sub(shoulder);
  const d = clamp(to.length(), 0.05, UPPER_ARM + FOREARM - 1e-4);
  const dir = to.normalize();
  const a = (UPPER_ARM * UPPER_ARM + d * d - FOREARM * FOREARM) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - a * a));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(p, h);
  const hand = shoulder.clone().addScaledVector(dir, d);
  upper.setFromUnitVectors(down, elbow.clone().sub(shoulder).normalize());
  const v = hand.sub(elbow).normalize().applyQuaternion(upper.clone().invert());
  fore.setFromUnitVectors(down, v);
}

interface ArmPose {
  ur: THREE.Quaternion;
  fr: THREE.Quaternion;
  ul: THREE.Quaternion;
  fl: THREE.Quaternion;
}

function armPose(w: WeaponId): ArmPose {
  const pose: ArmPose = { ur: new THREE.Quaternion(), fr: new THREE.Quaternion(), ul: new THREE.Quaternion(), fl: new THREE.Quaternion() };
  const [r, l] = GRIP[w];
  solveArm(new THREE.Vector3(0.2, 0, 0), r, new THREE.Vector3(0.7, -1, 0.3), pose.ur, pose.fr);
  solveArm(new THREE.Vector3(-0.2, 0, 0), l, new THREE.Vector3(-0.8, -1, 0.1), pose.ul, pose.fl);
  return pose;
}

const ARM_POSES: Record<WeaponId, ArmPose> = { rifle: armPose('rifle'), pistol: armPose('pistol'), sniper: armPose('sniper') };

/** Left arm holding the phone (the gun stays in the right hand). */
const PHONE_ARM = (() => {
  const ul = new THREE.Quaternion();
  const fl = new THREE.Quaternion();
  solveArm(new THREE.Vector3(-0.2, 0, 0), PHONE_HAND, new THREE.Vector3(-0.9, -1, 0.2), ul, fl);
  return { ul, fl };
})();

const PHONE_BODY = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4, metalness: 0.3 });
const ATTACHMENT = new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.55, metalness: 0.5 });
/** Shapes every character shares (made once: players come and go all evening). */
const SHAPES = {
  phoneBody: new THREE.BoxGeometry(0.072, 0.145, 0.009),
  phoneScreen: new THREE.PlaneGeometry(0.062, 0.128),
  suppressor: { pistol: new THREE.CylinderGeometry(0.018, 0.018, 0.17, 12).rotateX(Math.PI / 2), long: new THREE.CylinderGeometry(0.022, 0.022, 0.17, 12).rotateX(Math.PI / 2) },
  drum: new THREE.CylinderGeometry(0.075, 0.075, 0.07, 20).rotateZ(Math.PI / 2),
  redDot: new THREE.BoxGeometry(0.03, 0.045, 0.06),
};
const PHONE_SCREEN = new THREE.MeshBasicMaterial({ color: 0xd8ecff, toneMapped: false });
let glowTex: THREE.CanvasTexture | null = null;

function phoneGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(210,235,255,0.9)');
  grad.addColorStop(0.35, 'rgba(150,200,255,0.35)');
  grad.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function phoneModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(SHAPES.phoneBody, PHONE_BODY);
  const screen = new THREE.Mesh(SHAPES.phoneScreen, PHONE_SCREEN);
  screen.position.z = 0.0052;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: phoneGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.8 }));
  glow.scale.set(0.46, 0.46, 1);
  glow.position.z = 0.03;
  g.add(body, screen, glow);
  g.position.copy(PHONE_AT);
  g.rotation.set(-0.65, 0.2, 0);
  return g;
}

export interface CharacterState {
  /** World velocity (m/s) and facing. */
  vx: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  crouched: boolean;
  sprinting: boolean;
  ads: boolean;
  reloading: boolean;
  /** Stabbing with the knife (V): the arms lunge forward. */
  stabbing: boolean;
  weapon: WeaponId;
  /** A chat is open on their phone: it is in their left hand. */
  phone: boolean;
}

/** Seconds a stab's lunge takes, out and back. */
const STAB_TIME = 0.45;

function nameTagTexture(name: string, accent: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 36px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 26);
  g.fillStyle = '#ffffff';
  g.fillText(name, 128, 26);
  const w = Math.min(220, g.measureText(name).width + 16);
  g.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
  g.fillRect(128 - w / 2, 50, w, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let flashTex: THREE.CanvasTexture | null = null;

function muzzleTexture(): THREE.CanvasTexture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.25)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

export class Character {
  readonly object = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly tag: THREE.Sprite;
  private bones: THREE.Bone[] = [];
  private flash: THREE.Sprite;
  private flashTime = 1;
  private phase = 0;
  private crouch = 0;
  private air = 0;
  private sprint = 0;
  private legYaw = 0;
  private reload = 0;
  private phoneK = 0;
  /** Seconds since the last stab began, and whether the last state said stabbing. */
  private stabT = STAB_TIME;
  private stabbing = false;
  private phone: THREE.Group;
  private suppressors: THREE.Mesh[] = [];
  private drum: THREE.Mesh;
  private redDot: THREE.Mesh;
  private silenced = false;
  private weapon: WeaponId = 'pistol';
  /** 0 alive, rising to 1 while falling over. */
  private death = 0;
  private dying = false;
  private fallDir = -1;
  private tmp = new THREE.Vector3();

  private name: string;
  /** Our partner in team mode: the name tag shows through walls. */
  private mate = false;

  constructor(
    name: string,
    private accent: number,
  ) {
    this.name = name;
    for (let i = 0; i < B.count; i++) {
      const b = new THREE.Bone();
      const o = OFFSET[i]!;
      b.position.set(o[0], o[1], o[2]);
      if (PARENT[i]! >= 0) this.bones[PARENT[i]!]!.add(b);
      this.bones.push(b);
    }
    this.mesh = new THREE.SkinnedMesh(characterGeometry(accent), MATERIAL);
    this.mesh.add(this.bones[0]!);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Generous fixed bounds instead of per-frame skinned bounds.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
    this.object.add(this.mesh);

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name, accent), depthWrite: false, transparent: true }));
    this.tag.center.set(0.5, 0);
    this.tag.renderOrder = 5;
    this.object.add(this.tag);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: muzzleTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.flash.visible = false;
    this.object.add(this.flash);
    this.phone = phoneModel();
    this.phone.visible = false;
    this.bones[B.aim]!.add(this.phone);
    // Upgrades others can see: a suppressor on each gun and the rifle's drum magazine.
    for (const [bone, w] of [
      [B.rifle, 'rifle'],
      [B.pistol, 'pistol'],
      [B.sniper, 'sniper'],
    ] as const) {
      const sup = new THREE.Mesh(w === 'pistol' ? SHAPES.suppressor.pistol : SHAPES.suppressor.long, ATTACHMENT);
      sup.position.copy(MUZZLE[w]).add(new THREE.Vector3(0, 0, -0.08));
      sup.visible = false;
      sup.castShadow = true;
      this.bones[bone]!.add(sup);
      this.suppressors.push(sup);
    }
    this.drum = new THREE.Mesh(SHAPES.drum, ATTACHMENT);
    this.drum.position.set(0, -0.12, -0.36);
    this.drum.visible = false;
    this.drum.castShadow = true;
    this.bones[B.rifle]!.add(this.drum);
    this.redDot = new THREE.Mesh(SHAPES.redDot, ATTACHMENT);
    this.redDot.position.set(0, 0.065, -0.3);
    this.redDot.visible = false;
    this.redDot.castShadow = true;
    this.bones[B.rifle]!.add(this.redDot);
    this.setWeapon('pistol');
  }

  /** Visible upgrades: suppressors (no flash either), the drum magazine and the red dot sight. */
  setUpgrades(u: Upgrades): void {
    this.silenced = (u.vaimennin ?? 0) > 0;
    for (const s of this.suppressors) s.visible = this.silenced;
    this.drum.visible = (u.rumpu ?? 0) > 0;
    this.redDot.visible = (u.punapiste ?? 0) > 0;
  }

  /** A new name, or a new colour (team mode dresses a pair alike: beret, bands and tag). */
  setLook(name: string, accent: number): void {
    if (name === this.name && accent === this.accent) return;
    if (accent !== this.accent) this.mesh.geometry = characterGeometry(accent);
    this.name = name;
    this.accent = accent;
    const m = this.tag.material;
    m.map?.dispose();
    m.map = nameTagTexture(name, accent);
    m.needsUpdate = true;
  }

  /** Team mode: our partner's tag shows through walls, so we can find each other. */
  setMate(mate: boolean): void {
    if (mate === this.mate) return;
    this.mate = mate;
    this.tag.material.depthTest = !mate;
    this.tag.renderOrder = mate ? 6 : 5;
  }

  private setWeapon(w: WeaponId): void {
    this.weapon = w;
    for (const id of Object.keys(GUN_BONE) as WeaponId[]) this.bones[GUN_BONE[id]]!.scale.setScalar(w === id ? 1 : 1e-4);
    const p = ARM_POSES[w];
    this.bones[B.armUR]!.quaternion.copy(p.ur);
    this.bones[B.armFR]!.quaternion.copy(p.fr);
    this.bones[B.armUL]!.quaternion.copy(p.ul);
    this.bones[B.armFL]!.quaternion.copy(p.fl);
  }

  /** Muzzle position in world space (call after update). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const bone = this.bones[GUN_BONE[this.weapon]]!;
    return out.copy(MUZZLE[this.weapon]).applyMatrix4(bone.matrixWorld);
  }

  /** Eye-level point in world space for line-of-sight checks. */
  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0.14, 0).applyMatrix4(this.bones[B.head]!.matrixWorld);
  }

  muzzleFlash(): void {
    if (this.silenced) return;
    this.flashTime = 0;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
  }

  /** Starts the fall; `fromFront` tips them backwards. */
  die(fromFront: boolean): void {
    if (this.dying) return;
    this.dying = true;
    this.fallDir = fromFront ? 1 : -1;
  }

  revive(): void {
    this.dying = false;
    this.death = 0;
  }

  get dead(): boolean {
    return this.dying;
  }

  update(dt: number, s: CharacterState): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon);
    const bn = this.bones;
    // Movement relative to facing.
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const vf = s.vx * fx + s.vz * fz;
    const vr = s.vx * -fz + s.vz * fx;
    const speed = Math.hypot(s.vx, s.vz);
    this.crouch = damp(this.crouch, s.crouched ? 1 : 0, 12, dt);
    this.air = damp(this.air, s.onGround ? 0 : 1, 10, dt);
    this.sprint = damp(this.sprint, s.sprinting ? 1 : 0, 8, dt);
    this.reload = damp(this.reload, s.reloading ? 1 : 0, 10, dt);
    this.phoneK = damp(this.phoneK, s.phone && !this.dying ? 1 : 0, 9, dt);
    if (s.stabbing && !this.stabbing) this.stabT = 0;
    this.stabbing = s.stabbing;
    this.stabT += dt;
    const lunge = this.stabT < STAB_TIME ? Math.sin((this.stabT / STAB_TIME) * Math.PI) : 0;

    // Legs turn towards the walking direction (back-pedalling keeps them facing forward).
    let angle = speed > 0.4 ? Math.atan2(vr, vf) : 0;
    let dirSign = 1;
    if (Math.abs(angle) > 1.9) {
      angle -= Math.sign(angle) * Math.PI;
      dirSign = -1;
    }
    this.legYaw = damp(this.legYaw, clamp(angle, -1.0, 1.0), 8, dt);
    const stride = s.sprinting ? 2.3 : s.crouched ? 1.1 : 1.6;
    if (s.onGround) this.phase += ((speed * dt) / stride) * Math.PI * 2 * dirSign;
    const swing = Math.min(1, speed / 3.5) * (0.5 + 0.25 * this.sprint) * (1 - this.air) * (1 - 0.45 * this.crouch);

    const c = this.crouch;
    bn[B.hips]!.position.y = HIP_STAND + (HIP_CROUCH - HIP_STAND) * c - Math.abs(Math.sin(this.phase)) * 0.03 * swing;
    bn[B.hips]!.rotation.set(0, -this.legYaw, 0);
    const sinP = Math.sin(this.phase);
    const cosP = Math.cos(this.phase);
    const thighBase = 1.3 * c + 0.55 * this.air;
    const shinBase = -2.3 * c - 1.0 * this.air;
    bn[B.thighR]!.rotation.set(thighBase + sinP * swing - 0.12 * c, 0, 0);
    bn[B.thighL]!.rotation.set(thighBase - sinP * swing + 0.12 * c, 0, 0);
    bn[B.shinR]!.rotation.set(shinBase - Math.max(0, cosP) * swing * 1.3 - 0.05, 0, 0);
    bn[B.shinL]!.rotation.set(shinBase - Math.max(0, -cosP) * swing * 1.3 - 0.05, 0, 0);

    // Upper body: counter the leg turn, lean into sprints and crouches, share the pitch.
    const lean = 0.5 * c + 0.28 * this.sprint;
    const pitch = clamp(s.pitch, -1.3, 1.3);
    bn[B.spine]!.rotation.set(-lean - 0.2 * lunge + pitch * 0.25, this.legYaw, 0, 'YXZ');
    bn[B.head]!.rotation.set(lean + pitch * 0.5 - 0.45 * this.phoneK, 0, 0);
    // Phone out: the left hand leaves the gun for the phone; the gun hangs a little lower.
    const arms = ARM_POSES[this.weapon];
    bn[B.armUL]!.quaternion.slerpQuaternions(arms.ul, PHONE_ARM.ul, this.phoneK);
    bn[B.armFL]!.quaternion.slerpQuaternions(arms.fl, PHONE_ARM.fl, this.phoneK);
    this.phone.visible = this.phoneK > 0.35;
    // Aim: full pitch; sprinting lowers the gun across the chest, reloading tips it.
    const aimPitch = pitch * 0.75 + lean;
    // Sprinting lowers the gun across the chest, but a phone stays up in front of the face.
    const sprint = this.sprint * (1 - 0.75 * this.phoneK);
    bn[B.aim]!.rotation.set(aimPitch * (1 - sprint) - 0.75 * sprint - 0.35 * this.reload - 0.22 * this.phoneK, 0.55 * sprint, 0.5 * this.reload, 'YXZ');
    if (s.ads) bn[B.aim]!.position.set(-0.04, 0.4 + 0.04, 0);
    else bn[B.aim]!.position.set(0, 0.4, 0);
    // A stab: the arms drive forward and a little down, and come back.
    bn[B.aim]!.position.z -= 0.28 * lunge;
    bn[B.aim]!.rotation.x -= 0.3 * lunge;

    // Death: knees buckle, then the body tips over around the feet.
    const root = bn[B.root]!;
    if (this.dying) {
      this.death = Math.min(1, this.death + dt / 0.55);
      const d = this.death * this.death;
      root.rotation.set(this.fallDir * d * 1.45, 0, 0);
      root.position.y = 0.12 * d;
      bn[B.hips]!.position.y -= 0.25 * Math.min(1, this.death * 2);
      bn[B.thighR]!.rotation.x += 0.6 * this.death;
      bn[B.shinR]!.rotation.x -= 0.9 * this.death;
      bn[B.aim]!.rotation.x -= 0.9 * this.death;
    } else {
      root.rotation.set(0, 0, 0);
      root.position.y = 0;
    }
    // (The renderer brings the whole rig's matrices up to date; only the flash needs the gun's now.)

    // Muzzle flash.
    this.flashTime += dt;
    const on = this.flashTime < 0.05;
    this.flash.visible = on;
    if (on) {
      this.bones[GUN_BONE[this.weapon]]!.updateWorldMatrix(true, false);
      this.muzzleWorld(this.tmp);
      this.object.worldToLocal(this.tmp);
      this.flash.position.copy(this.tmp);
      const sz = this.weapon === 'pistol' ? 0.3 : this.weapon === 'sniper' ? 0.55 : 0.42;
      this.flash.scale.setScalar(sz * (0.8 + Math.random() * 0.4));
    }
  }

  /** Name tag above the head, kept readable at distance; hidden when `show` is false. */
  updateTag(show: boolean, dist: number): void {
    this.tag.visible = show && !this.dying;
    if (!this.tag.visible) return;
    const k = clamp(dist * 0.028, 0.3, 1.6);
    this.tag.scale.set(k * 4 * 0.22, k * 0.22, 1);
    this.tag.position.set(0, (this.crouch > 0.5 ? 1.32 : 1.9) + 0.06 * k, 0);
    this.tag.material.opacity = clamp(1.4 - dist / 60, 0.35, 1);
  }

  dispose(): void {
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
    this.flash.material.dispose();
    (this.phone.children[2] as THREE.Sprite).material.dispose();
    this.mesh.skeleton.dispose();
  }
}
