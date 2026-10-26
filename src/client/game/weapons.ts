import { TUNING, type WeaponId, type WeaponTuning } from '../../shared/config';
import { DEG, clamp, damp, makeRng, viewDir, type Vec3 } from '../../shared/math';
import { WEAPONS, fireInterval, recoilKick, spreadFor, type RecoilKick } from '../../shared/weapons';

export type WeaponState = 'ready' | 'reloading' | 'inspecting' | 'holstering' | 'drawing';

export interface WeaponInput {
  fireHeld: boolean;
  firePressed: boolean;
  adsHeld: boolean;
  sprinting: boolean;
  speed: number;
  maxSpeed: number;
  airborne: boolean;
  crouched: boolean;
}

export interface Aim {
  yaw: number;
  pitch: number;
}

export interface ShotEvent {
  weapon: WeaponId;
  dir: Vec3;
  spread: number;
  shotIndex: number;
}

export type WeaponSound = { name: string; volume?: number };

/** A timed cue inside a reload/inspect/switch timeline (fraction of its duration). */
interface Cue {
  at: number;
  sound?: string;
  volume?: number;
  refill?: boolean;
}

function reloadCues(id: WeaponId, empty: boolean, refill: number): Cue[] {
  const p = id;
  const cues: Cue[] = [
    { at: 0.1, sound: `${p}_mag_out`, volume: 0.9 },
    { at: refill, sound: `${p}_mag_in`, refill: true },
  ];
  if (empty) {
    cues.push({ at: 0.74, sound: `${p}_bolt_back` }, { at: 0.83, sound: `${p}_bolt_fwd` });
  }
  return cues;
}

/**
 * The local player's weapons, stepped at the fixed simulation rate. Gameplay values (ammo,
 * fire timing, recoil applied to aim) live here; the viewmodel only reads them.
 */
export class WeaponController {
  owned: WeaponId[] = ['pistol'];
  current: WeaponId = 'pistol';
  private next: WeaponId | null = null;
  ammo: Record<WeaponId, number> = { pistol: TUNING.pistol.magazine, rifle: TUNING.rifle.magazine };
  state: WeaponState = 'drawing';
  stateTime = 0;
  stateDur = TUNING.pistol.drawTime;
  reloadEmpty = false;
  private cues: Cue[] = [];
  private cueIndex = 0;

  ads = 0;
  adsPrev = 0;
  sprintPose = 0;
  sprintPosePrev = 0;
  cooldown = 0;
  shotIndex = 0;
  sinceShot = 99;
  bloom = 0;
  private buffered = 0;
  private dryArmed = true;

  /** Temporary camera punch (degrees; +pitch up, +yaw right) and its decaying target. */
  punchP = 0;
  punchY = 0;
  punchPrevP = 0;
  punchPrevY = 0;
  private punchTP = 0;
  private punchTY = 0;
  /** Lasting recoil still being fed into the aim. */
  private pendP = 0;
  private pendY = 0;

  /** Incremented per shot so the viewmodel can spring-kick. */
  shotCounter = 0;
  lastShotAds = 0;
  shots: ShotEvent[] = [];
  sounds: WeaponSound[] = [];
  refilledAt = -1;
  /** Seconds since the last R press while it does nothing (for the HUD reminder). */
  reminder = 0;
  private time = 0;
  private rng = makeRng(Date.now() >>> 0);
  private kick: RecoilKick = { pitch: 0, yaw: 0 };

  get t(): WeaponTuning {
    return TUNING[this.current];
  }

  get canAds(): boolean {
    return this.state === 'ready' || this.state === 'drawing';
  }

  give(id: WeaponId): void {
    if (!this.owned.includes(id)) this.owned.push(id);
    this.ammo[id] = TUNING[id].magazine;
  }

