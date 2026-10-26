/**
 * Minimal reader for a binary glTF (.glb) holding one skinned mesh, enough for the
 * first-person hand model. No DOM, so it runs in workers and in Node tests.
 */

export interface SkinnedGlb {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
  /** Four joint indices per vertex (into `jointNames`). */
  joints: Uint16Array;
  /** Four weights per vertex. */
  weights: Float32Array;
  jointNames: string[];
  /** Node world matrix of each joint at bind time (column-major 4x4). */
  jointWorld: Float32Array[];
  inverseBind: Float32Array[];
}

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface BufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json: { accessors: Accessor[]; bufferViews: BufferView[] }, bin: DataView, index: number): Float64Array {
  const acc = json.accessors[index]!;
  const view = json.bufferViews[acc.bufferView]!;
  const n = COMPONENTS[acc.type]!;
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType]!;
  const stride = view.byteStride ?? n * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float64Array(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      const o = base + i * stride + c * size;
      let v: number;
      switch (acc.componentType) {
        case 5120:
          v = bin.getInt8(o);
          break;
        case 5121:
          v = bin.getUint8(o);
          break;
        case 5122:
          v = bin.getInt16(o, true);
          break;
        case 5123:
          v = bin.getUint16(o, true);
          break;
        case 5125:
          v = bin.getUint32(o, true);
          break;
        default:
          v = bin.getFloat32(o, true);
      }
      out[i * n + c] = v;
    }
  }
  return out;
}

/** Column-major 4x4 from translation, rotation (x, y, z, w) and scale. */
export function composeTRS(t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): Float32Array {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m = new Float32Array(16);
  m[0] = (1 - (yy + zz)) * s[0]!;
  m[1] = (xy + wz) * s[0]!;
  m[2] = (xz - wy) * s[0]!;
  m[4] = (xy - wz) * s[1]!;
  m[5] = (1 - (xx + zz)) * s[1]!;
  m[6] = (yz + wx) * s[1]!;
  m[8] = (xz + wy) * s[2]!;
  m[9] = (yz - wx) * s[2]!;
  m[10] = (1 - (xx + yy)) * s[2]!;
  m[12] = t[0]!;
  m[13] = t[1]!;
  m[14] = t[2]!;
  m[15] = 1;
  return m;
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  return o;
}

export function parseSkinnedGlb(buffer: ArrayBuffer): SkinnedGlb {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  let off = 12;
  let json: any = null;
  let bin: DataView | null = null;
  while (off < buffer.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, off + 8, len)));
    else if (type === 0x004e4942) bin = new DataView(buffer, off + 8, len);
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('glb without json or bin chunk');
  const nodes: GltfNode[] = json.nodes;
  // World matrices (the hand skeletons are flat, but walk the tree anyway).
  const world: (Float32Array | null)[] = nodes.map(() => null);
  const local = (n: GltfNode) => (n.matrix ? Float32Array.from(n.matrix) : composeTRS(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]));
  const visit = (i: number, parent: Float32Array | null) => {
    const m = parent ? mul(parent, local(nodes[i]!)) : local(nodes[i]!);
    world[i] = m;
    for (const c of nodes[i]!.children ?? []) visit(c, m);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes as number[]) visit(r, null);
  const meshNode = nodes.find((n) => n.mesh !== undefined && n.skin !== undefined);
  if (!meshNode) throw new Error('no skinned mesh');
  const prim = json.meshes[meshNode.mesh!].primitives[0];
  const skin = json.skins[meshNode.skin!];
  const a = prim.attributes;
  const ibm = readAccessor(json, bin, skin.inverseBindMatrices);
  return {
    positions: Float32Array.from(readAccessor(json, bin, a.POSITION)),
    normals: Float32Array.from(readAccessor(json, bin, a.NORMAL)),
    uvs: a.TEXCOORD_0 !== undefined ? Float32Array.from(readAccessor(json, bin, a.TEXCOORD_0)) : null,
    indices: Uint32Array.from(readAccessor(json, bin, prim.indices)),
    joints: Uint16Array.from(readAccessor(json, bin, a.JOINTS_0)),
    weights: Float32Array.from(readAccessor(json, bin, a.WEIGHTS_0)),
    jointNames: (skin.joints as number[]).map((j) => nodes[j]!.name ?? `joint${j}`),
    jointWorld: (skin.joints as number[]).map((j) => world[j]!),
    inverseBind: (skin.joints as number[]).map((_, i) => Float32Array.from(ibm.subarray(i * 16, i * 16 + 16))),
  };
}
