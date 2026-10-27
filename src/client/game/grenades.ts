import * as THREE from 'three';
import type { CollisionWorld } from '../../shared/collision/world';
import { stepGrenade, type Grenade } from '../../shared/grenade';
import type { AudioEngine } from '../audio/engine';

export interface Explosion {
  x: number;
  y: number;
  z: number;
  owner: number;
}

/** The grenade's shapes and materials, made once: every grenade thrown all evening shares them. */
let parts: { body: THREE.BufferGeometry; fuse: THREE.BufferGeometry; spoon: THREE.BufferGeometry; ring: THREE.BufferGeometry; olive: THREE.Material; metal: THREE.Material } | null = null;

/** Hand grenade model: olive egg body, fuse head and spoon. Shared by world and viewmodel. */
export function grenadeMesh(): THREE.Group {
  parts ??= {
    body: new THREE.SphereGeometry(0.03, 16, 12).scale(1, 1.25, 1),
    fuse: new THREE.CylinderGeometry(0.011, 0.013, 0.022, 12),
    spoon: new THREE.BoxGeometry(0.012, 0.06, 0.004),
    ring: new THREE.TorusGeometry(0.009, 0.0016, 6, 14),
    olive: new THREE.MeshStandardMaterial({ color: 0x4a5a34, roughness: 0.6, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8c8f88, roughness: 0.4, metalness: 0.8 }),
  };
  const g = new THREE.Group();
  const body = new THREE.Mesh(parts.body, parts.olive);
  const fuse = new THREE.Mesh(parts.fuse, parts.metal);
  fuse.position.y = 0.044;
  const spoon = new THREE.Mesh(parts.spoon, parts.metal);
  spoon.position.set(0, 0.025, 0.03);
  spoon.rotation.x = 0.25;
  const ring = new THREE.Mesh(parts.ring, parts.metal);
  ring.position.set(0.016, 0.05, 0);
  g.add(body, fuse, spoon, ring);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

interface Live {
  g: Grenade;
  mesh: THREE.Group;
  px: number;
  py: number;
  pz: number;
  spin: THREE.Vector3;
}

/** Live grenades in the world: physics at the fixed step, interpolated meshes, bounce sounds. */
export class Grenades {
  readonly group = new THREE.Group();
  /**
   * Matches: the server decides when a grenade explodes (see `remove`); local fuses never
   * fire, and a grenade the server forgot (round restart) disappears a little after its fuse.
   */
  serverFuse = false;
  private live: Live[] = [];
  private nextId = 1;

  constructor(
    private world: CollisionWorld,
    private audio: AudioEngine,
  ) {}

  /** Returns the grenade's id: the server's id when given, otherwise a negative local one. */
  spawn(x: number, y: number, z: number, v: [number, number, number], fuse: number, owner: number, id?: number): number {
    const gid = id ?? -this.nextId++;
    const g: Grenade = { id: gid, owner, x, y, z, vx: v[0], vy: v[1], vz: v[2], fuse, resting: false };
    const mesh = grenadeMesh();
    this.group.add(mesh);
    this.live.push({ g, mesh, px: x, py: y, pz: z, spin: new THREE.Vector3(6 + Math.random() * 6, Math.random() * 4, Math.random() * 3) });
    return gid;
  }

  /** Gives a grenade thrown ahead of the server's answer the server's id. */
  adopt(localId: number, id: number): boolean {
    const l = this.live.find((x) => x.g.id === localId);
    if (!l) return false;
    l.g.id = id;
    return true;
  }

  has(id: number): boolean {
    return this.live.some((x) => x.g.id === id);
  }

  /** Removes a grenade (the server's explosion) and returns where it was. */
  remove(id: number): { x: number; y: number; z: number } | null {
    const l = this.live.find((x) => x.g.id === id);
    if (!l) return null;
    this.group.remove(l.mesh);
    this.live = this.live.filter((x) => x !== l);
    return { x: l.g.x, y: l.g.y, z: l.g.z };
  }

  clear(): void {
    for (const l of this.live) this.group.remove(l.mesh);
    this.live = [];
  }

  step(dt: number): Explosion[] {
    const out: Explosion[] = [];
    for (const l of this.live) {
      l.px = l.g.x;
      l.py = l.g.y;
      l.pz = l.g.z;
      const impact = stepGrenade(l.g, this.world, dt);
      if (impact > 1.2) {
        this.audio.playAt('grenade_bounce', l.g.x, l.g.y, l.g.z, { volume: Math.min(1, impact / 8), refDistance: 2 });
      }
      if (!this.serverFuse && l.g.fuse <= 0) out.push({ x: l.g.x, y: l.g.y, z: l.g.z, owner: l.g.owner });
    }
    const gone = (l: Live) => (this.serverFuse ? l.g.fuse < -1.5 : l.g.fuse <= 0);
    if (this.live.some(gone)) {
      for (const l of this.live.filter(gone)) this.group.remove(l.mesh);
      this.live = this.live.filter((l) => !gone(l));
    }
    return out;
  }

  render(alpha: number, dt: number): void {
    for (const l of this.live) {
      l.mesh.position.set(l.px + (l.g.x - l.px) * alpha, l.py + (l.g.y - l.py) * alpha, l.pz + (l.g.z - l.pz) * alpha);
      if (!l.g.resting) {
        l.mesh.rotation.x += l.spin.x * dt;
        l.mesh.rotation.y += l.spin.y * dt;
        l.mesh.rotation.z += l.spin.z * dt;
      }
    }
  }

  get count(): number {
    return this.live.length;
  }
}
