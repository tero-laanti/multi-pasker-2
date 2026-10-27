import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxAt, cylZ, extrudeSide, markingTexture, weaponMaterials } from './common';
import { buildHand, buildPhoneHand, type HandsModel } from './hands';
import { PISTOL } from './weaponShapes';

export interface WeaponModel {
  root: THREE.Group;
  /** Moves backwards when racked. */
  bolt: THREE.Object3D;
  /** Drops out and slides back in during reloads; local origin at its seated position. */
  mag: THREE.Object3D;
  trigger: THREE.Object3D;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  /** Rear sight notch in model space; the ADS pose puts it on the view axis. */
  sightY: number;
  sightZ: number;
  /** Direction the magazine slides out (model space, unit). */
  magAxis: THREE.Vector3;
  /** Side plate showing the SA stamp and serial number (shown during inspect). */
  serialPlate: THREE.Mesh;
  setSerial(serial: string): void;
  hands: HandsModel;
  /** Where the support hand grabs the bolt when racking (model space, relative to its rest pose). */
  rackOffset: THREE.Vector3;
  /** Magazine group origin (the point it rocks about). */
  magPivot: THREE.Vector3;
  /** How far the magazine rocks forward when removed (radians; AK-style magazines). */
  magRock: number;
  /** Where the support hand holds a fresh magazine, relative to its rest pose. */
  magHandOffset: THREE.Vector3;
  /** How far the bolt/charging handle travels back when racked. */
  boltTravel: number;
  /** Offsets at full inspect (camera-space metres and radians). */
  inspectPose: { x: number; y: number; z: number; pitch: number; yaw: number; roll: number };
  /** Ejected casing size relative to 9 mm brass (x, length, z). */
  casingScale: [number, number, number];
  /** True if the support hand holds the weapon at rest; otherwise it only appears for reloads. */
  supportHandAtRest: boolean;
  /** Extra pose during reloads (added on top of the shared reload curves). */
  reloadLift: { x: number; y: number; z: number; roll: number; pitch: number; yaw: number };
}

const SIGHT_Y = PISTOL.sightY;

/**
 * Pistooli, inspired by the Lahti L-35: long box receiver with the bolt's knurled cocking
 * piece at the rear, slender exposed barrel with a ramp front sight, Luger-like raked grip
 * with checkered panels, rounded trigger guard and a lanyard ring.
 */
