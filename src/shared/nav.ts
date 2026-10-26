import { MASK } from './collision/brush';
import { TraceResult, type CollisionWorld } from './collision/world';
import { TUNING } from './config';

export interface NavNode {
  x: number;
  y: number;
  z: number;
  links: number[];
}

const tr = new TraceResult();

/**
 * Links nav points that a player can walk between in a straight line: a hull trace lifted by
 * the step height (so steps, stairs and ramps pass) and ground under the midpoint.
 */
export function buildNavGraph(world: CollisionWorld, points: { x: number; y: number; z: number }[], maxLink = 26): NavNode[] {
  const T = TUNING.move;
  const nodes: NavNode[] = points.map((p) => ({ ...p, links: [] }));
  const lift = T.stepHeight;
  const hy = (T.standHeight - lift) / 2;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > maxLink || Math.abs(a.y - b.y) > 1.3) continue;
      world.trace(tr, a.x, a.y + lift + hy + 0.02, a.z, b.x, b.y + lift + hy + 0.02, b.z, T.radius, hy, T.radius, MASK.MOVE);
      if (tr.fraction < 1 || tr.startSolid) continue;
      let grounded = true;
      for (const k of [0.25, 0.5, 0.75]) {
        const x = a.x + (b.x - a.x) * k;
        const z = a.z + (b.z - a.z) * k;
        const y = a.y + (b.y - a.y) * k + 0.6;
        world.trace(tr, x, y, z, x, y - 2.2, z, 0, 0, 0, MASK.MOVE);
        if (tr.fraction === 1) grounded = false;
      }
      if (!grounded) continue;
      a.links.push(j);
      b.links.push(i);
    }
  }
  return nodes;
}

export function nearestNode(nodes: NavNode[], x: number, y: number, z: number, world?: CollisionWorld): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const d = Math.hypot(n.x - x, (n.y - y) * 2, n.z - z);
    if (d >= bestD) continue;
    if (world) {
      world.trace(tr, x, y + 1.0, z, n.x, n.y + 1.0, n.z, 0, 0, 0, MASK.MOVE);
      if (tr.fraction < 1) continue;
    }
    best = i;
    bestD = d;
  }
  return best;
}

/** A* over the graph; returns node indices from start to goal (inclusive), or null. */
export function findPath(nodes: NavNode[], start: number, goal: number): number[] | null {
  if (start < 0 || goal < 0) return null;
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open = new Set<number>([start]);
  const h = (i: number) => Math.hypot(nodes[i]!.x - nodes[goal]!.x, nodes[i]!.z - nodes[goal]!.z);
  const f = new Map<number, number>([[start, h(start)]]);
  while (open.size) {
    let cur = -1;
    let cf = Infinity;
    for (const i of open) {
      const v = f.get(i) ?? Infinity;
      if (v < cf) {
        cf = v;
        cur = i;
      }
    }
    if (cur === goal) {
      const path = [cur];
      while (came.has(cur)) {
        cur = came.get(cur)!;
        path.unshift(cur);
      }
      return path;
    }
    open.delete(cur);
    const n = nodes[cur]!;
    for (const j of n.links) {
      const m = nodes[j]!;
      const tentative = (g.get(cur) ?? Infinity) + Math.hypot(n.x - m.x, n.y - m.y, n.z - m.z);
      if (tentative < (g.get(j) ?? Infinity)) {
        came.set(j, cur);
        g.set(j, tentative);
        f.set(j, tentative + h(j));
        open.add(j);
      }
    }
  }
  return null;
}
