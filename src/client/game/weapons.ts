import { TUNING, type WeaponId, type WeaponTuning } from '../../shared/config';
import { DEG, clamp, damp, makeRng, viewDir, type Vec3 } from '../../shared/math';
import { WEAPONS, recoilKick, spreadFor, type RecoilKick } from '../../shared/weapons';
import { weaponStats, type Upgrades, type WeaponStats } from '../../shared/upgrades';

export type WeaponState = 'ready' | 'reloading' | 'inspecting' | 'holstering' | 'drawing' | 'priming' | 'holding' | 'throwing';

export interface WeaponInput {
  fireHeld: boolean;
  firePressed: boolean;
  adsHeld: boolean;
  sprinting: boolean;
  speed: number;
  maxSpeed: number;
  airborne: boolean;
  crouched: boolean;
  /** A chat is open on the player's phone: one-handed, no aiming down sights. */
  phone: boolean;
  /** G is held down: a primed grenade stays in the hand. */
  grenadeHeld?: boolean;
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
  release?: boolean;
}

/** Pulling the pin and bringing the grenade up (s); then it is held for as long as G is. */
export const PRIME_TIME = 0.28;
/** Fraction of the throw (after G is let go) at which the grenade leaves the hand. */
export const THROW_RELEASE = 0.3;
const THROW_TIME = 0.42;

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
  /** Spare rounds (the spare magazine) per gun. */
  reserve: Record<WeaponId, number> = { pistol: TUNING.pistol.magazine, rifle: TUNING.rifle.magazine };
  /** The practice range: reloads never run out. */
  endlessSpare = false;
  state: WeaponState = 'drawing';
  stateTime = 0;
  stateDur = TUNING.pistol.drawTime;
  reloadEmpty = false;
  /** The reload under way is the armourer's: it fills the magazine without taking the spare. */
  reloadFull = false;
  /** An empty gun's trigger was pulled with a spare to put in: the game starts the reload. */
  wantReload = false;
  private cues: Cue[] = [];
  private cueIndex = 0;

  ads = 0;
  adsPrev = 0;
  /** 0..1: the phone coming up in the off hand. */
  phone = 0;
  phonePrev = 0;
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
  /** Seconds left on the out-of-ammo reminder (an R press or trigger pull with nothing to load). */
  reminder = 0;
  grenades = 0;
  maxGrenades = 1;
  /** Set on the step the grenade leaves the hand; the game spawns it and clears this. */
  releaseGrenade = false;
  /** The grenade left the hand by falling (the game was paused while holding it): no throw. */
  droppedGrenade = false;
  /** Set when the fuse ran out in the hand; the game handles the blast and clears this. */
  cookedOff = false;
  /** When the pin came out (weapon time; -1: no grenade in hand). The fuse burns from here. */
  private pinAt = -1;
  private time = 0;
  private rng = makeRng(Date.now() >>> 0);
  private kick: RecoilKick = { pitch: 0, yaw: 0 };

  /** Ladder upgrades (matches): bigger magazines, faster bolt, less recoil. */
  upgrades: Upgrades = {};

  get t(): WeaponTuning {
    return TUNING[this.current];
  }

  /** Magazine, fire rate and recoil of a weapon with the upgrades. */
  stats(id: WeaponId = this.current): WeaponStats {
    return weaponStats(id, this.upgrades);
  }

  get canAds(): boolean {
    return this.state === 'ready' || this.state === 'drawing';
  }

  /** Spare rounds a gun carries when stocked up. */
  spare(id: WeaponId = this.current): number {
    return this.stats(id).magazine * TUNING.ammo.spareMagazines;
  }

  give(id: WeaponId): void {
    if (!this.owned.includes(id)) this.owned.push(id);
    this.ammo[id] = this.stats(id).magazine;
    this.reserve[id] = this.spare(id);
  }

  /** Can R do anything right now: room in the magazine and a spare to put in. */
  get canReload(): boolean {
    return this.ammo[this.current] < this.stats().magazine && (this.endlessSpare || this.reserve[this.current] > 0);
  }

  /** The off hand has a grenade in it (pin out, or on its way). */
  get grenadeBusy(): boolean {
    return this.state === 'priming' || this.state === 'holding' || this.state === 'throwing';
  }

  /** Start a reload of the weapon in hand from the spare (R). Returns a reason when refused. */
  startReload(): 'ok' | 'full' | 'busy' | 'noSpare' {
    if (this.state === 'holstering' || this.state === 'drawing' || this.grenadeBusy) return 'busy';
    if (this.state === 'reloading') return 'busy';
    if (this.ammo[this.current] >= this.stats().magazine) return 'full';
    if (!this.endlessSpare && this.reserve[this.current] <= 0) return 'noSpare';
    this.beginReload(this.current, false);
    return 'ok';
  }

  /**
   * The armourer's refill (LATAA) done locally (the range): every magazine and spare full, the
   * gun in hand with a reload. Returns false when there was nothing to fill.
   */
  refillAll(): boolean {
    const missing = this.owned.some((id) => this.ammo[id] < this.stats(id).magazine || this.reserve[id] < this.spare(id));
    if (!missing) return false;
    for (const id of this.owned) {
      this.reserve[id] = this.spare(id);
      if (id !== this.current) this.ammo[id] = this.stats(id).magazine;
    }
    if (this.state === 'reloading') this.reloadFull = true;
    else if (this.ammo[this.current] < this.stats().magazine) {
      if (this.state === 'holstering' || this.state === 'drawing' || this.grenadeBusy) this.ammo[this.current] = this.stats().magazine;
      else this.beginReload(this.current, true);
    }
    this.refilledAt = this.time;
    return true;
  }

  private beginReload(id: WeaponId, full: boolean): void {
    this.reloadEmpty = this.ammo[id] === 0;
    this.reloadFull = full;
    const t = TUNING[id];
    this.enter('reloading', this.reloadEmpty ? t.reloadEmptyTime : t.reloadTime, reloadCues(id, this.reloadEmpty, t.reloadRefill));
  }

  /** A new life in a match: the server's weapons with full magazines and spares, best gun drawn. */
  resetLife(owned: WeaponId[], ammo: Record<WeaponId, number>, reserve: Record<WeaponId, number>): void {
    this.owned = [...owned];
    for (const id of Object.keys(this.ammo) as WeaponId[]) {
      this.ammo[id] = ammo[id] ?? this.stats(id).magazine;
      this.reserve[id] = reserve[id] ?? this.spare(id);
    }
    this.current = owned.includes('rifle') ? 'rifle' : 'pistol';
    this.next = null;
    this.ads = this.adsPrev = 0;
    this.phone = this.phonePrev = 0;
    this.sprintPose = this.sprintPosePrev = 0;
    this.punchP = this.punchY = this.punchPrevP = this.punchPrevY = 0;
    this.punchTP = this.punchTY = this.pendP = this.pendY = 0;
    this.bloom = 0;
    this.shotIndex = 0;
    this.buffered = 0;
    this.cooldown = 0;
    this.releaseGrenade = false;
    this.droppedGrenade = false;
    this.cookedOff = false;
    this.pinAt = -1;
    this.sounds.push({ name: `${this.current}_draw`, volume: 0.8 });
    this.enter('drawing', TUNING[this.current].drawTime, []);
  }

  /** A reload the server started: R with a spare, or the varusmestari's LATAA (`full`). */
  serverReload(id: WeaponId, empty: boolean, dur: number, full: boolean): void {
    if (id !== this.current || this.state === 'holstering' || this.state === 'drawing' || this.grenadeBusy) return;
    this.reloadEmpty = empty;
    this.reloadFull = full;
    this.enter('reloading', dur, reloadCues(id, empty, TUNING[id].reloadRefill));
  }

  /** G pressed: pin out (the fuse burns from now) and the grenade up, if one is carried and the hands are free. */
  primeGrenade(): boolean {
    if (this.grenades <= 0) return false;
    if (this.state !== 'ready' && this.state !== 'inspecting') return false;
    this.grenades--;
    this.pinAt = this.time;
    this.enter('priming', PRIME_TIME, [{ at: 0, sound: 'grenade_pin', volume: 0.8 }]);
    return true;
  }

  /** Seconds left on the fuse of the grenade in hand (or just thrown); null when there is none. */
  get fuseLeft(): number | null {
    return this.pinAt < 0 ? null : TUNING.grenade.fuse - (this.time - this.pinAt);
  }

  /** The pin is out and the grenade is still in the hand. */
  get cooking(): boolean {
    return this.pinAt >= 0 && (this.state === 'priming' || this.state === 'holding' || (this.state === 'throwing' && !this.released));
  }

  private released = false;

  /** A live grenade lets go without a throw (the game was paused while holding it): it falls. */
  dropGrenade(): void {
    if (this.state !== 'priming' && this.state !== 'holding') return;
    this.droppedGrenade = true;
    this.enter('drawing', this.t.drawTime * 0.6, []);
  }

  /** The pin is spent: the grenade was thrown, dropped or went off. */
  clearPin(): void {
    this.pinAt = -1;
  }

  private throwHeld(): void {
    this.released = false;
    this.enter('throwing', THROW_TIME, [{ at: THROW_RELEASE, sound: 'grenade_throw', release: true }]);
  }

  inspect(): void {
    if (this.state !== 'ready') return;
    this.enter('inspecting', this.t.inspectTime, [{ at: 0.18, sound: `${this.current}_inspect`, volume: 0.8 }]);
  }

  switchTo(id: WeaponId): void {
    if (!this.owned.includes(id) || this.grenadeBusy) return;
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

    // Held too long: it goes off in the hand.
    if (this.cooking && (this.fuseLeft ?? 1) <= 0) {
      this.cookedOff = true;
      this.pinAt = -1;
      this.enter('drawing', this.t.drawTime, []);
    }

    // Timed states.
    if (this.state !== 'ready') {
      this.stateTime += dt;
      while (this.cueIndex < this.cues.length && this.progress >= this.cues[this.cueIndex]!.at) {
        const c = this.cues[this.cueIndex++]!;
        if (c.sound) this.sounds.push({ name: c.sound, volume: c.volume });
        if (c.refill) {
          const id = this.current;
          const room = this.stats(id).magazine - this.ammo[id];
          if (this.reloadFull || this.endlessSpare) this.ammo[id] += room;
          else {
            const take = Math.min(room, this.reserve[id]);
            this.ammo[id] += take;
            this.reserve[id] -= take;
          }
          this.refilledAt = this.time;
        }
        if (c.release) {
          this.releaseGrenade = true;
          this.released = true;
        }
      }
      if (this.state === 'holding') {
        // Held as long as G is down; the throw starts when it is let go.
        this.stateTime = 0;
        if (!inp.grenadeHeld) this.throwHeld();
      } else if (this.stateTime >= this.stateDur) {
        if (this.state === 'priming') {
          if (inp.grenadeHeld) this.enter('holding', 1, []);
          else this.throwHeld();
        } else if (this.state === 'holstering') {
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
    this.phonePrev = this.phone;
    const phoneRate = dt / Math.max(0.01, TUNING.phoneOut.raiseTime);
    this.phone = inp.phone ? Math.min(1, this.phone + phoneRate) : Math.max(0, this.phone - phoneRate);
    const wantAds = inp.adsHeld && this.canAds && !inp.sprinting && !inp.phone;
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
        this.dryArmed = false;
        this.buffered = 0;
        // Empty with a spare: the trigger pull reloads. Without one: click, and the reminder.
        if (this.canReload) this.wantReload = true;
        else {
          this.sounds.push({ name: `${this.current}_dry` });
          this.reminder = 2.5;
        }
      }
    }
    if (this.reminder > 0) this.reminder = Math.max(0, this.reminder - dt);
  }

  private fire(inp: WeaponInput, aim: Aim): void {
    const t = this.t;
    this.ammo[this.current]--;
    // Fire-rate cap; carry the remainder so 700 rpm averages exactly 700.
    const st = this.stats();
    this.cooldown = Math.max(this.cooldown, -0.5 / 120) + 60 / st.rpm;
    const spread = spreadFor(t, {
      ads: this.ads,
      speed: inp.speed,
      maxSpeed: inp.maxSpeed,
      airborne: inp.airborne,
      crouched: inp.crouched,
      bloom: this.bloom,
      phone: this.phone,
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
    mul *= 1 + (TUNING.phoneOut.recoilMul - 1) * this.phone;
    mul *= st.recoilMul;
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
