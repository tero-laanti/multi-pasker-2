import {
  MASK,
  boxPlanes,
  brushFromPlanes,
  cylinderPlanes,
  obbPlanes,
  prismPlanes,
  wedgePlanes,
  type Brush,
  type SlopeDir,
} from '../collision/brush';
import { surfaceOf, type MapData, type MaterialId, type PropDef, type SpawnPoint, type TargetDef } from './types';

export interface Opening {
  /** Offset along the wall from its start (metres). */
  at: number;
  width: number;
  /** Bottom of the opening above the wall's base (0 for doors). */
  bottom: number;
  top: number;
}

/** Fluent helper for writing maps as code. All coordinates are metres, Y up. */
export class MapBuilder {
  brushes: Brush[] = [];
  props: PropDef[] = [];
  spawns: SpawnPoint[] = [];
  targets: TargetDef[] = [];

  private add(b: Brush): Brush {
    this.brushes.push(b);
    return b;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MaterialId, flags: number = MASK.ALL): Brush {
    return this.add(
      brushFromPlanes(
        boxPlanes(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
        { mat, surface: surfaceOf(mat), flags },
      ),
    );
  }

  /** Box centred at (cx, cz) standing on y0, rotated by yaw. */
  obb(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, yaw: number, mat: MaterialId, flags: number = MASK.ALL): Brush {
    return this.add(brushFromPlanes(obbPlanes(cx, y0 + sy / 2, cz, sx / 2, sy / 2, sz / 2, yaw), { mat, surface: surfaceOf(mat), flags }));
  }

  wedge(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    dir: SlopeDir,
    mat: MaterialId,
    lowY?: number,
    flags: number = MASK.ALL,
  ): Brush {
    return this.add(
      brushFromPlanes(wedgePlanes(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), dir, lowY ?? y0), {
        mat,
        surface: surfaceOf(mat),
        flags,
      }),
    );
  }

  prism(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, axis: 'x' | 'z', mat: MaterialId, flags: number = MASK.ALL): Brush {
    return this.add(
      brushFromPlanes(prismPlanes(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), axis), {
        mat,
        surface: surfaceOf(mat),
        flags,
      }),
    );
  }

  cyl(cx: number, cz: number, r: number, y0: number, y1: number, mat: MaterialId, sides = 8, flags: number = MASK.ALL): Brush {
    return this.add(brushFromPlanes(cylinderPlanes(cx, cz, r, y0, y1, sides), { mat, surface: surfaceOf(mat), flags }));
  }

  /** Invisible wall that only stops players. */
  clip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Brush {
    return this.box(x0, y0, z0, x1, y1, z1, 'clip', MASK.MOVE);
  }

  /**
   * Straight wall along X (axis 'x') or Z (axis 'z') starting at (x, z), with door and window
   * openings cut out of it. `thick` extends towards +Z (or +X).
   */
  wall(
    axis: 'x' | 'z',
    x: number,
    y: number,
    z: number,
    length: number,
    height: number,
    thick: number,
    mat: MaterialId,
    openings: Opening[] = [],
  ): void {
    const seg = (a0: number, a1: number, b0: number, b1: number) => {
      if (a1 - a0 < 0.01 || b1 - b0 < 0.01) return;
      if (axis === 'x') this.box(x + a0, y + b0, z, x + a1, y + b1, z + thick, mat);
      else this.box(x, y + b0, z + a0, x + thick, y + b1, z + a1, mat);
    };
    const sorted = [...openings].sort((a, b) => a.at - b.at);
    let cursor = 0;
    for (const o of sorted) {
      seg(cursor, o.at, 0, height);
      seg(o.at, o.at + o.width, 0, o.bottom);
      seg(o.at, o.at + o.width, o.top, height);
      cursor = o.at + o.width;
    }
    seg(cursor, length, 0, height);
  }

  /** Straight flight of steps rising towards `dir`, filling the given footprint. */
  stairs(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: SlopeDir, steps: number, mat: MaterialId): void {
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const lz = Math.min(z0, z1);
    const hz = Math.max(z0, z1);
    const rise = (y1 - y0) / steps;
    // Each step is a slab on top of the previous one, so no two faces overlap.
    for (let i = 0; i < steps; i++) {
      const bottom = y0 + rise * i;
      const top = bottom + rise;
      const t0 = i / steps;
      switch (dir) {
        case '+x':
          this.box(lx + (hx - lx) * t0, bottom, lz, hx, top, hz, mat);
          break;
        case '-x':
          this.box(lx, bottom, lz, hx - (hx - lx) * t0, top, hz, mat);
          break;
        case '+z':
          this.box(lx, bottom, lz + (hz - lz) * t0, hx, top, hz, mat);
          break;
        case '-z':
          this.box(lx, bottom, lz, hx, top, hz - (hz - lz) * t0, mat);
          break;
      }
    }
  }

  crate(cx: number, y: number, cz: number, size: number, height = size, yaw = 0, mat: MaterialId = 'planks'): void {
    if (yaw === 0) this.box(cx - size / 2, y, cz - size / 2, cx + size / 2, y + height, cz + size / 2, mat);
    else this.obb(cx, y, cz, size, height, size, yaw, mat);
  }

  /** Row of sandbags as a low wall along X or Z, with a slightly narrower top course. */
  sandbags(axis: 'x' | 'z', x: number, z: number, length: number, height = 0.9): void {
    const t = 0.6;
    if (axis === 'x') {
      this.box(x, 0, z, x + length, height - 0.25, z + t, 'sandbag');
      this.box(x + 0.1, height - 0.25, z + 0.06, x + length - 0.1, height, z + t - 0.06, 'sandbag');
    } else {
      this.box(x, 0, z, x + t, height - 0.25, z + length, 'sandbag');
      this.box(x + 0.06, height - 0.25, z + 0.1, x + t - 0.06, height, z + length - 0.1, 'sandbag');
    }
  }

  prop(p: PropDef): void {
    this.props.push(p);
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.spawns.push({ x, y, z, yaw });
  }

  target(t: Omit<TargetDef, 'id'>): TargetDef {
    const def = { ...t, id: this.targets.length };
    this.targets.push(def);
    return def;
  }

  build(id: string, bounds: MapData['bounds'], sunDir: [number, number, number]): MapData {
    return { id, brushes: this.brushes, props: this.props, spawns: this.spawns, targets: this.targets, bounds, sunDir };
  }
}
