import { makeRng } from '../math';
import { MapBuilder } from './builder';
import type { MapData } from './types';
import { FI } from '../fi';
import { UI } from '../ui';

/**
 * Ampumarata: a summer shooting range with a covered firing point, six lanes with targets
 * at 10, 25 and 50 m, a moving target rail, pop-up drill targets behind cover, and a
 * training yard behind the firing point (kill house, tower, crates) for movement testing.
 * The firing line is at z = 0, facing -Z.
 */
export function buildRange(): MapData {
  const m = new MapBuilder();
  const S = FI.range.signs;

  // Ground and floors.
  m.box(-150, -2, -180, 150, 0, 120, 'grass');
  m.box(-22, 0, -58, 22, 0.02, -1.2, 'gravel');
  m.box(-30, 0, 7.4, 30, 0.03, 38, 'dirt');

  // Firing point: slab, roof, back wall with two doors, half side walls.
  m.box(-17, 0, -1.2, 17, 0.12, 7.4, 'concrete');
  for (let x = -15; x <= 15; x += 5) {
    m.box(x - 0.1, 0.12, -1.1, x + 0.1, 3.0, -0.9, 'wood');
  }
  m.wedge(-17, 3.0, -1.6, 17, 3.55, 7.6, '+z', 'roofTin', 3.2);
  m.wall('x', -17, 0.12, 7.2, 34, 2.88, 0.2, 'planks', [
    { at: 5.5, width: 1.6, bottom: 0, top: 2.2 },
    { at: 26.5, width: 1.6, bottom: 0, top: 2.2 },
  ]);
  m.wall('z', -17, 0.12, 2, 5.2, 2.88, 0.2, 'planks', [{ at: 1.2, width: 2.2, bottom: 1.1, top: 2.1 }]);
  m.wall('z', 16.8, 0.12, 2, 5.2, 2.88, 0.2, 'planks', [{ at: 1.2, width: 2.2, bottom: 1.1, top: 2.1 }]);

  // Shooting tables, one per lane.
  const lanes = [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5];
  lanes.forEach((x, i) => {
    m.box(x - 0.85, 0.86, -0.95, x + 0.85, 0.94, -0.25, 'planks');
    m.box(x - 0.8, 0.12, -0.9, x - 0.66, 0.86, -0.3, 'planks');
    m.box(x + 0.66, 0.12, -0.9, x + 0.8, 0.86, -0.3, 'planks');
    m.prop({ kind: 'sign', x, y: 2.62, z: -1.12, text: String(i + 1), size: 0.5 });
  });
  m.prop({ kind: 'sign', x: 0, y: 3.85, z: -1.2, text: S.title, size: 1.6 });

  // The duty table against the back wall, where the training's phone waits.
  m.box(4.8, 0.86, 6.2, 6.2, 0.94, 6.9, 'planks');
  m.box(4.85, 0.12, 6.25, 4.99, 0.86, 6.85, 'planks');
  m.box(6.01, 0.12, 6.25, 6.15, 0.86, 6.85, 'planks');
  m.prop({ kind: 'sign', x: 5.5, y: 2.05, z: 7.18, yaw: Math.PI, text: S.duty, size: 0.6 });

  // Distance markers along the left side.
  for (const d of [10, 25, 50]) m.prop({ kind: 'sign', x: -19.5, y: 0.9, z: -d, yaw: Math.PI / 2, text: `${d} m`, size: 0.7 });

  // Static targets.
  lanes.forEach((x, i) => {
    if (i % 2 === 0) m.target({ kind: 'silhouette', x, y: 0.02, z: -10, yaw: 0 });
    else m.target({ kind: 'plate', x, y: 1.15, z: -10, yaw: 0, radius: 0.2 });
    if (i % 2 === 1) m.target({ kind: 'silhouette', x, y: 0.02, z: -25, yaw: 0 });
    m.target({ kind: 'gong', x, y: 1.45, z: -50, yaw: 0, radius: 0.36 });
  });
  m.target({ kind: 'plate', x: -12.5, y: 1.0, z: -25, yaw: 0, radius: 0.16 });
  m.target({ kind: 'plate', x: 2.5 - 5, y: 1.0, z: -25, yaw: 0, radius: 0.16 });

  // Moving target behind a low protective wall, on a rail across all lanes.
  m.box(-16, 0.02, -19.2, 16, 0.55, -18.8, 'concreteDark');
  m.box(-16, 0.02, -20.15, 16, 0.12, -19.85, 'metal');
  m.target({ kind: 'silhouette', x: -14, y: 0.12, z: -20, yaw: 0, rail: { x0: -14, x1: 14, speed: 3.2 } });

  // Start plate: shooting it starts a drill.
  m.target({ kind: 'start', x: 0, y: 1.3, z: -6, yaw: 0, radius: 0.22 });
  m.prop({ kind: 'sign', x: 0, y: 0.75, z: -6, text: UI.range.startSign, size: 0.9 });

  // Drill cover downrange and the pop-up targets that use it.
  const barrier = (x: number, z: number, len = 2.4) => m.box(x - len / 2, 0.02, z - 0.3, x + len / 2, 0.85, z + 0.3, 'concrete');
  barrier(-9, -11.4);
  barrier(-3, -15.4);
  barrier(14, -15.4);
  barrier(3, -21.4);
  barrier(0, -35.4, 3.2);
  for (const [x, z] of [
    [6.6, -12.2],
    [7.3, -12.6],
    [-16.4, -22.2],
  ] as const) {
    m.propCollider(x, z, 0.3, 0.02, 0.92, 'metal', 12);
    m.prop({ kind: 'barrel', x, y: 0.02, z });
  }
  m.wall('x', -9.5, 0.02, -28.6, 4.5, 2.4, 0.15, 'plywood', [{ at: 1.2, width: 1.4, bottom: 1.0, top: 1.75 }]);
  m.wall('x', 8, 0.02, -28.6, 4.5, 2.4, 0.15, 'plywood', [{ at: 1.6, width: 1.4, bottom: 1.0, top: 1.75 }]);
  m.sandbags('x', -15, -36.5, 3.4);
  const popups: [number, number][] = [
    [-9.6, -12.4],
    [5.4, -12.8],
    [-3.4, -16.4],
    [14.6, -16.4],
    [-16.6, -23.4],
    [3.2, -22.4],
    [-7.4, -29.6],
    [10.3, -29.6],
    [0.6, -36.4],
    [-13.6, -37.6],
  ];
  for (const [x, z] of popups) m.target({ kind: 'silhouette', x, y: 0.02, z, yaw: 0, popup: true });

  // Backstop and side berms.
  m.wedge(-46, 0, -68, 46, 7, -58, '-z', 'berm');
  m.box(-46, 0, -80, 46, 7, -68, 'berm');
  m.prism(22, 0, -68, 34, 4.5, 2, 'z', 'berm');
  m.prism(-34, 0, -68, -22, 4.5, 2, 'z', 'berm');

  // Training yard: kill house (open top).
  const kx = -27;
  const kz = 11;
  const H = 2.7;
  const t = 0.14;
  m.wall('x', kx, 0.03, kz, 14, H, t, 'plywood', [
    { at: 2.5, width: 1.2, bottom: 0, top: 2.1 },
    { at: 8, width: 1.5, bottom: 1.0, top: 1.8 },
  ]);
  m.wall('x', kx, 0.03, kz + 12 - t, 14, H, t, 'plywood', [{ at: 9.5, width: 1.2, bottom: 0, top: 2.1 }]);
  m.wall('z', kx, 0.03, kz + t, 12 - 2 * t, H, t, 'plywood', [{ at: 4, width: 1.6, bottom: 1.0, top: 1.8 }]);
  m.wall('z', kx + 14 - t, 0.03, kz + t, 12 - 2 * t, H, t, 'plywood', [{ at: 6.5, width: 1.2, bottom: 0, top: 2.1 }]);
  m.wall('z', kx + 6, 0.03, kz + t, 12 - 2 * t, H, t, 'plywood', [
    { at: 1.5, width: 1.1, bottom: 0, top: 2.1 },
    { at: 8.2, width: 1.1, bottom: 0, top: 2.1 },
  ]);
  m.wall('x', kx + 6 + t, 0.03, kz + 6, 8 - 2 * t, H, t, 'plywood', [{ at: 3, width: 1.1, bottom: 0, top: 2.1 }]);

  // Tower with stairs and a ramp.
  m.box(12, 2.82, 14, 18, 3.0, 20, 'planks');
  for (const [x, z] of [
    [12.1, 14.1],
    [17.9, 14.1],
    [12.1, 19.9],
    [17.9, 19.9],
  ] as const)
    m.box(x - 0.12, 0.03, z - 0.12, x + 0.12, 2.82, z + 0.12, 'logs');
  m.stairs(16.6, 0.03, 20, 18, 3.0, 24, '-z', 12, 'planks');
  m.wedge(5.6, 0.03, 15.2, 12, 3.0, 17.2, '+x', 'planks');
  m.box(12, 3.0, 14, 18, 4.0, 14.12, 'planks');
  m.box(17.88, 3.0, 14.12, 18, 4.0, 20, 'planks');
  m.box(12, 3.0, 17.2, 12.12, 4.0, 20, 'planks');
  m.box(12, 3.0, 19.88, 16.6, 4.0, 20, 'planks');

  // Crates and low cover in the middle of the yard.
  m.crate(-4, 0.03, 12, 1.0, 0.4);
  m.crate(-2.4, 0.03, 12.4, 1.2, 0.8);
  m.crate(-0.6, 0.03, 13, 1.2, 1.2);
  m.crate(-0.6, 1.23, 13, 0.9, 0.9);
  m.crate(2.6, 0.03, 15, 1.4, 1.0, 0.35);
  m.crate(5, 0.03, 12.5, 1.0, 1.0, -0.2);
  m.crate(-3, 0.03, 18.5, 1.6, 1.4);
  m.sandbags('x', 0, 20.5, 4.2);
  m.sandbags('z', 8.6, 10.5, 3.4);

  // Wall with windows across the back of the yard.
  m.wall('x', -22, 0.03, 28, 30, 2.6, 0.3, 'concrete', [
    { at: 4, width: 1.4, bottom: 1.0, top: 1.8 },
    { at: 10, width: 1.4, bottom: 0, top: 2.2 },
    { at: 17, width: 1.6, bottom: 1.0, top: 1.8 },
    { at: 24, width: 1.4, bottom: 0, top: 2.2 },
  ]);

  // Range office hut.
  const ox = 20;
  const oz = 27;
  m.wall('x', ox, 0.03, oz, 7, 2.6, 0.2, 'ochre', [
    { at: 1.2, width: 1.0, bottom: 0, top: 2.1 },
    { at: 4, width: 1.4, bottom: 1.0, top: 1.9 },
  ]);
  m.wall('x', ox, 0.03, oz + 5.8, 7, 2.6, 0.2, 'ochre', [{ at: 2.5, width: 1.4, bottom: 1.0, top: 1.9 }]);
  m.wall('z', ox, 0.03, oz + 0.2, 5.6, 2.6, 0.2, 'ochre');
  m.wall('z', ox + 6.8, 0.03, oz + 0.2, 5.6, 2.6, 0.2, 'ochre');
  m.box(ox, 2.63, oz, ox + 7, 2.75, oz + 6, 'ochre');
  m.prism(ox - 0.3, 2.75, oz - 0.3, ox + 7.3, 4.0, oz + 6.3, 'x', 'roofFelt');
  m.box(ox + 0.6, 0.03, oz + 4.6, ox + 2.2, 0.8, oz + 5.6, 'planks');
  m.prop({ kind: 'sign', x: ox + 3.5, y: 2.25, z: oz - 0.03, yaw: Math.PI, text: S.office, size: 1.1 });
  m.cyl(ox - 3, oz + 3, 0.07, 0.03, 9, 'metal', 6);
  m.prop({ kind: 'flagpole', x: ox - 3, y: 0.03, z: oz + 3, size: 9 });

  // Yard birches with trunk collision.
  for (const [x, z] of [
    [-8, 33],
    [10, 34.5],
    [26, 12],
    [-29, 30],
  ] as const) {
    m.propCollider(x, z, 0.149 * 1.1, 0.03, 4, 'wood', 8);
    m.prop({ kind: 'birch', x, y: 0.03, z, scale: 1.1, solid: true });
  }

  // Perimeter: clips and the fence along the back.
  m.clip(-36, -5, -82, -33.5, 40, 42);
  m.clip(33.5, -5, -82, 36, 40, 42);
  m.clip(-36, -5, 38.5, 36, 40, 41);
  m.clip(-36, 7, -82, 36, 40, -66);
  m.prop({ kind: 'wire', x: 0, y: 0, z: 38.5, size: 66 });

  // Forest around everything.
  const rnd = makeRng(20261026);
  const inside = (x: number, z: number) => x > -40 && x < 40 && z > -86 && z < 44;
  let placed = 0;
  for (let i = 0; i < 2400 && placed < 420; i++) {
    const x = rnd() * 260 - 130;
    const z = rnd() * 280 - 170;
    if (inside(x, z)) continue;
    const r = rnd();
    const kind = r < 0.62 ? 'spruce' : r < 0.85 ? 'pine' : 'birch';
    m.prop({ kind, x, y: 0, z, yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.6 });
    placed++;
  }
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 80 - 40;
    const z = -84 - rnd() * 10;
    m.prop({ kind: 'bush', x, y: 0, z, scale: 0.7 + rnd() * 0.8 });
  }

  m.spawn(2.5, 0.14, 3.2, 0);
  return m.build('ampumarata', { minX: -36, minZ: -82, maxX: 36, maxZ: 42 }, [0.45, 0.78, 0.43]);
}
