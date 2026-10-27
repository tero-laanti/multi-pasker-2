import { SERVICE, SOTKU } from '../../shared/config';
import { normalize } from '../../shared/chat';
import { FI } from '../../shared/fi';
import { GEAR_IDS, canBuy, earn, effects, isCafeId, isShopId, payFor, rankFor, rises, shopItem, type CafeId, type ItemId, type StoreState } from '../../shared/service';
import type { Upgrades } from '../../shared/upgrades';
import type { ServerPlayer } from './player';
import type { Room } from './room';

const L = FI.ladder;
const V = FI.varusmestari;
const C = FI.commander;

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

function capitalize(s: string): string {
  return s ? s[0]!.toLocaleUpperCase('fi-FI') + s.slice(1) : s;
}

export type ContactKind = 'office' | 'huolto' | 'nylands';

export interface Contact {
  name: string;
  kind: ContactKind;
  /** The office's name in the allative ("Esikunnalle"), for wrong-chat replies. */
  to?: string;
}

/** How a piece of paperwork is done: from one word at the counter to Swedish at Dragsvik. */
export type PaperKind = 'word' | 'phrase' | 'office' | 'voice' | 'serial' | 'nylands';

/** What waits for paperwork: gear, or the discharge at TJ 0. */
export type Due = ItemId | 'discharge';

export interface Paperwork {
  due: Due;
  kind: PaperKind;
  /** Number of the conversation the answer goes to. */
  conv: string;
  /** Normalised answer. */
  answer: string;
  /** The code as issued (for keeping codes unique between players). */
  code: string;
  /** The contact posted its task in its chat (paperwork handled outside the asevarasto). */
  posted: boolean;
  /** How the contact presents the task: text, then a spelled voice note or a recorded line. */
  task?: { text: string; voice?: string[]; line?: string };
}

/** A service as the evening file keeps it. */
export interface ServiceRecord {
  days: number;
  money: number;
  owned: ItemId[];
  waiting: Due[];
  discharged: boolean;
  voucher: boolean;
  cafe: Record<CafeId, number>;
}

/** How each due thing is handed over: P-kausi teaches the kinds, the shop's rows reuse them. */
export function paperFor(due: Due, rnd: () => number = Math.random): PaperKind | null {
  switch (due) {
    case 'discharge':
      return 'nylands';
    case 'rifle':
      return 'word';
    case 'lipas':
      return 'phrase';
    case 'puukko':
      return 'office';
    case 'vyo':
      return 'voice';
    case 'tkiv':
      return 'serial';
    default: {
      const tier = shopItem(due).tier;
      return tier === 1 ? null : tier === 2 ? 'word' : tier === 3 ? (rnd() < 0.5 ? 'phrase' : 'office') : 'voice';
    }
  }
}

/** One player's service: days served, the wallet, gear, and the paperwork still to do. */
export class Service {
  days = 0;
  money = 0;
  /** Gear handed over. */
  readonly owned = new Set<ItemId>();
  /** Due or bought and waiting for paperwork, in order; the first one's may be open. */
  waiting: Due[] = [];
  open: Paperwork | null = null;
  /** The discharge paperwork is done: reservin kersantti, with the star. */
  discharged = false;
  /** The free pick that comes with the discharge. */
  voucher = false;
  cafe: Record<CafeId, number> = { munkki: 0, nakkisuoja: 0 };
  /** Numbers the player has been told to write to. */
  readonly contacts = new Map<string, Contact>();
  /** The Sotku's once-a-round commands used this round. */
  readonly used = new Set<'LENNOKKI' | 'TULI'>();
  /** Whether the next P-kausi gear came due with a kill or a death (its task's first line). */
  why: 'kill' | 'death' | null = null;
  /** Changed since the evening file was last written. */
  dirty = false;
  private fx: Upgrades | null = null;

  get tj(): number {
    return SERVICE.days - this.days;
  }

  get rank(): number {
    return rankFor(this.days, this.discharged, this.shopOpen);
  }

  /** P-kausi is passed, its days served and its gear signed for: the Sotku App is open. */
  get shopOpen(): boolean {
    return this.days >= SERVICE.pkausi && GEAR_IDS.every((id) => this.owned.has(id));
  }

  /** What the gear does, as upgrade levels. */
  get upgrades(): Upgrades {
    return (this.fx ??= effects(this.owned));
  }

  /** Had or bought: what the shop's tree counts as yours. */
  bought(): Set<string> {
    return new Set<string>([...this.owned, ...this.waiting]);
  }

