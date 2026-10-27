import { describe, expect, it } from 'vitest';
import { MASK } from '../src/shared/collision/brush';
import { CollisionWorld } from '../src/shared/collision/world';
import { TUNING } from '../src/shared/config';
import { buildGarrison } from '../src/shared/map/garrison';
import { buildNavGraph, findPath, nearestNode } from '../src/shared/nav';
import { Room } from '../src/server/game/room';

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

describe('garrison: the gates, the outer ring and the Veksi', () => {
  const map = buildGarrison();
  const room = new Room(map, { dev: true });
  const setGate = (open: boolean) => (room as unknown as { setGate(o: boolean): void }).setGate(open);
  const path = (from: [number, number, number], to: [number, number, number]) => {
    const nav = room.nav;
    return findPath(nav, nearestNode(nav, ...from, room.world), nearestNode(nav, ...to, room.world));
  };

  it('bots walk into the camp and back only while the gates are open', () => {
    setGate(false);
    expect(path([-21, 0.05, -37], [74, 0, -24])).toBeNull();
    setGate(true);
    expect(path([-21, 0.05, -37], [74, 0, -24])).not.toBeNull();
    expect(path([88, 0, -22], [-36, 0.35, 0])).not.toBeNull();
    // Both gates lead in: the back gate's way through.
    expect(path([48.5, 0, -36.2], [64.5, 0, -36])).not.toBeNull();
    setGate(false);
  });

  it('bots get into the Veksi: the waiting room, the corridor and the ward', () => {
    for (const to of [
      [37.7, 0.1, 13],
      [43.25, 0.1, 13.3],
      [48.1, 0.1, 13.3],
      [48.1, 0, 20.5],
    ] as const)
      expect(path([-21, 0.05, -37], [...to]), `path to ${to[0]},${to[2]}`).not.toBeNull();
  });

  it('spawns face into the map', () => {
    for (const s of map.spawns) {
      const toX = (s.outer ? 30 : 0) - s.x;
      const toZ = -s.z;
      // Facing (yaw): forward is (-sin yaw, -cos yaw).
      expect(-Math.sin(s.yaw) * toX - Math.cos(s.yaw) * toZ, `spawn ${s.x},${s.z}`).toBeGreaterThan(0);
    }
  });
});
