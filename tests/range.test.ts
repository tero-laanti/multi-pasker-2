import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/shared/collision/world';
import { buildRange } from '../src/shared/map/range';
import { DRILL, RangeSim } from '../src/shared/rangeSim';
import { MASK } from '../src/shared/collision/brush';

describe('range map', () => {
  const map = buildRange();
  const world = new CollisionWorld(map.brushes);

  it('spawns the player in free space above the firing point floor', () => {
    const s = map.spawns[0]!;
    expect(world.testBox(s.x, s.y + 0.95, s.z, 0.36, 0.89, 0.36, MASK.MOVE)).toBe(false);
  });

  it('keeps the firing lanes clear between the firing line and the 25 m targets', () => {
    for (const x of [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5]) {
      expect(world.testBox(x, 1.3, -8, 0.05, 0.05, 0.05, MASK.SHOT)).toBe(false);
    }
  });
});

describe('range simulation', () => {
  const map = buildRange();

  it('moves the rail target back and forth inside its rail', () => {
    const sim = new RangeSim(map.targets);
    const t = sim.targets.find((x) => x.def.rail)!;
    const xs: number[] = [];
    for (let i = 0; i < 1200; i++) {
      sim.update(1 / 60);
      xs.push(t.x);
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(t.def.rail!.x0 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(t.def.rail!.x1 + 1e-6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
  });

  it('knocks a silhouette down at 100 damage and raises it again', () => {
    const sim = new RangeSim(map.targets);
    const t = sim.targets.find((x) => x.def.kind === 'silhouette' && !x.def.popup && !x.def.rail)!;
    // Ray straight at the chest from 10 m in front.
    const hit = sim.raycast(t.x, t.y + 1.2, t.z + 10, 0, 0, -1, 50)!;
    expect(hit.target).toBe(t);
    expect(hit.zone).toBe('body');
    const head = sim.raycast(t.x, t.y + 1.62, t.z + 10, 0, 0, -1, 50)!;
    expect(head.zone).toBe('head');
    expect(sim.applyHit(hit, 50)).toBe(false);
    expect(sim.applyHit(hit, 50)).toBe(true);
    for (let i = 0; i < 30; i++) sim.update(1 / 60);
    expect(t.up).toBeLessThan(0.1);
    // The ray now passes over the fallen board (to whatever stands behind it).
    expect(sim.raycast(t.x, t.y + 1.2, t.z + 10, 0, 0, -1, 50)?.target).not.toBe(t);
    for (let i = 0; i < 240; i++) sim.update(1 / 60);
    expect(t.up).toBeGreaterThan(0.9);
    expect(t.hp).toBe(100);
  });

  it('runs a drill: briefing, pop-ups, scoring and the cease-fire', () => {
    const sim = new RangeSim(map.targets);
    const start = sim.targets.find((x) => x.def.kind === 'start')!;
    const hit = sim.raycast(start.x, start.y, start.z + 6, 0, 0, -1, 20)!;
    expect(hit.target).toBe(start);
    sim.applyHit(hit, 0);
    expect(sim.drillPhase).toBe('briefing');
    const keys: string[] = [];
    let knocked = 0;
    for (let i = 0; i < (DRILL.briefing + DRILL.duration + 1) * 60; i++) {
      sim.update(1 / 60);
      for (const e of sim.events) if (e.type === 'command') keys.push(e.key);
      sim.events.length = 0;
      const up = sim.targets.find((x) => x.def.popup && x.upTarget === 1 && x.up > 0.95);
      if (up && sim.drillPhase === 'running') {
        const h = sim.raycast(up.x, up.y + 1.62, up.z + 5, 0, 0, -1, 20);
        if (h && h.target === up) {
          sim.noteShot();
          sim.applyHit(h, 50);
          sim.noteShot();
          if (sim.applyHit(h, 50)) knocked++;
        }
      }
    }
    expect(keys).toEqual(['positions', 'fire', 'cease']);
    expect(sim.drillPhase).toBe('idle');
    expect(knocked).toBeGreaterThan(10);
    expect(sim.drill.downs).toBe(knocked);
    expect(sim.drill.heads).toBe(knocked * 2);
    expect(sim.drill.score).toBeGreaterThanOrEqual(knocked * (DRILL.killPoints + 2 * DRILL.headPoints));
  });
});
