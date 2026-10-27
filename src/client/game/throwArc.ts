import * as THREE from 'three';
import type { CollisionWorld } from '../../shared/collision/world';
import { stepGrenade, type Grenade, type GrenadeTuning } from '../../shared/grenade';

/** Dots along the path: one every few simulation steps, none in the first stretch by the eye. */
const DOTS = 64;
const EVERY = 3;
const NEAR = 2.5;

/**
 * Hyvä heittäjä: while a grenade is held, the path it would take if let go now, simulated the
 * way the server will, as a row of dots (lines are always a pixel thin in WebGL) with a ring
 * where it comes to rest or goes off.
 */
export class ThrowArc {
  readonly root = new THREE.Group();
  private dots: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private at = new THREE.Matrix4();

  constructor() {
    const color = 0xffd23a;
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 6), mat, DOTS);
    this.dots.frustumCulled = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    this.root.add(this.dots, this.ring);
    this.root.visible = false;
  }

  hide(): void {
    this.root.visible = false;
  }

  show(world: CollisionWorld, o: [number, number, number], v: [number, number, number], fuse: number, T: GrenadeTuning): void {
    const g: Grenade = { id: 0, owner: 0, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], fuse, resting: false };
    let n = 0;
    const dt = 1 / 60;
    for (let i = 1; n < DOTS && g.fuse > 0 && !g.resting; i++) {
      stepGrenade(g, world, dt, T);
      if (i % EVERY === 0 && Math.hypot(g.x - o[0], g.y - o[1], g.z - o[2]) > NEAR) this.dots.setMatrixAt(n++, this.at.makeTranslation(g.x, g.y, g.z));
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.ring.position.set(g.x, g.y + 0.02, g.z);
    this.root.visible = true;
  }
}
