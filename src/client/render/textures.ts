import * as THREE from 'three';
import { makeRng } from '../../shared/math';
import type { MaterialId } from '../../shared/map/types';

/**
 * Procedural, tileable textures for map materials, drawn into canvases at start-up.
 * Every material has a texture, a roughness/metalness and a world-space tile size.
 */

type Rgb = [number, number, number];

class TileNoise {
  private grid: Float32Array;
  constructor(
    seed: number,
    readonly period: number,
  ) {
    const r = makeRng(seed);
    this.grid = new Float32Array(period * period);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = r();
  }

  /** Smooth value noise in [0, 1], periodic over `period` lattice cells. */
  at(x: number, y: number): number {
    const P = this.period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % P) + P) % P;
    const y0 = ((yi % P) + P) % P;
    const x1 = (x0 + 1) % P;
    const y1 = (y0 + 1) % P;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const g = this.grid;
    const a = g[y0 * P + x0]!;
    const b = g[y0 * P + x1]!;
    const c = g[y1 * P + x0]!;
    const d = g[y1 * P + x1]!;
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** Tileable fractal noise over u, v in [0, 1). */
class Fbm {
  private octaves: TileNoise[];
  constructor(seed: number, base: number, count: number) {
    this.octaves = Array.from({ length: count }, (_, i) => new TileNoise(seed + i * 101, base << i));
  }
  at(u: number, v: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (const o of this.octaves) {
      sum += o.at(u * o.period, v * o.period) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }
}

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D; img: ImageData } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g, img: g.createImageData(size, size) };
}

