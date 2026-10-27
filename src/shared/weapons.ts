import { GEAR, TUNING, type KillSpeedPreset, type WeaponId, type WeaponTuning } from './config';
import type { HitZone } from './hitbox';
import { clamp, lerp } from './math';
import type { Upgrades } from './upgrades';

export interface WeaponInfo {
  id: WeaponId;
  auto: boolean;
  /** Number key: 1 = pistol (sidearm), 2 = rifle, 3 = sniper rifle (from the Sotku). */
  key: 1 | 2 | 3;
}

export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  pistol: { id: 'pistol', auto: false, key: 1 },
  rifle: { id: 'rifle', auto: true, key: 2 },
  sniper: { id: 'sniper', auto: false, key: 3 },
};

export function weaponTuning(id: WeaponId): WeaponTuning {
  return TUNING[id];
}

export function fireInterval(t: WeaponTuning): number {
  return 60 / t.rpm;
}

/** Damage for one hit, using the active kill-speed preset, distance falloff and the shooter's gear. */
export function damageFor(id: WeaponId, zone: HitZone, distance: number, preset: KillSpeedPreset, u: Upgrades = {}): number {
  const d = TUNING.killSpeed[preset];
  const t = TUNING[id];
  if (id === 'pistol') {
    if (zone === 'head') return d.pistolHead;
    // Ontelokärjet: the same share more than the plain round, whatever the preset.
    return u.ontelo ? Math.round((d.pistolBody * GEAR.pistolBody) / TUNING.killSpeed.cod.pistolBody) : d.pistolBody;
  }
  if (id === 'sniper') return zone === 'head' ? d.sniperHead : d.sniperBody;
  if (zone === 'head') return d.rifleHead;
  const k = clamp((distance - t.falloffStart) / Math.max(0.001, t.falloffEnd - t.falloffStart), 0, 1);
  return Math.round(lerp(d.rifleBodyNear, d.rifleBodyFar, k));
}

/** Shots and time to kill a 100 hp target with body or head hits at a distance. */
export function timeToKill(id: WeaponId, zone: HitZone, distance: number, preset: KillSpeedPreset): { shots: number; seconds: number } {
  const dmg = damageFor(id, zone, distance, preset);
  const shots = Math.ceil(TUNING.player.health / Math.max(1, dmg));
  return { shots, seconds: (shots - 1) * fireInterval(TUNING[id]) };
}

export interface RecoilKick {
  pitch: number;
  yaw: number;
}

/**
 * Camera kick in degrees for the n-th consecutive shot (0-based). The deterministic part is
 * the learnable pattern; `randP`/`randY` add a small variation (pass values in [-1, 1]).
 */
export function recoilKick(t: WeaponTuning, shot: number, randP: number, randY: number, out: RecoilKick): RecoilKick {
  const ramp = t.recoilRampShots <= 1 ? 1 : clamp(shot / (t.recoilRampShots - 1), 0, 1);
  out.pitch = lerp(t.recoilPitchStart, t.recoilPitchEnd, ramp) + randP * t.recoilRandPitch;
  // Half-shot offset: period 2 alternates left/right, longer periods start near zero.
  const phase = t.recoilYawPeriod > 0 ? (2 * Math.PI * (shot + 0.5)) / t.recoilYawPeriod : 0;
  out.yaw = t.recoilYawBias + t.recoilYawAmp * Math.sin(phase) + randY * t.recoilRandYaw;
  return out;
}

export interface SpreadInput {
  ads: number;
  speed: number;
  maxSpeed: number;
  airborne: boolean;
  crouched: boolean;
  bloom: number;
  /** 0..1: how far the phone is up (one-handed shooting). */
  phone?: number;
  /** Gear that steadies hip fire (Lonkalta): multiplies the hip spread. */
  hipMul?: number;
}

/** Cone half-angle in degrees for the next shot. */
export function spreadFor(t: WeaponTuning, s: SpreadInput): number {
  const moveK = clamp(s.speed / Math.max(0.1, s.maxSpeed), 0, 1);
  let hip = t.spreadHip + t.spreadMove * moveK + s.bloom;
  if (s.airborne) hip += t.spreadAir;
  if (s.crouched) hip *= t.spreadCrouchMul;
  if (s.hipMul) hip *= s.hipMul;
  hip = Math.min(hip, t.spreadMax + (s.airborne ? t.spreadAir : 0));
  const ph = s.phone ?? 0;
  if (ph > 0) hip = hip * (1 + (TUNING.phoneOut.spreadMul - 1) * ph) + TUNING.phoneOut.spreadAdd * ph;
  const ads = t.spreadAds + t.spreadAdsMove * moveK + s.bloom * 0.15 + (s.airborne ? t.spreadAir * 0.5 : 0);
  return lerp(hip, ads, s.ads);
}
