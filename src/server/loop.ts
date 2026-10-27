import { NET } from '../shared/config';
import type { Room } from './game/room';

/** The room's fixed-rate tick with drift compensation, and how long ticks take (the F3 overlay). */
export class TickLoop {
  count = 0;
  stats = { avg: 0, max: 0 };
  private window: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(room: Room) {
    const dt = 1000 / NET.tickHz;
    let next = performance.now();
    const loop = () => {
      if (this.stopped) return;
      const t0 = performance.now();
      this.count++;
      try {
        room.tick(dt / 1000);
      } catch (err) {
        console.error('[tick]', err);
      }
      this.window.push(performance.now() - t0);
      if (this.window.length >= NET.tickHz) {
        this.stats = { avg: this.window.reduce((a, b) => a + b, 0) / this.window.length, max: Math.max(...this.window) };
        this.window = [];
      }
      next += dt;
      const now = performance.now();
      if (next < now - dt * 5) next = now;
      this.timer = setTimeout(loop, Math.max(0, next - now));
    };
    this.timer = setTimeout(loop, dt);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
