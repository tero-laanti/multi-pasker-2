import { TUNING, type WeaponId } from './config';

/**
 * Upgrades from the TJ ladder: what each does, and the weapon numbers that result. Server and
 * clients compute stats from the same upgrade levels, so they always agree.
 */

export type UpgradeId = 'lipas' | 'suujarru' | 'lukko' | 'vaimennin' | 'vyo' | 'tumma' | 'pikavalinta' | 'munkki' | 'rumpu';

export interface UpgradeDef {
  id: UpgradeId;
  /** Finnish name, as the varusmestari calls it. */
  name: string;
  levels: number;
  /** The exact benefit of taking level `n` (1-based; English, shown before confirming). */
  benefit: (n: number) => string;
  /** Only offered on these ladder stages (otherwise any stage 2–6). */
  stages?: number[];
}

const MAG_STEP = 10;
const RPM_STEP = 100;
const BRAKE = [1, 0.75, 0.6];
export const DRUM_ROUNDS = 75;

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  lipas: {
    id: 'lipas',
    name: 'Pidennetty lipas',
    levels: 2,
    benefit: (n) => `Rifle magazine ${TUNING.rifle.magazine + MAG_STEP * (n - 1)} → ${TUNING.rifle.magazine + MAG_STEP * n} rounds.`,
  },
  suujarru: { id: 'suujarru', name: 'Suujarru', levels: 2, benefit: (n) => `Recoil −${Math.round((1 - BRAKE[n]!) * 100)} %.` },
  lukko: {
    id: 'lukko',
    name: 'Kevennetty lukko',
    levels: 2,
    benefit: (n) => `Rifle fire rate ${TUNING.rifle.rpm + RPM_STEP * (n - 1)} → ${TUNING.rifle.rpm + RPM_STEP * n} rounds per minute.`,
  },
  vaimennin: { id: 'vaimennin', name: 'Vaimennin', levels: 1, benefit: () => 'Suppressor: quieter shots, heard from a smaller radius, and no muzzle flash. Others can see it on your gun.' },
  vyo: { id: 'vyo', name: 'Kranaattivyö', levels: 1, benefit: () => 'Carry 2 grenades instead of 1.' },
  tumma: { id: 'tumma', name: 'Tumma tila', levels: 1, benefit: () => 'Dark mode: others can’t see you using your phone.' },
  pikavalinta: { id: 'pikavalinta', name: 'Pikavalinta', levels: 1, benefit: () => 'Speed dial: L works as LATAA and K as KRANAATTI.' },
  munkki: { id: 'munkki', name: 'Sotkun munkkikahvit', levels: 1, benefit: () => 'Your next challenge is done by sending KIITOS in the Asevarasto chat.' },
  rumpu: { id: 'rumpu', name: 'Rumpulipas', levels: 1, benefit: () => `${DRUM_ROUNDS}-round drum magazine for the rifle. Others can see it on your gun.`, stages: [5, 6] },
};

export type Upgrades = Partial<Record<UpgradeId, number>>;

export const level = (u: Upgrades, id: UpgradeId): number => u[id] ?? 0;

export interface WeaponStats {
  magazine: number;
  rpm: number;
  /** Multiplier on recoil (kick and camera). */
  recoilMul: number;
  silenced: boolean;
}

/** A weapon's numbers with the player's upgrades (the rifle mods apply to the rifle only). */
export function weaponStats(id: WeaponId, u: Upgrades): WeaponStats {
  const t = TUNING[id];
  const brake = BRAKE[level(u, 'suujarru')] ?? 1;
  const silenced = level(u, 'vaimennin') > 0;
  if (id !== 'rifle') return { magazine: t.magazine, rpm: t.rpm, recoilMul: brake, silenced };
  const magazine = level(u, 'rumpu') > 0 ? DRUM_ROUNDS : t.magazine + MAG_STEP * level(u, 'lipas');
  return { magazine, rpm: t.rpm + RPM_STEP * level(u, 'lukko'), recoilMul: brake, silenced };
}

export const maxGrenades = (u: Upgrades): number => (level(u, 'vyo') > 0 ? 2 : 1);

/** Up to `n` different upgrades that can still be taken at this ladder stage, picked at random. */
export function upgradeChoices(u: Upgrades, stage: number, n = 3, rnd: () => number = Math.random): UpgradeId[] {
  const eligible = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => level(u, d.id) < d.levels && (!d.stages || d.stages.includes(stage)) && !(d.id === 'lipas' && level(u, 'rumpu') > 0));
  const out: UpgradeId[] = [];
  const pool = [...eligible];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!.id);
  return out;
}
