import { brushVertices, type Brush } from '../../shared/collision/brush';
import { MINIMAP } from '../../shared/config';
import type { MapData } from '../../shared/map/types';

/** Pixels per metre in the pre-drawn map. */
const PX = 4;
/** Map drawn around the play area, so the forest edge shows near the fence. */
const MARGIN = 30;

export type MinimapKind = 'floor' | 'low' | 'wall' | 'fence';

/**
 * How a brush shows on the minimap, or null when it doesn't: the ground, roofs and lintels
 * (so doorways stay open from above), and tree trunks.
 */
export function minimapKind(b: Brush, area: number): MinimapKind | null {
  if (b.mat === 'grass') return null;
  if (b.mat === 'clip' || b.mat === '') return Math.max(b.maxX - b.minX, b.maxZ - b.minZ) > 3 ? 'fence' : null;
  if (b.minY > 1.8) return null;
  const h = b.maxY - b.minY;
  if (h < 0.3) return b.maxY < 1.8 ? 'floor' : null;
  // Waist-high and large is a platform to stand on (a raised floor, the review stand), not cover.
  if (h <= 1.4) return area > 25 ? 'floor' : 'low';
  return 'wall';
}

/** A brush's outline seen from above: the convex hull of its corners on the XZ plane. */
export function footprint(b: Brush): [number, number][] {
  const pts = brushVertices(b.planes)
    .map((v) => [v.x, v.z] as [number, number])
    .sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  const cross = (o: [number, number], a: [number, number], c: [number, number]) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 1e-9) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