  give(id: ItemId): void {
    this.owned.add(id);
    this.fx = null;
    this.dirty = true;
  }

  /** A new evening (or a new player): alokas at TJ 347 with nothing but the pistol. */
  reset(): void {
    this.days = 0;
    this.money = 0;
    this.owned.clear();
    this.waiting = [];
    this.open = null;
    this.discharged = false;
    this.voucher = false;
    this.cafe = { munkki: 0, nakkisuoja: 0 };
    this.contacts.clear();
    this.used.clear();
    this.why = null;
    this.fx = null;
    this.dirty = true;
  }

  record(): ServiceRecord {
    return { days: this.days, money: this.money, owned: [...this.owned], waiting: [...this.waiting], discharged: this.discharged, voucher: this.voucher, cafe: { ...this.cafe } };
  }

  /** Back from the evening file. Open paperwork starts again from the first waiting item. */
  restore(r: ServiceRecord): void {
    this.reset();
    const known = (id: string): id is ItemId => (GEAR_IDS as string[]).includes(id) || isShopId(id);
    this.days = Math.max(0, Math.min(SERVICE.days, Math.floor(Number(r.days) || 0)));
    this.money = Math.max(0, Math.floor(Number(r.money) || 0));
    for (const id of r.owned ?? []) if (known(id)) this.owned.add(id);
    this.waiting = (r.waiting ?? []).filter((d): d is Due => d === 'discharge' || known(d));
    this.discharged = !!r.discharged;
    this.voucher = !!r.voucher;
    for (const k of Object.keys(this.cafe) as CafeId[]) this.cafe[k] = Math.max(0, Math.floor(Number(r.cafe?.[k]) || 0));
    this.dirty = false;
  }
}

/** Short fictional numbers away from emergency and service prefixes (no 0…, no 11…). */
function shortNumber(taken: Set<string>): string {
  for (;;) {
    const n = String(2000 + Math.floor(Math.random() * 8000));
    if (!taken.has(n)) return n;
  }
}

/** 17 digits after the plus: longer than any real phone number can be. */
function longNumber(): string {
  let s = '+358';
  while (s.length < 18) s += String(Math.floor(Math.random() * 10));
  return s;
}

/**
 * The service for the whole room: days served from kills and deaths, the päiväraha, the
 * milestones the company commander texts, P-kausi gear, the Sotku App's purchases, and the
 * paperwork that hands gear over (codes unique between players where the pool allows).
 */
export class ServiceDesk {
  /** Codes handed out this round, per kind of paperwork. */
  private used = new Map<PaperKind, Set<string>>();

  constructor(private room: Room) {}

  /** New round: codes may repeat again. */
  resetRound(): void {
    this.used.clear();
  }

  /** Tells the player's desktop (rank, TJ, paperwork) and phone (the Sotku App) where they are. */
  notify(p: ServerPlayer): void {
    const s = p.service;
    p.outbox.push({ k: 'ladder', rank: p.rank, tj: s.tj, open: !!s.open, queued: Math.max(0, s.waiting.length - (s.open ? 1 : 0)) });
    p.phone.send({ t: 'store', s: this.storeState(p) });
  }

  storeState(p: ServerPlayer): StoreState {
    const s = p.service;
    const c = s.open;
    const where = c ? (c.conv === V.number ? V.name : (s.contacts.get(c.conv)?.name ?? c.conv)) : '';
    return {
      days: s.days,
      money: s.money,
      open: s.shopOpen,
      paper: c ? { item: c.due, where } : null,
      owned: [...s.owned],
      waiting: s.waiting.filter((d): d is ItemId => d !== 'discharge'),
      discharged: s.discharged,
      voucher: s.voucher,
      cafe: { ...s.cafe },
    };
  }

  /** A kill of someone else: the host's days per kill (3), one more if the victim has a lower TJ than the killer. */
  onKill(a: ServerPlayer, v: ServerPlayer): void {
    const senior = v.service.tj < a.service.tj;
    const days = this.room.settings.killDays + (senior ? SERVICE.seniorDays : 0);
    const eur = this.serve(a, days, 'kill');
    if (eur > 0) a.outbox.push({ k: 'pay', eur, days, senior });
  }

  /** Killed by someone else: a day in the veksi counts too. */
  onDeath(v: ServerPlayer): void {
    this.serve(v, SERVICE.deathDays, 'death');
  }

