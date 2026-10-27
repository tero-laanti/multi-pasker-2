import { LADDER } from '../../shared/config';
import { normalize } from '../../shared/chat';
import { FI } from '../../shared/fi';
import { UPGRADES, upgradeChoices, type UpgradeId, type Upgrades } from '../../shared/upgrades';
import type { ServerPlayer } from './player';
import type { Room } from './room';

const L = FI.ladder;
const V = FI.varusmestari;

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

export interface Challenge {
  stage: number;
  /** Number of the conversation the answer goes to. */
  conv: string;
  /** Normalised answer. */
  answer: string;
  /** The code as issued (for keeping codes unique between players). */
  code: string;
  /** The contact posted its task in its chat (stages handled outside the asevarasto). */
  posted: boolean;
  /** How the contact presents the task: text, then a spelled voice note or a recorded line. */
  task?: { text: string; voice?: string[]; line?: string };
}

/** One player's progress up the TJ ladder this round. */
export class Ladder {
  /** Completed stages: the player's rank, and TJ = stages − this. */
  stage = 0;
  open: Challenge | null = null;
  queued = 0;
  kills = 0;
  deaths = 0;
  started = false;
  upgrades: Upgrades = {};
  /** The upgrade screen is waiting on the phone. */
  choice: { stage: number; options: UpgradeId[] } | null = null;
  /** Numbers the player has been told to write to. */
  readonly contacts = new Map<string, Contact>();
  /** Sotkun munkkikahvit: KIITOS completes the next challenge. */
  munkki = false;

  get tj(): number {
    return LADDER.stages - this.stage;
  }

  get done(): boolean {
    return this.stage >= LADDER.stages;
  }

