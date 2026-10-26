import { MASK } from '../collision/brush';
import { makeRng } from '../math';
import { MapBuilder, type Opening } from './builder';
import type { MapData, MaterialId } from './types';

/**
 * Varuskunta: a summer Finnish garrison. Core: the kasarmi (north, playable ground floor),
 * the asevarasto (east, raised floor with a loading dock and a fenced yard), the sotku (west,
 * red-ochre timber with a porch) around the paraatikenttä with the flagpole; the esterata runs
 * along the south as a flanking route. Outer ring (east, behind the puomi gate, open with more
 * than ~8 players): a tent camp with kaminas and a forest edge. -Z is north.
 */
export function buildGarrison(): MapData {
  const m = new MapBuilder();
  const face = (x: number, z: number) => Math.atan2(x, z);

  // Ground, roads and the parade ground.
  m.box(-200, -2, -200, 200, 0, 200, 'grass');
  m.box(-30, 0, -24, 30, 0.02, 22, 'gravel');
  m.box(-22, 0.02, -16, 22, 0.05, 16, 'asphalt');
  m.box(22, 0, -3, 84, 0.02, 3, 'gravel');
  m.box(-50, 0, -3, -30, 0.02, 3, 'gravel');

  // Flagpole on a plinth (landmark).
  m.box(-1.6, 0.05, -1.6, 1.6, 0.5, 1.6, 'concreteDark');
  m.cyl(0, 0, 0.11, 0.5, 13, 'metal', 8);
  m.prop({ kind: 'flagpole', x: 0, y: 0.5, z: 0, size: 12.5 });

  // Cover on the parade ground: two trucks, the field kitchen, planters, the review stand.
  truck(m, -11, 7, false);
  truck(m, 12, -7.5, true);
  m.box(6.6, 0.05, 8.2, 9.4, 1.35, 9.8, 'metalYellow');
  m.cyl(8.6, 9, 0.12, 1.35, 2.8, 'metal', 8);
  m.prop({ kind: 'sign', x: 8, y: 1.9, z: 9.85, text: 'HERNEKEITTO TORSTAISIN', size: 2.6 });
  for (const [x, z] of [
    [-18, -12],
    [18, -12],
    [-18, 12.5],
    [18, 12.5],
  ] as const)
    m.box(x - 1, 0.05, z - 0.5, x + 1, 0.95, z + 0.5, 'concrete');
  m.box(-5, 0.05, -16, 5, 0.9, -12.6, 'planks');
  m.stairs(-1.5, 0.05, -12.6, 1.5, 0.9, -11.4, '-z', 3, 'planks');
  for (const x of [-14, 14]) m.box(x - 1.2, 0.05, 15.2, x + 1.2, 0.5, 15.7, 'planks');

  kasarmi(m);
  asevarasto(m);
  sotku(m);
  esterata(m);

  // North alley behind the kasarmi: bins, a bike shed, a store.
  for (const [x, z] of [
    [-34, -45],
    [-17, -44.5],
    [9, -45],
    [31, -44.6],
  ] as const)
    m.box(x - 0.9, 0, z - 0.6, x + 0.9, 1.3, z + 0.6, 'metal');
  m.box(-6, 2.3, -48.5, 2, 2.45, -45.5, 'roofTin');
  for (const x of [-5.9, 1.9]) for (const z of [-48.4, -45.6]) m.box(x - 0.06, 0, z - 0.06, x + 0.06, 2.3, z + 0.06, 'metal');
  m.box(18, 0, -49, 24, 2.6, -46, 'plaster');

  // West alley: a woodshed and log piles.
  m.box(-49, 0, -6, -45, 2.4, 2, 'redwood');
  m.prism(-49.3, 2.4, -6.3, -44.7, 3.2, 2.3, 'z', 'roofFelt');
  m.box(-47.5, 0, 10, -44.5, 1.0, 13, 'logs');
  m.box(-49, 0, 20, -46, 1.2, 22, 'logs');

  const gateBrushes = perimeterAndGate(m);
  outerRing(m, [...NAV.map(([x, z]) => [x, z] as [number, number]), ...OUTER_SPAWNS.map(([x, , z]) => [x, z] as [number, number])]);

  // Trees around the outside of the fence and a few inside.
  const rnd = makeRng(1918);
  let placed = 0;
  for (let i = 0; i < 3000 && placed < 360; i++) {
    const x = rnd() * 300 - 140;
    const z = rnd() * 300 - 150;
    const inCore = x > -56 && x < 56 && z > -54 && z < 50;
    const inOuter = x > 50 && x < 96 && z > -50 && z < 48;
    if (inCore || inOuter) continue;
    const r = rnd();
    m.prop({ kind: r < 0.55 ? 'spruce' : r < 0.8 ? 'pine' : 'birch', x, y: 0, z, yaw: rnd() * 6.28, scale: 0.8 + rnd() * 0.6 });
    placed++;
  }
  for (const [x, z] of [
    [-44, 30],
    [-38, 42],
    [40, 42],
    [-24, -48],
    [44, 28],
  ] as const) {
    m.propCollider(x, z, 0.149 * 1.05, 0, 4, 'wood', 8);
    m.prop({ kind: 'birch', x, y: 0, z, scale: 1.05, solid: true });
  }

  // Spawns: core (always) and outer ring (gate open).
  const core: [number, number, number][] = [
    [-21, 0.05, -37],
    [21, 0.05, -37],
    [-21, 0.05, -29],
    [21, 0.05, -29],
    [-12, 0, -45.5],
    [14, 0, -45.5],
    [-35, 0.36, 6],
    [-46, 0, -9],
    [-46, 0, 16],
    [35, 1.02, -17],
    [45, 0, -18],
    [-31, 0.03, 35],
    [31, 0.03, 36],
    [-46, 0, 41],
    [46, 0, 41],
    [46, 0, 9],
  ];
  for (const [x, y, z] of core) m.spawn(x, y, z, face(-x, -z));
  for (const [x, y, z] of OUTER_SPAWNS) m.spawn(x, y, z, face(-x + 30, -z), true);
  for (const [x, z, y] of NAV) m.navPoint(x, z, y ?? 0);

  return m.build('varuskunta', { minX: -56, minZ: -54, maxX: 96, maxZ: 50 }, [0.45, 0.78, 0.43], {
    gateBrushes: gateBrushes,
  });
}

