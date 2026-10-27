import { INVENTORY, PHONE, TUNING } from '../../shared/config';
import { classify, normalize, type Classified } from '../../shared/chat';
import { FI } from '../../shared/fi';
import { level } from '../../shared/upgrades';
import type { PhoneMessage } from '../../shared/protocol';
import type { InventoryKind, ServerPlayer } from './player';
import type { Room } from './room';

const V = FI.varusmestari;

/** YK (yhteyskoe, the radio check), however it was typed. */
export function isRadioCheckReply(text: string): boolean {
  const t = normalize(text).replace(/\s+/g, '');
  return t === 'YK' || t === 'YHTEYSKOE';
}

function pick(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? '';
}

function capitalize(s: string): string {
  return s ? s[0]!.toLocaleUpperCase('fi-FI') + s.slice(1) : s;
}

export interface SendRequest {
  rid: string;
  conv: string;
  text: string;
  life: number;
  round: number;
}

interface Decision {
  reply: string;
  /** Shown to everyone in the typo feed (anything that wasn't valid here). */
  public: boolean;
  /** A command that was carried out or answered on its merits (read quickly). */
  command: boolean;
}

/**
 * The armourer: reads what players text the asevarasto, carries out LATAA and KRANAATTI
 * on the server's own state, and answers everything else from the script in fi.ts.
 */
export class Varusmestari {
  constructor(private room: Room) {}

  /** The tutorial's radio check: the first text on the range, answered with YK. */
  radioCheck(p: ServerPlayer): void {
    if (p.radioCheck === 'waiting' || p.radioCheck === 'done') return;
    p.radioCheck = 'waiting';
    p.phone.conv(V.number, V.name);
    this.post(p, V.number, pick(FI.training.radioCheck));
  }

  /** Opens the asevarasto chat with the instructions (they stay in the history). */
  greet(p: ServerPlayer): void {
    const phone = p.phone;
    phone.conv(V.number, V.name);
    phone.add(V.number, { id: phone.newId(), from: 'them', text: pick(V.welcome), at: Date.now() });
  }

  /**
   * A message from the asevarasto (or a contact's number) into the player's chat, after a
   * typing pause; messages queue so they arrive one at a time. Returns when it arrives.
   */
  post(p: ServerPlayer, from: string, text: string, voice?: { url: string; duration: number }): number {
    const phone = p.phone;
    if (from === V.number && !phone.convs.has(V.number)) this.greet(p);
    if (!phone.convs.has(from)) return this.room.now();
    const now = this.room.now();
    const typing = voice ? 1400 : Math.min(PHONE.typingMax, Math.max(PHONE.typingMin, text.length / PHONE.typingCps)) * 1000;
    const start = Math.max(now + 300, phone.busyUntil);
    phone.busyUntil = start + typing;
    phone.schedule(start, () => phone.send({ t: 'typing', conv: from, on: true }));
    phone.schedule(start + typing, () => {
      phone.send({ t: 'typing', conv: from, on: false });
      phone.add(from, { id: phone.newId(), from: 'them', text: voice ? undefined : text, voice, at: Date.now() });
    });
    return start + typing;
  }

