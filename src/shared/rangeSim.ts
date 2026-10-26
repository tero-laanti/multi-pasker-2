import { TUNING } from './config';
import { silhouetteZone, type HitZone } from './hitbox';
import { makeRng } from './math';
import type { TargetDef } from './map/types';

/**
 * Shooting range logic: target states, the moving rail, knock-downs and pop-up drills.
 * Pure simulation (no rendering) so it can run on the client now and on the server later.
 */

export interface TargetState {
  def: TargetDef;
  x: number;
  y: number;
  z: number;
  dir: number;
  /** 1 = standing, 0 = flat on the ground. */
  up: number;
  upTarget: number;
  hp: number;
  downTimer: number;
  /** Pop-up lifetime left while raised by a drill. */
  active: number;
  /** Visual swing of plates (radians) and its velocity. */
  swing: number;
  swingVel: number;
  hitFlash: number;
  raisedAt: number;
}

export interface TargetHit {
  target: TargetState;
  zone: HitZone;
  t: number;
  /** Hit point on the board, for hole decals. */
  x: number;
  y: number;
  z: number;
}

export type RangeEvent =
  | { type: 'command'; key: 'positions' | 'fire' | 'cease' | 'ended' }
  | { type: 'targetDown'; target: TargetState }
  | { type: 'targetUp'; target: TargetState }
  | { type: 'drillEnd'; result: DrillResult };

export interface DrillResult {
  score: number;
  downs: number;
  spawned: number;
  hits: number;
  heads: number;
  shots: number;
}

export const DRILL = {
  briefing: 2.2,
  duration: 30,
  popupLife: 2.6,
  intervalMin: 1.0,
  intervalMax: 1.8,
  killPoints: 100,
  headPoints: 25,
  fastBonus: 50,
  fastTime: 0.9,
};

const KNOCKDOWN_TIME = 2.5;
const RAISE_RATE = 7;

export class RangeSim {
  readonly targets: TargetState[];
  events: RangeEvent[] = [];
  drillPhase: 'idle' | 'briefing' | 'running' = 'idle';
  drillTime = 0;
  drill: DrillResult = { score: 0, downs: 0, spawned: 0, hits: 0, heads: 0, shots: 0 };
  private nextPopup = 0;
  private time = 0;
  private rng = makeRng(7);

  constructor(defs: TargetDef[]) {
    this.targets = defs.map((def) => ({
      def,
      x: def.x,
      y: def.y,
      z: def.z,
      dir: 1,
      up: def.popup ? 0 : 1,
      upTarget: def.popup ? 0 : 1,
      hp: TUNING.player.health,
      downTimer: 0,
      active: 0,
      swing: 0,
      swingVel: 0,
      hitFlash: 0,
      raisedAt: 0,
    }));
  }

  update(dt: number): void {
    this.time += dt;
    for (const t of this.targets) {
      const rail = t.def.rail;
      if (rail) {
        t.x += t.dir * rail.speed * dt;
        if (t.x > rail.x1) {
          t.x = rail.x1;
          t.dir = -1;
        } else if (t.x < rail.x0) {
          t.x = rail.x0;
          t.dir = 1;
        }
      }
      if (t.downTimer > 0) {
        t.downTimer -= dt;
        if (t.downTimer <= 0 && !t.def.popup) this.raise(t);
      }
      if (t.def.popup && t.active > 0) {
        t.active -= dt;
        if (t.active <= 0 && t.upTarget === 1) {
          t.upTarget = 0;
          this.events.push({ type: 'targetDown', target: t });
        }
      }
      t.up += Math.sign(t.upTarget - t.up) * Math.min(Math.abs(t.upTarget - t.up), RAISE_RATE * dt);
      // Plates swing on a damped spring.
      t.swingVel += (-60 * t.swing - 4 * t.swingVel) * dt;
      t.swing += t.swingVel * dt;
      t.hitFlash = Math.max(0, t.hitFlash - dt * 4);
    }
    this.updateDrill(dt);
  }

  private raise(t: TargetState): void {
    t.hp = TUNING.player.health;
    t.upTarget = 1;
    t.raisedAt = this.time;
    this.events.push({ type: 'targetUp', target: t });
  }

  startDrill(): void {
    if (this.drillPhase !== 'idle') return;
    this.drillPhase = 'briefing';
    this.drillTime = 0;
    this.drill = { score: 0, downs: 0, spawned: 0, hits: 0, heads: 0, shots: 0 };
    for (const t of this.targets) if (t.def.popup) t.upTarget = 0;
    this.events.push({ type: 'command', key: 'positions' });
  }

  stopDrill(): void {
    if (this.drillPhase === 'idle') return;
    this.drillPhase = 'idle';
    for (const t of this.targets) {
      if (t.def.popup) {
        t.active = 0;
        t.upTarget = 0;
      }
    }
  }