/** Sisu-style truck: chassis, cab, wheels and a canvas-covered bed. */
function truck(m: MapBuilder, cx: number, cz: number, alongZ: boolean): void {
  const L = 7.4;
  const W = 2.4;
  const box = (a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, mat: MaterialId) => {
    // a runs along the truck's length, b across it.
    if (alongZ) m.box(cx + b0, y0, cz + a0, cx + b1, y1, cz + a1, mat);
    else m.box(cx + a0, y0, cz + b0, cx + a1, y1, cz + b1, mat);
  };
  const h = L / 2;
  const w = W / 2;
  box(-h, 0.55, -w + 0.1, h, 1.35, w - 0.1, 'metal');
  for (const a of [-h + 1.1, h - 2.2, h - 1.0])
    for (const s of [-1, 1]) box(a - 0.5, 0.05, s > 0 ? w - 0.45 : -w, a + 0.5, 1.05, s > 0 ? w : -w + 0.45, 'rubber');
  box(-h, 1.35, -w, -h + 2.2, 3.0, w, 'metal');
  box(-h + 2.3, 1.35, -w, h, 1.9, w, 'metal');
  if (alongZ) m.prism(cx - w, 1.9, cz - h + 2.3, cx + w, 3.25, cz + h, 'z', 'canvas');
  else m.prism(cx - h + 2.3, 1.9, cz - w, cx + h, 3.25, cz + w, 'x', 'canvas');
}