  /**
   * A surprise inventory check: a question about the player's own kit or the round. The
   * answer time starts when the question arrives on the phone.
   */
  inventory(p: ServerPlayer): void {
    const kinds: InventoryKind[] = ['mag', 'spare', 'grenades', 'kills', 'deaths', 'players'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
    const rank = FI.ranks[p.rank] ?? FI.ranks[0]!;
    const text = pick(FI.inventory.ask[kind]!).replace(/\{s\}/g, String(INVENTORY.answerTime)).replace(/\{rank\}/g, rank);
    const arrives = this.post(p, V.number, text);
    const expires = arrives + INVENTORY.answerTime * 1000;
    p.inventory = { kind, asked: this.room.inventoryValue(p, kind), expires };
    p.outbox.push({ k: 'inventory', until: expires });
    p.phone.schedule(arrives, () => p.phone.send({ t: 'inventory', left: INVENTORY.answerTime }));
  }

  /** No right answer in time: push-ups, and everyone gets to read about it. */
  inventoryTimeout(p: ServerPlayer): void {
    p.inventory = null;
    p.outbox.push({ k: 'inventory', until: 0 });
    p.phone.send({ t: 'inventory', left: 0 });
    p.phone.locked = true;
    p.stats.pushups++;
    const reply = capitalize(pick(FI.inventory.timeout));
    this.post(p, V.number, reply);
    this.room.offerTypo(p, V.name, '…', reply);
  }

  /** A number while an inventory check waits: right (a grenade) or wrong (try again). */
  private inventoryAnswer(p: ServerPlayer, n: number, say: (list: readonly string[]) => string): Decision {
    const inv = p.inventory!;
    if (n !== inv.asked && n !== this.room.inventoryValue(p, inv.kind)) return { reply: say(FI.inventory.wrong), public: true, command: false };
    p.inventory = null;
    p.outbox.push({ k: 'inventory', until: 0 });
    p.phone.send({ t: 'inventory', left: 0 });
    const reply = this.room.giveGrenade(p) ? say(FI.inventory.right) : say(FI.inventory.rightFull);
    return { reply, public: false, command: true };
  }

  /** A message sent from a phone (or a bot pretending to have one). */
  receive(p: ServerPlayer, req: SendRequest): Classified['kind'] | 'retry' | 'unknownNumber' {
    const phone = p.phone;
    const now = this.room.now();
    if (phone.rids.has(req.rid)) {
      // A retry after a reconnect: confirm what we already have, act on nothing.
      const m = phone.convs.get(req.conv)?.messages.find((x) => x.id === req.rid);
      if (m) phone.send({ t: 'msg', conv: req.conv, m });
      return 'retry';
    }
    phone.rids.add(req.rid);
    const text = req.text.slice(0, 300);
    phone.draft = null;
    phone.activeUntil = now + PHONE.activeTime * 1000;
    const conv = phone.convs.get(req.conv) ?? phone.conv(req.conv, req.conv);
    const out: PhoneMessage = { id: req.rid, from: 'me', text, at: Date.now(), state: 'sent' };
    phone.add(conv.id, out);
    phone.schedule(now + 120, () => phone.setState(conv.id, out.id, 'delivered'));

    // The TJ ladder first: the right code in the right chat completes the task.
    const [r0, r1] = PHONE.readDelay;
    const ladder = this.room.ladder.check(p, conv.id, text);
    if (ladder === 'done') {
      phone.schedule(now + 250, () => phone.setState(conv.id, out.id, 'read'));
      return 'command';
    }
    const contact = this.room.ladder.contact(p, conv.id);
    if (ladder === 'wrongChat' || (contact && conv.id !== V.number)) {
      const reply = contact?.kind === 'nylands' ? this.swedishReply(text) : pick(ladder === 'wrongChat' ? FI.ladder.wrongChat : FI.ladder.officeOther);
      phone.schedule(now + (r0 + Math.random() * (r1 - r0)) * 1000, () => phone.setState(conv.id, out.id, 'read'));
      this.post(p, conv.id, reply);
      this.room.offerTypo(p, conv.name, text, reply);
      return 'other';
    }
    if (conv.id !== V.number) {
      // Numbers that don't exist: the message bounces.
      phone.schedule(now + 500, () => {
        phone.setState(conv.id, out.id, 'failed');
        phone.add(conv.id, { id: phone.newId(), from: 'system', text: V.unknownNumber, at: Date.now() });
      });
      this.room.offerTypo(p, conv.name, text, V.unknownNumber);
      return 'unknownNumber';
    }

    const c = classify(text, level(p.ladder.upgrades, 'pikavalinta') > 0);
    const d = this.decide(p, req, c, text, now);
    const read = now + (d.command ? 250 : (r0 + Math.random() * (r1 - r0)) * 1000);
    phone.schedule(read, () => phone.setState(conv.id, out.id, 'read'));
    if (d.reply) {
      const typing = Math.min(PHONE.typingMax, Math.max(PHONE.typingMin, d.reply.length / PHONE.typingCps)) * 1000;
      const start = Math.max(read + 150, phone.busyUntil);
      phone.busyUntil = start + typing;
      const reply = d.reply;
      phone.schedule(start, () => phone.send({ t: 'typing', conv: conv.id, on: true }));
      phone.schedule(start + typing, () => {
        phone.send({ t: 'typing', conv: conv.id, on: false });
        phone.add(conv.id, { id: phone.newId(), from: 'them', text: reply, at: Date.now() });
      });
    }
    if (d.public) this.room.offerTypo(p, V.name, text, d.reply);
    return c.kind;
  }

  /** Nylands brigad: anything that isn't Swedish gets told to answer in Swedish. */
  private swedishReply(text: string): string {
    const t = normalize(text);
    const swedishCodes = Object.keys(FI.ladder.swedishInFinnish);
    if (swedishCodes.includes(t) || classify(text).kind === 'swedish') return pick(FI.ladder.nylandsWrong);
    return pick(FI.ladder.nylandsFinnish);
  }

  private decide(p: ServerPlayer, req: SendRequest, c: Classified, text: string, now: number): Decision {
    const phone = p.phone;
    const rank = FI.ranks[p.rank] ?? FI.ranks[0]!;
    const say = (list: readonly string[], cmd = '') => capitalize(pick(list).replace(/\{rank\}/g, rank).replace(/\{cmd\}/g, cmd));
    const answer = (list: readonly string[], cmd = ''): Decision => ({ reply: say(list, cmd), public: true, command: false });
    const ok = (reply: string): Decision => ({ reply, public: false, command: true });

    // Spam: many messages in a short time, or the same thing over and over.
    phone.recent.push({ at: now, text: normalize(text) });
    phone.recent = phone.recent.filter((r) => now - r.at < PHONE.spamWindow * 1000).slice(-10);
    const last = phone.recent.slice(-PHONE.spamRepeat);
    const spam = phone.recent.length >= PHONE.spamCount || (last.length === PHONE.spamRepeat && last.every((r) => r.text === last[0]!.text));

    // An inventory check waiting: a number is the answer (even during the push-up lock).
    const digits = normalize(text).replace(/\s+/g, '');
    if (p.inventory && /^\d{1,3}$/.test(digits)) return this.inventoryAnswer(p, Number(digits), say);

    // On the range: the radio check first, then LATAA and KRANAATTI for the range's own guns.
    if (p.training) {
      if (p.radioCheck === 'waiting') {
        if (!isRadioCheckReply(text)) return { reply: say(FI.training.radioCheckWrong), public: false, command: false };
        p.radioCheck = 'done';
        p.outbox.push({ k: 'training', what: 'radioCheck' });
        return ok(say(FI.training.radioCheckOk));
      }
      if (c.kind === 'command' && !phone.locked && (c.cmd === 'LATAA' || c.cmd === 'KRANAATTI')) {
        p.outbox.push({ k: 'training', what: c.cmd === 'LATAA' ? 'ammo' : 'grenade' });
        return ok(say(c.cmd === 'LATAA' ? V.reloadOk : V.grenadeOk));
      }
    }

    if (phone.locked) {
      if (c.kind === 'command' && c.cmd === 'PUNNERRETTU') {
        phone.locked = false;
        return ok(say(V.unlocked));
      }
      return answer(V.locked);
    }
    if (c.kind === 'swear') {
      phone.locked = true;
      p.stats.pushups++;
      return answer(V.swear);
    }
    if (c.kind !== 'command') {
      if (spam) return answer(V.spam);
      switch (c.kind) {
        case 'nearMiss':
          return answer(V.nearMiss, c.cmd);
        case 'question':
          return answer(V.question);
        case 'help':
          return answer(V.help);
        case 'english':
          return answer(V.english);
        case 'swedish':
          return answer(V.swedish);
        case 'greeting':
          return answer(V.greeting);
        case 'thanks':
          return answer(V.thanks);
        case 'numbers':
          return answer(V.numbers);
        case 'empty':
          return answer(V.empty);
        default:
          return answer(V.other);
      }
    }
    if (c.cmd === 'PUNNERRETTU') return ok(say(V.unlockedNotLocked));
    // Services: only for this round and this life, never queued.
    if (req.round !== this.room.round.n) return ok(say(V.oldRound));
    if (!p.alive || req.life !== p.life) return answer(V.dead);
    if (c.cmd === 'LATAA') {
      const r = this.room.startReload(p, 'armoury');
      if (r === 'full') return ok(say(V.reloadFull));
      if (r === 'busy') return ok(say(V.reloadBusy));
      if (r === 'dead') return answer(V.dead);
      p.stats.reloads++;
      return ok(say(V.reloadOk));
    }
    if (p.grenades >= p.maxGrenades) return ok(say(p.maxGrenades > 1 ? V.grenadeLimit2 : V.grenadeLimit1));
    if (now - phone.lastGrenadeAt < TUNING.grenade.supplyCooldown * 1000) return ok(say(V.grenadeCooldown));
    if (!this.room.giveGrenade(p)) return answer(V.dead);
    phone.lastGrenadeAt = now;
    return ok(say(V.grenadeOk));
  }
}