  /** Start a reload of the weapon in hand. Returns a reason when refused. */
  startReload(): 'ok' | 'full' | 'busy' {
    if (this.state === 'holstering' || this.state === 'drawing') return 'busy';
    if (this.state === 'reloading') return 'busy';
    if (this.ammo[this.current] >= this.t.magazine) return 'full';
    this.reloadEmpty = this.ammo[this.current] === 0;
    this.enter('reloading', this.reloadEmpty ? this.t.reloadEmptyTime : this.t.reloadTime, reloadCues(this.current, this.reloadEmpty, this.t.reloadRefill));
    return 'ok';
  }

  inspect(): void {
    if (this.state !== 'ready') return;
    this.enter('inspecting', this.t.inspectTime, [{ at: 0.18, sound: `${this.current}_inspect`, volume: 0.8 }]);
  }

  switchTo(id: WeaponId): void {
    if (!this.owned.includes(id)) return;
    if (id === this.current && this.state !== 'holstering') return;
    if (this.state === 'holstering') {
      this.next = id;
      return;
    }
    this.next = id;
    this.enter('holstering', this.t.holsterTime, []);
  }

  cycleWeapon(dir: number): void {
    if (this.owned.length < 2) return;
    const i = this.owned.indexOf(this.next ?? this.current);
    const n = this.owned.length;
    this.switchTo(this.owned[(((i + dir) % n) + n) % n]!);
  }

  private enter(state: WeaponState, dur: number, cues: Cue[]): void {
    this.state = state;
    this.stateTime = 0;
    this.stateDur = Math.max(0.01, dur);
    this.cues = cues.sort((a, b) => a.at - b.at);
    this.cueIndex = 0;
  }

  /** Normalised progress of the current timed state (0..1). */
  get progress(): number {
    return clamp(this.stateTime / this.stateDur, 0, 1);
  }

  step(dt: number, inp: WeaponInput, aim: Aim): void {
    this.time += dt;
    this.adsPrev = this.ads;
    this.sprintPosePrev = this.sprintPose;
    this.punchPrevP = this.punchP;
    this.punchPrevY = this.punchY;
    const t = this.t;

    // Timed states.
    if (this.state !== 'ready') {
      this.stateTime += dt;
      while (this.cueIndex < this.cues.length && this.progress >= this.cues[this.cueIndex]!.at) {
        const c = this.cues[this.cueIndex++]!;
        if (c.sound) this.sounds.push({ name: c.sound, volume: c.volume });
        if (c.refill) {
          this.ammo[this.current] = t.magazine;
          this.refilledAt = this.time;
        }
      }
      if (this.stateTime >= this.stateDur) {
        if (this.state === 'holstering') {
          this.current = this.next ?? this.current;
          this.next = null;
          this.sounds.push({ name: `${this.current}_draw`, volume: 0.8 });
          this.enter('drawing', TUNING[this.current].drawTime, []);
        } else {
          this.state = 'ready';
        }
      }
    }

    // Sprint pose and aim.
    const sprintIn = 1 / Math.max(0.01, t.sprintInTime);
    const sprintOut = 1 / Math.max(0.01, t.sprintToFire);
    this.sprintPose = inp.sprinting ? Math.min(1, this.sprintPose + dt * sprintIn) : Math.max(0, this.sprintPose - dt * sprintOut);
    const wantAds = inp.adsHeld && this.canAds && !inp.sprinting;
    this.ads = wantAds ? Math.min(1, this.ads + dt / Math.max(0.01, t.adsTime)) : Math.max(0, this.ads - dt / Math.max(0.01, t.adsOutTime));
    if (this.state === 'inspecting' && inp.adsHeld) this.state = 'ready';

    // Bloom and recoil recovery.
    this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - t.spreadRecover * dt);
    if (this.sinceShot > t.recoilReset) this.shotIndex = 0;
    this.punchTP = damp(this.punchTP, 0, t.recoilReturn, dt);
    this.punchTY = damp(this.punchTY, 0, t.recoilReturn, dt);
    this.punchP = damp(this.punchP, this.punchTP, t.recoilRise, dt);
    this.punchY = damp(this.punchY, this.punchTY, t.recoilRise, dt);
    const feed = 1 - Math.exp(-t.recoilRise * dt);
    const dp = this.pendP * feed;
    const dy = this.pendY * feed;
    this.pendP -= dp;
    this.pendY -= dy;
    aim.pitch = clamp(aim.pitch + dp * DEG, -89 * DEG, 89 * DEG);
    aim.yaw -= dy * DEG;