function paint(size: number, fn: (u: number, v: number, x: number, y: number) => Rgb): HTMLCanvasElement {
  const { c, g, img } = canvas(size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gr, b] = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      d[i] = r;
      d[i + 1] = gr;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

function grass(): HTMLCanvasElement {
  const big = new Fbm(1, 4, 4);
  const fine = new Fbm(2, 32, 3);
  const dry = new Fbm(3, 3, 3);
  return paint(512, (u, v) => {
    const n = big.at(u, v);
    const f = fine.at(u, v);
    let c = mixRgb([70, 98, 44], [112, 136, 62], n);
    const d = Math.max(0, (dry.at(u, v) - 0.58) * 4);
    c = mixRgb(c, [146, 140, 84], Math.min(1, d) * 0.6);
    return mul(c, 0.8 + f * 0.4);
  });
}

function dirt(base: Rgb = [122, 104, 82], seed = 10): HTMLCanvasElement {
  const big = new Fbm(seed, 4, 4);
  const fine = new Fbm(seed + 1, 64, 2);
  const r = makeRng(seed);
  const c = paint(512, (u, v) => mul(mixRgb(mul(base, 0.82), mul(base, 1.12), big.at(u, v)), 0.86 + fine.at(u, v) * 0.28));
  const g = c.getContext('2d')!;
  for (let i = 0; i < 260; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const s = 1 + r() * 3;
    const k = 0.7 + r() * 0.6;
    g.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
    g.beginPath();
    g.ellipse(x, y, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function gravel(): HTMLCanvasElement {
  const base = new Fbm(20, 8, 3);
  const c = paint(512, (u, v) => mixRgb([118, 112, 102], [150, 144, 132], base.at(u, v)));
  const g = c.getContext('2d')!;
  const r = makeRng(21);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const s = 2 + r() * 5;
    const k = 0.75 + r() * 0.5;
    const tone: Rgb = r() < 0.3 ? [158, 140, 118] : [150, 148, 142];
    for (const [dx, dy] of [
      [0, 0],
      [512, 0],
      [-512, 0],
      [0, 512],
      [0, -512],
    ]) {
      const cx = x + dx!;
      const cy = y + dy!;
      if (cx < -10 || cx > 522 || cy < -10 || cy > 522) continue;
      g.fillStyle = `rgb(${tone[0] * k * 0.7},${tone[1] * k * 0.7},${tone[2] * k * 0.7})`;
      g.beginPath();
      g.ellipse(cx + 0.8, cy + 0.8, s, s * 0.75, 0.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgb(${tone[0] * k},${tone[1] * k},${tone[2] * k})`;
      g.beginPath();
      g.ellipse(cx, cy, s * 0.92, s * 0.68, 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

function concrete(base: Rgb, seed: number): HTMLCanvasElement {
  const stain = new Fbm(seed, 3, 4);
  const fine = new Fbm(seed + 1, 64, 2);
  const c = paint(512, (u, v) => {
    const s = stain.at(u, v);
    return mul(base, (0.9 + fine.at(u, v) * 0.14) * (1 - Math.max(0, s - 0.55) * 0.5));
  });
  const g = c.getContext('2d')!;
  const r = makeRng(seed + 2);
  for (let i = 0; i < 900; i++) {
    const k = 0.55 + r() * 0.25;
    g.fillStyle = `rgba(${base[0] * k},${base[1] * k},${base[2] * k},0.8)`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  return c;
}

function brick(): HTMLCanvasElement {
  const size = 512;
  const rows = 20;
  const cols = 6;
  const rowH = size / rows;
  const colW = size / cols;
  const mortar = 3;
  const fine = new Fbm(30, 32, 3);
  const r = makeRng(31);
  const tints: Rgb[] = [];
  for (let i = 0; i < rows * cols * 2; i++) tints.push(mul([152, 66, 48], 0.82 + r() * 0.32));
  return paint(size, (u, v, x, y) => {
    const row = Math.floor(y / rowH);
    const off = row % 2 ? colW / 2 : 0;
    const xx = (x + off) % size;
    const col = Math.floor(xx / colW);
    const inMortar = y % rowH < mortar || xx % colW < mortar;
    const f = fine.at(u, v);
    if (inMortar) return mul([188, 182, 168], 0.9 + f * 0.15);
    return mul(tints[row * cols + col]!, 0.88 + f * 0.24);
  });
}

function plaster(base: Rgb, seed: number): HTMLCanvasElement {
  const big = new Fbm(seed, 4, 4);
  const fine = new Fbm(seed + 1, 64, 2);
  return paint(512, (u, v) => mul(base, 0.9 + big.at(u, v) * 0.12 + (fine.at(u, v) - 0.5) * 0.08));
}

function planks(base: Rgb, count: number, seed: number, weathered = true): HTMLCanvasElement {
  const grain = new TileNoise(seed, 64);
  const big = new Fbm(seed + 1, 4, 3);
  const r = makeRng(seed + 2);
  const tints: number[] = Array.from({ length: count }, () => 0.82 + r() * 0.3);
  return paint(512, (u, v) => {
    const p = Math.floor(u * count);
    const local = u * count - p;
    if (local < 0.025 || local > 0.975) return mul(base, 0.35);
    const gr = grain.at(u * 64 * 0.25 + p * 7.3, v * 64 * 4) * 0.5 + grain.at(u * 64, v * 64 * 0.5) * 0.5;
    let k = tints[p]! * (0.85 + gr * 0.3);
    if (weathered) k *= 0.92 + big.at(u, v) * 0.16;
    return mul(base, k);
  });
}

function plywood(): HTMLCanvasElement {
  const swirl = new Fbm(40, 4, 4);
  const fine = new TileNoise(41, 128);
  return paint(512, (u, v) => {
    const s = swirl.at(u, v);
    const bands = 0.5 + 0.5 * Math.sin((u * 6 + s * 5) * Math.PI * 2);
    const k = 0.86 + bands * 0.12 + fine.at(u * 128, v * 16) * 0.06;
    return mul([206, 170, 118], k);
  });
}

function metal(base: Rgb, seed: number): HTMLCanvasElement {
  const big = new Fbm(seed, 4, 4);
  const rust = new Fbm(seed + 1, 6, 3);
  const c = paint(256, (u, v) => {
    let col = mul(base, 0.9 + big.at(u, v) * 0.15);
    const rr = Math.max(0, rust.at(u, v) - 0.66) * 3;
    col = mixRgb(col, [120, 72, 40], Math.min(1, rr) * 0.6);
    return col;
  });
  const g = c.getContext('2d')!;
  const r = makeRng(seed + 2);
  g.strokeStyle = 'rgba(210,210,200,0.18)';
  for (let i = 0; i < 40; i++) {
    g.lineWidth = 0.5 + r();
    g.beginPath();
    const x = r() * 256;
    const y = r() * 256;
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 12);
    g.stroke();
  }
  return c;
}

function hazard(): HTMLCanvasElement {
  const n = new Fbm(50, 8, 2);
  return paint(256, (u, v) => {
    const s = Math.floor((u + v) * 6) % 2 === 0;
    const k = 0.9 + n.at(u, v) * 0.15;
    return s ? mul([224, 178, 32], k) : mul([34, 32, 30], k);
  });
}

function corrugated(): HTMLCanvasElement {
  const n = new Fbm(60, 4, 3);
  return paint(256, (u, v) => {
    const w = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 12);
    return mul([118, 126, 124], (0.72 + w * 0.38) * (0.92 + n.at(u, v) * 0.12));
  });
}

function sandbag(): HTMLCanvasElement {
  const weave = new TileNoise(70, 128);
  const big = new Fbm(71, 4, 3);
  return paint(256, (u, v) => {
    const row = Math.floor(v * 5);
    const off = row % 2 ? 0.25 : 0;
    const lu = (u * 2 + off) % 1;
    const lv = v * 5 - row;
    const edge = Math.min(lu, 1 - lu) * 2;
    const edgeV = Math.min(lv, 1 - lv) * 2;
    const bulge = Math.sqrt(Math.min(1, Math.min(edge * 3, edgeV * 3)));
    const k = (0.45 + bulge * 0.55) * (0.9 + weave.at(u * 128, v * 128) * 0.15) * (0.92 + big.at(u, v) * 0.12);
    return mul([158, 142, 104], k);
  });
}

function weave(base: Rgb, seed: number): HTMLCanvasElement {
  const w = new TileNoise(seed, 128);
  const big = new Fbm(seed + 1, 4, 3);
  return paint(256, (u, v) => mul(base, (0.88 + w.at(u * 128, v * 128) * 0.14) * (0.9 + big.at(u, v) * 0.15)));
}

interface MatSpec {
  tex: () => HTMLCanvasElement;
  /** World metres covered by one texture repeat. */
  tile: number;
  roughness: number;
  metalness?: number;
}

const SPECS: Record<Exclude<MaterialId, 'clip'>, MatSpec> = {
  grass: { tex: grass, tile: 7, roughness: 0.95 },
  dirt: { tex: () => dirt(), tile: 5, roughness: 0.95 },
  gravel: { tex: gravel, tile: 3.5, roughness: 0.9 },
  sand: { tex: () => dirt([186, 166, 124], 12), tile: 5, roughness: 0.95 },
  berm: { tex: () => dirt([108, 104, 70], 14), tile: 6, roughness: 0.95 },
  concrete: { tex: () => concrete([186, 182, 172], 80), tile: 3, roughness: 0.85 },
  concreteDark: { tex: () => concrete([132, 130, 124], 82), tile: 3, roughness: 0.85 },
  asphalt: { tex: () => concrete([72, 72, 74], 84), tile: 4, roughness: 0.9 },
  brick: { tex: brick, tile: 1.6, roughness: 0.85 },
  plaster: { tex: () => plaster([214, 206, 188], 90), tile: 3, roughness: 0.9 },
  ochre: { tex: () => plaster([204, 150, 72], 92), tile: 3, roughness: 0.9 },
  wood: { tex: () => planks([128, 100, 70], 1, 100, false), tile: 1.2, roughness: 0.8 },
  plywood: { tex: plywood, tile: 2.4, roughness: 0.75 },
  planks: { tex: () => planks([142, 116, 84], 6, 110), tile: 1.2, roughness: 0.85 },
  logs: { tex: () => planks([96, 70, 46], 3, 120, false), tile: 1, roughness: 0.9 },
  metal: { tex: () => metal([88, 98, 90], 130), tile: 2, roughness: 0.55, metalness: 0.4 },
  metalYellow: { tex: hazard, tile: 1.2, roughness: 0.6, metalness: 0.2 },
  steelTarget: { tex: () => metal([226, 224, 216], 140), tile: 1, roughness: 0.5, metalness: 0.3 },
  roofTin: { tex: corrugated, tile: 1.6, roughness: 0.5, metalness: 0.5 },
  roofFelt: { tex: () => concrete([66, 62, 60], 150), tile: 3, roughness: 0.95 },
  sandbag: { tex: sandbag, tile: 1.2, roughness: 0.95 },
  canvas: { tex: () => weave([96, 106, 64], 160), tile: 3, roughness: 0.95 },
  rubber: { tex: () => concrete([38, 38, 38], 170), tile: 2, roughness: 0.9 },
};

export interface MapMaterial {
  material: THREE.MeshStandardMaterial;
  tile: number;
}

export function createMapMaterials(maxAnisotropy: number): Map<MaterialId, MapMaterial> {
  const out = new Map<MaterialId, MapMaterial>();
  for (const [id, spec] of Object.entries(SPECS) as [Exclude<MaterialId, 'clip'>, MatSpec][]) {
    const tex = new THREE.CanvasTexture(spec.tex());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAnisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const material = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: spec.roughness,
      metalness: spec.metalness ?? 0,
      vertexColors: true,
    });
    material.name = id;
    out.set(id, { material, tile: spec.tile });
  }
  return out;
}

/** Text on a board, for range signs. */
export function signTexture(text: string, fg = '#f2efe6', bg = '#2f4630', w = 512, h = 160): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg;
  let size = h * 0.55;
  g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  while (g.measureText(text).width > w - 60 && size > 10) {
    size -= 4;
    g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