function kasarmi(m: MapBuilder): void {
  const x0 = -28;
  const x1 = 28;
  const z0 = -40;
  const z1 = -26;
  const t = 0.3;
  const H = 6.4;
  const door = (at: number, w = 1.3): Opening => ({ at, width: w, bottom: 0, top: 2.3 });
  const win = (at: number): Opening => ({ at, width: 1.5, bottom: 1.0, top: 2.1 });
  const southRooms = [-21, -7, 7, 21];
  const southOpen: Opening[] = [door(-7 - x0 - 0.65), door(7 - x0 - 0.65)];
  for (const c of southRooms) {
    for (const off of [-4, 2.5]) {
      const at = c + off - x0;
      if (!southOpen.some((o) => Math.abs(o.at - at) < 2)) southOpen.push(win(at));
    }
  }
  m.wall('x', x0, 0, z1 - t, x1 - x0, H, t, 'brick', southOpen);
  const northOpen: Opening[] = [door(-21 - x0 - 0.65), door(21 - x0 - 0.65)];
  for (const c of southRooms) northOpen.push(win(c - 4.5 - x0), win(c + 3 - x0));
  m.wall('x', x0, 0, z0, x1 - x0, H, t, 'brick', northOpen);
  m.wall('z', x0, 0, z0 + t, z1 - z0 - 2 * t, H, t, 'brick', [{ at: 6.3, width: 1.4, bottom: 0, top: 2.3 }]);
  m.wall('z', x1 - t, 0, z0 + t, z1 - z0 - 2 * t, H, t, 'brick', [{ at: 6.3, width: 1.4, bottom: 0, top: 2.3 }]);
  m.box(x0 + t, 3.2, z0 + t, x1 - t, 3.5, z1 - t, 'concrete');
  m.box(x0 + t, 0, z0 + t, x1 - t, 0.05, z1 - t, 'concrete');
  m.prism(x0 - 0.4, H, z0 - 0.4, x1 + 0.4, 9.2, z1 + 0.4, 'x', 'roofTin');
  // Corridor and rooms on the ground floor.
  const ci = 0.15;
  const corrN = -34.6;
  const corrS = -31.4;
  const roomDoors = southRooms.map((c) => door(c - (x0 + t) - 0.55, 1.1));
  m.wall('x', x0 + t, 0.05, corrN - ci, x1 - x0 - 2 * t, 3.15, ci, 'plaster', roomDoors);
  m.wall('x', x0 + t, 0.05, corrS, x1 - x0 - 2 * t, 3.15, ci, 'plaster', roomDoors);
  for (const x of [-14, 0, 14]) {
    m.box(x - ci / 2, 0.05, z0 + t, x + ci / 2, 3.2, corrN - ci, 'plaster');
    m.box(x - ci / 2, 0.05, corrS + ci, x + ci / 2, 3.2, z1 - t, 'plaster');
  }
  // Bunks and lockers as cover inside the rooms.
  for (const c of southRooms) {
    m.box(c - 4.5, 0.05, -39.4, c - 2.5, 1.1, -38.4, 'metal');
    m.box(c + 2, 0.05, -39.4, c + 4, 1.1, -38.4, 'metal');
    m.box(c - 5.5, 0.05, -27.2, c - 4.6, 2.0, -26.4, 'metal');
    m.box(c + 4, 0.05, -29.5, c + 6, 0.8, -28.5, 'planks');
  }
  m.prop({ kind: 'sign', x: 0, y: 4.6, z: z1 + 0.02, text: 'KASARMI 3', size: 3 });
}

