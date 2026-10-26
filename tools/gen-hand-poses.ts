/**
 * Solves the first-person hand poses (src/client/game/models/handSpecs.ts) against the weapon
 * shapes and writes the result to src/client/game/models/handPoses.json, so the game only
 * skins and bakes the hands at load time. Run after changing hand specs, weapon shapes or the
 * hand model:  npm run gen:hands
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeAllHands } from '../src/client/game/models/handBake';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const glb = fs.readFileSync(path.join(root, 'assets/models/generic-hand-right.glb'));
const t0 = performance.now();
const result = bakeAllHands(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), undefined, { solve: true });
const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
const out = path.join(root, 'src/client/game/models/handPoses.json');
// One pose per line keeps diffs readable.
const lines = Object.entries(result.solutions.poses).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v, round)}`);
fs.writeFileSync(out, `{\n  "hash": ${JSON.stringify(result.solutions.hash)},\n  "poses": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`Solved ${result.hands.length} hand poses in ${(performance.now() - t0).toFixed(0)} ms -> ${path.relative(root, out)} (inputs ${result.solutions.hash})`);
for (const h of result.hands) console.log(`  ${h.key.padEnd(16)} clearance ${(h.minClear * 1000).toFixed(2)} mm, ${h.tris} triangles`);
