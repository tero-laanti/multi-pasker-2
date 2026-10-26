import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropDef } from '../../shared/map/types';
import { makeRng } from '../../shared/math';
import { signTexture } from './textures';

/** Render-only decorations: instanced trees and bushes, signs, barrels, the flagpole and fences. */

function colored(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  const r = makeRng(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) {
      cols[(i + j) * 3] = c.r * k;
      cols[(i + j) * 3 + 1] = c.g * k;
      cols[(i + j) * 3 + 2] = c.b * k;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  return geo;
}

function spruceGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colored(new THREE.CylinderGeometry(0.09, 0.16, 2.2, 7).translate(0, 1.1, 0), 0x4a3526, 0.2, 2));
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = 2.1 * (1 - t) + 0.35;
    const h = 2.6 - t * 0.9;
    const y = 1.3 + i * 1.45;
    parts.push(colored(new THREE.ConeGeometry(r, h, 9, 1, true).translate(0, y + h / 2, 0), i % 2 ? 0x2a4a2c : 0x2f5230, 0.25, 10 + i));
  }
  parts.push(colored(new THREE.ConeGeometry(0.45, 1.4, 7).translate(0, 1.3 + tiers * 1.45 + 0.4, 0), 0x2f5230, 0.2, 30));
  return mergeGeometries(parts)!;
}

function pineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colored(new THREE.CylinderGeometry(0.12, 0.22, 9, 7).translate(0, 4.5, 0), 0x8a5a3a, 0.25, 3));
  const r = makeRng(5);
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(1.4 + r() * 0.8, 0);
    g.scale(1.3, 0.62, 1.3);
    g.translate((r() - 0.5) * 2.2, 8.4 + r() * 2.2, (r() - 0.5) * 2.2);
    parts.push(colored(g, 0x355a2f, 0.3, 40 + i));
  }
  return mergeGeometries(parts)!;
}

function birchGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 6.5, 8, 8).translate(0, 3.25, 0).toNonIndexed();
  const n = trunk.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  const rr = makeRng(7);
  const bands = Array.from({ length: 16 }, () => ({ y: rr() * 6.4, h: 0.04 + rr() * 0.12 }));
  const pos = trunk.getAttribute('position');
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const dark = bands.some((b) => Math.abs(y - b.y) < b.h) || y < 0.5;
    const k = dark ? 0.22 : 0.92;
    cols[i * 3] = k;
    cols[i * 3 + 1] = k * 0.98;
    cols[i * 3 + 2] = k * 0.94;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  trunk.deleteAttribute('uv');
  parts.push(trunk);
  const r = makeRng(8);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.IcosahedronGeometry(1.0 + r() * 0.6, 1);
    g.translate((r() - 0.5) * 1.8, 4.6 + r() * 2.6, (r() - 0.5) * 1.8);
    parts.push(colored(g, 0x6f9a3e, 0.3, 60 + i));
  }
  return mergeGeometries(parts)!;
}

function bushGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = makeRng(9);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(0.6 + r() * 0.4, 1);
    g.translate((r() - 0.5) * 1.2, 0.45 + r() * 0.3, (r() - 0.5) * 1.2);
    parts.push(colored(g, 0x4c7034, 0.3, 80 + i));
  }
  return mergeGeometries(parts)!;
}

const FOLIAGE = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

