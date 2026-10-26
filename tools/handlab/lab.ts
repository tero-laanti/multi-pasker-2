/**
 * Hand lab (development only): bakes the first-person hands and shows them on their weapon (or
 * on a stand-in phone) under viewmodel-like lights. Open /tools/handlab/index.html?show=pistol
 * (or rifle, phone) on the dev server and drag to orbit. The scripted screenshot tool
 * (tools/e2e/shot.ts) drives it through window.__pasker: setup(), setupPhone(), view().
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPistol } from '../../src/client/game/models/pistol';
import { buildRifle } from '../../src/client/game/models/rifle';
import { bakeAllHands } from '../../src/client/game/models/handBake';
import type { HandKey } from '../../src/client/game/models/handSpecs';
import { HAND_MODEL_URL, buildPhoneHand, cacheHand } from '../../src/client/game/models/hands';
import { PHONE } from '../../src/client/game/models/weaponShapes';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
gl.setSize(window.innerWidth, window.innerHeight, false);
gl.outputColorSpace = THREE.SRGBColorSpace;
gl.toneMapping = THREE.ACESFilmicToneMapping;
gl.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6d7480);
const pmrem = new THREE.PMREMGenerator(gl);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xc4dcf2, 0x6b6a4c, 1.0));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xdce6ff, 0.55);
fill.position.set(-0.6, 0.5, 1);
scene.add(fill);
const cam = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.005, 10);
const stats: Record<string, unknown> = {};

async function bake(keys: HandKey[]): Promise<void> {
  const buf = await fetch(HAND_MODEL_URL).then((r) => r.arrayBuffer());
  const t0 = performance.now();
  const baked = bakeAllHands(buf, keys);
  stats.bakeMs = Math.round(performance.now() - t0);
  stats.fromCache = baked.fromCache;
  for (const h of baked.hands) {
    cacheHand(h.key, h.glove, h.sleeve);
    stats[h.key] = { minClear: h.minClear, tris: h.tris, breadth: h.breadth, fingerDepth: h.fingerDepth, debug: h.debug };
  }
}

/** A weapon with the given hands shown (they are baked first, so the weapon picks them up). */
async function setup(kind: 'pistol' | 'rifle', keys: HandKey[]): Promise<Record<string, unknown>> {
  await bake(keys);
  const m = kind === 'pistol' ? buildPistol() : buildRifle();
  for (const h of [m.hands.right, m.hands.left, m.hands.leftRack, m.hands.phone]) if (h) h.visible = keys.includes(h.name as HandKey);
  scene.add(m.root);
  return stats;
}

/** The phone hand with a stand-in phone (the game's phone mesh belongs to the viewmodel). */
async function setupPhone(): Promise<Record<string, unknown>> {
  await bake(['phone.left']);
  const group = buildPhoneHand();
  group.visible = true;
  const [w, h, t] = PHONE.size;
  const r = PHONE.corner;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w / 2, h / 2 - r);
  shape.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 8 }).translate(0, 0, -t / 2);
  const phone = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.35, metalness: 0.3 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.006, h - 0.012), new THREE.MeshBasicMaterial({ color: 0x5e8fb8 }));
  screen.position.z = t / 2 + 0.0002;
  (group.userData.phoneAnchor as THREE.Object3D).add(phone, screen);
  scene.add(group);
  return stats;
}

/** Orbit camera: yaw 0 looks from behind (+Z), 90 from the right. */
function view(yawDeg: number, pitchDeg: number, dist: number, target: [number, number, number] = [0, -0.04, -0.03], fov = 30): void {
  cam.fov = fov;
  cam.updateProjectionMatrix();
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const t = new THREE.Vector3(...target);
  cam.position.set(t.x + dist * Math.sin(y) * Math.cos(p), t.y + dist * Math.sin(p), t.z + dist * Math.cos(y) * Math.cos(p));
  cam.lookAt(t);
  gl.render(scene, cam);
}

(window as unknown as { __pasker: unknown }).__pasker = { game: {}, THREE, scene, cam, gl, view, setup, setupPhone, stats };

// Interactive use: ?show=pistol | rifle | phone
const show = new URLSearchParams(location.search).get('show');
if (show) {
  const ready =
    show === 'phone'
      ? setupPhone()
      : show === 'rifle'
        ? setup('rifle', ['rifle.right', 'rifle.left'])
        : setup('pistol', ['pistol.right']);
  void ready.then(() => {
    const target = show === 'phone' ? new THREE.Vector3(0, 0, 0) : show === 'rifle' ? new THREE.Vector3(0, -0.03, -0.18) : new THREE.Vector3(0, -0.05, -0.03);
    view(30, 15, show === 'rifle' ? 0.9 : 0.45, [target.x, target.y, target.z]);
    const controls = new OrbitControls(cam, canvas);
    controls.target.copy(target);
    controls.update();
    const loop = () => {
      requestAnimationFrame(loop);
      gl.render(scene, cam);
    };
    loop();
  });
}