function asevarasto(m: MapBuilder): void {
  const x0 = 28;
  const x1 = 40;
  const z0 = -20;
  const z1 = -4;
  const t = 0.3;
  const H = 4.4;
  // Raised floor at loading-dock height.
  m.box(x0 + t, 0, z0 + t, x1 - t, 1.0, z1 - t, 'concrete');
  m.wall('z', x0, 0, z0 + t, z1 - z0 - 2 * t, H, t, 'ochre', [{ at: 5.7, width: 5, bottom: 1.0, top: 3.7 }]);
  m.wall('z', x1 - t, 0, z0 + t, z1 - z0 - 2 * t, H, t, 'ochre', [{ at: 9.7, width: 1.3, bottom: 1.0, top: 3.2 }]);
  m.wall('x', x0, 0, z0, x1 - x0, H, t, 'ochre', [
    { at: 3, width: 1.4, bottom: 2.0, top: 3.0 },
    { at: 8, width: 1.4, bottom: 2.0, top: 3.0 },
  ]);
  m.wall('x', x0, 0, z1 - t, x1 - x0, H, t, 'ochre', [{ at: 3, width: 2, bottom: 1.9, top: 2.9 }]);
  m.box(x0 - 0.2, H, z0 - 0.2, x1 + 0.2, H + 0.3, z1 + 0.2, 'concreteDark');
  // The varusmestari's service hatch with its hazard-striped counter.
  m.box(31, 0, z1, 33, 1.1, z1 + 0.6, 'metalYellow');
  m.prop({ kind: 'sign', x: 34, y: 3.6, z: z1 + 0.02, text: 'ASEVARASTO', size: 3 });
  // Loading dock with steps at both ends and a hazard edge.
  m.box(25.5, 0, -16, x0, 1.0, -6, 'concrete');
  m.box(25.4, 0.7, -16, 25.5, 1.0, -6, 'metalYellow');
  m.stairs(25.5, 0, -6, 27.5, 1.0, -4.2, '-z', 5, 'concrete');
  m.stairs(25.5, 0, -17.8, 27.5, 1.0, -16, '+z', 5, 'concrete');
  m.stairs(x1, 0, -10.6, 41.6, 1.0, -8.8, '-x', 5, 'concrete');
  // Racks inside.
  for (const [ax, az, bx, bz] of [
    [30.5, -18.4, 37.5, -17.8],
    [30.5, -14.2, 36, -13.6],
    [32, -10.2, 38.5, -9.6],
    [30.5, -6.4, 35.5, -5.8],
  ] as const)
    m.box(ax, 1.0, az, bx, 3.0, bz, 'metal');
  // Fenced yard: chain-link stops players and grenades but not bullets.
  const fence = (x0f: number, z0f: number, x1f: number, z1f: number) => m.box(x0f, 0, z0f, x1f, 2.2, z1f, 'clip', MASK.MOVE | MASK.GRENADE);
  fence(40, -22.1, 49.1, -22);
  fence(49, -22, 49.1, -6);
  fence(44, -6.1, 49.1, -6);
  fence(40, -22, 40.1, -20);
  m.prop({ kind: 'wire', x: 44.5, y: 0, z: -22.05, size: 9 });
  m.prop({ kind: 'wire', x: 49.05, y: 0, z: -14, size: 16, yaw: Math.PI / 2 });
  m.prop({ kind: 'wire', x: 46.5, y: 0, z: -6.05, size: 5 });
  m.box(41.5, 0, -21.4, 47.5, 2.6, -19, 'metal');
  m.crate(47.4, 0, -9.4, 1.2, 1.2);
  m.crate(46, 0, -9.1, 1.0, 0.9, 0.3);
  m.crate(47.6, 0, -12.6, 1.4, 1.4);
}

