import * as THREE from 'three';
import { FINGERS, chainNames, dualQuat, skinDq, type FingerName } from './handRig';
import { Field, GLOVE, mir, solveHand, v3, type HandPose, type HandSource, type Posed, type Poser, type SolvedPose, type V3 } from './handSolve';
import { loopSubdivide, neighbours, vertexNormals } from './meshOps';
import type { WeaponSdf } from './weaponShapes';

/**
 * Bakes a posed, gloved first-person hand (handSolve.ts poses it):
 *
 *  1. skin with dual quaternions, bend the wrist towards the forearm and extend a glove cuff,
 *  2. one step of Loop subdivision, glove thickness along the normals,
 *  3. press whatever still sits in the weapon back against its surface (soft contact) and check
 *     points across every nearby triangle too, so no part of the glove enters the weapon,
 *  4. bake ambient occlusion into vertex colours and add the sleeve.
 *
 * Everything ends up in the weapon's model space (left hands are mirrored back at the end).
 */

export interface BakedMesh {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
}

export interface BakeStats {
  /** Smallest distance from the glove to the weapon's distance field (metres). */
  minClear: number;
  tris: number;
  /** Glove breadth across the knuckles. */
  breadth: number;
  /** Middle finger's first segment, back to palm and side to side. */
  fingerDepth: number;
  fingerWidth: number;
  debug: Record<string, unknown>;
}

/** Gap kept between the glove and the weapon. */
const CLEAR = 0.0006;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Orthonormal basis (u, v) perpendicular to `a`. */
function basis(a: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const t = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(t, a).normalize();
  const v = new THREE.Vector3().crossVectors(a, u).normalize();
  return [u, v];
}

/**
 * Bakes one hand pose. `sdf` is what the hand must stay out of (the weapon, plus another hand
 * for `avoid`), `aoSdf` what shades it; `cached` skips solving the pose.
 */
