import * as THREE from 'three';
import { MASK } from '../../shared/collision/brush';
import { TraceResult, type CollisionWorld } from '../../shared/collision/world';
import { TUNING, type WeaponId } from '../../shared/config';
import { rayPlayer, type HitZone } from '../../shared/hitbox';
import { SURFACE_NAMES } from '../../shared/map/types';
import { ACCENTS, PF, WEAPON_IDS, type PlayerInfo, type Snapshot } from '../../shared/protocol';
import type { AudioEngine } from '../audio/engine';
import { Character } from './character';
import { STEP_SOUND } from './game';
import { InterpClock, SnapshotBuffer, type Interp } from './interp';

export class RemotePlayer {
  readonly char: Character;
  readonly s: Interp = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, flags: 0, weapon: 0, hp: 100, extrapolated: false };
  info: PlayerInfo;
  present = false;
  alive = false;
  private stepDist = 0;
  private wasGround = true;
  private airTime = 0;
  private visCheck = 0;
  visible = false;
  /** Where the last shot that hit them came from (for the fall direction). */
  hitFrom: [number, number, number] | null = null;

  constructor(info: PlayerInfo) {
    this.info = info;
    this.char = new Character(info.name, ACCENTS[info.color % ACCENTS.length]!);
  }

  get crouched(): boolean {
    return (this.s.flags & PF.CROUCH) !== 0;
  }

  get weapon(): WeaponId {
    return WEAPON_IDS[this.s.weapon] ?? 'pistol';
  }

  /** Footsteps and landings by distance travelled on the ground. */
  sounds(dt: number, audio: AudioEngine, world: CollisionWorld, tr: TraceResult, listener: THREE.Vector3): void {
    const s = this.s;
    const ground = (s.flags & PF.GROUND) !== 0;
    const d = Math.hypot(s.x - listener.x, s.z - listener.z);
    if (!ground) this.airTime += dt;
    if (ground && !this.wasGround && this.airTime > 0.35 && d < 40) {
      audio.playAt('land', s.x, s.y + 0.05, s.z, { volume: 0.7, refDistance: 3, rolloff: 1.3, maxDistance: 40 });
    }
    if (ground) this.airTime = 0;
    this.wasGround = ground;
    const hs = Math.hypot(s.vx, s.vz);
    if (!ground || hs < 0.8) return;
    this.stepDist += hs * dt;
    const sprint = (s.flags & PF.SPRINT) !== 0;
    const crouch = (s.flags & PF.CROUCH) !== 0;
    const stride = sprint ? 2.4 : crouch ? 1.4 : 1.9;
    if (this.stepDist < stride) return;
    this.stepDist = 0;
    if (d > 38) return;
    world.trace(tr, s.x, s.y + 0.2, s.z, s.x, s.y - 0.4, s.z, 0, 0, 0, MASK.MOVE);
    const surf = SURFACE_NAMES[tr.fraction < 1 ? tr.surface : 0] ?? 'default';
    const vol = crouch ? 0.25 : sprint ? 0.9 : 0.6;
    audio.playAt(STEP_SOUND[surf] ?? 'step_concrete', s.x, s.y + 0.05, s.z, { volume: vol, refDistance: 2.5, rolloff: 1.25, maxDistance: 38 });
  }

  /** Line of sight to the name tag, rechecked a few times per second. */
  updateVisibility(dt: number, world: CollisionWorld, tr: TraceResult, eye: THREE.Vector3): void {
    this.visCheck -= dt;
    if (this.visCheck > 0) return;
    this.visCheck = 0.12 + Math.random() * 0.06;
    const s = this.s;
    const hy = s.y + (this.crouched ? 1.05 : 1.65);
    world.trace(tr, eye.x, eye.y, eye.z, s.x, hy, s.z, 0, 0, 0, MASK.SHOT);
    this.visible = tr.fraction >= 0.999;
  }
}

export interface ShotHit {
  id: number;
  zone: HitZone;
  t: number;
}

/** Everyone else in the match, drawn at the interpolation clock's render time. */
export class Remotes {
  readonly group = new THREE.Group();
  readonly buffer = new SnapshotBuffer();
  readonly clock = new InterpClock();
  readonly players = new Map<number, RemotePlayer>();
  private tr = new TraceResult();
  private eye = new THREE.Vector3();
  private lastNow = 0;

  constructor(
    private world: CollisionWorld,
    private audio: AudioEngine,
    private myId: () => number,
  ) {}

  onSnapshot(s: Snapshot, arrival: number): void {
    this.buffer.push(s, this.myId());
    this.clock.onSnapshot(s.time, arrival, this.buffer.age);
  }