export function buildPistol(): WeaponModel {
  const M = weaponMaterials();
  const root = new THREE.Group();
  root.name = 'pistooli';

  const steel: THREE.BufferGeometry[] = [];
  const worn: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  // Receiver: long box with a chamfered nose and a slightly raised top flat.
  steel.push(extrudeSide(PISTOL.receiver, 0.0112, 0.0014));
  // Barrel shroud and the slender barrel.
  steel.push(cylZ(0.0094, 0.0094, -0.128, -0.158, 0.0015, 0, 24));
  worn.push(cylZ(0.0101, 0.0101, -0.15, -0.158, 0.0015, 0, 24));
  steel.push(cylZ(0.0074, 0.007, -0.158, -0.236, 0.0015, 0, 22));
  worn.push(cylZ(0.0078, 0.0078, -0.229, -0.236, 0.0015, 0, 22));
  // Front sight ramp and blade, rear sight with a U-notch.
  steel.push(extrudeSide(PISTOL.frontSightRamp, 0.003, 0.0004));
  steel.push(boxAt(-0.0013, 0.0013, 0.011, SIGHT_Y, -0.229, -0.221));
  steel.push(boxAt(-0.0056, 0.0056, 0.0158, SIGHT_Y, -0.0135, -0.0045));
  steel.push(boxAt(-0.0056, -0.0019, SIGHT_Y, SIGHT_Y + 0.0024, -0.0135, -0.0045));
  steel.push(boxAt(0.0019, 0.0056, SIGHT_Y, SIGHT_Y + 0.0024, -0.0135, -0.0045));
  // Lower frame and the trigger guard loop.
  steel.push(extrudeSide(PISTOL.lowerFrame, 0.0104, 0.0012));
  {
    const shape = new THREE.Shape();
    PISTOL.guardOuter.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
    const hole = new THREE.Path();
    PISTOL.guardInner.forEach(([z, y], i) => (i === 0 ? hole.moveTo(-z, y) : hole.lineTo(-z, y)));
    shape.holes.push(hole);
    const G = PISTOL.guard;
    const g = new THREE.ExtrudeGeometry(shape, { depth: G.depth, bevelEnabled: true, bevelThickness: G.bevelThickness, bevelSize: G.bevelSize, bevelSegments: 2 });
    g.translate(0, 0, -G.depth / 2);
    g.rotateY(Math.PI / 2);
    steel.push(g);
  }
  // Grip frame (raked back like the L-35) under the panels.
  steel.push(extrudeSide(PISTOL.grip, PISTOL.gripHalfWidth, 0.0015));
  // Bolt cocking piece with grip rings, movable for the rack.
  const boltGeo: THREE.BufferGeometry[] = [cylZ(0.0085, 0.0085, -0.004, 0.012, 0.004, 0, 22)];
  for (let i = 0; i < 4; i++) boltGeo.push(cylZ(0.0094, 0.0094, 0.0005 + i * 0.0029, 0.0019 + i * 0.0029, 0.004, 0, 22));
  boltGeo.push(cylZ(0.0062, 0.0062, 0.012, 0.0145, 0.004, 0, 18));
  const bolt = new THREE.Mesh(mergeGeometries(boltGeo)!, M.bluedWorn);
  root.add(bolt);
  // Ejection port (dark recess) on the right side.
  dark.push(boxAt(0.0108, 0.0114, 0.003, 0.013, -0.07, -0.04));
  // Takedown lever and safety on the left (kept clear of the serial stamp).
  worn.push(cylZ(0.0035, 0.0035, -0.124, -0.116, -0.004, -0.0122, 14));
  steel.push(boxAt(-0.0128, -0.0112, -0.012, -0.004, -0.02, 0.0));
  // Screws on the grip panels.
  for (const side of [-1, 1]) {
    const sc = PISTOL.screw;
    const s = new THREE.CylinderGeometry(sc.r, sc.r, sc.len, 14);
    s.rotateZ(Math.PI / 2);
    s.translate(side * sc.x, sc.y, sc.z);
    worn.push(s);
  }
  // Lanyard ring.
  {
    const l = PISTOL.lanyard;
    const t = new THREE.TorusGeometry(l.R, l.r, 8, 18);
    t.rotateY(Math.PI / 2);
    t.translate(...l.c);
    worn.push(t);
  }
  // Bore.
  dark.push(cylZ(0.0046, 0.0046, -0.2365, -0.2355, 0.0015, 0, 16));

  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!, mat);
    root.add(mesh);
    return mesh;
  };
  add(steel, M.blued);
  add(worn, M.bluedWorn);
  add(dark, M.bore);

  // Checkered grip panels, slightly proud of the frame.
  for (const side of [-1, 1]) {
    const g = extrudeSide(PISTOL.panel, PISTOL.panelHalfWidth, 0.0008);
    g.translate(side * PISTOL.panelX, 0, 0);
    // Planar UVs across the side for the checkering.
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getZ(i) * 18;
      uv[i * 2 + 1] = pos.getY(i) * 18;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    root.add(new THREE.Mesh(g, M.gripChecker));
  }

  // Trigger.
  const trigger = new THREE.Mesh(extrudeSide(PISTOL.trigger, 0.0028, 0.0006), M.bluedWorn);
  root.add(trigger);

  // Magazine: base plate visible under the grip, body hidden inside until it slides out.
  const magAxis = new THREE.Vector3(0, -0.906, 0.423).normalize();
  const mag = new THREE.Group();
  const magBody = extrudeSide(PISTOL.magBody, PISTOL.magHalfWidth, 0);
  const magBase = extrudeSide(PISTOL.magBase, 0.0128, 0.001);
  const magMesh = new THREE.Mesh(magBody, M.parkerized);
  mag.add(magMesh, new THREE.Mesh(magBase, M.bluedWorn));
  root.add(mag);

  // Serial plate on the right side of the receiver.
  const plateMat = new THREE.MeshStandardMaterial({ map: markingTexture(['SA', '000000']), transparent: true, metalness: 0.6, roughness: 0.45 });
  const serialPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.0125), plateMat);
  serialPlate.rotation.y = -Math.PI / 2;
  serialPlate.position.set(-0.01135, -0.004, -0.085);
  root.add(serialPlate);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.0015, -0.238);
  root.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.012, 0.009, -0.055);
  root.add(eject);

  // One-handed hold: the left hand only appears to bring a fresh magazine (posed on the
  // seated magazine) and to rack the bolt (posed pinching the cocking piece).
  const phone = buildPhoneHand();
  const right = buildHand('pistol.right');
  const hands = { right, left: buildHand('pistol.left'), leftRack: buildHand('pistol.leftRack'), phone, phoneAnchor: phone.userData.phoneAnchor as THREE.Object3D, trigger: right.userData.trigger as THREE.Object3D | undefined };
  hands.left.visible = false;
  hands.leftRack.visible = false;
  root.add(hands.right, hands.left, hands.leftRack, hands.phone);

  for (const o of root.children) o.traverse((c) => ((c as THREE.Mesh).castShadow = false));

  return {
    root,
    bolt,
    mag,
    trigger,
    muzzle,
    eject,
    sightY: SIGHT_Y,
    sightZ: -0.009,
    magAxis,
    serialPlate,
    hands,
    rackOffset: new THREE.Vector3(0, 0, 0),
    magPivot: new THREE.Vector3(0, 0, 0),
    magRock: 0,
    magHandOffset: new THREE.Vector3(0, 0, 0),
    boltTravel: 0.026,
    // Turned muzzle-left so the left side (stamp and serial) faces the eye, close to the face.
    inspectPose: { x: -0.1, y: 0.085, z: 0.15, pitch: 0.1, yaw: 1.45, roll: 0.12 },
    casingScale: [1, 1, 1],
    supportHandAtRest: false,
    reloadLift: { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
    setSerial(serial: string) {
      const old = plateMat.map;
      plateMat.map = markingTexture(['SA', serial]);
      plateMat.needsUpdate = true;
      old?.dispose();
    },
  };
}
