import { describe, expect, it } from 'vitest';
import { MASK } from '../src/shared/collision/brush';
import { CollisionWorld } from '../src/shared/collision/world';
import { TUNING } from '../src/shared/config';
import { buildGarrison } from '../src/shared/map/garrison';
import { buildNavGraph, findPath, nearestNode } from '../src/shared/nav';

describe('garrison map', () => {
  const map = buildGarrison();
  const world = new CollisionWorld(map.brushes);
  const T = TUNING.move;

  it('has spawns in free space with ground below', () => {
    expect(map.spawns.filter((s) => !s.outer).length).toBeGreaterThanOrEqual(16);
    for (const s of map.spawns) {
      const free = !world.testBox(s.x, s.y + 0.95, s.z, T.radius, 0.88, T.radius, MASK.MOVE);
      expect(free, `spawn ${s.x},${s.z}`).toBe(true);
    }
  });

  it('nav graph connects the core and, through the gate, the outer ring', () => {
    const nodes = buildNavGraph(world, map.nav!);
    const isolated = nodes.map((n, i) => (n.links.length === 0 ? `${i}:${n.x},${n.z}` : '')).filter(Boolean);
    expect(isolated).toEqual([]);
    const from = nearestNode(nodes, -21, 0.05, -37, world);
    for (const [x, y, z] of [
      [34, 1.0, -16],
      [-36, 0.35, 0],
      [30, 0, 31],
      [-46, 0, 16],
    ] as const) {
      const to = nearestNode(nodes, x, y, z, world);
      expect(findPath(nodes, from, to), `path to ${x},${z}`).not.toBeNull();
    }
  });

  it('the closed gate blocks players but opening it lets them through', () => {
    const gate = map.gateBrushes!;
    expect(gate.length).toBeGreaterThan(0);
    expect(world.testBox(52.05, 1, 0, 0.3, 0.8, 0.3, MASK.MOVE)).toBe(true);
    for (const i of gate) map.brushes[i]!.flags = 0;
    expect(world.testBox(52.05, 1, 0, 0.3, 0.8, 0.3, MASK.MOVE)).toBe(false);
  });
});
