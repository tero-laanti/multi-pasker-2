import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxAt, cylZ, extrudeSide, markingTexture, roundedProfile, weaponMaterials } from './common';
import { pistolHands, type HandsModel } from './hands';

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
}

const SIGHT_Y = 0.0195;

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
  steel.push(
    extrudeSide(
      roundedProfile([
        [0.0, -0.016, 0.003],
        [0.0, 0.012, 0.004],
        [-0.012, 0.016, 0.002],
        [-0.118, 0.016, 0.002],
        [-0.138, 0.0125, 0.003],
        [-0.142, -0.006, 0.002],
        [-0.13, -0.016, 0.002],
      ]),
      0.0112,
      0.0014,
    ),
  );
  // Barrel shroud and the slender barrel.
  steel.push(cylZ(0.0094, 0.0094, -0.128, -0.158, 0.0015, 0, 24));
  worn.push(cylZ(0.0101, 0.0101, -0.15, -0.158, 0.0015, 0, 24));
  steel.push(cylZ(0.0074, 0.007, -0.158, -0.236, 0.0015, 0, 22));
  worn.push(cylZ(0.0078, 0.0078, -0.229, -0.236, 0.0015, 0, 22));
  // Front sight ramp and blade, rear sight with a U-notch.
  steel.push(
    extrudeSide(
      [
        [-0.212, 0.0078],
        [-0.231, 0.0078],
        [-0.231, 0.0112],
        [-0.219, 0.0112],
      ],
      0.003,
      0.0004,
    ),
  );
  steel.push(boxAt(-0.0013, 0.0013, 0.011, SIGHT_Y, -0.229, -0.221));
  steel.push(boxAt(-0.0056, 0.0056, 0.0158, SIGHT_Y, -0.0135, -0.0045));
  steel.push(boxAt(-0.0056, -0.0019, SIGHT_Y, SIGHT_Y + 0.0024, -0.0135, -0.0045));
  steel.push(boxAt(0.0019, 0.0056, SIGHT_Y, SIGHT_Y + 0.0024, -0.0135, -0.0045));
  // Lower frame and the trigger guard loop.
  steel.push(
    extrudeSide(
      roundedProfile([
        [-0.126, -0.016],
        [-0.004, -0.016],
        [-0.002, -0.028, 0.004],
        [-0.046, -0.029, 0.003],
        [-0.06, -0.026],
        [-0.112, -0.026, 0.003],
      ]),
      0.0104,
      0.0012,
    ),
  );
  const guardOuter: [number, number, number?][] = [
    [-0.046, -0.028],
    [-0.05, -0.05, 0.012],
    [-0.106, -0.052, 0.016],
    [-0.112, -0.026],
  ];
  const guardInner: [number, number][] = roundedProfile([
    [-0.106, -0.0275],
    [-0.1005, -0.0465, 0.012],
    [-0.055, -0.0455, 0.009],
    [-0.0515, -0.0285],
  ]);
  {
    const shape = new THREE.Shape();
    roundedProfile(guardOuter).forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
    const hole = new THREE.Path();
    guardInner.forEach(([z, y], i) => (i === 0 ? hole.moveTo(-z, y) : hole.lineTo(-z, y)));
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0066, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0008, bevelSegments: 2 });
    g.translate(0, 0, -0.0033);
    g.rotateY(Math.PI / 2);
    steel.push(g);
  }
  // Grip frame (raked back like the L-35) under the panels.
  const gripProfile = roundedProfile([
    [-0.047, -0.027],
    [-0.04, -0.06, 0.02],
    [-0.012, -0.112, 0.006],
    [0.034, -0.109, 0.006],
    [0.03, -0.075, 0.03],
    [0.006, -0.03, 0.01],
    [0.004, -0.016],
  ]);
  steel.push(extrudeSide(gripProfile, 0.0128, 0.0015));
  // Bolt cocking piece with grip rings, movable for the rack.
  const boltGeo: THREE.BufferGeometry[] = [cylZ(0.0085, 0.0085, -0.004, 0.012, 0.004, 0, 22)];
  for (let i = 0; i < 4; i++) boltGeo.push(cylZ(0.0094, 0.0094, 0.0005 + i * 0.0029, 0.0019 + i * 0.0029, 0.004, 0, 22));
  boltGeo.push(cylZ(0.0062, 0.0062, 0.012, 0.0145, 0.004, 0, 18));
  const bolt = new THREE.Mesh(mergeGeometries(boltGeo)!, M.bluedWorn);
  root.add(bolt);
  // Ejection port (dark recess) on the right side.
  dark.push(boxAt(0.0108, 0.0114, 0.003, 0.013, -0.07, -0.04));
  // Takedown lever and safety on the left.
  worn.push(cylZ(0.0035, 0.0035, -0.104, -0.096, -0.004, -0.0122, 14).rotateZ(0));
  steel.push(boxAt(-0.0128, -0.0112, -0.012, -0.004, -0.02, 0.0));
  // Screws on the grip panels.
  for (const side of [-1, 1]) {
    const s = new THREE.CylinderGeometry(0.0028, 0.0028, 0.0012, 14);
    s.rotateZ(Math.PI / 2);
    s.translate(side * 0.0158, -0.067, 0.008);
    worn.push(s);
  }
  // Lanyard ring.
  {
    const t = new THREE.TorusGeometry(0.0055, 0.0011, 8, 18);
    t.rotateY(Math.PI / 2);
    t.translate(0, -0.106, 0.04);
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
  const panelProfile = roundedProfile([
    [-0.04, -0.034],
    [-0.035, -0.06, 0.016],
    [-0.012, -0.101, 0.005],
    [0.024, -0.099, 0.005],
    [0.022, -0.074, 0.02],
    [0.0, -0.034, 0.004],
  ]);
  for (const side of [-1, 1]) {
    const g = extrudeSide(panelProfile, 0.0018, 0.0008);
    g.translate(side * 0.0138, 0, 0);
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
  const trigger = new THREE.Mesh(
    extrudeSide(
      roundedProfile([
        [-0.072, -0.026],
        [-0.066, -0.026],
        [-0.069, -0.036, 0.004],
        [-0.075, -0.045, 0.002],
        [-0.078, -0.044],
        [-0.074, -0.036, 0.004],
      ]),
      0.0028,
      0.0006,
    ),
    M.bluedWorn,
  );
  root.add(trigger);

  // Magazine: base plate visible under the grip, body hidden inside until it slides out.
  const magAxis = new THREE.Vector3(0, -0.906, 0.423).normalize();
  const mag = new THREE.Group();
  const magBody = boxAt(-0.0105, 0.0105, -0.088, 0.0, -0.016, 0.016);
  magBody.rotateX(-Math.atan2(magAxis.z, -magAxis.y));
  const magBase = extrudeSide(
    roundedProfile([
      [-0.013, -0.111],
      [0.033, -0.108],
      [0.034, -0.116, 0.002],
      [-0.014, -0.119, 0.002],
    ]),
    0.0128,
    0.001,
  );
  const magMesh = new THREE.Mesh(magBody.translate(0, -0.024, 0.012), M.parkerized);
  mag.add(magMesh, new THREE.Mesh(magBase, M.bluedWorn));
  root.add(mag);

  // Serial plate on the right side of the receiver.
  const plateMat = new THREE.MeshStandardMaterial({ map: markingTexture(['SA', '000000']), transparent: true, metalness: 0.6, roughness: 0.45 });
  const serialPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.0125), plateMat);
  serialPlate.rotation.y = Math.PI / 2;
  serialPlate.position.set(0.01135, -0.006, -0.088);
  root.add(serialPlate);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.0015, -0.238);
  root.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.012, 0.009, -0.055);
  root.add(eject);

  const hands = pistolHands(
    { origin: [0, -0.03, -0.02], down: [0, -0.906, 0.423], fwd: [0, -0.423, -0.906] },
    [0.002, -0.04, -0.07],
  );
  root.add(hands.right, hands.left);

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
    rackOffset: new THREE.Vector3(0.03, 0.09, 0.035),
    setSerial(serial: string) {
      const old = plateMat.map;
      plateMat.map = markingTexture(['SA', serial]);
      plateMat.needsUpdate = true;
      old?.dispose();
    },
  };
}
