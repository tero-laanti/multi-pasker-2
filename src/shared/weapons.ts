import { TUNING, type KillSpeedPreset, type WeaponId, type WeaponTuning } from './config';
import type { HitZone } from './hitbox';
import { clamp, lerp } from './math';

export interface WeaponInfo {
  id: WeaponId;
  auto: boolean;
  /** Slot key: 1 = rifle (primary), 2 = pistol (sidearm). */
  slot: 1 | 2;
}

export const WEAPONS: Record<WeaponId, WeaponInfo> = {
  rifle: { id: 'rifle', auto: true, slot: 1 },
  pistol: { id: 'pistol', auto: false, slot: 2 },
};

export function weaponTuning(id: WeaponId): WeaponTuning {
  return TUNING[id];
}

export function fireInterval(t: WeaponTuning): number {
  return 60 / t.rpm;
}

/** Damage for one hit, using the active kill-speed preset and distance falloff. */
export function damageFor(id: WeaponId, zone: HitZone, distance: number, preset: KillSpeedPreset): number {
  const d = TUNING.killSpeed[preset];
  const t = TUNING[id];
  if (id === 'pistol') return zone === 'head' ? d.pistolHead : d.pistolBody;
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
}

/** Cone half-angle in degrees for the next shot. */
export function spreadFor(t: WeaponTuning, s: SpreadInput): number {
  const moveK = clamp(s.speed / Math.max(0.1, s.maxSpeed), 0, 1);
  let hip = t.spreadHip + t.spreadMove * moveK + s.bloom;
  if (s.airborne) hip += t.spreadAir;
  if (s.crouched) hip *= t.spreadCrouchMul;
  hip = Math.min(hip, t.spreadMax + (s.airborne ? t.spreadAir : 0));
  const ads = t.spreadAds + t.spreadAdsMove * moveK + s.bloom * 0.15 + (s.airborne ? t.spreadAir * 0.5 : 0);
  return lerp(hip, ads, s.ads);
}