function sotku(m: MapBuilder): void {
  const x0 = -40;
  const x1 = -28;
  const z0 = -10;
  const z1 = 10;
  const t = 0.25;
  const H = 3.6;
  m.box(x0 + t, 0, z0 + t, x1 - t, 0.35, z1 - t, 'planks');
  m.wall('z', x1 - t, 0, z0 + t, z1 - z0 - 2 * t, H, t, 'redwood', [
    { at: 3.3, width: 1.4, bottom: 0, top: 2.4 },
    { at: 8, width: 1.6, bottom: 1.2, top: 2.4 },
    { at: 13.3, width: 1.4, bottom: 0, top: 2.4 },
  ]);
  m.wall('z', x0, 0, z0 + t, z1 - z0 - 2 * t, H, t, 'redwood', [
    { at: 8.4, width: 1.3, bottom: 0, top: 2.4 },
    { at: 3, width: 1.4, bottom: 1.3, top: 2.4 },
    { at: 14, width: 1.4, bottom: 1.3, top: 2.4 },
  ]);
  m.wall('x', x0, 0, z0, x1 - x0, H, t, 'redwood', [
    { at: 3, width: 1.4, bottom: 1.3, top: 2.4 },
    { at: 7.5, width: 1.3, bottom: 0, top: 2.4 },
  ]);
  m.wall('x', x0, 0, z1 - t, x1 - x0, H, t, 'redwood', [{ at: 5.5, width: 1.6, bottom: 1.3, top: 2.4 }]);
  m.prism(x0 - 0.5, H, z0 - 0.5, x1 + 0.5, 6.2, z1 + 0.5, 'z', 'roofFelt');
  m.box(x0 + t, H - 0.06, z0 + t, x1 - t, H, z1 - t, 'plaster');
  // Porch facing the parade ground.
  m.box(x1, 0, -9, -25.4, 0.35, 9, 'planks');
  for (const z of [-8.8, -3, 3, 8.8]) m.box(-25.6, 0.35, z - 0.08, -25.44, 3.0, z + 0.08, 'planks');
  m.box(x1, 3.0, -9.2, -25.2, 3.15, 9.2, 'roofFelt');
  // Long tables and the kitchen counter.
  for (const x of [-35, -31.6]) m.box(x - 0.5, 0.35, -6.5, x + 0.5, 1.15, 2.5, 'planks');
  m.box(x0 + t, 0.35, 1.5, -38.8, 1.35, 8.5, 'metal');
  m.prop({ kind: 'sign', x: x1 + 0.03, y: 2.9, z: 0, yaw: Math.PI / 2, text: 'SOTKU', size: 2 });
}

function esterata(m: MapBuilder): void {
  m.box(-34, 0, 22, 34, 0.03, 40, 'sand');
  for (const x of [-30, -26.5]) m.box(x, 0.03, 24, x + 0.32, 0.6, 38, 'logs');
  m.box(-21, 0.03, 24, -20.6, 1.0, 38, 'planks');
  for (const z of [27.8, 33.8]) m.box(-16, 0.03, z, -8, 0.5, z + 0.4, 'logs');
  // Crawl net: crouch to get under it.
  m.box(-4, 1.3, 25, 4, 1.38, 37, 'canvas');
  for (const x of [-4, 3.9]) for (const z of [25, 30.95, 36.9]) m.box(x, 0.03, z, x + 0.1, 1.3, z + 0.1, 'logs');
  // High wall with gaps at both ends.
  m.box(8, 0.03, 26, 8.5, 2.3, 36, 'planks');
  for (let i = 0; i < 5; i++) m.prop({ kind: 'tire', x: 12.5 + i * 1.3, y: 0.03, z: 29 + (i % 2) * 1.2 });
  // Climbing frame: platform and a higher deck.
  m.stairs(16, 0.03, 29, 20, 1.2, 33, '+x', 5, 'planks');
  m.box(20, 0.03, 28, 26, 1.2, 34, 'planks');
  m.stairs(20, 1.2, 33, 23, 2.4, 34, '+x', 5, 'planks');
  m.box(23, 1.2, 28, 26, 2.4, 33, 'planks');
  m.box(23, 2.4, 28, 26, 3.2, 28.1, 'planks');
  m.prop({ kind: 'sign', x: -33, y: 1.0, z: 23, text: 'ESTERATA', size: 1.8 });
}

