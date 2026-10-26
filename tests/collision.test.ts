import { describe, expect, it } from 'vitest';
import { MASK, boxPlanes, brushFaces, brushFromPlanes, obbPlanes, prismPlanes, wedgePlanes } from '../src/shared/collision/brush';
import { CollisionWorld, SURFACE_CLIP_EPSILON, TraceResult } from '../src/shared/collision/world';
import { makeRng } from '../src/shared/math';

function world(...planeSets: ReturnType<typeof boxPlanes>[]) {
  return new CollisionWorld(planeSets.map((p) => brushFromPlanes(p)));
}

describe('point traces', () => {
  const w = world(boxPlanes(-1, 0, -1, 1, 2, 1));
  const tr = new TraceResult();

  it('hits the near face with the right normal and distance', () => {
    w.trace(tr, 0, 1, 10, 0, 1, -10, 0, 0, 0, MASK.SHOT);
    expect(tr.fraction).toBeGreaterThan(0);
    expect(tr.fraction).toBeLessThan(1);
    expect(tr.z).toBeCloseTo(1 + SURFACE_CLIP_EPSILON, 2);
    expect([tr.nx, tr.ny, tr.nz]).toEqual([0, 0, 1]);
    expect(tr.startSolid).toBe(false);
  });

  it('misses when passing beside the box', () => {
    w.trace(tr, 2, 1, 10, 2, 1, -10, 0, 0, 0, MASK.SHOT);
    expect(tr.fraction).toBe(1);
    expect(tr.brush).toBe(-1);
  });

  it('respects masks', () => {
    const clipOnly = new CollisionWorld([brushFromPlanes(boxPlanes(-1, 0, -1, 1, 2, 1), { flags: MASK.MOVE })]);
    clipOnly.trace(tr, 0, 1, 10, 0, 1, -10, 0, 0, 0, MASK.SHOT);
    expect(tr.fraction).toBe(1);
    clipOnly.trace(tr, 0, 1, 10, 0, 1, -10, 0, 0, 0, MASK.MOVE);
    expect(tr.fraction).toBeLessThan(1);
  });

  it('reports start-solid for rays starting inside', () => {
    w.trace(tr, 0, 1, 0, 0, 1, 10, 0, 0, 0, MASK.SHOT);
    expect(tr.startSolid).toBe(true);
    expect(tr.allSolid).toBe(false);
  });

  it('long rays use the same results as short ones', () => {
    const far = new TraceResult();
    w.trace(far, 0, 1, 200, 0, 1, -200, 0, 0, 0, MASK.SHOT);
    expect(far.z).toBeCloseTo(1 + SURFACE_CLIP_EPSILON, 2);
  });
});