  /**
   * Days served: the päiväraha for each, P-kausi gear and milestones on the days passed (the
   * Sotku opening, the pay rises, TJ 0). Returns the € earned; after TJ 0 nothing is paid.
   */
  serve(p: ServerPlayer, add: number, why: 'kill' | 'death'): number {
    const s = p.service;
    const before = s.days;
    const after = Math.min(SERVICE.days, before + Math.max(0, Math.floor(add)));
    if (after === before) return 0;
    const wasOpen = s.shopOpen;
    const eur = earn(before, after - before);
    s.days = after;
    s.money += eur;
    s.dirty = true;
    const passed = (day: number) => before < day && after >= day;
    for (const [day, id] of SERVICE.gear) {
      if (passed(day) && !s.owned.has(id as ItemId) && !s.waiting.includes(id as ItemId)) {
        s.waiting.push(id as ItemId);
        s.why = why;
      }
    }
    this.pkausiPassed(p, wasOpen);
    for (const from of rises()) if (passed(from)) this.commander(p, s.shopOpen ? C.rise : C.raise, { eur: payFor(from), rank: FI.ranks[s.rank] ?? '' });
    if (passed(SERVICE.days)) s.waiting.push('discharge');
    const promoted = p.rank !== s.rank;
    p.rank = s.rank;
    this.next(p);
    this.notify(p);
    if (promoted) this.room.broadcastPlayers();
    return eur;
  }

  /** P-kausi was just passed (its days and its gear): the company commander opens the Sotku App. */
  private pkausiPassed(p: ServerPlayer, wasOpen: boolean): void {
    if (wasOpen || !p.service.shopOpen) return;
    this.commander(p, C.pkausi);
  }

  /**
   * Dev: P-kausi done in one go, its days served and its gear handed over without paperwork,
   * so the Sotku App opens.
   */
  skipPkausi(p: ServerPlayer): void {
    const s = p.service;
    if (s.days < SERVICE.pkausi) this.serve(p, SERVICE.pkausi - s.days, 'kill');
    const wasOpen = s.shopOpen;
    if (s.open && (GEAR_IDS as string[]).includes(s.open.due)) s.open = null;
    for (const id of GEAR_IDS) {
      s.waiting = s.waiting.filter((d) => d !== id);
      if (!s.owned.has(id)) this.hand(p, id, null);
    }
    this.pkausiPassed(p, wasOpen);
    p.rank = s.rank;
    this.room.broadcastPlayers();
    this.next(p);
    this.notify(p);
  }

  /** A text from the company commander, in its own chat. */
  private commander(p: ServerPlayer, list: readonly string[], values: Record<string, string | number> = {}): void {
    p.phone.conv(C.number, C.name);
    const all: Record<string, string | number> = { name: p.name, tj: p.service.tj, rankTo: FI.ranksTo[p.service.rank] ?? '', ...values };
    this.say(p, pick(list).replace(/\{(\w+)\}/g, (_, k: string) => String(all[k] ?? '')), C.number);
  }

  private fill(p: ServerPlayer, s: string): string {
    const rank = FI.ranks[p.rank] ?? FI.ranks[0]!;
    return capitalize(s.replace(/\{rank\}/g, rank).replace(/\{name\}/g, p.name).replace(/\{rankTo\}/g, FI.ranksTo[p.rank] ?? '').replace(/\{tj\}/g, String(p.service.tj)));
  }

  /**
   * A message from the asevarasto (or a contact) into the player's chat, after a short typing
   * pause. `reply`: an answer to what the player just did, never held back behind unread ones.
   */
  private say(p: ServerPlayer, text: string, from: string = V.number, voice?: { url: string; duration: number }, reply = false): void {
    this.room.varusmestari.post(p, from, text, voice, reply);
  }

  /** A code from the pool that no other player has been given for this kind, if any is left. */
  private code(kind: PaperKind, pool: readonly string[]): string {
    let used = this.used.get(kind);
    if (!used) this.used.set(kind, (used = new Set()));
    const free = pool.filter((c) => !used!.has(c));
    const c = pick(free.length ? free : pool);
    used.add(c);
    return c;
  }

  /** The first line of a handover: why P-kausi gear came, or which order arrived. */
  private intro(p: ServerPlayer, due: Due): string {
    if (due === 'discharge' || due === 'rifle') return '';
    const name = FI.items[due] ?? due;
    if (!(GEAR_IDS as string[]).includes(due)) return pick(L.orderIntro).replace('{item}', name);
    const s = p.service;
    const why = s.why ? this.fill(p, pick(s.why === 'kill' ? L.offerKill : L.offerDeath)) : '';
    s.why = null;
    const gear = pick(L.gearIntro).replace('{item}', name);
    return why ? `${why}\n${gear}` : gear;
  }

