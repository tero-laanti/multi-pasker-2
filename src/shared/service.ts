import { GEAR, MINIMAP, SERVICE, SOTKU, TUNING } from './config';
import { UI } from './ui';
import { BRAKE, DRUM_ROUNDS, MAG_STEP, RPM_STEP, type Upgrades } from './upgrades';

/**
 * The service and the Sotku App's rules, shared by the server (which decides) and the phone
 * (which shows the shop): päiväraha by the day, ranks by days served, the shop's tree.
 */

/** Gear handed out in P-kausi (by text). */
export type GearId = 'rifle' | 'lipas' | 'puukko' | 'vyo';
/** The shop's nodes. */
export type ShopId = keyof typeof SOTKU.items;
/** The café's consumables. */
export type CafeId = keyof typeof SOTKU.cafe;
export type ItemId = GearId | ShopId;
export type PathId = 'sp' | 'ta' | 'vm' | 'pi';

export const PATHS: PathId[] = ['sp', 'ta', 'vm', 'pi'];
export const SHOP_IDS = Object.keys(SOTKU.items) as ShopId[];
export const CAFE_IDS = Object.keys(SOTKU.cafe) as CafeId[];
export const GEAR_IDS: GearId[] = ['rifle', 'lipas', 'puukko', 'vyo'];

export interface ShopItem {
  path: PathId;
  tier: 1 | 2 | 3 | 4;
  price: number;
  needs?: readonly ShopId[];
}

export const shopItem = (id: ShopId): ShopItem => SOTKU.items[id] as ShopItem;
export const isShopId = (id: string): id is ShopId => id in SOTKU.items;
export const isCafeId = (id: string): id is CafeId => id in SOTKU.cafe;

/** The shop's nodes of one path, row by row. */
export function pathItems(path: PathId): ShopId[] {
  return SHOP_IDS.filter((id) => shopItem(id).path === path).sort((a, b) => shopItem(a).tier - shopItem(b).tier);
}

/** Päiväraha for one day of service (days count from 1). */
export function payFor(day: number): number {
  let eur = 0;
  for (const [from, rate] of SERVICE.pay) if (day >= from) eur = rate;
  return eur;
}

/** € earned by serving `add` more days after `served`; the service ends at SERVICE.days. */
export function earn(served: number, add: number): number {
  let eur = 0;
  for (let d = served + 1; d <= Math.min(SERVICE.days, served + add); d++) eur += payFor(d);
  return eur;
}

/**
 * Rank by days served: alokas through P-kausi, sotamies after it, a promotion with each pay
 * rise (korpraali, alikersantti), and kersantti once discharged. Indexes FI.ranks.
 */
export function rankFor(days: number, discharged = false): number {
  if (discharged) return SERVICE.pay.length + 1;
  if (days < SERVICE.pkausi) return 0;
  return 1 + rises().filter((from) => days >= from).length;
}

/** The days the päiväraha rises on (each one a promotion). */
export function rises(): number[] {
  return SERVICE.pay.slice(1).map(([from]) => from);
}

/** A node can be bought: not had yet, and one of what it needs is bought (or it needs nothing). */
export function canBuy(id: ShopId, bought: ReadonlySet<string>): boolean {
  if (bought.has(id)) return false;
  const needs = shopItem(id).needs;
  return !needs || needs.some((n) => bought.has(n));
}

/** What owned gear does, as upgrade levels: the numbers the guns, the phone and the HUD read. */
export function effects(owned: Iterable<string>): Upgrades {
  const u: Upgrades = {};
  const at = (k: keyof Upgrades, lv: number) => (u[k] = Math.max(u[k] ?? 0, lv));
  for (const id of owned) {
    if (id === 'rifle' || id === 'tkiv') continue;
    if (id === 'lipas') at('lipas', 1);
    else if (id === 'lipas2') at('lipas', 2);
    else if (id === 'vyo') at('vyo', 1);
    else if (id === 'kolmas') at('vyo', 2);
    else at(id as keyof Upgrades, 1);
  }
  return u;
}

/** What the phone needs to draw the Sotku App. */
export interface StoreState {
  /** Days served (TJ = SERVICE.days − days) and the wallet. */
  days: number;
  money: number;
  /** P-kausi is over: the shop is open. */
  open: boolean;
  /** Handed over, and bought but still waiting for paperwork (in the order they come). */
  owned: ItemId[];
  waiting: ItemId[];
  /** Discharged at TJ 0, and the free item that comes with it, not yet chosen. */
  discharged: boolean;
  voucher: boolean;
  cafe: Record<CafeId, number>;
}

/** What a piece of gear (or a café item) does, in English, with the numbers from config. */
export function benefit(id: string): string {
  const R = TUNING.rifle;
  const P = TUNING.pistol;
  const G = TUNING.grenade;
  const values: Record<string, Record<string, string | number>> = {
    lipas: { a: R.magazine, b: R.magazine + MAG_STEP },
    vyo: { a: 1, b: 2 },
    plipas: { a: P.magazine, b: GEAR.pistolMagazine },
    ontelo: { a: TUNING.killSpeed.cod.pistolBody, b: GEAR.pistolBody },
    kevyt: { pct: Math.round((GEAR.pistolMoveMul - 1) * 100) },
    sarja: { b: GEAR.pistolAutoRpm },
    suujarru: { pct: Math.round((1 - BRAKE[1]!) * 100) },
    lipas2: { a: R.magazine + MAG_STEP, b: R.magazine + MAG_STEP * 2 },
    lukko: { a: R.rpm, b: R.rpm + RPM_STEP },
    rumpu: { b: DRUM_ROUNDS },
    tkiv: { b: TUNING.killSpeed.cod.sniperBody, n: TUNING.sniper.magazine },
    tutka: { a: MINIMAP.range, b: GEAR.radarRange },
    lennokki: { s: GEAR.droneTime },
    tihea: { a: G.supplyCooldown, b: GEAR.grenadeCooldown },
    heitto: { pct: Math.round((GEAR.throwMul - 1) * 100) },
    sytytin: { a: G.fuse, b: GEAR.shortFuse },
    raskas: { a: G.radius, b: GEAR.heavyRadius },
    tuli: { n: GEAR.mortarRounds, s: GEAR.mortarDelay },
  };
  const v = values[id] ?? {};
  return (UI.items[id] ?? '').replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
}