export function bakeHand(src: HandSource, pose: HandPose, sdf: WeaponSdf, cached?: SolvedPose, aoSdf = sdf): { glove: BakedMesh; sleeve: BakedMesh; stats: BakeStats; solution: SolvedPose } {
  const tm: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => {
    const t1 = performance.now();
    tm[k] = Math.round(t1 - t0);
    t0 = t1;
  };
  const field = new Field(sdf, !!pose.left);
  const solved = solveHand(src, pose, field, cached);
  lap('solve');
  const { poser, posed, forearm, wristPos, forearmDir, debug } = solved;
  const rig = src.rig;
  const n = src.pos.length / 3;

  // Skin with the wrist blending into the forearm.
  const wr = new THREE.Vector3().setFromMatrixPosition(rig.rest[rig.index('wrist')]!);
  const mr = new THREE.Vector3().setFromMatrixPosition(rig.rest[rig.index('middle-finger-phalanx-proximal')]!);
  const restBack = wr.clone().sub(mr).normalize();
  const fw = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const u = (src.pos[v * 3]! - wr.x) * restBack.x + (src.pos[v * 3 + 1]! - wr.y) * restBack.y + (src.pos[v * 3 + 2]! - wr.z) * restBack.z;
    fw[v] = smoothstep(-0.012, 0.018, u);
  }
  const skinned = new Float32Array(src.pos.length);
  skinDq(src.pos, src.joints, src.weights, posed.skin, skinned, { dq: dualQuat(forearm), weight: fw });

  // Glove cuff: extend the wrist opening along the forearm, rounding it off.
  const ring = src.ring;
  const c0 = new THREE.Vector3();
  for (const v of ring) c0.add(new THREE.Vector3(skinned[v * 3], skinned[v * 3 + 1], skinned[v * 3 + 2]));
  c0.divideScalar(ring.length);
  const A = forearmDir.clone();
  const [bu, bv] = basis(A);
  const rel = ring.map((v) => new THREE.Vector3(skinned[v * 3]! - c0.x, skinned[v * 3 + 1]! - c0.y, skinned[v * 3 + 2]! - c0.z));
  const rad = rel.map((r) => Math.hypot(r.dot(bu), r.dot(bv)));
  const meanR = rad.reduce((s, r) => s + r, 0) / rad.length;
  const cuffSteps = [0.006, 0.014, 0.024, 0.036, 0.05, 0.066];
  const extraPos: number[] = [];
  const extraUv: number[] = [];
  const extraIdx: number[] = [];
  const m = ring.length;
  // Cylindrical UVs on the cuff at the model's own texel density (~0.35 m per UV unit).
  const UV_M = 0.35;
  let prev = ring.slice();
  cuffSteps.forEach((s, k) => {
    const t = (k + 1) / cuffSteps.length;
    const round = smoothstep(0, 0.7, t);
    const flare = 1 + 0.12 * smoothstep(0.2, 1, t);
    const cur: number[] = [];
    rel.forEach((r, i) => {
      const a = r.dot(bu);
      const b = r.dot(bv);
      const len = Math.hypot(a, b) || 1;
      const rr = (rad[i]! * (1 - round) + meanR * round) * flare;
      const p = c0.clone().addScaledVector(A, s).addScaledVector(bu, (a / len) * rr).addScaledVector(bv, (b / len) * rr);
      cur.push(n + extraPos.length / 3);
      extraPos.push(p.x, p.y, p.z);
      extraUv.push(((i / m) * 2 * Math.PI * meanR) / UV_M, s / UV_M);
    });
    for (let i = 0; i < m; i++) {
      const a0 = prev[i]!;
      const a1 = prev[(i + 1) % m]!;
      const b0 = cur[i]!;
      const b1 = cur[(i + 1) % m]!;
      // Boundary edges run a0 -> a1 in the hand's winding; continue the surface outward.
      extraIdx.push(a1, a0, b0, a1, b0, b1);
    }
    prev = cur;
  });
  const total = n + extraPos.length / 3;
  let pos: Float32Array = new Float32Array(total * 3);
  pos.set(skinned);
  pos.set(extraPos, n * 3);
  let idx: Uint32Array = new Uint32Array(src.idx.length + extraIdx.length);
  idx.set(src.idx);
  idx.set(extraIdx, src.idx.length);
  let uv: Float32Array = new Float32Array(total * 2);
  uv.set(src.uv);
  uv.set(extraUv, n * 2);
  // 1 on the cuff, 0 on the hand (carried through subdivision for the cuff's darker band).
  let cuff: Float32Array = new Float32Array(total);
  for (let v = n; v < total; v++) cuff[v] = 1;
  // Make the cuff's winding agree with the hand's (one quad against the outward direction).
  {
    const t = src.idx.length;
    const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    const pa = new THREE.Vector3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);
    const pb = new THREE.Vector3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    const pc = new THREE.Vector3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    const nn = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    const out = pa.clone().sub(c0);
    out.addScaledVector(A, -out.dot(A));
    if (nn.dot(out) < 0) for (let i = src.idx.length; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
  }
  // Weight of the middle finger's first segment, carried along to measure the finger.
  let midW: Float32Array = new Float32Array(total);
  {
    const jm = rig.index('middle-finger-phalanx-proximal');
    for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) if (src.joints[v * 4 + k] === jm) midW[v] = src.weights[v * 4 + k]!;
  }

  // Smooth limit surface.
  const sub = loopSubdivide(pos, idx, [
    { a: uv, size: 2 },
    { a: cuff, size: 1 },
    { a: midW, size: 1 },
  ]);
  pos = sub.pos;
  idx = sub.idx;
  uv = sub.attrs[0]!;
  cuff = sub.attrs[1]!;
  midW = sub.attrs[2]!;
  const nv = pos.length / 3;
  lap('skin+cuff+subdiv');

  // Glove thickness.
  let nrm = vertexNormals(pos, idx);
  for (let i = 0; i < pos.length; i++) pos[i]! += nrm[i]! * GLOVE;

  // Soft contact: skin that would sit inside the weapon is pressed back (like soft tissue) and
  // the press fades out over the neighbours.
  const nb = neighbours(idx, nv);
  const wrapP = pose.wrapAxis ? v3(mir(pose.wrapAxis.p, !!pose.left)) : null;
  const wrapD = pose.wrapAxis ? v3(mir(pose.wrapAxis.d, !!pose.left)).normalize() : null;
  const push = new Float32Array(nv * 3);
  const need = new Float32Array(nv);
  const pdir = new Float32Array(nv * 3);
  const march = (x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number) => {
    // Big steps while deep inside, 0.1 mm near the surface.
    for (let t = 0; t <= max; ) {
      const d = field.d(x + dx * t, y + dy * t, z + dz * t);
      if (d >= CLEAR) return t;
      t += Math.max(0.0001, Math.min(0.002, -d * 0.5));
    }
    return -1;
  };
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3]!;
    const y = pos[v * 3 + 1]!;
    const z = pos[v * 3 + 2]!;
    if (field.d(x, y, z) >= CLEAR) continue;
    // Inside a part the hand wraps round: out from its axis, so skin drapes round the grip
    // instead of through it. Anywhere else: whichever of back into the glove or straight out
    // of the weapon is shorter.
    const cands: V3[] = [];
    if (wrapP && wrapD && field.inWrapPart(x, y, z)) {
      const rx = x - wrapP.x;
      const ry = y - wrapP.y;
      const rz = z - wrapP.z;
      const a = rx * wrapD.x + ry * wrapD.y + rz * wrapD.z;
      const ox = rx - wrapD.x * a;
      const oy = ry - wrapD.y * a;
      const oz = rz - wrapD.z * a;
      const ol = Math.hypot(ox, oy, oz);
      if (ol > 1e-6) cands.push([ox / ol, oy / ol, oz / ol]);
    } else cands.push([-nrm[v * 3]!, -nrm[v * 3 + 1]!, -nrm[v * 3 + 2]!], field.grad(x, y, z));
    let dir: V3 = cands[0]!;
    let t = -1;
    for (const c of cands) {
      const tc = march(x, y, z, c[0], c[1], c[2], 0.03);
      if (tc >= 0 && (t < 0 || tc < t)) {
        t = tc;
        dir = c;
      }
    }
    if (t < 0) {
      dir = field.grad(x, y, z);
      t = march(x, y, z, dir[0], dir[1], dir[2], 0.03);
    }
    if (t < 0) continue;
    need[v] = t;
    pdir.set(dir, v * 3);
    push.set([dir[0] * t, dir[1] * t, dir[2] * t], v * 3);
  }
  for (let it = 0; it < 40; it++) {
    const nextPush = new Float32Array(push);
    for (let v = 0; v < nv; v++) {
      const list = nb[v]!;
      if (list.length === 0) continue;
      let ax = 0,
        ay = 0,
        az = 0;
      for (const u of list) {
        ax += push[u * 3]!;
        ay += push[u * 3 + 1]!;
        az += push[u * 3 + 2]!;
      }
      const k = 0.5 / list.length;
      nextPush[v * 3] = push[v * 3]! * 0.5 + ax * k;
      nextPush[v * 3 + 1] = push[v * 3 + 1]! * 0.5 + ay * k;
      nextPush[v * 3 + 2] = push[v * 3 + 2]! * 0.5 + az * k;
      // Never less than the press this vertex needs.
      if (need[v]! > 0) {
        const along = nextPush[v * 3]! * pdir[v * 3]! + nextPush[v * 3 + 1]! * pdir[v * 3 + 1]! + nextPush[v * 3 + 2]! * pdir[v * 3 + 2]!;
        if (along < need[v]!) for (let c = 0; c < 3; c++) nextPush[v * 3 + c]! += pdir[v * 3 + c]! * (need[v]! - along);
      }
    }
    push.set(nextPush);
  }
  debug.maxPress = +Math.max(0, ...need).toFixed(4);
  for (let i = 0; i < pos.length; i++) pos[i]! += push[i]!;
  lap('flatten');

  // Hard guarantee: anything still inside walks out along a fixed direction (the gradient
  // where it starts, else back into the glove), which cannot oscillate between parts. Then the
  // same for points across each triangle, so a thin edge cannot slip between vertices.
  const settle = () => {
    const n0 = vertexNormals(pos, idx);
    for (let v = 0; v < nv; v++) {
      const x = pos[v * 3]!;
      const y = pos[v * 3 + 1]!;
      const z = pos[v * 3 + 2]!;
      if (field.d(x, y, z) >= CLEAR) continue;
      const dirs: V3[] = [field.grad(x, y, z), [-n0[v * 3]!, -n0[v * 3 + 1]!, -n0[v * 3 + 2]!]];
      for (const dir of dirs) {
        let t = 0;
        while (t < 0.02 && field.d(x + dir[0] * t, y + dir[1] * t, z + dir[2] * t) < CLEAR) t += 0.0001;
        if (t < 0.02) {
          pos[v * 3] = x + dir[0] * t;
          pos[v * 3 + 1] = y + dir[1] * t;
          pos[v * 3 + 2] = z + dir[2] * t;
          break;
        }
      }
    }
  };
  settle();
  // Barycentric sample points inside each triangle, at most 1.5 mm apart.
  const grids = new Map<number, [number, number, number][]>();
  const baryGrid = (k: number) => {
    let g = grids.get(k);
    if (!g) {
      g = [];
      for (let i = 0; i <= k; i++) for (let j = 0; i + j <= k; j++) if (!(i === k || j === k || i + j === 0)) g.push([i / k, j / k, 1 - (i + j) / k]);
      grids.set(k, g);
    }
    return g;
  };
  const vd = new Float32Array(nv);
  const passes: number[] = [];
  for (let pass = 0; pass < 12; pass++) {
    let moved = 0;
    for (let v = 0; v < nv; v++) vd[v] = field.d(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3;
      const b = idx[t + 1]! * 3;
      const c = idx[t + 2]! * 3;
      const edge = Math.max(
        Math.hypot(pos[a]! - pos[b]!, pos[a + 1]! - pos[b + 1]!, pos[a + 2]! - pos[b + 2]!),
        Math.hypot(pos[b]! - pos[c]!, pos[b + 1]! - pos[c + 1]!, pos[b + 2]! - pos[c + 2]!),
        Math.hypot(pos[c]! - pos[a]!, pos[c + 1]! - pos[a + 1]!, pos[c + 2]! - pos[a + 2]!),
      );
      // Only triangles that could reach the weapon (no point of a triangle is further than its
      // longest edge from its nearest vertex).
      if (Math.min(vd[idx[t]!]!, vd[idx[t + 1]!]!, vd[idx[t + 2]!]!) > CLEAR + edge) continue;
      for (const [u, w, r] of baryGrid(Math.min(16, Math.max(4, Math.ceil(edge / 0.0015))))) {
        const qx = u * pos[a]! + w * pos[b]! + r * pos[c]!;
        const qy = u * pos[a + 1]! + w * pos[b + 1]! + r * pos[c + 1]!;
        const qz = u * pos[a + 2]! + w * pos[b + 2]! + r * pos[c + 2]!;
        const d = field.d(qx, qy, qz);
        if (d >= CLEAR * 0.75) continue;
        const g = field.grad(qx, qy, qz);
        const k = CLEAR * 1.5 - d;
        for (const o of [a, b, c]) for (let i = 0; i < 3; i++) pos[o + i]! += g[i]! * k;
        moved++;
        break;
      }
    }
    passes.push(moved);
    settle();
    if (!moved) break;
  }
  debug.settlePasses = passes;
  let minClear = Infinity;
  for (let v = 0; v < nv; v++) minClear = Math.min(minClear, field.d(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!));
  nrm = vertexNormals(pos, idx);
  lap('settle');

  // Ambient occlusion from the weapon and from the hand itself (bone capsules).
  const aoField = aoSdf === sdf ? field : new Field(aoSdf, !!pose.left);
  const caps = handCapsules(posed, poser);
  const col = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const px = pos[v * 3]!;
    const py = pos[v * 3 + 1]!;
    const pz = pos[v * 3 + 2]!;
    let occ = 0;
    let w = 1;
    for (let i = 1; i <= 5; i++) {
      const h = 0.0025 * i;
      const qx = px + nrm[v * 3]! * h;
      const qy = py + nrm[v * 3 + 1]! * h;
      const qz = pz + nrm[v * 3 + 2]! * h;
      const d = Math.min(aoField.d(qx, qy, qz), capsuleDist(caps, qx, qy, qz));
      occ += Math.max(0, h - d) * w;
      w *= 0.75;
    }
    const ao = Math.max(0.25, 1 - occ * 70);
    // The cuff band (knit and strap) is a shade darker than the leather.
    const band = 1 - 0.3 * smoothstep(0.15, 0.55, cuff[v]!);
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = ao * band;
  }
  lap('ao');
  const size = measureHand(pos, midW, posed, poser);
  debug.timing = tm;

  let glove: BakedMesh = { pos, nrm, uv, col, idx };
  let sleeve = sleeveMesh(wristPos, forearmDir, pose.sleeve);
  if (pose.left) {
    glove = mirrorMesh(glove);
    sleeve = mirrorMesh(sleeve);
  }
  return { glove, sleeve, stats: { minClear, tris: idx.length / 3, ...size, debug }, solution: solved.solution };
}