  /** Back tonight from the evening file: the paperwork for what still waits starts again. */
  resume(p: ServerPlayer): void {
    this.next(p);
  }

  /** The next waiting thing's paperwork, once nothing else is open. */
  private next(p: ServerPlayer): void {
    const s = p.service;
    if (s.open || s.waiting.length === 0) return;
    this.issue(p, s.waiting[0]!);
  }

  /** Sets up the paperwork for `due` and tells the player where to answer, in one message. */
  private issue(p: ServerPlayer, due: Due): void {
    const s = p.service;
    const kind = paperFor(due) ?? 'word';
    const intro = this.intro(p, due);
    const say = (text: string) => this.say(p, intro ? `${intro}\n${text}` : text);
    if (kind === 'word' || kind === 'phrase') {
      let code = this.code(kind, kind === 'word' ? L.stage1Codes : L.stage2Codes);
      code = code.replace('{RANK}', (FI.ranks[p.rank] ?? '').toLocaleUpperCase('fi-FI')).replace('{NAME}', p.name.toLocaleUpperCase('fi-FI'));
      s.open = { due, kind, conv: V.number, answer: normalize(code), code, posted: true };
      const lines = due === 'rifle' ? L.stage1 : kind === 'word' ? L.word : L.stage2;
      say(pick(lines).replace('{code}', code));
      return;
    }
    if (kind === 'office') {
      const [name, to] = pick(L.offices);
      const number = shortNumber(new Set([V.number, C.number, FI.inventory.number, ...s.contacts.keys()]));
      s.contacts.set(number, { name, kind: 'office', to });
      const rules = Math.random() < 0.5;
      const code = rules ? this.code('office', L.officeWords) : this.code('office', L.officePhrases);
      const text = pick(rules ? L.officeRules : L.officePhrase).replace('{office}', name).replace('{code}', code);
      s.open = { due, kind, conv: number, answer: normalize(code), code, posted: false, task: { text } };
      say(pick(L.stage3).replace('{office}', name).replace('{number}', number));
      this.postTask(p);
      return;
    }
    if (kind === 'voice') {
      const number = this.huolto(p);
      const code = this.code('voice', L.stage4Codes);
      s.open = { due, kind, conv: number, answer: normalize(code), code, posted: false, task: { text: pick(L.huoltoNote), voice: [...code] } };
      say(pick(L.stage4).replace('{number}', number));
      this.postTask(p);
      return;
    }
    if (kind === 'serial') {
      // The serial number off a gun: inspect (I) to read it.
      const known = [...s.contacts.values()].some((c) => c.kind === 'huolto');
      const number = this.huolto(p);
      const serials = p.serials;
      const how = pick(['full', 'last3', 'reversed', 'pistol'] as const);
      const code = how === 'full' ? serials.rifle : how === 'last3' ? serials.rifle.slice(-3) : how === 'reversed' ? [...serials.rifle].reverse().join('') : serials.pistol;
      s.open = { due, kind, conv: number, answer: normalize(code), code, posted: false, task: { text: pick(L.stage5[how]) } };
      say(known ? pick(L.stage5Intro) : pick(L.stage5New).replace('{number}', number));
      this.postTask(p);
      return;
    }
    // The discharge: Nylands brigad, in Swedish. The company commander sends you there.
    const number = shortNumber(new Set([V.number, C.number, FI.inventory.number, ...s.contacts.keys()]));
    s.contacts.set(number, { name: L.nylands, kind: 'nylands' });
    const code = this.code('nylands', FI.voice.swedish.map(([, c]) => c));
    const file = FI.voice.swedish.find(([, c]) => c === code)![0];
    s.open = { due, kind, conv: number, answer: normalize(code), code, posted: false, task: { text: pick(L.nylandsNote), line: file } };
    this.commander(p, C.tj0, { number });
    this.postTask(p);
  }

  /** The huoltopäällikkö's long number (made up the first time it is needed). */
  private huolto(p: ServerPlayer): string {
    const s = p.service;
    let number = [...s.contacts].find(([, c]) => c.kind === 'huolto')?.[0];
    if (!number) {
      number = longNumber();
      s.contacts.set(number, { name: L.huolto, kind: 'huolto' });
    }
    return number;
  }

