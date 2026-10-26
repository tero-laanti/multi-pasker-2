import { UI } from '../../shared/ui';
import type { NetStats } from '../net';

export interface StatsSource {
  net: NetStats;
  draws: number;
  tris: number;
  gpu: string;
  simSteps: number;
  snapshotRate: number | null;
  interpDelay: number | null;
  extra?: () => string[];
}

const N = 240;

/** F3 overlay: frame-time graph and network/server numbers. */
export class StatsOverlay {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private text: HTMLPreElement;
  private times = new Float32Array(N);
  private head = 0;
  private filled = 0;
  private acc = 0;
  visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'stats hidden';
    this.canvas = document.createElement('canvas');
    this.canvas.width = N;
    this.canvas.height = 80;
    this.text = document.createElement('pre');
    this.root.append(this.canvas, this.text);
    parent.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }

  /** Call every frame with the frame time in milliseconds. */
  frame(ms: number, src: StatsSource): void {
    this.times[this.head] = ms;
    this.head = (this.head + 1) % N;
    this.filled = Math.min(N, this.filled + 1);
    if (!this.visible) return;
    this.acc += ms;
    this.draw();
    if (this.acc < 250) return;
    this.acc = 0;
    const arr = Array.from(this.times.slice(0, this.filled)).sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    const p99 = arr[Math.floor(arr.length * 0.99)] ?? 0;
    const max = arr[arr.length - 1] ?? 0;
    const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : UI.stats.na);
    const S = UI.stats;
    const lines = [
      `${S.fps} ${f(1000 / avg, 0)}   ${S.frame} ${f(avg, 2)} ms  p99 ${f(p99, 2)}  max ${f(max, 2)}`,
      `${S.sim} ${src.simSteps}/frame (120 Hz)`,
      `${S.rtt} ${f(src.net.rtt)} ms   ${S.jitter} ${f(src.net.jitter)} ms   ${src.net.connected ? '' : '(disconnected)'}`,
      `${S.snapshots} ${src.snapshotRate === null ? S.na : f(src.snapshotRate, 0) + ' Hz'}   ${S.interp} ${src.interpDelay === null ? S.na : f(src.interpDelay * 1000, 0) + ' ms'}`,
      `${S.tick} ${f(src.net.serverTickMs, 3)} ms @ ${f(src.net.serverTickHz, 0)} Hz`,
      `${S.draws} ${src.draws}   ${S.tris} ${src.tris.toLocaleString('en-US')}`,
      `${S.gpu}: ${src.gpu}`,
      ...(src.extra?.() ?? []),
    ];
    this.text.textContent = lines.join('\n');
  }

  /** Mean frame time over the last `n` frames (ms). */
  average(n = N): number {
    const k = Math.min(n, this.filled);
    let s = 0;
    for (let i = 0; i < k; i++) s += this.times[(this.head - 1 - i + N) % N]!;
    return k ? s / k : NaN;
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 0, W, H);
    const scale = H / 40;
    for (const [ms, color] of [
      [16.7, 'rgba(120,220,120,0.5)'],
      [33.3, 'rgba(240,180,80,0.5)'],
    ] as const) {
      g.strokeStyle = color;
      g.beginPath();
      g.moveTo(0, H - ms * scale);
      g.lineTo(W, H - ms * scale);
      g.stroke();
    }
    for (let i = 0; i < this.filled; i++) {
      const v = this.times[(this.head - this.filled + i + N) % N]!;
      g.fillStyle = v > 33.3 ? '#e85a4f' : v > 17.5 ? '#e8c14f' : '#8fd19e';
      const hgt = Math.min(H, v * scale);
      g.fillRect(i + (W - this.filled), H - hgt, 1, hgt);
    }
  }
}
