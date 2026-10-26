import { NET } from '../../shared/config';
import { wrapAngle } from '../../shared/math';
import { PF, type PlayerSnap, type Snapshot } from '../../shared/protocol';

/** Remote player interpolation: per-player state timelines and the adaptive render clock. */

interface Sample {
  /** When the state was true (server clock): snapshot time minus the state's age. */
  t: number;
  p: PlayerSnap;
}

/** Each player's recent states on their own timeline, oldest first. */
export class SnapshotBuffer {
  private lines = new Map<number, Sample[]>();
  /** Server time of the newest snapshot. */
  latest = 0;
  /** Typical state age in recent snapshots (ms), for the interpolation delay. */
  age = 0;
  private ages: number[] = [];

  /** `self`: our own id, left out of the age statistics (we are never drawn). */
  push(s: Snapshot, self = -1): void {
    if (s.time <= this.latest) return;
    this.latest = s.time;
    let maxAge = 0;
    for (const p of s.players) {
      let line = this.lines.get(p.id);
      if (!line) this.lines.set(p.id, (line = []));
      const t = s.time - p.age;
      const last = line[line.length - 1];
      if (last && t <= last.t) {
        // No newer state from that client: server-side changes (death, protection) still apply.
        last.p = { ...last.p, flags: p.flags, hp: p.hp, weapon: p.weapon };
        continue;
      }
      if (p.age < 250 && p.id !== self) maxAge = Math.max(maxAge, p.age);
      line.push({ t, p });
      while (line.length > 2 && line[0]!.t < s.time - 1500) line.shift();
    }
    for (const [id, line] of this.lines) {
      if (line.length && !s.players.some((p) => p.id === id) && line[line.length - 1]!.t < s.time - 3000) this.lines.delete(id);
    }
    this.ages.push(maxAge);
    if (this.ages.length > 60) this.ages.shift();
    const sorted = [...this.ages].sort((a, b) => a - b);
    this.age = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  }

  /** Whether the player was in the newest snapshot (connected and in the world). */
  has(id: number): boolean {
    const line = this.lines.get(id);
    return !!line && line.length > 0;
  }

  /**
   * Player state at server time `t`: interpolated between the two states around it, briefly
   * extrapolated past the newest. Respawns and teleports are not blended.
   */
  sample(id: number, t: number, out: Interp): boolean {
    const line = this.lines.get(id);
    if (!line || line.length === 0) return false;
    const n = line.length;
    let i = n - 1;
    while (i > 0 && line[i]!.t > t) i--;
    const a = line[i]!;
    if (i === n - 1 || a.t > t) {
      // At or past the newest state (or before the oldest): hold, extrapolating briefly.
      const p = a.p;
      fill(out, p);
      out.vx = out.vy = out.vz = 0;
      out.extrapolated = t > a.t;
      const prev = i > 0 ? line[i - 1]! : undefined;
      if (prev && t > a.t && (prev.p.flags & PF.ALIVE) === (p.flags & PF.ALIVE) && Math.hypot(p.x - prev.p.x, p.z - prev.p.z) < 3) {
        const dtS = (a.t - prev.t) / 1000;
        if (dtS > 0) {
          out.vx = (p.x - prev.p.x) / dtS;
          out.vy = (p.y - prev.p.y) / dtS;
          out.vz = (p.z - prev.p.z) / dtS;
          const ext = Math.min(0.1, (t - a.t) / 1000);
          out.x += out.vx * ext;
          out.y += out.vy * ext;
          out.z += out.vz * ext;
        }
      }
      return true;
    }
    const b = line[i + 1]!;
    const pa = a.p;
    const pb = b.p;
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
    const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 4 || (pa.flags & PF.ALIVE) !== (pb.flags & PF.ALIVE);
    if (jump) {
      fill(out, k < 1 ? pa : pb);
      out.vx = out.vz = out.vy = 0;
      out.extrapolated = false;
      return true;
    }
    out.x = pa.x + (pb.x - pa.x) * k;
    out.y = pa.y + (pb.y - pa.y) * k;
    out.z = pa.z + (pb.z - pa.z) * k;
    out.yaw = pa.yaw + wrapAngle(pb.yaw - pa.yaw) * k;
    out.pitch = pa.pitch + (pb.pitch - pa.pitch) * k;
    out.flags = k < 0.5 ? pa.flags : pb.flags;
    out.weapon = k < 0.5 ? pa.weapon : pb.weapon;
    out.hp = pb.hp;
    const sp = span / 1000;
    out.vx = sp > 0 ? (pb.x - pa.x) / sp : 0;
    out.vy = sp > 0 ? (pb.y - pa.y) / sp : 0;
    out.vz = sp > 0 ? (pb.z - pa.z) / sp : 0;
    out.extrapolated = false;
    return true;
  }
}

export interface Interp {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
  hp: number;
  extrapolated: boolean;
}

function fill(out: Interp, p: PlayerSnap): void {
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  out.yaw = p.yaw;
  out.pitch = p.pitch;
  out.flags = p.flags;
  out.weapon = p.weapon;
  out.hp = p.hp;
}

/**
 * Render clock for remote players: server time minus an interpolation delay that adapts to the
 * measured snapshot jitter. The clock follows the snapshot stream (fastest arrivals) and is
 * slewed gently, so changes in delay never make remote players jump.
 */
export class InterpClock {
  /** Server time the remote players are drawn at (ms). */
  renderTime = 0;
  /** Current interpolation delay (ms). */
  delay = NET.interpMinDelay * 1000;
  private offset = NaN;
  private devs: number[] = [];

  onSnapshot(serverTime: number, arrival: number, stateAge = 0): void {
    const o = serverTime - arrival;
    // Fastest arrival wins immediately; slower ones pull the estimate only slowly (clock drift).
    if (!Number.isFinite(this.offset) || o > this.offset) this.offset = o;
    else this.offset += (o - this.offset) * 0.01;
    this.devs.push(this.offset - o);
    if (this.devs.length > 90) this.devs.shift();
    const interval = 1000 / NET.snapshotHz;
    const sorted = [...this.devs].sort((a, b) => a - b);
    // Lateness that 95 % of snapshots stay under.
    const late = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const target = Math.min(NET.interpMaxDelay * 1000, Math.max(NET.interpMinDelay * 1000, interval * 1.5 + late * 1.2 + stateAge));
    this.delay += (target - this.delay) * 0.05;
  }

  /** Advances the render clock to local time `now` (ms). */
  update(now: number, dtMs: number): number {
    if (!Number.isFinite(this.offset)) return this.renderTime;
    const target = now + this.offset - this.delay;
    const predicted = this.renderTime + dtMs;
    const err = target - predicted;
    if (Math.abs(err) > 250 || this.renderTime === 0) this.renderTime = target;
    // Close the gap gently: the clock runs at most 8 % fast or slow.
    else this.renderTime = predicted + Math.max(-0.08 * dtMs, Math.min(0.08 * dtMs, err * 0.1));
    return this.renderTime;
  }

  get ready(): boolean {
    return Number.isFinite(this.offset);
  }
}
