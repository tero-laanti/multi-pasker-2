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

/** Hand grenade model: olive egg body, fuse head and spoon. Shared by world and viewmodel. */
export function grenadeMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 12).scale(1, 1.25, 1),
    new THREE.MeshStandardMaterial({ color: 0x4a5a34, roughness: 0.6, metalness: 0.2 }),
  );
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c8f88, roughness: 0.4, metalness: 0.8 });
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.022, 12), metal);
  fuse.position.y = 0.044;
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.004), metal);
  spoon.position.set(0, 0.025, 0.03);
  spoon.rotation.x = 0.25;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 6, 14), metal);
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
  private live: Live[] = [];
  private nextId = 1;

  constructor(
    private world: CollisionWorld,
    private audio: AudioEngine,
  ) {}

  spawn(x: number, y: number, z: number, v: [number, number, number], fuse: number, owner: number): void {
    const g: Grenade = { id: this.nextId++, owner, x, y, z, vx: v[0], vy: v[1], vz: v[2], fuse, resting: false };
    const mesh = grenadeMesh();
    this.group.add(mesh);
    this.live.push({ g, mesh, px: x, py: y, pz: z, spin: new THREE.Vector3(6 + Math.random() * 6, Math.random() * 4, Math.random() * 3) });
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
      if (l.g.fuse <= 0) out.push({ x: l.g.x, y: l.g.y, z: l.g.z, owner: l.g.owner });
    }
    if (out.length) {
      for (const l of this.live.filter((x) => x.g.fuse <= 0)) this.group.remove(l.mesh);
      this.live = this.live.filter((x) => x.g.fuse > 0);
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
