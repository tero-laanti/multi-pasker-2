import { describe, expect, it } from 'vitest';
import { buildGarrison } from '../src/shared/map/garrison';
import { footprint, minimapKind, toMinimap } from '../src/client/ui/minimap';

const map = buildGarrison();

function areaOf(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

describe('minimap', () => {
  it('turns the map so that where you look is up', () => {
    const up = (dx: number, dz: number, yaw: number) => toMinimap(dx, dz, yaw).map((v) => Math.round(v * 1000) / 1000 + 0);
    // Yaw 0 looks north (-Z); a quarter turn left looks west (-X), right looks east.
    expect(up(0, -10, 0)).toEqual([0, -10]);
    expect(up(-10, 0, Math.PI / 2)).toEqual([0, -10]);
    expect(up(10, 0, -Math.PI / 2)).toEqual([0, -10]);
    // Facing north, east is to the right.
    expect(up(10, 0, 0)).toEqual([10, 0]);
  });

  it('outlines a box as its four corners from above', () => {
    const b = map.brushes.find((x) => x.mat === 'metalYellow')!;
    const poly = footprint(b);
    expect(poly).toHaveLength(4);
    expect(areaOf(poly)).toBeCloseTo((b.maxX - b.minX) * (b.maxZ - b.minZ), 5);
  });

  it('draws walls, cover, floors and the fence, but not the ground, roofs or tree trunks', () => {
    const kinds = new Map<string, number>();
    for (const b of map.brushes) {
      const k = minimapKind(b, areaOf(footprint(b))) ?? 'none';
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    expect(kinds.get('wall')).toBeGreaterThan(20);
    expect(kinds.get('low')).toBeGreaterThan(10);
    expect(kinds.get('floor')).toBeGreaterThan(3);
    expect(kinds.get('fence')).toBeGreaterThan(3);
    // The ground itself is not drawn.
    expect(minimapKind(map.brushes.find((x) => x.mat === 'grass')!, 1e5)).toBeNull();
    // Nothing that starts above head height (roofs, lintels over doorways).
    for (const b of map.brushes) if (b.minY > 1.8 && b.mat !== 'clip') expect(minimapKind(b, 1)).toBeNull();
    // Tree trunk colliders are left to the drawn trees.
    const trunk = map.brushes.find((x) => x.mat === 'clip' && Math.max(x.maxX - x.minX, x.maxZ - x.minZ) < 0.5);
    expect(trunk).toBeDefined();
    if (trunk) expect(minimapKind(trunk, 0.1)).toBeNull();
  });
});