    // Trigger.
    this.cooldown -= dt;
    if (this.buffered > 0) this.buffered -= dt;
    const info = WEAPONS[this.current];
    if (inp.firePressed) {
      // A click during sprint fires as soon as the gun is up.
      this.buffered = t.fireBuffer + (this.sprintPose > 0 || inp.sprinting ? t.sprintToFire + 0.05 : 0);
      this.dryArmed = true;
    }
    if (!inp.fireHeld && !inp.firePressed) this.dryArmed = true;
    const trigger = info.auto ? inp.fireHeld || this.buffered > 0 : this.buffered > 0;
    const up = this.sprintPose <= 0.001 && !inp.sprinting;
    if (trigger && this.state === 'ready' && up && this.cooldown <= 0) {
      if (this.ammo[this.current] > 0) {
        this.fire(inp, aim);
        this.buffered = 0;
      } else if (this.dryArmed) {
        this.sounds.push({ name: `${this.current}_dry` });
        this.dryArmed = false;
        this.buffered = 0;
        this.reminder = 2.5;
      }
    }
    if (this.reminder > 0) this.reminder = Math.max(0, this.reminder - dt);
  }

  private fire(inp: WeaponInput, aim: Aim): void {
    const t = this.t;
    this.ammo[this.current]--;
    // Fire-rate cap; carry the remainder so 700 rpm averages exactly 700.
    this.cooldown = Math.max(this.cooldown, -0.5 / 120) + fireInterval(t);
    const spread = spreadFor(t, {
      ads: this.ads,
      speed: inp.speed,
      maxSpeed: inp.maxSpeed,
      airborne: inp.airborne,
      crouched: inp.crouched,
      bloom: this.bloom,
    });
    const shotIdx = this.shotIndex;
    // Aim = view + punch; spread is a cone around it.
    const yaw = aim.yaw - this.punchY * DEG;
    const pitch = aim.pitch + this.punchP * DEG;
    const dir = viewDir({ x: 0, y: 0, z: 0 }, yaw, pitch);
    if (spread > 0) {
      const a = spread * DEG * Math.sqrt(this.rng());
      const phi = this.rng() * Math.PI * 2;
      const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
      const upv = { x: dir.y * right.z - dir.z * right.y, y: dir.z * right.x - dir.x * right.z, z: dir.x * right.y - dir.y * right.x };
      const k = Math.tan(a);
      dir.x += (right.x * Math.cos(phi) + upv.x * Math.sin(phi)) * k;
      dir.y += (right.y * Math.cos(phi) + upv.y * Math.sin(phi)) * k;
      dir.z += (right.z * Math.cos(phi) + upv.z * Math.sin(phi)) * k;
      const l = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= l;
      dir.y /= l;
      dir.z /= l;
    }
    this.shots.push({ weapon: this.current, dir, spread, shotIndex: shotIdx });

    // Recoil: part goes into the aim for good, the rest is a punch that springs back.
    let mul = 1;
    mul *= 1 + (t.recoilAdsMul - 1) * this.ads;
    if (inp.crouched) mul *= t.recoilCrouchMul;
    recoilKick(t, shotIdx, this.rng() * 2 - 1, this.rng() * 2 - 1, this.kick);
    const kp = this.kick.pitch * mul;
    const ky = this.kick.yaw * mul;
    this.pendP += kp * t.recoilAimShare;
    this.pendY += ky * t.recoilAimShare;
    this.punchTP += kp * (1 - t.recoilAimShare);
    this.punchTY += ky * (1 - t.recoilAimShare);

    this.bloom = Math.min(t.spreadMax, this.bloom + t.spreadPerShot);
    this.shotIndex++;
    this.sinceShot = 0;
    this.shotCounter++;
    this.lastShotAds = this.ads;
  }
}
