import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxAt, cylZ, extrudeSide, markingTexture, weaponMaterials } from './common';
import { buildHand, buildPhoneHand } from './hands';
import type { WeaponModel } from './pistol';
import { RIFLE } from './weaponShapes';

/** Height of the scope's axis above the bore: the ADS pose puts it on the view axis. */
const SCOPE_Y = 0.062;

/**
 * Tarkkuuskivääri, the Sotku's sniper rifle, after the TKIV 2000: a round bolt-action receiver
 * on a green-black synthetic stock, a long heavy barrel with a muzzle brake, a scope in two
 * rings and a five-round box magazine. The grip, guard and trigger are the rifle's, so both
 * hands keep the assault rifle's poses.
 */
export function buildSniper(): WeaponModel {
  const M = weaponMaterials();
  const root = new THREE.Group();
  root.name = 'tarkkuuskivaari';
  const steel: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];

  // Receiver, barrel and the muzzle brake.
  steel.push(cylZ(0.0145, 0.0145, 0.045, -0.205, 0, 0, 24));
  steel.push(boxAt(-0.0115, 0.0115, -0.03, -0.004, 0.035, -0.19));
  steel.push(cylZ(0.0128, 0.0104, -0.205, -0.8, 0, 0, 22));
  steel.push(cylZ(0.0158, 0.0158, -0.8, -0.85, 0, 0, 18));
  for (const z of [-0.812, -0.826, -0.84]) dark.push(boxAt(-0.0162, 0.0162, -0.004, 0.004, z, z - 0.006));
  dark.push(cylZ(0.0046, 0.0046, -0.849, -0.851, 0, 0, 14));
  // Synthetic stock: the forend under the barrel, and the part around the grip.
  poly.push(boxAt(-0.022, 0.022, -0.044, 0.002, -0.07, -0.5));
  poly.push(boxAt(-0.02, 0.02, -0.036, 0.006, 0.07, -0.07));
  poly.push(extrudeSide(RIFLE.grip, RIFLE.gripHalfWidth, 0.0022));
  steel.push(extrudeSide(RIFLE.guard, 0.0042, 0.0008));
  // The scope: tube, objective and eyepiece bells, turrets, and the two rings.
  dark.push(cylZ(0.0135, 0.0135, 0.07, -0.2, SCOPE_Y, 0, 24));
  dark.push(cylZ(0.0135, 0.0222, -0.2, -0.236, SCOPE_Y, 0, 24));
  dark.push(cylZ(0.0222, 0.0222, -0.236, -0.27, SCOPE_Y, 0, 24));
  dark.push(cylZ(0.0178, 0.0135, 0.112, 0.07, SCOPE_Y, 0, 24));
  {
    const top = new THREE.CylinderGeometry(0.0085, 0.0085, 0.016, 16);
    top.translate(0, SCOPE_Y + 0.019, -0.065);
    dark.push(top);
    const side = new THREE.CylinderGeometry(0.0085, 0.0085, 0.016, 16);
    side.rotateZ(Math.PI / 2);
    side.translate(0.019, SCOPE_Y, -0.065);
    dark.push(side);
  }
  for (const z of [0.004, -0.15]) {
    steel.push(boxAt(-0.0085, 0.0085, 0.012, SCOPE_Y - 0.008, z, z - 0.016));
    steel.push(cylZ(0.0158, 0.0158, z, z - 0.016, SCOPE_Y, 0, 20));
  }

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, mat);
    root.add(mesh);
    return mesh;
  };
  add(steel, M.blued);
  add(dark, M.dark);
  add(poly, M.polymer);
  // Lenses: the front one catches the light (others see the glint), the rear faces the eye.
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d3346, metalness: 0.9, roughness: 0.08, emissive: 0x0a141c });
  root.add(new THREE.Mesh(cylZ(0.0205, 0.0205, -0.268, -0.271, SCOPE_Y, 0, 24), glass));
  root.add(new THREE.Mesh(cylZ(0.016, 0.016, 0.11, 0.113, SCOPE_Y, 0, 24), glass));

  // The bolt handle on the right, worked after every shot (racks back).
  const boltGeo: THREE.BufferGeometry[] = [];
  {
    const arm = new THREE.CylinderGeometry(0.0038, 0.0038, 0.036, 12);
    arm.rotateZ(Math.PI / 2 + 0.35);
    arm.translate(0.031, -0.004, 0.024);
    boltGeo.push(arm);
    const knob = new THREE.SphereGeometry(0.0072, 14, 10);
    knob.translate(0.048, -0.011, 0.024);
    boltGeo.push(knob);
    boltGeo.push(cylZ(0.0062, 0.0062, 0.05, 0.035, 0, 0, 14));
  }
  const bolt = new THREE.Mesh(mergeGeometries(boltGeo.map((g) => (g.index ? g.toNonIndexed() : g)))!, M.bluedWorn);
  root.add(bolt);

  // Five-round box magazine; it drops straight down when changed.
  const magPivot = new THREE.Vector3(0, -0.03, -0.075);
  const magGeo = boxAt(-0.0118, 0.0118, -0.03, -0.072, -0.075, -0.13);
  magGeo.translate(-magPivot.x, -magPivot.y, -magPivot.z);
  const mag = new THREE.Group();
  mag.add(new THREE.Mesh(magGeo, M.parkerized));
  mag.position.copy(magPivot);
  root.add(mag);
  const magAxis = new THREE.Vector3(0, -1, 0);

  // Serial plate on the left of the receiver.
  const plateMat = new THREE.MeshStandardMaterial({ map: markingTexture(['SA', '000000']), transparent: true, metalness: 0.6, roughness: 0.45 });
  const serialPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.014), plateMat);
  serialPlate.rotation.y = -Math.PI / 2;
  serialPlate.position.set(-0.0147, -0.012, -0.1);
  root.add(serialPlate);

  const trigger = new THREE.Mesh(extrudeSide(RIFLE.trigger, 0.0028, 0.0006), M.bluedWorn);
  root.add(trigger);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.852);
  root.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.017, 0.008, -0.03);
  root.add(eject);

  const right = buildHand('rifle.right');
  const left = buildHand('rifle.left');
  const phone = buildPhoneHand();
  root.add(right, left, phone);

  return {
    root,
    bolt,
    mag,
    trigger,
    muzzle,
    eject,
    sightY: SCOPE_Y,
    sightZ: 0.112,
    magAxis,
    serialPlate,
    hands: { right, left, phone, phoneAnchor: phone.userData.phoneAnchor as THREE.Object3D, trigger: right.userData.trigger as THREE.Object3D | undefined },
    rackOffset: new THREE.Vector3(0.05, 0.02, 0.19),
    magPivot,
    magRock: 0,
    magHandOffset: new THREE.Vector3(0.02, -0.07, 0.11),
    boltTravel: 0.07,
    inspectPose: { x: -0.07, y: 0.09, z: 0.13, pitch: 0.14, yaw: 1.0, roll: -0.35 },
    casingScale: [1.35, 2.6, 1.35],
    supportHandAtRest: true,
    reloadLift: { x: -0.05, y: 0.07, z: 0.0, roll: -0.7, pitch: -0.2, yaw: 0.5 },
    setSerial(serial: string) {
      const old = plateMat.map;
      plateMat.map = markingTexture(['SA', serial]);
      plateMat.needsUpdate = true;
      old?.dispose();
    },
  };
}