/** Perimeter fence and the gate; returns the brushes that close the gate. */
function perimeterAndGate(m: MapBuilder): number[] {
  const fence = (x0: number, z0: number, x1: number, z1: number) => m.box(x0, 0, z0, x1, 3, z1, 'clip', MASK.MOVE | MASK.GRENADE);
  fence(-52.1, -50.1, 52.1, -50);
  fence(-52.1, 46, 52.1, 46.1);
  fence(-52.1, -50, -52, 46);
  fence(52, -50, 52.1, -3.2);
  fence(52, 3.2, 52.1, 46);
  m.prop({ kind: 'wire', x: 0, y: 0, z: -50.05, size: 104 });
  m.prop({ kind: 'wire', x: 0, y: 0, z: 46.05, size: 104 });
  m.prop({ kind: 'wire', x: -52.05, y: 0, z: -2, size: 96, yaw: Math.PI / 2 });
  m.prop({ kind: 'wire', x: 52.05, y: 0, z: -26.6, size: 46.8, yaw: Math.PI / 2 });
  m.prop({ kind: 'wire', x: 52.05, y: 0, z: 24.6, size: 42.8, yaw: Math.PI / 2 });
  // The gate: a clip in the opening while it is closed, a striped boom and a guard booth.
  const gate = m.brushes.length;
  m.box(51.95, 0, -3.2, 52.15, 4, 3.2, 'clip', MASK.MOVE | MASK.GRENADE);
  m.prop({ kind: 'boom', x: 52.05, y: 0, z: -3.3, size: 6.4 });
  m.box(53, 0, -7.2, 55.2, 2.5, -4.6, 'plaster');
  m.box(52.8, 2.5, -7.4, 55.4, 2.7, -4.4, 'roofTin');
  m.prop({ kind: 'sign', x: 52.0, y: 3.4, z: 3.6, yaw: Math.PI / 2, text: 'PORTTI', size: 1.4 });
  return [gate];
}

/** Outer ring; random trees and rocks keep clear of the reserved points (nav, spawns). */
function outerRing(m: MapBuilder, reserved: [number, number][]): void {
  // A loop of forest paths stays open so bots can walk it.
  const paths: [number, number][] = [[60, 12], [70, 18], [84, 14], [90, 28], [78, 38], [64, 32], [60, 12], [57, 7], [63, 0]];
  const segDist = (x: number, z: number, a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const k = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(a[0] + dx * k - x, a[1] + dz * k - z);
  };
  const clear = (x: number, z: number, r: number) =>
    reserved.every(([rx, rz]) => Math.hypot(rx - x, rz - z) > r) && paths.every((p, i) => i === 0 || segDist(x, z, paths[i - 1]!, p) > r * 0.7);
  m.clip(52, -5, -52, 96, 40, -50);
  m.clip(52, -5, 46, 96, 40, 48);
  m.clip(94, -5, -52, 96, 40, 48);
  // Tent camp: tents with stove pipes, a woodpile and a latrine.
  for (const [x, z] of [
    [60, -30],
    [69, -30],
    [60, -18],
    [69, -18],
    [80, -26],
  ] as const) {
    m.prism(x - 2.2, 0, z - 3, x + 2.2, 2.7, z + 3, 'z', 'canvas');
    m.prop({ kind: 'chimney', x: x + 0.9, y: 1.4, z: z + 1.5 });
  }
  m.box(75, 0, -40, 79, 1.0, -38, 'logs');
  m.box(86, 0, -14, 87.4, 2.2, -12.6, 'planks');
  m.box(64, 0, -10, 66.5, 1.2, -8, 'logs');
  // Forest edge with rocks.
  const rnd = makeRng(77);
  for (let i = 0; i < 26; i++) {
    const x = 56 + rnd() * 36;
    const z = 8 + rnd() * 36;
    const r = rnd();
    if (!clear(x, z, 2.2)) continue;
    const kind = r < 0.6 ? 'spruce' : 'pine';
    const scale = 0.75 + rnd() * 0.35;
    // Trunk radius at chest height for the drawn tree.
    m.propCollider(x, z, (kind === 'pine' ? 0.207 : 0.122) * scale, 0, 4, 'wood', 8);
    m.prop({ kind, x, y: 0, z, yaw: rnd() * 6, scale, solid: true });
  }
  for (let i = 0; i < 8; i++) {
    const x = 58 + rnd() * 32;
    const z = 10 + rnd() * 32;
    const s = 1 + rnd() * 1.4;
    const yaw = rnd() * 3;
    if (!clear(x, z, s * 1.6 + 1.2)) continue;
    m.obb(x, 0, z, s * 1.4, s * 0.9, s, yaw, 'concreteDark');
  }
}

