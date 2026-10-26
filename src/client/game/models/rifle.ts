import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxAt, cylZ, extrudeSide, markingTexture, weaponMaterials } from './common';
import { buildHand, buildPhoneHand } from './hands';
import type { WeaponModel } from './pistol';
import { RIFLE, rifleMagProfile } from './weaponShapes';

const SIGHT_Y = 0.05;

/**
 * Rynnäkkökivääri, inspired by the Rk 62: milled AK-type receiver with the diopter rear sight
 * on the cover, bare gas tube over a ribbed lower handguard, hooded front post at the muzzle,
 * three-prong flash hider, open "winter" trigger guard and a curved steel magazine. The tubular
 * stock is out of view in first person and not modelled.
 */
export function buildRifle(): WeaponModel {
  const M = weaponMaterials();
  const root = new THREE.Group();
  root.name = 'rynnakkokivaari';
  const steel: THREE.BufferGeometry[] = [];
  const worn: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const poly: THREE.BufferGeometry[] = [];

  // Receiver body and the top cover.
  steel.push(extrudeSide(RIFLE.receiver, 0.0152, 0.0012));
  worn.push(extrudeSide(RIFLE.cover, 0.0138, 0.0012));
  // Diopter rear sight: base, aperture ring and the two protective ears.
  steel.push(boxAt(-0.009, 0.009, 0.026, 0.036, 0.004, 0.03));
  {
    const ring = new THREE.TorusGeometry(0.0042, 0.0017, 10, 22);
    ring.translate(0, SIGHT_Y, 0.016);
    steel.push(ring);
    const stem = boxAt(-0.0022, 0.0022, 0.034, SIGHT_Y - 0.004, 0.013, 0.019);
    steel.push(stem);
    for (const sx of [-1, 1]) steel.push(boxAt(sx * 0.0065, sx * 0.0095, 0.03, SIGHT_Y + 0.006, 0.006, 0.026));
  }
  // Barrel, gas block, gas tube.
  steel.push(cylZ(0.0108, 0.0098, -0.215, -0.66, 0, 0, 22));
  steel.push(boxAt(-0.012, 0.012, -0.016, 0.04, -0.43, -0.462));
  worn.push(cylZ(0.0108, 0.0108, -0.205, -0.432, 0.028, 0, 20));
  // Front sight base with hood and post at the muzzle.
  steel.push(boxAt(-0.009, 0.009, -0.006, 0.031, -0.635, -0.668));
  {
    const hood = new THREE.CylinderGeometry(0.0115, 0.0115, 0.02, 20, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
    hood.rotateX(Math.PI / 2);
    hood.translate(0, 0.041, -0.652);
    steel.push(hood);
    steel.push(boxAt(-0.0012, 0.0012, 0.031, SIGHT_Y, -0.648, -0.656));
  }
  // Three-prong flash hider.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    steel.push(cylZ(0.0024, 0.002, -0.668, -0.712, Math.sin(a) * 0.0085, Math.cos(a) * 0.0085, 8));
  }
  steel.push(cylZ(0.0112, 0.0112, -0.665, -0.676, 0, 0, 20));
  dark.push(cylZ(0.0044, 0.0044, -0.675, -0.677, 0, 0, 14));
  // Lower handguard with ribs and cooling slots.
  poly.push(extrudeSide(RIFLE.handguard, RIFLE.handguardHalfWidth, 0.0025));
  for (let i = 0; i < 5; i++) {
    const z = -0.255 - i * 0.034;
    for (const sx of [-1, 1]) dark.push(boxAt(sx * 0.0214, sx * 0.0222, -0.017, -0.004, z - 0.011, z));
  }
  // Pistol grip.
  poly.push(extrudeSide(RIFLE.grip, RIFLE.gripHalfWidth, 0.0022));
  // Open-front "winter" trigger guard: a bar from behind the trigger, under it and forwards.
  steel.push(extrudeSide(RIFLE.guard, 0.0042, 0.0008));
  // Selector lever and charging handle on the right.
  worn.push(extrudeSide(RIFLE.selector, 0.0009, 0.0004).translate(0.0162, 0, 0));

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, mat);
    root.add(mesh);
    return mesh;
  };
  add(steel, M.blued);
  add(worn, M.bluedWorn);
  add(dark, M.bore);
  add(poly, M.polymer);

  // Bolt carrier with the charging handle (racks back).
  const boltGeo: THREE.BufferGeometry[] = [boxAt(0.0148, 0.0166, -0.005, 0.01, -0.06, -0.16), cylZ(0.0035, 0.0035, -0.135, -0.135, 0.004, 0.0165, 10)];
  {
    const handle = new THREE.CylinderGeometry(0.0034, 0.0034, 0.022, 12);
    handle.rotateZ(Math.PI / 2);
    handle.translate(0.027, 0.004, -0.136);
    boltGeo.push(handle);
    const knob = new THREE.SphereGeometry(0.0055, 12, 8);
    knob.translate(0.039, 0.004, -0.136);
    boltGeo.push(knob);
  }
  const bolt = new THREE.Mesh(mergeGeometries(boltGeo.map((g) => (g.index ? g.toNonIndexed() : g)))!, M.bluedWorn);
  root.add(bolt);

  // Curved 30-round magazine; pivots at the front of the magwell when rocked out.
  const magPivot = new THREE.Vector3(...RIFLE.magPivot);
  const magGeo = extrudeSide(rifleMagProfile(), 0.0115, 0.0012, 2);
  magGeo.translate(-magPivot.x, -magPivot.y, -magPivot.z);
  const mag = new THREE.Group();
  mag.add(new THREE.Mesh(magGeo, M.parkerized));
  mag.position.copy(magPivot);
  root.add(mag);
  const magAxis = new THREE.Vector3(0, -0.95, -0.3).normalize();

  // Serial plate on the left side of the receiver.
  const plateMat = new THREE.MeshStandardMaterial({ map: markingTexture(['SA', '000000']), transparent: true, metalness: 0.6, roughness: 0.45 });
  const serialPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.014), plateMat);
  serialPlate.rotation.y = -Math.PI / 2;
  serialPlate.position.set(-0.01535, -0.012, -0.06);
  root.add(serialPlate);

  // Trigger (the right index finger rests on it).
  const trigger = new THREE.Mesh(extrudeSide(RIFLE.trigger, 0.0028, 0.0006), M.bluedWorn);
  root.add(trigger);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.714);
  root.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.017, 0.006, -0.1);
  root.add(eject);

  // Hands: right on the pistol grip, left under the handguard (or holding the phone).
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
    sightY: SIGHT_Y,
    sightZ: 0.016,
    magAxis,
    serialPlate,
    hands: { right, left, phone, phoneAnchor: phone.userData.phoneAnchor as THREE.Object3D },
    rackOffset: new THREE.Vector3(0.05, 0.035, 0.19),
    magPivot,
    magRock: 0.4,
    magHandOffset: new THREE.Vector3(0.02, -0.075, 0.182),
    boltTravel: 0.085,
    inspectPose: { x: -0.06, y: 0.09, z: 0.11, pitch: 0.16, yaw: 1.0, roll: -0.35 },
    casingScale: [1.15, 2.05, 1.15],
    supportHandAtRest: true,
    reloadLift: { x: -0.05, y: 0.07, z: 0.0, roll: -0.75, pitch: -0.2, yaw: 0.55 },
    setSerial(serial: string) {
      const old = plateMat.map;
      plateMat.map = markingTexture(['SA', serial]);
      plateMat.needsUpdate = true;
      old?.dispose();
    },
  };
}