  /** Keeps a RemotePlayer for everyone in the player list except us. */
  syncPlayers(list: PlayerInfo[]): void {
    const ids = new Set<number>();
    for (const info of list) {
      if (info.id === this.myId()) continue;
      ids.add(info.id);
      let rp = this.players.get(info.id);
      if (!rp) {
        rp = new RemotePlayer(info);
        this.players.set(info.id, rp);
        this.group.add(rp.char.object);
      } else if (rp.info.name !== info.name) {
        rp.char.setName(info.name);
      }
      rp.info = info;
    }
    for (const [id, rp] of this.players) {
      if (ids.has(id)) continue;
      this.group.remove(rp.char.object);
      rp.char.dispose();
      this.players.delete(id);
    }
  }

  update(dt: number, now: number, eye: THREE.Vector3): void {
    const dtMs = this.lastNow ? now - this.lastNow : dt * 1000;
    this.lastNow = now;
    const t = this.clock.update(now, dtMs);
    this.eye.copy(eye);
    for (const rp of this.players.values()) {
      rp.present = this.buffer.sample(rp.info.id, t, rp.s);
      const s = rp.s;
      const alive = rp.present && (s.flags & PF.ALIVE) !== 0;
      if (alive && !rp.alive) rp.char.revive();
      if (!alive && rp.alive && rp.present) {
        const from = rp.hitFrom;
        let fromFront = true;
        if (from) {
          const fx = -Math.sin(s.yaw);
          const fz = -Math.cos(s.yaw);
          fromFront = (from[0] - s.x) * fx + (from[2] - s.z) * fz > 0;
        }
        rp.char.die(fromFront);
      }
      rp.alive = alive;
      const obj = rp.char.object;
      obj.visible = rp.present && (alive || rp.char.dead);
      if (!obj.visible) continue;
      obj.position.set(s.x, s.y, s.z);
      obj.rotation.set(0, s.yaw, 0);
      rp.char.update(dt, {
        vx: s.vx,
        vz: s.vz,
        yaw: s.yaw,
        pitch: s.pitch,
        onGround: (s.flags & PF.GROUND) !== 0,
        crouched: (s.flags & PF.CROUCH) !== 0,
        sprinting: (s.flags & PF.SPRINT) !== 0,
        ads: (s.flags & PF.ADS) !== 0,
        reloading: (s.flags & PF.RELOAD) !== 0,
        stabbing: (s.flags & PF.MELEE) !== 0,
        weapon: rp.weapon,
        // Tumma tila: nobody sees them on the phone.
        phone: (s.flags & PF.PHONE) !== 0 && !rp.info.upgrades?.tumma,
      });
      rp.char.setUpgrades(rp.info.upgrades ?? {});
      if (alive) {
        rp.sounds(dt, this.audio, this.world, this.tr, eye);
        rp.updateVisibility(dt, this.world, this.tr, eye);
      }
      const dist = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
      rp.char.updateTag(alive && rp.visible && dist < 70, dist);
    }
  }

  /** The nearest remote player on the ray as drawn right now (the shooter-favoured claim). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): ShotHit | null {
    let best: ShotHit | null = null;
    for (const rp of this.players.values()) {
      if (!rp.present || !rp.alive || (rp.s.flags & PF.PROTECTED) !== 0) continue;
      const s = rp.s;
      const hit = rayPlayer(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, rp.crouched, best ? best.t : maxT);
      if (hit && (!best || hit.t < best.t)) best = { id: rp.info.id, zone: hit.zone, t: hit.t };
    }
    return best;
  }

  /** Remote players as drawn right now who can be hurt (alive, not spawn-protected): for the knife. */
  *bodies(): Generator<{ id: number; x: number; y: number; z: number; crouched: boolean }> {
    for (const rp of this.players.values()) {
      if (!rp.present || !rp.alive || (rp.s.flags & PF.PROTECTED) !== 0) continue;
      yield { id: rp.info.id, x: rp.s.x, y: rp.s.y, z: rp.s.z, crouched: rp.crouched };
    }
  }

  /** Where a remote player's muzzle is drawn (falls back to their eye). */
  muzzle(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const rp = this.players.get(id);
    if (!rp || !rp.present || !rp.char.object.visible) return null;
    return rp.char.muzzleWorld(out);
  }

  eyeOf(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const rp = this.players.get(id);
    if (!rp || !rp.present) return null;
    return out.set(rp.s.x, rp.s.y + (rp.crouched ? TUNING.move.crouchEye : TUNING.move.standEye), rp.s.z);
  }

  dispose(): void {
    for (const rp of this.players.values()) rp.char.dispose();
    this.players.clear();
  }
}