const OUTER_SPAWNS: [number, number, number][] = [
  [58, 0, -40],
  [74, 0, -8],
  [86, 0, -32],
  [62, 0, 22],
  [80, 0, 36],
  [88, 0, 8],
  [57, 0, 7],
  [60, 0, -10],
];

/** Bot navigation points [x, z, floor height]; links are found automatically. */
const NAV: [number, number, number?][] = [
  // Parade ground and its edges.
  [-16, -9], [-6, -9], [6, -10.5], [16, -12], [-16, 0], [-5, 0], [5, 0], [16, 0], [0, -6], [0, 6],
  [-16, 11], [-5, 12], [5, 13], [16, 9], [-24, -21], [-12, -21], [0, -21], [12, -21], [24, -21],
  [-25, 0], [25, 0], [-24, 19], [-8, 19], [8, 19], [24, 19],
  // Kasarmi: outside the doors, rooms, corridor, end doors.
  [-7, -24], [7, -24], [-7, -28.5], [7, -28.5], [-21, -28.5], [21, -28.5],
  [-26, -33], [-14, -33], [-7, -33], [0, -33], [7, -33], [14, -33], [26, -33], [-30, -33], [30, -33],
  [-21, -37], [-7, -37], [7, -37], [21, -37], [-21, -41.5], [21, -41.5],
  // North alley, close to the kasarmi wall (clear of the bins).
  [-44, -43], [-28, -42.8], [-12, -42.8], [4, -42.8], [20, -42.8], [36, -42.8], [46, -43],
  // Sotku: porch and raised floor.
  [-26.5, -6, 0.36], [-26.5, 4, 0.36], [-33.5, -7.5, 0.36], [-33.5, 4, 0.36], [-36.8, -1.2, 0.36], [-36.8, -7.8, 0.36],
  [-36.8, 3.6, 0.36], [-42.5, -0.7],
  [-46, -18], [-43, 0], [-46, 16], [-46, 30], [-32.5, -12.5], [-34, 12.5],
  // Asevarasto: dock, the aisles between the racks (raised floor), back door, yard.
  [26.5, -11, 1.0], [29.4, -16, 1.0], [38.7, -16, 1.0], [29.4, -11.9, 1.0], [38.7, -11.9, 1.0], [29.4, -8, 1.0], [38.7, -8, 1.0],
  [29.4, -5, 1.0], [37, -5, 1.0], [39, -9.35, 1.0], [42.4, -9.6], [26.5, -3.2], [26.5, -18.8],
  [43.5, -15], [44, -10.5], [42.5, -4.5], [33, -1.6],
  // Road to the gate and the outer ring.
  [40, 0], [48, 0], [55, 0], [63, 0], [72, 0], [82, 0],
  [56, -24], [64.5, -24], [64.5, -36], [64.5, -12], [74, -24], [74, -36], [86, -36], [86, -18],
  [60, 12], [70, 18], [84, 14], [90, 28], [78, 38], [64, 32],
  // South: around the esterata (its obstacles need jumping) and the corners.
  [-44, 40], [-32, 23], [-18, 23], [-6, 23], [6, 23], [18, 23], [30, 23],
  [-32, 39], [-12, 39], [0, 39], [14, 39], [30, 39], [44, 40], [44, 24], [-40, 24],
];