  /**
   * The contact's own message with the task. It appears once the player has opened that chat
   * themselves (we never open it for them); if the chat already exists, it arrives right away.
   */
  postTask(p: ServerPlayer): void {
    const c = p.service.open;
    if (!c || c.posted || !c.task || !p.phone.convs.has(c.conv)) return;
    c.posted = true;
    const voice = c.task.voice ? this.room.voiceNotes.spell(c.task.voice) : c.task.line ? this.room.voiceNotes.line(c.task.line) : undefined;
    this.say(p, c.task.text, c.conv);
    if (voice) this.say(p, '', c.conv, voice);
  }

  /** Dev: completes the open paperwork, or serves ten more days if there is none. */
  advance(p: ServerPlayer): void {
    if (p.service.open) this.complete(p);
    else this.serve(p, 10, 'kill');
  }

  /** The phone opened a chat with a number: known contacts get their name (and their task). */
  opened(p: ServerPlayer, number: string): boolean {
    const contact = p.service.contacts.get(number);
    if (!contact) return false;
    p.phone.conv(number, contact.name);
    this.postTask(p);
    return true;
  }

  contact(p: ServerPlayer, number: string): Contact | undefined {
    return p.service.contacts.get(number);
  }

  /**
   * Checks a message against the open paperwork. 'done' completes it; 'wrongChat' is the right
   * code in the wrong conversation; null means it has nothing to do with the paperwork.
   */
  check(p: ServerPlayer, conv: string, text: string): 'done' | 'wrongChat' | null {
    const s = p.service;
    const c = s.open;
    if (!c) return null;
    const t = normalize(text);
    if (s.cafe.munkki > 0 && conv === V.number && t === 'KIITOS') {
      s.cafe.munkki--;
      s.dirty = true;
      this.say(p, pick(L.munkkiDone), V.number, undefined, true);
      this.complete(p);
      return 'done';
    }
    if (t !== c.answer) return null;
    if (conv !== c.conv || (c.task && !c.posted)) return 'wrongChat';
    this.complete(p);
    return 'done';
  }

  private complete(p: ServerPlayer): void {
    const s = p.service;
    const c = s.open;
    if (!c) return;
    const wasOpen = s.shopOpen;
    s.open = null;
    if (s.waiting[0] === c.due) s.waiting.shift();
    else s.waiting = s.waiting.filter((d) => d !== c.due);
    if (c.due === 'discharge') {
      s.discharged = true;
      s.voucher = true;
      s.dirty = true;
      this.say(p, pick(L.nylandsDone), c.conv, undefined, true);
      p.stats.swedishAt = this.room.now();
      this.commander(p, C.discharged);
      this.say(p, L.tj0);
      p.rank = s.rank;
      this.room.broadcastPlayers();
    } else this.hand(p, c.due, c.conv);
    // The last piece of P-kausi's gear may be what passes it.
    this.pkausiPassed(p, wasOpen);
    if (p.rank !== s.rank) {
      p.rank = s.rank;
      this.room.broadcastPlayers();
    }
    this.next(p);
    this.notify(p);
  }

  /** Gear handed over: it works from now on, and the chat it came through says so. */
  private hand(p: ServerPlayer, id: ItemId, from: string | null): void {
    p.service.give(id);
    if (from) {
      if (id === 'rifle') this.say(p, pick(L.stage1Done), from, undefined, true);
      else this.say(p, pick(L.upgradeTaken).replace('{upgrade}', FI.items[id] ?? id), from, undefined, true);
    }
    if (id === 'rifle') this.room.giveWeapon(p, 'rifle');
    if (id === 'tkiv') this.room.giveWeapon(p, 'sniper');
    this.room.applyUpgrades(p, id);
  }

  /**
   * The Sotku App's Buy. Pays (or uses the free discharge pick), then hands row I over at once
   * and queues paperwork for the rest. The café's goods go straight into the pocket.
   */
  buy(p: ServerPlayer, id: string): boolean {
    const s = p.service;
    if (!s.shopOpen) return false;
    if (isCafeId(id)) {
      const price = SOTKU.cafe[id];
      if (s.money < price) return false;
      s.money -= price;
      s.cafe[id]++;
      s.dirty = true;
      this.notify(p);
      return true;
    }
    if (!isShopId(id) || !canBuy(id, s.bought())) return false;
    const price = shopItem(id).price;
    if (s.voucher) s.voucher = false;
    else if (s.money >= price) s.money -= price;
    else return false;
    s.dirty = true;
    if (paperFor(id) === null) this.hand(p, id, null);
    else {
      s.waiting.push(id);
      this.next(p);
    }
    this.notify(p);
    return true;
  }
}