function instanced(geo: THREE.BufferGeometry, list: PropDef[], density: number): THREE.InstancedMesh | null {
  const keep = list.filter((d, i) => d.solid || (i * 0.618034) % 1 < density);
  if (keep.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, FOLIAGE, keep.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  const r = makeRng(keep.length);
  keep.forEach((d, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw ?? 0);
    const k = d.scale ?? 1;
    s.set(k, k * (0.9 + r() * 0.25), k);
    p.set(d.x, d.y - 0.05, d.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    tint.setScalar(0.85 + r() * 0.3);
    mesh.setColorAt(i, tint);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function finnishFlag(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 180;
  c.height = 110;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 180, 110);
  g.fillStyle = '#003580';
  g.fillRect(50, 0, 30, 110);
  g.fillRect(0, 40, 180, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chainLink(): THREE.CanvasTexture {
  // Wire about a quarter of the area: crisp diamonds up close, a light haze from afar.
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(170,175,170,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(32, 32);
  g.moveTo(32, 0);
  g.lineTo(0, 32);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boomStripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#f2f2ee' : '#c8211c';
    g.fillRect(i * 32, 0, 32, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface PropsView {
  group: THREE.Group;
  update(time: number): void;
  /** Raises or lowers the gate boom (the outer ring is open while it is up). */
  setGate?(open: boolean): void;
}

export function buildProps(props: PropDef[], density: number): PropsView {
  const group = new THREE.Group();
  group.name = 'props';
  const byKind = (k: PropDef['kind']) => props.filter((p) => p.kind === k);
  for (const [kind, geo] of [
    ['spruce', spruceGeometry()],
    ['pine', pineGeometry()],
    ['birch', birchGeometry()],
    ['bush', bushGeometry()],
  ] as const) {
    const mesh = instanced(geo, byKind(kind), kind === 'bush' ? Math.min(1, density + 0.2) : density);
    if (mesh) group.add(mesh);
  }

  const boardMat = new THREE.MeshStandardMaterial({ color: 0x2c3b2c, roughness: 0.8 });
  for (const s of byKind('sign')) {
    const w = s.size ?? 1;
    const h = w * 0.32;
    const sign = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), boardMat);
    sign.add(board);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.98, h * 0.96),
      new THREE.MeshStandardMaterial({ map: signTexture(s.text ?? ''), roughness: 0.7 }),
    );
    face.position.z = 0.021;
    sign.add(face);
    sign.position.set(s.x, s.y, s.z);
    sign.rotation.y = s.yaw ?? 0;
    board.castShadow = true;
    if (s.y < 1.5) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, s.y, 0.07), new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.9 }));
      post.position.set(0, -s.y / 2, -0.04);
      post.castShadow = true;
      sign.add(post);
    }
    group.add(sign);
  }

  const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3f5a3c, roughness: 0.6, metalness: 0.35 });
  const ringGeo = new THREE.TorusGeometry(0.302, 0.012, 4, 20);
  for (const b of byKind('barrel')) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(barrelGeo, barrelMat);
    body.position.y = 0.45;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    for (const y of [0.3, 0.6]) {
      const ring = new THREE.Mesh(ringGeo, barrelMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    }
    g.position.set(b.x, b.y, b.z);
    group.add(g);
  }

  let flag: THREE.Mesh | null = null;
  let flagBase: Float32Array | null = null;
  for (const f of byKind('flagpole')) {
    const h = f.size ?? 9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, h, 10), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }));
    pole.position.set(f.x, f.y + h / 2, f.z);
    pole.castShadow = true;
    group.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8c27a, metalness: 0.6, roughness: 0.3 }));
    knob.position.set(f.x, f.y + h + 0.06, f.z);
    group.add(knob);
    const geo = new THREE.PlaneGeometry(1.8, 1.1, 16, 8);
    geo.translate(0.9 + 0.06, 0, 0);
    flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: finnishFlag(), side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(f.x, f.y + h - 0.65, f.z);
    flag.rotation.y = 0.6;
    flag.castShadow = true;
    flagBase = (geo.getAttribute('position').array as Float32Array).slice();
    group.add(flag);
  }

  const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 2, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7c827c, metalness: 0.6, roughness: 0.4 });
  for (const w of byKind('wire')) {
    const len = w.size ?? 20;
    const fence = new THREE.Group();
    const tex = chainLink();
    tex.repeat.set(len / 0.12, 1.8 / 0.12);
    // Blended, not alpha-tested: far away the thin wires average into a faint grey haze
    // instead of vanishing and leaving bare posts.
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 1.8),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 }),
    );
    tex.format = THREE.RGBAFormat;
    tex.anisotropy = 8;
    mesh.position.y = 0.9;
    fence.add(mesh);
    const posts = Math.floor(len / 3) + 1;
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts);
    const pm = new THREE.Matrix4();
    for (let i = 0; i < posts; i++) postMesh.setMatrixAt(i, pm.makeTranslation(-len / 2 + i * 3, 1, 0));
    postMesh.castShadow = true;
    fence.add(postMesh);
    fence.position.set(w.x, w.y, w.z);
    fence.rotation.y = w.yaw ?? 0;
    group.add(fence);
  }

  const rubber = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.92 });
  const tireGeo = new THREE.TorusGeometry(0.33, 0.12, 8, 18).rotateX(Math.PI / 2);
  const tires = byKind('tire');
  if (tires.length) {
    const mesh = new THREE.InstancedMesh(tireGeo, rubber, tires.length);
    const m = new THREE.Matrix4();
    tires.forEach((t, i) => mesh.setMatrixAt(i, m.makeTranslation(t.x, t.y + 0.12, t.z)));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2a, metalness: 0.6, roughness: 0.5 });
  for (const c of byKind('chimney')) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.7, 10), pipeMat);
    pipe.position.set(c.x, c.y + 0.85, c.z);
    pipe.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.12, 10), pipeMat);
    cap.position.set(c.x, c.y + 1.78, c.z);
    group.add(pipe, cap);
  }

  // Gate boom: a post with a counterweight and a striped arm that swings up when open.
  const booms: { arm: THREE.Group; open: number; target: number }[] = [];
  const stripe = boomStripes();
  for (const b of byKind('boom')) {
    const len = b.size ?? 6;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.15, 0.3), new THREE.MeshStandardMaterial({ color: 0x5e6458, roughness: 0.7 }));
    post.position.set(b.x, b.y + 0.575, b.z);
    post.castShadow = true;
    group.add(post);
    const arm = new THREE.Group();
    arm.position.set(b.x, b.y + 1.0, b.z);
    const tex = stripe.clone();
    tex.repeat.set(len / 1.6, 1);
    tex.needsUpdate = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, len), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
    // Stripes run along the arm.
    const uv = bar.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const pos = bar.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (pos.getZ(i) / len + 0.5) * 1);
    uv.needsUpdate = true;
    bar.position.z = len / 2;
    bar.castShadow = true;
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a3d38, roughness: 0.6 }));
    weight.position.z = -0.35;
    weight.castShadow = true;
    arm.add(bar, weight);
    group.add(arm);
    booms.push({ arm, open: 0, target: 0 });
  }

  let lastTime = 0;
  return {
    group,
    setGate(open: boolean) {
      for (const b of booms) b.target = open ? 1 : 0;
    },
    update(time: number) {
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      for (const b of booms) {
        if (b.open === b.target) continue;
        b.open = b.target > b.open ? Math.min(b.target, b.open + dt * 0.5) : Math.max(b.target, b.open - dt * 0.5);
        const e = b.open * b.open * (3 - 2 * b.open);
        b.arm.rotation.x = -1.35 * e;
      }
      if (!flag || !flagBase) return;
      const pos = flag.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = flagBase[i]!;
        const k = Math.min(1, x / 1.8);
        arr[i + 2] = Math.sin(x * 3.1 - time * 5.2) * 0.12 * k + Math.sin(x * 5.7 - time * 7.9) * 0.04 * k;
        arr[i + 1] = flagBase[i + 1]! - k * k * 0.08;
      }
      pos.needsUpdate = true;
      flag.geometry.computeVertexNormals();
    },
  };
}
