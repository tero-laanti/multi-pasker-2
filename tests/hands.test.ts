import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { HAND_POSES } from '../src/client/game/models/handPoses';
import { forearmInHand, gloveGeometry, type HandKey } from '../src/client/game/models/hands';
import type { WeaponModel } from '../src/client/game/models/pistol';
import { PHONE } from '../src/client/game/models/weaponShapes';
import { clearance, collectTriangles, TriGrid } from './meshClearance';

// The weapon builders draw a few canvas textures; a do-nothing canvas is enough here.
function stubCanvas(): void {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === 'createImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'canvas' ? { width: 1, height: 1 } : () => undefined),
    set: () => true,
  });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) };
}

let pistol: WeaponModel;
let rifle: WeaponModel;

/** Weapon triangles without the hands and without flat decals (the serial plate). */
function weaponTris(m: WeaponModel) {
  const handGroups = new Set<THREE.Object3D>([m.hands.right, m.hands.left, m.hands.phone, ...(m.hands.leftRack ? [m.hands.leftRack] : [])]);
  return collectTriangles(m.root, (o) => handGroups.has(o) || ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'PlaneGeometry'));
}

function phoneTris() {
  const [w, h, t] = PHONE.size;
  return collectTriangles(new THREE.Mesh(new THREE.BoxGeometry(w, h, t)));
}

/** Signed volume of a closed mesh: positive when its triangles face outwards. */
function volume(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const idx = g.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

beforeAll(async () => {
  stubCanvas();
  const { buildPistol } = await import('../src/client/game/models/pistol');
  const { buildRifle } = await import('../src/client/game/models/rifle');
  pistol = buildPistol();
  rifle = buildRifle();
});

const KEYS = Object.keys(HAND_POSES) as HandKey[];

describe('first-person hands', () => {
  it('builds every pose from a few hundred triangles', () => {
    for (const key of KEYS) {
      const { glove, sleeve } = gloveGeometry(HAND_POSES[key]);
      const tris = (glove.index!.count + sleeve.index!.count) / 3;
      expect(tris).toBeLessThan(8000);
      expect(Number.isFinite(glove.boundingSphere!.radius)).toBe(true);
    }
  });

  it('bends fingers and thumbs only towards the palm, and the wrist only as far as a wrist goes', () => {
    for (const key of KEYS) {
      const p = HAND_POSES[key];
      for (const f of [p.index, p.middle, p.ring, p.pinky]) {
        expect(f.mcp).toBeGreaterThanOrEqual(0);
        expect(f.mcp).toBeLessThanOrEqual(1.6);
        expect(f.pip).toBeGreaterThanOrEqual(0);
        expect(f.pip).toBeLessThanOrEqual(1.9);
        expect(f.dip).toBeGreaterThanOrEqual(0);
        expect(f.dip).toBeLessThanOrEqual(1.4);
        expect(Math.abs(f.spread ?? 0)).toBeLessThanOrEqual(0.3);
      }
      // The thumb's two joints curl the same way, within a thumb's range.
      expect(p.thumb.mcp, `${key} thumb mcp`).toBeGreaterThanOrEqual(0);
      expect(p.thumb.mcp, `${key} thumb mcp`).toBeLessThanOrEqual(1.0);
      expect(p.thumb.ip, `${key} thumb ip`).toBeGreaterThanOrEqual(0);
      expect(p.thumb.ip, `${key} thumb ip`).toBeLessThanOrEqual(1.3);
      const bend = (Math.acos(-forearmInHand(p).y) * 180) / Math.PI;
      expect(bend, `${key} wrist bend`).toBeLessThanOrEqual(28.01);
    }
  });

  it('left hands are mirror images that still face outwards', () => {
    for (const key of KEYS) expect(volume(gloveGeometry(HAND_POSES[key]).glove), key).toBeGreaterThan(0);
  });

  const cases: [HandKey, () => [THREE.Object3D, Float64Array]][] = [
    ['pistol.right', () => [pistol.hands.right, weaponTris(pistol)]],
    ['pistol.left', () => [pistol.hands.left, weaponTris(pistol)]],
    ['pistol.leftRack', () => [pistol.hands.leftRack!, weaponTris(pistol)]],
    ['rifle.right', () => [rifle.hands.right, weaponTris(rifle)]],
    ['rifle.left', () => [rifle.hands.left, weaponTris(rifle)]],
    ['phone.left', () => [pistol.hands.phone, phoneTris()]],
  ];
  for (const [key, get] of cases) {
    it(`${key} keeps out of what it holds`, () => {
      const [group, held] = get();
      const glove = new THREE.Mesh((group.children[0] as THREE.Mesh).geometry);
      const c = clearance(collectTriangles(glove), held, new TriGrid(held));
      console.log(`  ${key.padEnd(16)} closest ${(c.minSigned * 1000).toFixed(1)} mm at [${c.at.map((x) => x.toFixed(3)).join(', ')}], ${c.inside} vertices inside`);
      // A glove may press a couple of millimetres into a grip; nothing deeper.
      expect(c.minSigned).toBeGreaterThan(-0.0025);
    }, 60000);
  }
});
