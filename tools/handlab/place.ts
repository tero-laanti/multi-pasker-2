/**
 * Hand placement helper (development only): places the rest-pose hand by an orientation and an
 * index-knuckle target and prints every joint's position and the deepest palm penetration per
 * bone, to reason about a new pose before solving it.
 *
 *   npx tsx tools/handlab/place.ts pistol "Lx,Ly,Lz" "Dx,Dy,Dz" "ix,iy,iz"
 *
 * L points from the wrist to the middle knuckle, D out of the back of the hand, i is the index
 * knuckle (MCP joint centre), all in the weapon's model space (metres).
 */
import fs from 'node:fs';
import * as THREE from 'three';
import { handSource } from '../../src/client/game/models/handSolve';
import { skinDq } from '../../src/client/game/models/handRig';
import { WeaponSdf, pistolParts, rifleParts } from '../../src/client/game/models/weaponShapes';

// usage: tsx place.ts pistol "Lx,Ly,Lz" "Dx,Dy,Dz" "ix,iy,iz"
const [weapon = 'pistol', Ls = '0,-0.12,-0.99', Ds = '1,0,0', Is = '0.03,-0.04,-0.02'] = process.argv.slice(2);
const vec = (s: string) => new THREE.Vector3(...(s.split(',').map(Number) as [number, number, number]));
const buf = fs.readFileSync('assets/models/generic-hand-right.glb');
const src = handSource(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const rig = src.rig;
const sdf = new WeaponSdf(weapon === 'pistol' ? pistolParts() : rifleParts());
const rp = (n: string) => new THREE.Vector3().setFromMatrixPosition(rig.rest[rig.index(n)]!);
const w0 = rp('wrist');
const Lr = rp('middle-finger-phalanx-proximal').sub(w0).normalize();
const Dr = new THREE.Vector3(1, 0, 0).addScaledVector(Lr, -Lr.x).normalize();
const La = vec(Ls).normalize();
const Da = vec(Ds);
Da.addScaledVector(La, -Da.dot(La)).normalize();
const mr = new THREE.Matrix4().makeBasis(Lr, Dr, Lr.clone().cross(Dr));
const ma = new THREE.Matrix4().makeBasis(La, Da, La.clone().cross(Da));
const R = ma.multiply(mr.transpose());
const idxRest = rp('index-finger-phalanx-proximal').applyMatrix4(R);
const t = vec(Is).sub(idxRest);
const M = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z).multiply(R);
const f = (v: THREE.Vector3) => [v.x, v.y, v.z].map((x) => x.toFixed(4).padStart(8)).join(' ');
console.log('N (ulnar) =', f(La.clone().cross(Da)));
for (const n of rig.names) {
  if (n.endsWith('-tip')) continue;
  const p = rp(n).applyMatrix4(M);
  console.log(n.padEnd(36), f(p), '  d', (sdf.d(p.x, p.y, p.z) * 1000).toFixed(1), 'mm');
}
// Skin rest pose with the placement and report the deepest vertex per owning joint.
const skin = rig.rest.map(() => M.clone());
const out = new Float32Array(src.pos.length);
skinDq(src.pos, src.joints, src.weights, skin, out);
const worst = new Map<string, [number, THREE.Vector3]>();
for (let v = 0; v < out.length / 3; v++) {
  const p = new THREE.Vector3(out[v * 3], out[v * 3 + 1], out[v * 3 + 2]);
  const d = sdf.d(p.x, p.y, p.z);
  const o = rig.names[src.owner[v]!]!;
  const w = worst.get(o);
  if (!w || d < w[0]) worst.set(o, [d, p]);
}
console.log('--- deepest vertex per bone (rest fingers) ---');
for (const [o, [d, p]] of [...worst.entries()].sort((a, b) => a[1][0] - b[1][0])) if (d < 0.004) console.log(o.padEnd(36), (d * 1000).toFixed(1).padStart(7), 'mm at', f(p));