/**
 * Glove sizes: breadth across the knuckles (radial to ulnar side) and the thickness of the
 * middle finger's first segment (back to palm, and side to side).
 */
function measureHand(pos: Float32Array, midW: Float32Array, p: Posed, poser: Poser): { breadth: number; fingerDepth: number; fingerWidth: number } {
  const P = (n: string) => new THREE.Vector3().setFromMatrixPosition(p.joints[poser.j(n)]!);
  const a = P('index-finger-phalanx-proximal');
  const b = P('pinky-finger-phalanx-proximal');
  const w = P('wrist');
  const m = P('middle-finger-phalanx-proximal');
  const Lh = m.clone().sub(w).normalize();
  const N = b.clone().sub(a);
  N.addScaledVector(Lh, -N.dot(Lh)).normalize();
  let lo = Infinity;
  let hi = -Infinity;
  const q = new THREE.Vector3();
  const ab = b.clone().sub(a);
  for (let v = 0; v < pos.length / 3; v++) {
    q.set(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
    // Within 2.2 cm of the knuckle line.
    const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq()));
    if (q.distanceTo(a.clone().addScaledVector(ab, t)) > 0.022) continue;
    const s = q.clone().sub(a).dot(N);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  // Middle finger's first segment: section through its middle.
  const m0 = p.joints[poser.j('middle-finger-phalanx-proximal')]!;
  const m1 = P('middle-finger-phalanx-intermediate');
  const axis = m1.clone().sub(m).normalize();
  const e = m0.elements;
  const yAx = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  const xAx = new THREE.Vector3(e[0], e[1], e[2]).normalize();
  const mid = m.clone().lerp(m1, 0.5);
  let y0 = Infinity,
    y1 = -Infinity,
    x0 = Infinity,
    x1 = -Infinity;
  for (let v = 0; v < pos.length / 3; v++) {
    if (midW[v]! < 0.6) continue;
    q.set(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!).sub(mid);
    if (Math.abs(q.dot(axis)) > 0.004) continue;
    y0 = Math.min(y0, q.dot(yAx));
    y1 = Math.max(y1, q.dot(yAx));
    x0 = Math.min(x0, q.dot(xAx));
    x1 = Math.max(x1, q.dot(xAx));
  }
  return { breadth: +(hi - lo).toFixed(4), fingerDepth: +(y1 - y0).toFixed(4), fingerWidth: +(x1 - x0).toFixed(4) };
}

interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

/** Bones as capsules sitting inside the glove (for self-occlusion). */
function handCapsules(p: Posed, poser: Poser): Capsule[] {
  const P = (name: string) => new THREE.Vector3().setFromMatrixPosition(p.joints[poser.j(name)]!);
  const caps: Capsule[] = [];
  for (const f of [...FINGERS, 'thumb'] as FingerName[]) {
    const ch = chainNames(f);
    const radii = f === 'thumb' ? [0.011, 0.0085, 0.0075] : [0.0085, 0.0075, 0.0065, 0.006];
    for (let i = 1; i + 1 < ch.length; i++) caps.push({ a: P(ch[i]!), b: P(ch[i + 1]!), r: radii[i - 1] ?? 0.006 });
    if (f !== 'thumb') caps.push({ a: P(ch[0]!), b: P(ch[1]!), r: 0.009 });
  }
  return caps;
}

function capsuleDist(caps: Capsule[], x: number, y: number, z: number): number {
  let best = Infinity;
  for (const c of caps) {
    const bax = c.b.x - c.a.x;
    const bay = c.b.y - c.a.y;
    const baz = c.b.z - c.a.z;
    const pax = x - c.a.x;
    const pay = y - c.a.y;
    const paz = z - c.a.z;
    const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
    const d = Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t) - c.r;
    if (d < best) best = d;
  }
  // The capsules sit inside the glove: only other parts of the hand occlude.
  return best + 0.004;
}

