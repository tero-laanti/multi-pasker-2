import type { Brush } from './brush';

/**
 * Static collision world made of convex brushes, with Quake III-style box traces.
 *
 * A box with half extents (hx, hy, hz) swept from start to end is traced by pushing every
 * brush plane outwards by the box's support distance (the Minkowski sum). With axial bevel
 * planes on every brush this is exact for boxes, yaw-rotated boxes, single-axis ramps and
 * prisms. Point traces (bullets) are the same code with zero extents.
 */

/** Distance traces stop short of a surface, so the next trace never starts inside it. */
export const SURFACE_CLIP_EPSILON = 1 / 320;

export class TraceResult {
  /** 0..1 along the requested move; 1 means nothing was hit. */
  fraction = 1;
  x = 0;
  y = 0;
  z = 0;
  nx = 0;
  ny = 0;
  nz = 0;
  startSolid = false;
  allSolid = false;
  /** Index of the brush that was hit, or -1. */
  brush = -1;
  surface = 0;
}

const LONG_TRACE = 24;

function slab(r: { tmin: number; tmax: number }, s: number, e: number, lo: number, hi: number): boolean {
  const d = e - s;
  if (Math.abs(d) < 1e-12) return s >= lo && s <= hi;
  let t0 = (lo - s) / d;
  let t1 = (hi - s) / d;
  if (t0 > t1) {
    const t = t0;
    t0 = t1;
    t1 = t;
  }
  if (t0 > r.tmin) r.tmin = t0;
  if (t1 < r.tmax) r.tmax = t1;
  return r.tmin <= r.tmax;
}

export class CollisionWorld {
  readonly brushes: Brush[];
  readonly cellSize: number;
  private gridMinX = 0;
  private gridMinZ = 0;
  private gridW = 1;
  private gridH = 1;
  private cells: Int32Array[] = [];
  private stamp = 1;
  // Per-trace working values.
  private sx = 0;
  private sy = 0;
  private sz = 0;
  private ex = 0;
  private ey = 0;
  private ez = 0;
  private hx = 0;
  private hy = 0;
  private hz = 0;

  constructor(brushes: Brush[], cellSize = 4) {
    this.brushes = brushes;
    this.cellSize = cellSize;
    brushes.forEach((b, i) => (b.index = i));
    this.buildGrid();
  }

  private buildGrid(): void {
    if (this.brushes.length === 0) return;
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (const b of this.brushes) {
      minX = Math.min(minX, b.minX);
      minZ = Math.min(minZ, b.minZ);
      maxX = Math.max(maxX, b.maxX);
      maxZ = Math.max(maxZ, b.maxZ);
    }
    const cs = this.cellSize;
    this.gridMinX = Math.floor(minX / cs) * cs;
    this.gridMinZ = Math.floor(minZ / cs) * cs;
    this.gridW = Math.max(1, Math.ceil((maxX - this.gridMinX) / cs));
    this.gridH = Math.max(1, Math.ceil((maxZ - this.gridMinZ) / cs));
    const lists: number[][] = Array.from({ length: this.gridW * this.gridH }, () => []);
    for (const b of this.brushes) {
      const x0 = this.cellX(b.minX);
      const x1 = this.cellX(b.maxX);
      const z0 = this.cellZ(b.minZ);
      const z1 = this.cellZ(b.maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) lists[z * this.gridW + x]!.push(b.index);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
  }

  private cellX(x: number): number {
    const c = Math.floor((x - this.gridMinX) / this.cellSize);
    return c < 0 ? 0 : c >= this.gridW ? this.gridW - 1 : c;
  }

  private cellZ(z: number): number {
    const c = Math.floor((z - this.gridMinZ) / this.cellSize);
    return c < 0 ? 0 : c >= this.gridH ? this.gridH - 1 : c;
  }

  /**
   * Sweeps an axis-aligned box centred on the path from start to end.
   * Pass zero extents for a ray. `mask` selects which brushes block (see MASK).
   */
  trace(
    out: TraceResult,
    sx: number,
    sy: number,
    sz: number,
    ex: number,
    ey: number,
    ez: number,
    hx: number,
    hy: number,
    hz: number,
    mask: number,
  ): TraceResult {
    out.fraction = 1;
    out.startSolid = false;
    out.allSolid = false;
    out.brush = -1;
    out.surface = 0;
    out.nx = 0;
    out.ny = 0;
    out.nz = 0;
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.ex = ex;
    this.ey = ey;
    this.ez = ez;
    this.hx = hx;
    this.hy = hy;
    this.hz = hz;

    const pad = SURFACE_CLIP_EPSILON * 2;
    const bMinX = Math.min(sx, ex) - hx - pad;
    const bMaxX = Math.max(sx, ex) + hx + pad;
    const bMinY = Math.min(sy, ey) - hy - pad;
    const bMaxY = Math.max(sy, ey) + hy + pad;
    const bMinZ = Math.min(sz, ez) - hz - pad;
    const bMaxZ = Math.max(sz, ez) + hz + pad;
    const stamp = ++this.stamp;
    const brushes = this.brushes;

    const long = Math.abs(ex - sx) + Math.abs(ez - sz) > LONG_TRACE;
    if (long) {
      for (let i = 0; i < brushes.length; i++) {
        const b = brushes[i]!;
        if ((b.flags & mask) === 0) continue;
        if (b.maxX < bMinX || b.minX > bMaxX || b.maxY < bMinY || b.minY > bMaxY || b.maxZ < bMinZ || b.minZ > bMaxZ) continue;
        if (!this.rayHitsBounds(b, out.fraction)) continue;
        this.clipToBrush(out, b);
        if (out.allSolid) break;
      }
    } else {
      const x0 = this.cellX(bMinX);
      const x1 = this.cellX(bMaxX);
      const z0 = this.cellZ(bMinZ);
      const z1 = this.cellZ(bMaxZ);
      outer: for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = this.cells[cz * this.gridW + cx]!;
          for (let k = 0; k < cell.length; k++) {
            const b = brushes[cell[k]!]!;
            if (b.stamp === stamp) continue;
            b.stamp = stamp;
            if ((b.flags & mask) === 0) continue;
            if (b.maxX < bMinX || b.minX > bMaxX || b.maxY < bMinY || b.minY > bMaxY || b.maxZ < bMinZ || b.minZ > bMaxZ)
              continue;
            this.clipToBrush(out, b);
            if (out.allSolid) break outer;
          }
        }
      }
    }

