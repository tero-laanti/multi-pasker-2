import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/shared/collision/world';
import { SIM_DT, TUNING } from '../src/shared/config';
import { blastReaches, explosionDamage, stepGrenade, throwVelocity, type Grenade } from '../src/shared/grenade';
import { MapBuilder } from '../src/shared/map/builder';
import { MASK } from '../src/shared/collision/brush';

function world() {
  const m = new MapBuilder();
  m.box(-50, -1, -50, 50, 0, 50, 'concrete');
  m.box(-5, 0, -21, 5, 3, -20, 'concrete');
  return new CollisionWorld(m.brushes);
}

function grenade(x: number, y: number, z: number, v: [number, number, number]): Grenade {
  return { id: 1, owner: 1, x, y, z, vx: v[0], vy: v[1], vz: v[2], fuse: TUNING.grenade.fuse, resting: false };
}

describe('grenades', () => {
  it('flies, bounces and comes to rest on the ground without sinking into it', () => {
    const w = world();
    const g = grenade(0, 1.5, 0, throwVelocity(0, 0, 0, 0, 0));
    let bounces = 0;
    let t = 0;
    while (t < TUNING.grenade.fuse) {
      if (stepGrenade(g, w, SIM_DT) > 1) bounces++;
      t += SIM_DT;
      expect(w.testBox(g.x, g.y, g.z, 0.04, 0.04, 0.04, MASK.GRENADE)).toBe(false);
    }
    expect(bounces).toBeGreaterThan(0);
    expect(g.resting).toBe(true);
    expect(g.y).toBeGreaterThan(0);
    expect(g.y).toBeLessThan(0.1);
    expect(g.z).toBeLessThan(-8);
  });

  it('bounces back off a wall', () => {
    const w = world();
    const g = grenade(0, 1.5, -18, [0, 0, -15]);
    for (let i = 0; i < 30; i++) stepGrenade(g, w, SIM_DT);
    expect(g.vz).toBeGreaterThan(0);
    expect(g.z).toBeGreaterThan(-20);
  });

  it('damage falls off and cover blocks the blast', () => {
    expect(explosionDamage(0.5)).toBe(TUNING.grenade.damage);
    expect(explosionDamage(TUNING.grenade.radius + 0.1)).toBe(0);
    expect(explosionDamage(3)).toBeLessThan(TUNING.grenade.damage);
    const w = world();
    expect(blastReaches(w, 0, 0.05, -18, 0, 1, -15)).toBe(true);
    expect(blastReaches(w, 0, 0.05, -18, 0, 1, -23)).toBe(false);
  });
});
