/** Recent positions of one player, for rewinding shots to what the shooter saw. */

export interface HistorySample {
  t: number;
  x: number;
  y: number;
  z: number;
  crouched: boolean;
  alive: boolean;
}

export class PositionHistory {
  private buf: HistorySample[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity = 150) {
    this.buf = Array.from({ length: capacity }, () => ({ t: 0, x: 0, y: 0, z: 0, crouched: false, alive: false }));
  }

  push(t: number, x: number, y: number, z: number, crouched: boolean, alive: boolean): void {
    // Times only move forward: a sample at (or before) the newest time replaces it.
    const replace = this.count > 0 && t <= this.get(this.count - 1).t;
    if (replace) {
      const last = this.get(this.count - 1);
      last.x = x;
      last.y = y;
      last.z = z;
      last.crouched = crouched;
      last.alive = alive;
      return;
    }
    const s = this.buf[this.head]!;
    s.t = t;
    s.x = x;
    s.y = y;
    s.z = z;
    s.crouched = crouched;
    s.alive = alive;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  clear(): void {
    this.count = 0;
  }

  private get(i: number): HistorySample {
    // i = 0 is the oldest sample.
    return this.buf[(this.head - this.count + i + this.capacity) % this.capacity]!;
  }

  /** Interpolated state at time t, clamped to the recorded range. */
  at(t: number, out: HistorySample = { t: 0, x: 0, y: 0, z: 0, crouched: false, alive: false }): HistorySample | null {
    if (this.count === 0) return null;
    const first = this.get(0);
    const last = this.get(this.count - 1);
    if (t <= first.t) return Object.assign(out, first);
    if (t >= last.t) return Object.assign(out, last);
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.get(mid).t <= t) lo = mid;
      else hi = mid;
    }
    const a = this.get(lo);
    const b = this.get(hi);
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    out.t = t;
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.crouched = k < 0.5 ? a.crouched : b.crouched;
    out.alive = a.alive && b.alive;
    return out;
  }
}