  private updateDrill(dt: number): void {
    if (this.drillPhase === 'idle') return;
    this.drillTime += dt;
    if (this.drillPhase === 'briefing') {
      if (this.drillTime >= DRILL.briefing) {
        this.drillPhase = 'running';
        this.drillTime = 0;
        this.nextPopup = 0.4;
        this.events.push({ type: 'command', key: 'fire' });
      }
      return;
    }
    if (this.drillTime >= DRILL.duration) {
      this.stopDrill();
      this.events.push({ type: 'command', key: 'cease' });
      this.events.push({ type: 'drillEnd', result: { ...this.drill } });
      return;
    }
    this.nextPopup -= dt;
    if (this.nextPopup <= 0 && this.drillTime < DRILL.duration - DRILL.popupLife * 0.6) {
      const free = this.targets.filter((t) => t.def.popup && t.upTarget === 0 && t.up < 0.05);
      const count = this.rng() < 0.3 ? 2 : 1;
      for (let i = 0; i < count && free.length > 0; i++) {
        const t = free.splice(Math.floor(this.rng() * free.length), 1)[0]!;
        t.active = DRILL.popupLife;
        this.raise(t);
        this.drill.spawned++;
      }
      this.nextPopup = DRILL.intervalMin + this.rng() * (DRILL.intervalMax - DRILL.intervalMin);
    }
  }

  /** Records a shot fired during a drill (for accuracy). */
  noteShot(): void {
    if (this.drillPhase === 'running') this.drill.shots++;
  }

  /** Nearest target hit by a unit ray, or null. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): TargetHit | null {
    let best: TargetHit | null = null;
    for (const t of this.targets) {
      if (t.up < 0.5) continue;
      const hit = t.def.kind === 'silhouette' ? this.raySilhouette(t, ox, oy, oz, dx, dy, dz, maxT) : this.rayPlate(t, ox, oy, oz, dx, dy, dz, maxT);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }

  private raySilhouette(t: TargetState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): TargetHit | null {
    const yaw = t.def.yaw;
    // Board frame: right R, facing F, tilted back by (1 - up) * 90 degrees around R.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const tilt = (1 - t.up) * (Math.PI / 2);
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    // Up' = U cos - F sin ; N' = F cos + U sin.
    const ux = -fx * st;
    const uy = ct;
    const uz = -fz * st;
    const nx = fx * ct;
    const ny = st;
    const nz = fz * ct;
    const denom = dx * nx + dy * ny + dz * nz;
    if (Math.abs(denom) < 1e-6) return null;
    const tt = ((t.x - ox) * nx + (t.y - oy) * ny + (t.z - oz) * nz) / denom;
    if (tt < 0 || tt > maxT) return null;
    const px = ox + dx * tt;
    const py = oy + dy * tt;
    const pz = oz + dz * tt;
    const u = (px - t.x) * rx + (pz - t.z) * rz;
    const v = (px - t.x) * ux + (py - t.y) * uy + (pz - t.z) * uz;
    const zone = silhouetteZone(u, v);
    if (!zone) return null;
    return { target: t, zone, t: tt, x: px, y: py, z: pz };
  }

  private rayPlate(t: TargetState, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): TargetHit | null {
    const r = t.def.radius ?? 0.2;
    const nx = Math.sin(t.def.yaw);
    const nz = Math.cos(t.def.yaw);
    const denom = dx * nx + dz * nz;
    if (Math.abs(denom) < 1e-6) return null;
    const tt = ((t.x - ox) * nx + (t.z - oz) * nz) / denom;
    if (tt < 0 || tt > maxT) return null;
    const px = ox + dx * tt;
    const py = oy + dy * tt;
    const pz = oz + dz * tt;
    const ddx = px - t.x;
    const ddy = py - t.y;
    const ddz = pz - t.z;
    if (ddx * ddx + ddy * ddy + ddz * ddz > r * r) return null;
    return { target: t, zone: 'body', t: tt, x: px, y: py, z: pz };
  }

  /** Applies a hit. Returns true if the hit knocked the target down. */
  applyHit(hit: TargetHit, damage: number): boolean {
    const t = hit.target;
    t.hitFlash = 1;
    if (t.def.kind !== 'silhouette') {
      t.swingVel += 6 + Math.random() * 2;
      if (t.def.kind === 'start') this.startDrill();
      return false;
    }
    if (this.drillPhase === 'running' && t.def.popup) {
      this.drill.hits++;
      if (hit.zone === 'head') {
        this.drill.heads++;
        this.drill.score += DRILL.headPoints;
      }
    }
    t.hp -= damage;
    if (t.hp > 0) return false;
    t.upTarget = 0;
    t.active = 0;
    if (!t.def.popup) t.downTimer = KNOCKDOWN_TIME;
    if (this.drillPhase === 'running' && t.def.popup) {
      this.drill.downs++;
      const fast = Math.max(0, 1 - (this.time - t.raisedAt) / DRILL.fastTime);
      this.drill.score += DRILL.killPoints + Math.round(DRILL.fastBonus * fast);
    }
    this.events.push({ type: 'targetDown', target: t });
    return true;
  }
}