  reset(): void {
    this.stage = 0;
    this.open = null;
    this.queued = 0;
    this.kills = 0;
    this.deaths = 0;
    this.started = false;
    this.upgrades = {};
    this.choice = null;
    this.contacts.clear();
    this.munkki = false;
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
 * The ladder for the whole room: offers from kills and deaths, issuing each stage's challenge
 * (with codes unique between players where the pool allows), checking answers, promotions and
 * upgrade choices. Talks to the phones through the varusmestari and the contacts.
 */
export class LadderService {
  /** Codes handed out this round, per stage. */
  private used = new Map<number, Set<string>>();

  constructor(private room: Room) {}

  /** New round: everyone starts again from alokas. */
  resetRound(): void {
    this.used.clear();
  }

  /** Tells the player's desktop where they are on the ladder (rank, TJ, open task, queue). */
  notify(p: ServerPlayer): void {
    const l = p.ladder;
    p.outbox.push({ k: 'ladder', rank: p.rank, tj: l.tj, open: !!l.open, queued: l.queued, choice: !!l.choice });
  }

  private threshold(): number {
    const extra = Math.max(0, this.room.activeCount() - LADDER.scaleFrom);
    return LADDER.offerEvery + Math.floor(extra / LADDER.scaleEvery);
  }

  /** A kill by `p` (not of themselves). */
  onKill(p: ServerPlayer): void {
    const l = p.ladder;
    if (!l.started) return this.first(p, 'kill');
    if (++l.kills >= this.threshold()) {
      l.kills = 0;
      this.offer(p, 'kill');
    }
  }

  /** `p` was killed by someone else. */
  onDeath(p: ServerPlayer): void {
    const l = p.ladder;
    if (!l.started) return this.first(p, 'death');
    if (++l.deaths >= this.threshold()) {
      l.deaths = 0;
      this.offer(p, 'death');
    }
  }

  private first(p: ServerPlayer, why: 'kill' | 'death'): void {
    p.ladder.started = true;
    this.offer(p, why);
  }

  /** A new task is on offer; it waits in the queue while another one is unfinished. */
  offer(p: ServerPlayer, why: 'kill' | 'death'): void {
    const l = p.ladder;
    if (l.done) return;
    const pending = l.stage + (l.open ? 1 : 0) + l.queued + (l.choice ? 0 : 0);
    if (pending >= LADDER.stages) return;
    if (l.open || l.choice) {
      // It waits its turn (the HUD and the phone show the queue); no extra message.
      l.queued++;
      this.notify(p);
      return;
    }
    this.issue(p, this.fill(p, pick(why === 'kill' ? L.offerKill : L.offerDeath)));
    this.notify(p);
  }

  private fill(p: ServerPlayer, s: string): string {
    const rank = FI.ranks[p.rank] ?? FI.ranks[0]!;
    return capitalize(s.replace(/\{rank\}/g, rank).replace(/\{name\}/g, p.name).replace(/\{rankTo\}/g, FI.ranksTo[p.rank] ?? '').replace(/\{tj\}/g, String(p.ladder.tj)));
  }

  /**
   * A message from the asevarasto (or a contact) into the player's chat, after a short typing
   * pause. `reply`: an answer to what the player just did, never held back behind unread ones.
   */
  private say(p: ServerPlayer, text: string, from: string = V.number, voice?: { url: string; duration: number }, reply = false): void {
    this.room.varusmestari.post(p, from, text, voice, reply);
  }

  /** A code from the pool that no other player has been given at this stage, if any is left. */
  private code(stage: number, pool: readonly string[]): string {
    let used = this.used.get(stage);
    if (!used) this.used.set(stage, (used = new Set()));
    const free = pool.filter((c) => !used!.has(c));
    const c = pick(free.length ? free : pool);
    used.add(c);
    return c;
  }

  /**
   * Sets up the next stage's challenge and tells the player where to answer, in one message
   * (after `intro`, the reason for the offer, if any).
   */
  private issue(p: ServerPlayer, intro = ''): void {
    const l = p.ladder;
    const say = (text: string) => this.say(p, intro ? `${intro}\n${text}` : text);
    const stage = l.stage + 1;
    if (stage > LADDER.stages) return;
    if (stage === 1 || stage === 2) {
      let code = this.code(stage, stage === 1 ? L.stage1Codes : L.stage2Codes);
      code = code.replace('{RANK}', (FI.ranks[p.rank] ?? '').toLocaleUpperCase('fi-FI')).replace('{NAME}', p.name.toLocaleUpperCase('fi-FI'));
      l.open = { stage, conv: V.number, answer: normalize(code), code, posted: true };
      say(pick(stage === 1 ? L.stage1 : L.stage2).replace('{code}', code));
      return;
    }
    if (stage === 3) {
      const [name, to] = pick(L.offices);
      const taken = new Set([V.number, ...l.contacts.keys()]);
      const number = shortNumber(taken);
      l.contacts.set(number, { name, kind: 'office', to });
      const rules = Math.random() < 0.5;
      const code = rules ? this.code(3, L.officeWords) : this.code(3, L.officePhrases);
      const text = pick(rules ? L.officeRules : L.officePhrase).replace('{office}', name).replace('{code}', code);
      l.open = { stage, conv: number, answer: normalize(code), code, posted: false, task: { text } };
      say(pick(L.stage3).replace('{office}', name).replace('{number}', number));
      this.postTask(p);
      return;
    }
    if (stage === 4) {
      const number = this.huolto(p);
      const code = this.code(4, L.stage4Codes);
      l.open = { stage, conv: number, answer: normalize(code), code, posted: false, task: { text: pick(L.huoltoNote), voice: [...code] } };
      say(pick(L.stage4).replace('{number}', number));
      this.postTask(p);
      return;
    }
    if (stage === 5) {
      // The serial number off the gun: inspect (I) to read it.
      const number = this.huolto(p);
      const s = p.serials;
      const kind = pick(['full', 'last3', 'reversed', 'pistol'] as const);
      const code = kind === 'full' ? s.rifle : kind === 'last3' ? s.rifle.slice(-3) : kind === 'reversed' ? [...s.rifle].reverse().join('') : s.pistol;
      l.open = { stage, conv: number, answer: normalize(code), code, posted: false, task: { text: pick(L.stage5[kind]) } };
      say(pick(L.stage5Intro));
      this.postTask(p);
      return;
    }
    if (stage === 6) {
      const taken = new Set([V.number, ...l.contacts.keys()]);
      const number = shortNumber(taken);
      l.contacts.set(number, { name: L.nylands, kind: 'nylands' });
      const code = this.code(6, FI.voice.swedish.map(([, c]) => c));
      const file = FI.voice.swedish.find(([, c]) => c === code)![0];
      l.open = { stage, conv: number, answer: normalize(code), code, posted: false, task: { text: pick(L.nylandsNote), line: file } };
      say(pick(L.stage6).replace('{number}', number));
      this.postTask(p);
    }
  }

  /** The huoltopäällikkö's long number (made up if stage 4 was skipped). */
  private huolto(p: ServerPlayer): string {
    const l = p.ladder;
    let number = [...l.contacts].find(([, c]) => c.kind === 'huolto')?.[0];
    if (!number) {
      number = longNumber();
      l.contacts.set(number, { name: L.huolto, kind: 'huolto' });
    }
    return number;
  }

  /**
   * The contact's own message with the task. It appears once the player has opened that chat
   * themselves (we never open it for them); if the chat already exists, it arrives right away.
   */
  postTask(p: ServerPlayer): void {
    const c = p.ladder.open;
    if (!c || c.posted || !c.task || !p.phone.convs.has(c.conv)) return;
    c.posted = true;
    const voice = c.task.voice ? this.room.voiceNotes.spell(c.task.voice) : c.task.line ? this.room.voiceNotes.line(c.task.line) : undefined;
    this.say(p, c.task.text, c.conv);
    if (voice) this.say(p, '', c.conv, voice);
  }

  /** Dev: completes the open task (or opens one) as if the right code had been sent. */
  advance(p: ServerPlayer): void {
    const l = p.ladder;
    l.started = true;
    if (l.choice) this.choose(p, l.choice.options[0]!);
    else if (l.open) this.complete(p);
    else this.offer(p, 'kill');
  }

  /** The phone opened a chat with a number: known contacts get their name (and their task). */
  opened(p: ServerPlayer, number: string): boolean {
    const contact = p.ladder.contacts.get(number);
    if (!contact) return false;
    p.phone.conv(number, contact.name);
    this.postTask(p);
    return true;
  }

  contact(p: ServerPlayer, number: string): Contact | undefined {
    return p.ladder.contacts.get(number);
  }

  /**
   * Checks a message against the open challenge. 'done' completes it; 'wrongChat' is the right
   * code in the wrong conversation; null means it has nothing to do with the ladder.
   */
  check(p: ServerPlayer, conv: string, text: string): 'done' | 'wrongChat' | null {
    const l = p.ladder;
    const c = l.open;
    if (!c) return null;
    const t = normalize(text);
    if (l.munkki && conv === V.number && t === 'KIITOS') {
      l.munkki = false;
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
    const l = p.ladder;
    const c = l.open;
    if (!c) return;
    l.open = null;
    l.stage = c.stage;
    p.rank = l.stage;
    const from = c.conv;
    const promoted = this.fill(p, pick(L.promoted));
    if (c.stage === 1) {
      this.say(p, `${pick(L.stage1Done)}\n${promoted}`, from, undefined, true);
      this.room.giveWeapon(p, 'rifle');
    } else if (c.stage === 6) {
      // Nylands brigad answers in Swedish; the promotion comes from the asevarasto.
      this.say(p, pick(L.nylandsDone), from, undefined, true);
      p.stats.swedishAt = this.room.now();
    }
    if (l.done) this.say(p, `${promoted}\n${L.tj0}`);
    else if (c.stage !== 1) this.say(p, promoted, from, undefined, true);
    this.room.broadcastPlayers();
    if (c.stage >= 2) {
      const options = upgradeChoices(l.upgrades, c.stage);
      if (options.length) {
        l.choice = { stage: c.stage, options };
        this.room.sendUpgradeChoice(p);
        this.notify(p);
        return;
      }
    }
    this.next(p);
    this.notify(p);
  }

  /** The player picked an upgrade on the phone. */
  choose(p: ServerPlayer, id: UpgradeId): boolean {
    const l = p.ladder;
    if (!l.choice || !l.choice.options.includes(id)) return false;
    l.choice = null;
    const lv = (l.upgrades[id] ?? 0) + 1;
    l.upgrades[id] = Math.min(UPGRADES[id].levels, lv);
    if (id === 'munkki') l.munkki = true;
    this.room.applyUpgrades(p, id);
    this.say(p, pick(L.upgradeTaken).replace('{upgrade}', UPGRADES[id].name), V.number, undefined, true);
    this.next(p);
    this.notify(p);
    return true;
  }

  /** Queued offers become the next challenge once nothing else is open. */
  private next(p: ServerPlayer): void {
    const l = p.ladder;
    if (l.queued > 0 && !l.open && !l.choice && !l.done) {
      l.queued--;
      this.issue(p);
    }
  }
}