    const f = out.fraction;
    out.x = sx + (ex - sx) * f;
    out.y = sy + (ey - sy) * f;
    out.z = sz + (ez - sz) * f;
    return out;
  }

  /** True if a box centred at (cx, cy, cz) overlaps any brush in `mask`. */
  testBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, mask: number): boolean {
    const x0 = this.cellX(cx - hx);
    const x1 = this.cellX(cx + hx);
    const z0 = this.cellZ(cz - hz);
    const z1 = this.cellZ(cz + hz);
    const stamp = ++this.stamp;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = this.cells[gz * this.gridW + gx]!;
        for (let k = 0; k < cell.length; k++) {
          const b = this.brushes[cell[k]!]!;
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if ((b.flags & mask) === 0) continue;
          if (b.maxX <= cx - hx || b.minX >= cx + hx || b.maxY <= cy - hy || b.minY >= cy + hy || b.maxZ <= cz - hz || b.minZ >= cz + hz)
            continue;
          let inside = true;
          for (const p of b.planes) {
            const dist = p.d + Math.abs(p.nx) * hx + Math.abs(p.ny) * hy + Math.abs(p.nz) * hz;
            if (p.nx * cx + p.ny * cy + p.nz * cz - dist >= 0) {
              inside = false;
              break;
            }
          }
          if (inside) return true;
        }
      }
    }
    return false;
  }

  /** Slab test of the current ray (expanded by the box) against a brush's bounds. */
  private rayHitsBounds(b: Brush, maxFrac: number): boolean {
    const e = SURFACE_CLIP_EPSILON;
    const r = { tmin: 0, tmax: maxFrac };
    return (
      slab(r, this.sx, this.ex, b.minX - this.hx - e, b.maxX + this.hx + e) &&
      slab(r, this.sy, this.ey, b.minY - this.hy - e, b.maxY + this.hy + e) &&
      slab(r, this.sz, this.ez, b.minZ - this.hz - e, b.maxZ + this.hz + e)
    );
  }

  private clipToBrush(out: TraceResult, b: Brush): void {
    let enterFrac = -1;
    let leaveFrac = 1;
    let clip = -1;
    let getOut = false;
    let startOut = false;
    const planes = b.planes;
    const { sx, sy, sz, ex, ey, ez, hx, hy, hz } = this;
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]!;
      const dist = p.d + Math.abs(p.nx) * hx + Math.abs(p.ny) * hy + Math.abs(p.nz) * hz;
      const d1 = p.nx * sx + p.ny * sy + p.nz * sz - dist;
      const d2 = p.nx * ex + p.ny * ey + p.nz * ez - dist;
      if (d2 > 0) getOut = true;
      if (d1 > 0) startOut = true;
      // Completely in front of this face: the move never touches the brush.
      if (d1 > 0 && (d2 >= SURFACE_CLIP_EPSILON || d2 >= d1)) return;
      // Entirely behind this plane: it doesn't limit the move.
      if (d1 <= 0 && d2 <= 0) continue;
      if (d1 > d2) {
        let f = (d1 - SURFACE_CLIP_EPSILON) / (d1 - d2);
        if (f < 0) f = 0;
        if (f > enterFrac) {
          enterFrac = f;
          clip = i;
        }
      } else {
        let f = (d1 + SURFACE_CLIP_EPSILON) / (d1 - d2);
        if (f > 1) f = 1;
        if (f < leaveFrac) leaveFrac = f;
      }
    }
    if (!startOut) {
      out.startSolid = true;
      if (!getOut) {
        out.allSolid = true;
        out.fraction = 0;
        out.brush = b.index;
        out.surface = b.surface;
      }
      return;
    }
    if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < out.fraction) {
      if (enterFrac < 0) enterFrac = 0;
      const p = planes[clip]!;
      out.fraction = enterFrac;
      out.nx = p.nx;
      out.ny = p.ny;
      out.nz = p.nz;
      out.brush = b.index;
      out.surface = b.surface;
    }
  }
}