function area(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

/**
 * Where a world offset from the player lands on the minimap, turned by the view yaw so that
 * straight ahead is up (canvas coordinates: +x right, +y down).
 */
export function toMinimap(dx: number, dz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

const COLOR: Record<MinimapKind, string> = {
  floor: 'rgba(236, 230, 210, 0.13)',
  low: 'rgba(236, 230, 210, 0.42)',
  wall: 'rgba(241, 238, 228, 0.82)',
  fence: 'rgba(226, 178, 31, 0.55)',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/**
 * The minimap: the map from above around the player, turned so the view points up, with the
 * field of view, the closed gate, and a red dot where an enemy fired without a suppressor.
 */
export class Minimap {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement | null = null;
  private mapId = '';
  private originX = 0;
  private originZ = 0;
  private gates: [number, number][][] = [];
  private pings = new Map<number, { x: number; z: number; t: number }>();
  private size = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'minimap hidden', parent);
    this.canvas = el('canvas', 'minimap-canvas', this.root);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => (this.size = 0)).observe(this.root);
  }

  /** Draws the map's walls, cover, floors, fences and trees once, from above. */
  setMap(map: MapData): void {
    if (map.id === this.mapId) return;
    this.mapId = map.id;
    const b = map.bounds;
    this.originX = b.minX - MARGIN;
    this.originZ = b.minZ - MARGIN;
    const layer = document.createElement('canvas');
    layer.width = Math.ceil((b.maxX - b.minX + MARGIN * 2) * PX);
    layer.height = Math.ceil((b.maxZ - b.minZ + MARGIN * 2) * PX);
    const ctx = layer.getContext('2d')!;
    ctx.scale(PX, PX);
    ctx.translate(-this.originX, -this.originZ);
    for (const p of map.props) {
      if (p.kind !== 'spruce' && p.kind !== 'pine' && p.kind !== 'birch' && p.kind !== 'bush') continue;
      ctx.fillStyle = 'rgba(112, 142, 84, 0.32)';
      ctx.beginPath();
      ctx.arc(p.x, p.z, (p.kind === 'bush' ? 0.7 : 1.4) * (p.scale ?? 1), 0, Math.PI * 2);
      ctx.fill();
    }
    const gateSet = new Set(map.gateBrushes ?? []);
    const shapes: { kind: MinimapKind; poly: [number, number][]; top: number }[] = [];
    this.gates = [];
    for (const brush of map.brushes) {
      const poly = footprint(brush);
      if (poly.length < 3) continue;
      if (gateSet.has(brush.index)) {
        this.gates.push(poly);
        continue;
      }
      const kind = minimapKind(brush, area(poly));
      if (kind) shapes.push({ kind, poly, top: brush.maxY });
    }
    const order: MinimapKind[] = ['floor', 'low', 'wall', 'fence'];
    shapes.sort((a, c) => order.indexOf(a.kind) - order.indexOf(c.kind) || a.top - c.top);
    for (const s of shapes) {
      ctx.beginPath();
      for (const [x, z] of s.poly) ctx.lineTo(x, z);
      ctx.closePath();
      ctx.fillStyle = COLOR[s.kind];
      ctx.fill();
      if (s.kind === 'fence') {
        ctx.strokeStyle = COLOR.fence;
        ctx.lineWidth = 0.35;
        ctx.stroke();
      }
    }
    this.layer = layer;
  }

  /** An enemy fired without a suppressor: a red dot where they stood, for a moment. */
  shot(player: number, x: number, z: number): void {
    this.pings.set(player, { x, z, t: 0 });
  }

  /** Draws the map around (x, z), turned so that the view (yaw) points up. */
  draw(dt: number, x: number, z: number, yaw: number, fovDeg: number, gateOpen: boolean, visible: boolean): void {
    this.root.classList.toggle('hidden', !visible || !this.layer);
    for (const [id, p] of this.pings) if ((p.t += dt) > MINIMAP.shotShow) this.pings.delete(id);
    if (!visible || !this.layer) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this.size) {
      this.size = Math.max(1, Math.round(this.root.clientWidth * dpr));
      this.canvas.width = this.canvas.height = this.size;
    }
    const ctx = this.ctx;
    const r = this.size / 2;
    const scale = r / MINIMAP.range;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(14, 18, 13, 0.93)';
    ctx.fillRect(0, 0, this.size, this.size);

    // The map, turned around us.
    ctx.translate(r, r);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-x, -z);
    ctx.drawImage(this.layer, this.originX, this.originZ, this.layer.width / PX, this.layer.height / PX);
    if (!gateOpen) {
      ctx.fillStyle = '#e6553f';
      for (const poly of this.gates) {
        ctx.beginPath();
        for (const [gx, gz] of poly) ctx.lineTo(gx, gz);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#e6553f';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // What we can see: the field of view as a faint wedge.
    const half = ((fovDeg / 2) * Math.PI) / 180;
    const cone = ctx.createRadialGradient(r, r, 0, r, r, r);
    cone.addColorStop(0, 'rgba(226, 178, 31, 0.22)');
    cone.addColorStop(1, 'rgba(226, 178, 31, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.fill();

    // Enemy shots: where they were fired; beyond the edge, on the rim.
    for (const p of this.pings.values()) {
      let [px, pz] = toMinimap(p.x - x, p.z - z, yaw);
      px *= scale;
      pz *= scale;
      const d = Math.hypot(px, pz);
      const rim = r - 7 * dpr;
      if (d > rim) {
        px *= rim / d;
        pz *= rim / d;
      }
      const fade = 1 - p.t / MINIMAP.shotShow;
      ctx.fillStyle = `rgba(230, 85, 63, ${(fade * (d > rim ? 0.7 : 1)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(r + px, r + pz, 4.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
      if (p.t < 0.5) {
        ctx.strokeStyle = `rgba(230, 85, 63, ${(1 - p.t / 0.5).toFixed(3)})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(r + px, r + pz, (4.2 + p.t * 22) * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Us, pointing up.
    ctx.fillStyle = '#e2b21f';
    ctx.strokeStyle = 'rgba(14, 18, 13, 0.9)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(r, r - 8 * dpr);
    ctx.lineTo(r + 5.5 * dpr, r + 6 * dpr);
    ctx.lineTo(r, r + 3 * dpr);
    ctx.lineTo(r - 5.5 * dpr, r + 6 * dpr);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // The rim, and north on it.
    ctx.strokeStyle = 'rgba(241, 238, 228, 0.28)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(r, r, r - dpr, 0, Math.PI * 2);
    ctx.stroke();
    const [nx, nz] = toMinimap(0, -1, yaw);
    const nr = r - 11 * dpr;
    ctx.font = `700 ${Math.round(13 * dpr)}px 'Barlow Condensed', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(14, 18, 13, 0.9)';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeText('N', r + nx * nr, r + nz * nr);
    ctx.fillStyle = 'rgba(241, 238, 228, 0.9)';
    ctx.fillText('N', r + nx * nr, r + nz * nr);
  }
}
