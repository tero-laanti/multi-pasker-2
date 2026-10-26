import * as THREE from 'three';
import { makeRng } from '../../../shared/math';
import { normalFromHeight } from './common';
import type { BakedMesh } from './handBuild';
import type { HandKey } from './handSpecs';

/**
 * First-person gloved hands. The shapes come from the WebXR "generic-hand" model (MIT, see
 * README), posed on each weapon and baked into static meshes in a worker (handWorker.ts →
 * handBuild.ts); this module only turns the baked arrays into meshes with materials.
 */

export const HAND_MODEL_URL = new URL('../../../../assets/models/generic-hand-right.glb', import.meta.url).href;

export interface HandsModel {
  /** Shooting hand, fixed to the grip. */
  right: THREE.Group;
  /** Support hand; animated separately for reloads. Rest pose is identity. */
  left: THREE.Group;
  /** Optional second support-hand pose used to rack the bolt (rest pose is identity). */
  leftRack?: THREE.Group;
  /**
   * Support hand holding a phone (hidden until the viewmodel shows it). Its local frame is
   * the phone's: origin at the phone's centre, +X right, +Y along the long side, +Z out of the
   * screen. Place the group where the phone should be and attach the phone mesh to
   * `phoneAnchor`.
   */
  phone: THREE.Group;
  /** Child of `phone` at the phone's centre (identity transform): parent the phone mesh here. */
  phoneAnchor: THREE.Object3D;
}

let gloveMat: THREE.MeshStandardMaterial | null = null;
let sleeveMat: THREE.MeshStandardMaterial | null = null;

function materials(): { glove: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial } {
  if (!gloveMat || !sleeveMat) {
    const r = makeRng(31);
    const cells = 64;
    const jitter = Array.from({ length: cells * cells }, () => r());
    const leather = normalFromHeight(
      256,
      (u, v) => {
        // Fine pebbled grain: one soft bump per cell, with a little variation.
        const x = u * cells;
        const y = v * cells;
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        const fx = x - cx - 0.5;
        const fy = y - cy - 0.5;
        const j = jitter[(cy % cells) * cells + (cx % cells)]!;
        return Math.max(0, 0.25 - (fx * fx + fy * fy)) * (0.6 + 0.4 * j);
      },
      0.9,
    );
    // About 0.35 m of hand per UV unit: repeat the grain so a pebble is about a millimetre.
    leather.repeat.set(6, 6);
    gloveMat = new THREE.MeshStandardMaterial({
      color: 0x5c4a38,
      roughness: 0.55,
      metalness: 0,
      envMapIntensity: 0.6,
      normalMap: leather,
      normalScale: new THREE.Vector2(0.35, 0.35),
      vertexColors: true,
    });
    const weave = normalFromHeight(
      128,
      (u, v) => {
        const a = Math.sin(u * Math.PI * 2 * 48) * 0.5 + 0.5;
        const b = Math.sin(v * Math.PI * 2 * 48) * 0.5 + 0.5;
        return (a + b) * 0.5;
      },
      0.6,
    );
    sleeveMat = new THREE.MeshStandardMaterial({
      color: 0x56603f,
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.3,
      normalMap: weave,
      normalScale: new THREE.Vector2(0.35, 0.35),
      vertexColors: true,
    });
  }
  return { glove: gloveMat, sleeve: sleeveMat };
}

const cache = new Map<string, { glove: THREE.BufferGeometry; sleeve: THREE.BufferGeometry }>();

export function toGeometry(m: BakedMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(m.col, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  g.computeBoundingSphere();
  return g;
}

export function cacheHand(key: string, glove: BakedMesh, sleeve: BakedMesh): void {
  cache.set(key, { glove: toGeometry(glove), sleeve: toGeometry(sleeve) });
}

let ready: Promise<void> | null = null;

/** Bakes every hand pose in a worker (parallel to other loading); falls back to the main thread. */
export function prepareHands(): Promise<void> {
  ready ??= new Promise<void>((resolve) => {
    let worker: Worker;
    const fallback = async () => {
      try {
        const [{ bakeAllHands }, buf] = await Promise.all([import('./handBake'), fetch(HAND_MODEL_URL).then((r) => r.arrayBuffer())]);
        for (const h of bakeAllHands(buf).hands) cacheHand(h.key, h.glove, h.sleeve);
      } catch (err) {
        console.error('hands: baking failed', err);
      }
      resolve();
    };
    try {
      worker = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      void fallback();
      return;
    }
    worker.onmessage = (ev: MessageEvent<{ key: string; glove: BakedMesh; sleeve: BakedMesh } | { done: true } | { error: string }>) => {
      const m = ev.data;
      if ('error' in m) {
        console.warn('hands: worker failed, baking on the main thread', m.error);
        worker.terminate();
        void fallback();
      } else if ('done' in m) {
        worker.terminate();
        resolve();
      } else cacheHand(m.key, m.glove, m.sleeve);
    };
    worker.onerror = () => {
      worker.terminate();
      void fallback();
    };
    worker.postMessage({ url: HAND_MODEL_URL });
  });
  return ready;
}

/**
 * The support hand holding a phone of PHONE.size (7 x 14 x 0.9 cm, weaponShapes.ts), with a
 * `phoneAnchor` child at the phone's centre (also in `userData.phoneAnchor`). Hidden.
 */
export function buildPhoneHand(): THREE.Group {
  const group = buildHand('phone.left');
  const anchor = new THREE.Object3D();
  anchor.name = 'phoneAnchor';
  group.add(anchor);
  group.userData.phoneAnchor = anchor;
  group.visible = false;
  return group;
}

/** One gloved hand with its sleeve (weapon model space), from the baked cache. */
export function buildHand(key: HandKey): THREE.Group {
  const group = new THREE.Group();
  group.name = key;
  const geo = cache.get(key);
  if (!geo) {
    console.warn(`hands: ${key} not baked (call prepareHands first)`);
    return group;
  }
  const mats = materials();
  group.add(new THREE.Mesh(geo.glove, mats.glove));
  group.add(new THREE.Mesh(geo.sleeve, mats.sleeve));
  return group;
}
