import * as THREE from 'three';
import { MASK, brushFaces } from '../../shared/collision/brush';
import type { CollisionWorld } from '../../shared/collision/world';
import type { MaterialId } from '../../shared/map/types';
import type { Vec3 } from '../../shared/math';
import type { MapMaterial } from './textures';

/** Height of the darkened band where walls meet the ground. */
const AO_HEIGHT = 0.55;
const AO_DARK = 0.6;

interface Buckets {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
}

/**
 * Builds one merged mesh per material from the map's brushes. UVs are projected in world
 * space along the face's dominant axis, so texel density is the same everywhere.
 */
export function buildMapMeshes(world: CollisionWorld, materials: Map<MaterialId, MapMaterial>): THREE.Group {
  const group = new THREE.Group();
  group.name = 'map';
  const buckets = new Map<MaterialId, Buckets>();

  for (const brush of world.brushes) {
    const mat = brush.mat as MaterialId;
    if (!mat || mat === 'clip' || !materials.has(mat)) continue;
    const tile = materials.get(mat)!.tile;
    let b = buckets.get(mat);
    if (!b) {
      b = { pos: [], nrm: [], uv: [], col: [] };
      buckets.set(mat, b);
    }
    for (const face of brushFaces(brush)) {
      const n = face.plane;
      // Skip bottoms resting on something (never visible).
      if (n.ny < -0.99 && brush.minY > -1) {
        const c = centroid(face.verts);
        if (world.testBox(c.x, c.y - 0.02, c.z, 0.01, 0.01, 0.01, MASK.ALL)) continue;
      }
      const vertical = Math.abs(n.ny) < 0.3;
      let polys: Vec3[][] = [face.verts];
      let contact = false;
      if (vertical) {
        const bottom = Math.min(...face.verts.map((v) => v.y));
        const top = Math.max(...face.verts.map((v) => v.y));
        contact = touchesFloor(world, face.verts, n, bottom);
        if (contact && top - bottom > AO_HEIGHT * 1.2) polys = splitAtY(face.verts, bottom + AO_HEIGHT);
      }
      const bottomY = Math.min(...face.verts.map((v) => v.y));
      for (const poly of polys) emit(b, poly, n, tile, contact ? bottomY : null);
    }
  }

  for (const [mat, b] of buckets) {
    if (b.pos.length === 0) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials.get(mat)!.material);
    mesh.name = `map:${mat}`;
    mesh.castShadow = mat !== 'grass' && mat !== 'gravel' && mat !== 'dirt';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

function centroid(vs: Vec3[]): Vec3 {
  const c = { x: 0, y: 0, z: 0 };
  for (const v of vs) {
    c.x += v.x;
    c.y += v.y;
    c.z += v.z;
  }
  c.x /= vs.length;
  c.y /= vs.length;
  c.z /= vs.length;
  return c;
}

function touchesFloor(world: CollisionWorld, vs: Vec3[], n: { nx: number; nz: number }, bottom: number): boolean {
  const low = vs.filter((v) => v.y < bottom + 0.01);
  if (low.length === 0) return false;
  const mx = low.reduce((a, v) => a + v.x, 0) / low.length;
  const mz = low.reduce((a, v) => a + v.z, 0) / low.length;
  return world.testBox(mx + n.nx * 0.06, bottom - 0.03, mz + n.nz * 0.06, 0.02, 0.02, 0.02, MASK.ALL);
}

function splitAtY(poly: Vec3[], y: number): Vec3[][] {
  const below: Vec3[] = [];
  const above: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = a.y - y;
    const db = b.y - y;
    if (da <= 0) below.push(a);
    if (da >= 0) above.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const p = { x: a.x + (b.x - a.x) * t, y, z: a.z + (b.z - a.z) * t };
      below.push(p);
      above.push(p);
    }
  }
  return [below, above].filter((p) => p.length >= 3);
}

function emit(b: Buckets, poly: Vec3[], n: { nx: number; ny: number; nz: number }, tile: number, aoBottom: number | null): void {
  const ax = Math.abs(n.nx);
  const ay = Math.abs(n.ny);
  const az = Math.abs(n.nz);
  const uvOf = (v: Vec3): [number, number] => {
    if (ay >= ax && ay >= az) return [v.x / tile, v.z / tile];
    if (ax >= az) return [(n.nx > 0 ? -v.z : v.z) / tile, v.y / tile];
    return [(n.nz > 0 ? v.x : -v.x) / tile, v.y / tile];
  };
  const shade = (v: Vec3): number => {
    if (aoBottom === null) return 1;
    const t = Math.min(1, Math.max(0, (v.y - aoBottom) / AO_HEIGHT));
    return AO_DARK + (1 - AO_DARK) * t * t * (3 - 2 * t);
  };
  const v0 = poly[0]!;
  for (let i = 1; i + 1 < poly.length; i++) {
    for (const v of [v0, poly[i]!, poly[i + 1]!]) {
      b.pos.push(v.x, v.y, v.z);
      b.nrm.push(n.nx, n.ny, n.nz);
      const [u, w] = uvOf(v);
      b.uv.push(u, w);
      const s = shade(v);
      b.col.push(s, s, s);
    }
  }
}
