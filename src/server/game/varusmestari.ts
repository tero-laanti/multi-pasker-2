import { GEAR, INVENTORY, PHONE, TUNING } from '../../shared/config';
import { classify, normalize, type Classified, type CommandId } from '../../shared/chat';
import { FI } from '../../shared/fi';
import { level } from '../../shared/upgrades';
import type { PhoneMessage } from '../../shared/protocol';
import type { InventoryKind, ServerPlayer } from './player';
import type { Room } from './room';

const V = FI.varusmestari;
const VA = FI.inventory;
const C = FI.commander;

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
    p.radioMisses = 0;
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
  post(p: ServerPlayer, from: string, text: string, voice?: { url: string; duration: number }, prompted = false, dequeued = false): number {
    const phone = p.phone;
    if (from === V.number && !phone.convs.has(V.number)) this.greet(p);
    if (!phone.convs.has(from)) return this.room.now();
    // One new message per chat: an unasked-for one waits until the last has been read.
    if (!prompted) {
      if (!dequeued && phone.busy(from)) {
        const q = phone.deferred.get(from) ?? [];
        q.push({ text, voice });
        phone.deferred.set(from, q);
        return Infinity;
      }
      phone.inFlight.set(from, (phone.inFlight.get(from) ?? 0) + 1);
    }
    const now = this.room.now();
    const typing = voice ? 1400 : Math.min(PHONE.typingMax, Math.max(PHONE.typingMin, text.length / PHONE.typingCps)) * 1000;
    const start = Math.max(now + 300, phone.busyUntil);
    phone.busyUntil = start + typing;
    phone.schedule(start, () => phone.send({ t: 'typing', conv: from, on: true }));
    phone.schedule(start + typing, () => {
      phone.send({ t: 'typing', conv: from, on: false });
      if (!prompted) phone.inFlight.set(from, Math.max(0, (phone.inFlight.get(from) ?? 1) - 1));
      phone.add(from, { id: phone.newId(), from: 'them', text: voice ? undefined : text, voice, at: Date.now() });
    });
    return start + typing;
  }

  /** The player read a chat: the next message waiting for it comes in. */
  flush(p: ServerPlayer, conv: string): void {
    const phone = p.phone;
    const q = phone.deferred.get(conv);
    if (!q?.length || (phone.convs.get(conv)?.unread ?? 0) > 0 || (phone.inFlight.get(conv) ?? 0) > 0) return;
    const next = q.shift()!;
    if (!q.length) phone.deferred.delete(conv);
    this.post(p, conv, next.text, next.voice, false, true);
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
    p.phone.conv(VA.number, VA.name);
    const arrives = this.post(p, VA.number, text);
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
    this.post(p, VA.number, reply);
    this.room.offerTypo(p, VA.name, '…', reply);
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

    // Paperwork first: the right code in the right chat hands the gear over.
    const [r0, r1] = PHONE.readDelay;
    const paper = this.room.service.check(p, conv.id, text);
    if (paper === 'done') {
      phone.schedule(now + 250, () => phone.setState(conv.id, out.id, 'read'));
      return 'command';
    }
    const contact = this.room.service.contact(p, conv.id);
    if (paper === 'wrongChat' || (contact && conv.id !== V.number) || conv.id === C.number) {
      const reply = conv.id === C.number ? pick(C.reply) : contact?.kind === 'nylands' ? this.swedishReply(text) : pick(paper === 'wrongChat' ? FI.ladder.wrongChat : FI.ladder.officeOther);
      phone.schedule(now + (r0 + Math.random() * (r1 - r0)) * 1000, () => phone.setState(conv.id, out.id, 'read'));
      this.post(p, conv.id, reply);
      this.room.offerTypo(p, conv.name, text, reply);
      return 'other';
    }
    if (conv.id === VA.number) return this.toVaapeli(p, conv.id, out.id, text, now);
    if (conv.id !== V.number) {
      // Numbers that don't exist: the message bounces.
      phone.schedule(now + 500, () => {
        phone.setState(conv.id, out.id, 'failed');
        phone.add(conv.id, { id: phone.newId(), from: 'system', text: V.unknownNumber, at: Date.now() });
      });
      this.room.offerTypo(p, conv.name, text, V.unknownNumber);
      return 'unknownNumber';
    }

    const u = p.service.upgrades;
    const abilities: CommandId[] = [...(level(u, 'lennokki') > 0 ? (['LENNOKKI'] as const) : []), ...(level(u, 'tuli') > 0 ? (['TULI'] as const) : [])];
    const c = classify(text, level(u, 'pikavalinta') > 0, abilities);
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

  /**
   * The vääpeli's chat: a number answers the inventory check, PUNNERRETTU reports the push-ups,
   * anything else gets told off.
   */
  private toVaapeli(p: ServerPlayer, conv: string, id: string, text: string, now: number): Classified['kind'] {
    const phone = p.phone;
    const rank = FI.ranks[p.rank] ?? FI.ranks[0]!;
    const say = (list: readonly string[]) => capitalize(pick(list).replace(/\{rank\}/g, rank));
    const digits = normalize(text).replace(/\s+/g, '');
    const c = classify(text);
    let reply: string;
    let pub = false;
    let kind: Classified['kind'] = c.kind;
    if (p.inventory && /^\d{1,3}$/.test(digits)) {
      const d = this.inventoryAnswer(p, Number(digits), say);
      reply = d.reply;
      pub = d.public;
      kind = d.command ? 'command' : 'numbers';
    } else if (c.kind === 'command' && c.cmd === 'PUNNERRETTU' && phone.locked) {
      phone.locked = false;
      reply = say(VA.unlocked);
      kind = 'command';
    } else {
      reply = say(p.inventory ? VA.other : VA.idle);
      pub = true;
    }
    const [r0, r1] = PHONE.readDelay;
    phone.schedule(now + (kind === 'command' ? 250 : (r0 + Math.random() * (r1 - r0)) * 1000), () => phone.setState(conv, id, 'read'));
    this.post(p, conv, reply, undefined, true);
    if (pub) this.room.offerTypo(p, VA.name, text, reply);
    return kind;
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
    const u = p.service.upgrades;
    const rank = FI.ranks[p.rank] ?? FI.ranks[0]!;
    const say = (list: readonly string[], cmd = '') => capitalize(pick(list).replace(/\{rank\}/g, rank).replace(/\{cmd\}/g, cmd));
    const answer = (list: readonly string[], cmd = ''): Decision => ({ reply: say(list, cmd), public: true, command: false });
    const ok = (reply: string): Decision => ({ reply, public: false, command: true });

    // Spam: many messages in a short time, or the same thing over and over.
    phone.recent.push({ at: now, text: normalize(text) });
    phone.recent = phone.recent.filter((r) => now - r.at < PHONE.spamWindow * 1000).slice(-10);
    const last = phone.recent.slice(-PHONE.spamRepeat);
    const spam = phone.recent.length >= PHONE.spamCount || (last.length === PHONE.spamRepeat && last.every((r) => r.text === last[0]!.text));

    // On the range: the radio check first, then LATAA and KRANAATTI for the range's own guns.
    if (p.training) {
      if (p.radioCheck === 'waiting') {
        if (!isRadioCheckReply(text)) return { reply: say(p.radioMisses++ === 0 ? FI.training.radioCheckExplain : FI.training.radioCheckWrong), public: false, command: false };
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
    // The Sotku's once-a-round commands.
    if (c.cmd === 'LENNOKKI') return ok(say(this.room.drone(p) === 'ok' ? FI.abilities.droneOk : FI.abilities.used));
    if (c.cmd === 'TULI') {
      const r = this.room.mortar(p);
      return ok(say(r === 'ok' ? FI.abilities.mortarOk : r === 'used' ? FI.abilities.used : FI.abilities.noTarget));
    }
    if (p.grenades >= p.maxGrenades) return ok(say(p.maxGrenades > 1 ? V.grenadeLimit2 : V.grenadeLimit1));
    const cooldown = level(u, 'tihea') > 0 ? GEAR.grenadeCooldown : TUNING.grenade.supplyCooldown;
    if (now - phone.lastGrenadeAt < cooldown * 1000) return ok(say(V.grenadeCooldown));
    if (!this.room.giveGrenade(p)) return answer(V.dead);
    phone.lastGrenadeAt = now;
    return ok(say(V.grenadeOk));
  }
}
