import * as THREE from 'three';
import { extrudeSide, weaponMaterials } from './common';
import { HAND_POSES } from './handPoses';
import { buildHand } from './hands';
import { roundedProfile, type Pt } from './weaponShapes';

/**
 * In view space for the stab, as a right hand's knife is seen in first person: the back of the
 * hand (the knuckles) up and turned to you, the fingers ahead, palm down; the blade then points
 * ahead and to the left and the forearm comes up from below on the right.
 */
const BACK_DIR = new THREE.Vector3(0.15, 0.95, 0.25);
const ALONG_DIR = new THREE.Vector3(-0.25, 0.1, -1);

/** Rotation basis from a first direction and the part of a second one square to it. */
function basis(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const e1 = a.clone().normalize();
  const e2 = b.clone().addScaledVector(e1, -b.dot(e1)).normalize();
  return new THREE.Matrix4().makeBasis(e1, e2, new THREE.Vector3().crossVectors(e1, e2));
}

/**
 * The knife (V), a puukko: a birch handle shaped and placed like the pistol's grip (so the
 * pistol hand closes round it), a steel bolster and a single-edged blade. Drawn in pistol
 * space with the blade up the handle's axis; `root` turns it so the blade points forward.
 */
export const KNIFE = {
  handle: roundedProfile([
    [-0.042, -0.022, 0.01],
    [-0.037, -0.06, 0.02],
    [-0.012, -0.11, 0.008],
    [0.031, -0.107, 0.008],
    [0.027, -0.074, 0.02],
    [0.004, -0.022, 0.01],
  ]),
  handleHalfWidth: 0.0135,
  /** Top of the handle (z, y) and the handle's axis towards the blade. */
  top: [-0.019, -0.022] as Pt,
  axis: [-0.313, 0.95] as Pt,
  bladeLength: 0.115,
};

/** (along the axis, across it towards the back) → (z, y) in pistol space. */
function onAxis(base: Pt, s: number, u: number): Pt {
  const [az, ay] = KNIFE.axis;
  // Across: the axis turned a quarter towards the back of the handle (+z).
  return [base[0] + az * s + ay * u, base[1] + ay * s - az * u];
}

export interface KnifeModel {
  root: THREE.Group;
  /** The gloved hand round the handle. */
  hand: THREE.Group;
  /** Knife without the hand (for clearance tests). */
  knife: THREE.Group;
}

let steel: THREE.MeshStandardMaterial | null = null;

export function buildKnife(): KnifeModel {
  const M = weaponMaterials();
  steel ??= new THREE.MeshStandardMaterial({ color: 0xc6cad0, metalness: 1, roughness: 0.24 });
  const knife = new THREE.Group();
  knife.add(new THREE.Mesh(extrudeSide(KNIFE.handle, KNIFE.handleHalfWidth, 0.003), M.wood));
  const bolster: Pt[] = [onAxis(KNIFE.top, 0, -0.024), onAxis(KNIFE.top, 0.006, -0.022), onAxis(KNIFE.top, 0.006, 0.02), onAxis(KNIFE.top, 0, 0.022)];
  knife.add(new THREE.Mesh(extrudeSide(bolster, 0.011, 0.0015), steel));
  const base = onAxis(KNIFE.top, 0.006, 0);
  const L = KNIFE.bladeLength;
  // Straight back, the edge sweeping up to a point near the back line.
  const blade: Pt[] = [
    onAxis(base, 0, -0.009),
    onAxis(base, L * 0.55, -0.0105),
    onAxis(base, L * 0.85, -0.006),
    onAxis(base, L, 0.004),
    onAxis(base, L * 0.8, 0.0085),
    onAxis(base, 0, 0.009),
  ];
  knife.add(new THREE.Mesh(extrudeSide(blade, 0.0016, 0.0006), steel));
  for (const m of knife.children) m.castShadow = false;

  const hand = buildHand('knife.right');
  const inner = new THREE.Group();
  inner.add(knife, hand);
  // Turn the back of the hand up and the fingers ahead.
  const pose = HAND_POSES['knife.right'];
  const turn = basis(BACK_DIR, ALONG_DIR).multiply(basis(new THREE.Vector3(...pose.back), new THREE.Vector3(...pose.along)).transpose());
  inner.quaternion.setFromRotationMatrix(turn);
  const root = new THREE.Group();
  root.name = 'knife';
  root.add(inner);
  root.visible = false;
  return { root, hand, knife };
}