describe('box traces', () => {
  const tr = new TraceResult();

  it('stops a box at its half extent from a wall', () => {
    const w = world(boxPlanes(-5, 0, -1, 5, 3, 0));
    w.trace(tr, 0, 1, 5, 0, 1, -5, 0.4, 0.9, 0.4, MASK.MOVE);
    expect(tr.z).toBeCloseTo(0.4 + SURFACE_CLIP_EPSILON, 2);
    expect(tr.nz).toBe(1);
  });

  it('slides exactly up a ramp surface', () => {
    // Ramp rising towards -z from y=0 at z=0 to y=1 at z=-2.
    const w = new CollisionWorld([brushFromPlanes(wedgePlanes(-2, 0, -2, 2, 1, 0, '-z'))]);
    // Drop a point onto the middle of the ramp.
    w.trace(tr, 0, 5, -1, 0, -5, -1, 0, 0, 0, MASK.ALL);
    expect(tr.y).toBeCloseTo(0.5, 2);
    expect(tr.ny).toBeGreaterThan(0.8);
    expect(tr.nz).toBeGreaterThan(0.4); // normal tilts towards +z (the low side)
  });

  it('box against a rotated box stops at the right distance', () => {
    const w = new CollisionWorld([brushFromPlanes(obbPlanes(0, 1, 0, 1, 1, 1, Math.PI / 4))]);
    // Corner of the diamond points at +z, at z = sqrt(2).
    w.trace(tr, 0, 1, 5, 0, 1, -5, 0.3, 0.3, 0.3, MASK.ALL);
    // Axial bevel stops the box face flush with the corner.
    expect(tr.z).toBeCloseTo(Math.SQRT2 + 0.3 + SURFACE_CLIP_EPSILON, 2);
  });

  it('prism ridge is solid and the eaves are low', () => {
    const w = new CollisionWorld([brushFromPlanes(prismPlanes(-2, 0, -3, 2, 2, 3, 'z'))]);
    w.trace(tr, 0, 5, 0, 0, -5, 0, 0, 0, 0, MASK.ALL);
    expect(tr.y).toBeCloseTo(2, 2);
    w.trace(tr, 1.5, 5, 0, 1.5, -5, 0, 0, 0, 0, MASK.ALL);
    expect(tr.y).toBeCloseTo(0.5, 2);
  });

  it('testBox detects overlap', () => {
    const w = world(boxPlanes(0, 0, 0, 1, 1, 1));
    expect(w.testBox(0.5, 0.5, 0.5, 0.1, 0.1, 0.1, MASK.ALL)).toBe(true);
    expect(w.testBox(1.5, 0.5, 0.5, 0.4, 0.1, 0.1, MASK.ALL)).toBe(false);
    expect(w.testBox(1.3, 0.5, 0.5, 0.4, 0.1, 0.1, MASK.ALL)).toBe(true);
  });

  it('random box sweeps never end inside a brush', () => {
    const rnd = makeRng(1234);
    const sets = [];
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 40 - 20;
      const z = rnd() * 40 - 20;
      const s = 0.5 + rnd() * 3;
      if (i % 3 === 0) sets.push(obbPlanes(x, s / 2, z, s / 2, s / 2, s / 3, rnd() * 3));
      else if (i % 3 === 1) sets.push(wedgePlanes(x, 0, z, x + s, s * 0.6, z + s, '+x'));
      else sets.push(boxPlanes(x, 0, z, x + s, s, z + s * 0.5));
    }
    const w = new CollisionWorld(sets.map((p) => brushFromPlanes(p)));
    let tested = 0;
    for (let i = 0; i < 4000; i++) {
      const sx = rnd() * 50 - 25;
      const sy = rnd() * 4;
      const sz = rnd() * 50 - 25;
      if (w.testBox(sx, sy, sz, 0.35, 0.5, 0.35, MASK.ALL)) continue;
      const ex = sx + (rnd() - 0.5) * 20;
      const ey = sy + (rnd() - 0.5) * 4;
      const ez = sz + (rnd() - 0.5) * 20;
      w.trace(tr, sx, sy, sz, ex, ey, ez, 0.35, 0.5, 0.35, MASK.ALL);
      expect(tr.startSolid).toBe(false);
      expect(w.testBox(tr.x, tr.y, tr.z, 0.35, 0.5, 0.35, MASK.ALL)).toBe(false);
      tested++;
    }
    expect(tested).toBeGreaterThan(1000);
  });
});

describe('brush faces', () => {
  it('a box has six quads and a wedge five faces', () => {
    expect(brushFaces(brushFromPlanes(boxPlanes(0, 0, 0, 1, 1, 1))).map((f) => f.verts.length)).toEqual([4, 4, 4, 4, 4, 4]);
    const wedge = brushFaces(brushFromPlanes(wedgePlanes(0, 0, 0, 2, 1, 1, '+x')));
    expect(wedge.length).toBe(5);
  });

  it('face winding is counter-clockwise seen from outside', () => {
    for (const f of brushFaces(brushFromPlanes(obbPlanes(0, 0, 0, 1, 2, 3, 0.7)))) {
      const [a, b, c] = f.verts as [any, any, any];
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      expect(n[0]! * f.plane.nx + n[1]! * f.plane.ny + n[2]! * f.plane.nz).toBeGreaterThan(0);
    }
  });
});
