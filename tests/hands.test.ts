import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { bakeAllHands, type BakedHand } from '../src/client/game/models/handBake';
import type { HandKey } from '../src/client/game/models/handSpecs';
import { cacheHand } from '../src/client/game/models/hands';
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

const HAND_GLB = path.resolve(__dirname, '../assets/models/generic-hand-right.glb');

let hands: Map<HandKey, BakedHand>;
let pistol: WeaponModel;
let rifle: WeaponModel;
let bakeMs = 0;
let fromCache = false;

/** Weapon triangles without the hands and without flat decals (the serial plate). */
function weaponTris(m: WeaponModel) {
  const handGroups = new Set<THREE.Object3D>([m.hands.right, m.hands.left, m.hands.phone, ...(m.hands.leftRack ? [m.hands.leftRack] : [])]);
  return collectTriangles(m.root, (o) => handGroups.has(o) || ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'PlaneGeometry'));
}

beforeAll(async () => {
  stubCanvas();
  const buf = fs.readFileSync(HAND_GLB);
  const t0 = performance.now();
  const result = bakeAllHands(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  bakeMs = performance.now() - t0;
  fromCache = result.fromCache;
  const baked = result.hands;
  hands = new Map(baked.map((h) => [h.key, h]));
  for (const h of baked) cacheHand(h.key, h.glove, h.sleeve);
  const { buildPistol } = await import('../src/client/game/models/pistol');
  const { buildRifle } = await import('../src/client/game/models/rifle');
  pistol = buildPistol();
  rifle = buildRifle();
}, 120000);

describe('first-person hands', () => {
  it('uses up-to-date solved poses (otherwise run npm run gen:hands)', () => {
    expect(fromCache).toBe(true);
  });

  it('bakes every pose with a reasonable triangle budget', () => {
    console.log(`hands: baked ${hands.size} poses in ${bakeMs.toFixed(0)} ms (${fromCache ? 'cached poses' : 'solved'})`);
    for (const h of hands.values()) {
      const tris = h.glove.idx.length / 3 + h.sleeve.idx.length / 3;
      console.log(`  ${h.key.padEnd(16)} ${tris} triangles, breadth ${(h.breadth * 100).toFixed(1)} cm, finger ${(h.fingerDepth * 100).toFixed(1)} x ${(h.fingerWidth * 100).toFixed(1)} cm`);
      expect(tris).toBeLessThan(20000);
    }
  });

  it('has natural proportions (gloved hand ~9 cm across the knuckles, fingers ~2 cm thick)', () => {
    // Breadth of the open hand (the shooting grip is the least curled pose measured here).
    const open = hands.get('rifle.left')!;
    console.log(`  open hand breadth ${(open.breadth * 100).toFixed(1)} cm`);
    expect(open.breadth).toBeGreaterThan(0.085);
    expect(open.breadth).toBeLessThan(0.095);
    for (const h of hands.values()) {
      expect(h.fingerDepth).toBeGreaterThan(0.017);
      expect(h.fingerDepth).toBeLessThan(0.0215);
      expect(h.fingerWidth).toBeLessThan(0.0215);
    }
  });

  it('phone.left never enters the phone', () => {
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
    const phoneMesh = new THREE.Mesh(geo);
    const phoneTris = collectTriangles(phoneMesh);
    const c = clearance(collectTriangles(pistol.hands.phone), phoneTris, new TriGrid(phoneTris));
    console.log(`  ${'phone.left'.padEnd(16)} closest ${(c.minSigned * 1000).toFixed(2)} mm, ${c.inside} vertices inside, ${c.crossings} crossing triangles`);
    if (c.crossings) console.log('    crossings near', [...c.where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `[${k}] x${n}`).join('  '));
    expect(c.inside).toBe(0);
    expect(c.crossings).toBe(0);
    // The anchor sits at the phone's centre in the hand's own frame.
    expect(pistol.hands.phoneAnchor.parent).toBe(pistol.hands.phone);
    expect(pistol.hands.phoneAnchor.position.length()).toBe(0);
  }, 120000);

  it('pistol reload hands keep clear of the gun and of the right hand', () => {
    const m = pistol;
    // Magazine hand as shown when the fresh magazine seats (it rides with the magazine);
    // racking hand at rest and with the bolt fully back.
    const right = collectTriangles(m.hands.right);
    const rightGrid = new TriGrid(right);
    const results: string[] = [];
    for (const [name, group, dz] of [
      ['pistol.left', m.hands.left, 0],
      ['pistol.leftRack', m.hands.leftRack!, 0],
      ['pistol.leftRack', m.hands.leftRack!, m.boltTravel],
    ] as const) {
      group.position.set(0, 0, dz);
      m.bolt.position.z = dz;
      const hand = collectTriangles(group);
      const w = weaponTris(m);
      const gun = clearance(hand, w, new TriGrid(w));
      const other = clearance(hand, right, rightGrid, true);
      group.position.set(0, 0, 0);
      m.bolt.position.z = 0;
      results.push(`  ${name.padEnd(16)} ${dz ? 'bolt back ' : ''}gun: closest ${(gun.minSigned * 1000).toFixed(2)} mm, ${gun.inside} inside, ${gun.crossings} crossings; right hand: ${other.crossings} crossings`);
      expect(gun.inside).toBe(0);
      expect(gun.crossings).toBe(0);
      expect(other.crossings).toBe(0);
    }
    console.log(results.join('\n'));
  }, 120000);

  const cases: [HandKey, () => WeaponModel][] = [
    ['pistol.right', () => pistol],
    ['rifle.right', () => rifle],
    ['rifle.left', () => rifle],
  ];
  for (const [key, weapon] of cases) {
    it(`${key} never enters the weapon`, () => {
      const m = weapon();
      const w = weaponTris(m);
      const group = key === 'rifle.left' ? m.hands.left : m.hands.right;
      const c = clearance(collectTriangles(group), w, new TriGrid(w));
      console.log(`  ${key.padEnd(16)} closest ${(c.minSigned * 1000).toFixed(2)} mm at [${c.at.map((x) => x.toFixed(4)).join(', ')}], ${c.inside} vertices inside, ${c.crossings} crossing triangles`);
      if (c.crossings) console.log('    crossings near', [...c.where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `[${k}] x${n}`).join('  '));
      expect(c.inside).toBe(0);
      expect(c.crossings).toBe(0);
      expect(c.minSigned).toBeGreaterThanOrEqual(0);
    }, 120000);
  }
});
