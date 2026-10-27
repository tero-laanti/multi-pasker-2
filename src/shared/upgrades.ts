import { GEAR, TUNING, type WeaponId } from './config';
import { WEAPONS } from './weapons';

/**
 * Upgrade levels: what a player's gear does (service.ts turns owned gear into these), and the
 * weapon numbers that result. Server and clients compute stats from the same levels, so they
 * always agree.
 */

export type UpgradeId =
  | 'lipas'
  | 'vyo'
  | 'puukko'
  | 'pveto'
  | 'plipas'
  | 'lonkka'
  | 'ontelo'
  | 'kevyt'
  | 'sarja'
  | 'suujarru'
  | 'punapiste'
  | 'rumpu'
  | 'vaimennin'
  | 'pikavalinta'
  | 'autofill'
  | 'tutka'
  | 'tumma'
  | 'kannykka'
  | 'lennokki'
  | 'tihea'
  | 'heitto'
  | 'sirpale'
  | 'raskas'
  | 'tuli';

export type Upgrades = Partial<Record<UpgradeId, number>>;

export const level = (u: Upgrades, id: UpgradeId): number => u[id] ?? 0;

/** Rifle magazine growth per long-magazine level. */
export const MAG_STEP = 10;
/** Recoil multiplier by muzzle-brake level. */
export const BRAKE = [1, 0.75, 0.6];
export const DRUM_ROUNDS = 75;

export interface WeaponStats {
  magazine: number;
  rpm: number;
  /** Fires for as long as the trigger is held. */
  auto: boolean;
  /** Multiplier on recoil (kick and camera). */
  recoilMul: number;
  silenced: boolean;
  /** Multipliers on drawing and aiming times, on hip-fire spread, and on aimed spread on the move. */
  drawMul: number;
  adsMul: number;
  hipMul: number;
  adsMoveMul: number;
  /** Movement speed with this gun out, on top of its own moveSpeedMul. */
  moveMul: number;
}

/** A weapon's numbers with the player's upgrades. */
export function weaponStats(id: WeaponId, u: Upgrades): WeaponStats {
  const t = TUNING[id];
  const base: WeaponStats = {
    magazine: t.magazine,
    rpm: t.rpm,
    auto: WEAPONS[id].auto,
    recoilMul: BRAKE[level(u, 'suujarru')] ?? 1,
    silenced: level(u, 'vaimennin') > 0,
    drawMul: 1,
    adsMul: 1,
    hipMul: 1,
    adsMoveMul: 1,
    moveMul: 1,
  };
  if (id === 'pistol') {
    const quick = level(u, 'pveto') > 0 ? GEAR.pistolDrawMul : 1;
    const auto = level(u, 'sarja') > 0;
    return {
      ...base,
      magazine: level(u, 'plipas') > 0 ? GEAR.pistolMagazine : t.magazine,
      rpm: auto ? GEAR.pistolAutoRpm : t.rpm,
      auto: auto || base.auto,
      drawMul: quick,
      adsMul: quick,
      hipMul: level(u, 'lonkka') > 0 ? GEAR.pistolHipMul : 1,
      moveMul: level(u, 'kevyt') > 0 ? GEAR.pistolMoveMul : 1,
    };
  }
  if (id === 'rifle') {
    const magazine = level(u, 'rumpu') > 0 ? DRUM_ROUNDS : t.magazine + MAG_STEP * level(u, 'lipas');
    const dot = level(u, 'punapiste') > 0;
    return { ...base, magazine, adsMul: dot ? GEAR.redDotAdsMul : 1, adsMoveMul: dot ? GEAR.redDotAdsMoveMul : 1 };
  }
  return base;
}

export const maxGrenades = (u: Upgrades): number => 1 + level(u, 'vyo');