function mirrorMesh(m: BakedMesh): BakedMesh {
  const pos = m.pos.slice();
  const nrm = m.nrm.slice();
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = -pos[i]!;
    nrm[i] = -nrm[i]!;
  }
  const idx = m.idx.slice();
  for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2]!, idx[t + 1]!];
  return { pos, nrm, uv: m.uv, col: m.col, idx };
}

/** Olive sleeve: a slightly flattened tube with a few soft folds, from the cuff towards the elbow. */
function sleeveMesh(wrist: THREE.Vector3, dir: THREE.Vector3, s: { start: number; length: number; radius: number }): BakedMesh {
  const [u, v] = basis(dir);
  const seg = 28;
  const rings = 14;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const along = s.start + s.length * t;
    const rad = s.radius * (1 + 0.35 * t);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const fold = 1 + 0.035 * Math.sin(a * 3 + t * 7) * Math.sin(t * 9 + 1) + 0.02 * Math.sin(a * 5 - t * 11);
      const hem = r === 0 ? 0.97 : 1;
      const x = Math.cos(a) * rad * fold * hem;
      const y = Math.sin(a) * rad * 0.9 * fold * hem;
      const p = wrist.clone().addScaledVector(dir, along).addScaledVector(u, x).addScaledVector(v, y);
      pos.push(p.x, p.y, p.z);
      uv.push((i / seg) * 6, t * 12);
      const ao = r === 0 ? 0.55 : r === 1 ? 0.85 : 1;
      col.push(ao, ao, ao);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings; r++)
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const P = Float32Array.from(pos);
  const I = Uint32Array.from(idx);
  // Make the winding face outward.
  const nrm0 = vertexNormals(P, I);
  const p0 = new THREE.Vector3(P[0], P[1], P[2]).sub(wrist.clone().addScaledVector(dir, s.start));
  if (p0.dot(new THREE.Vector3(nrm0[0], nrm0[1], nrm0[2])) < 0) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2]!, I[t + 1]!];
  return { pos: P, nrm: vertexNormals(P, I), uv: Float32Array.from(uv), col: Float32Array.from(col), idx: I };
}
