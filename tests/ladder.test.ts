import { describe, expect, it } from 'vitest';
import { normalize } from '../src/shared/chat';
import { FI } from '../src/shared/fi';
import { MapBuilder } from '../src/shared/map/builder';
import { PROTOCOL_VERSION, type GameEvent, type PhoneServerMsg } from '../src/shared/protocol';
import { weaponStats } from '../src/shared/upgrades';
import { Room } from '../src/server/game/room';
import type { ServerPlayer } from '../src/server/game/player';

const V = FI.varusmestari;

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.readyState = 3;
  }
  phone(): PhoneServerMsg[] {
    return this.sent as PhoneServerMsg[];
  }
  events(): GameEvent[] {
    return this.sent.flatMap((m) => ((m as { t?: string }).t === 'events' ? (m as { e: GameEvent[] }).e : []));
  }
}

function arena() {
  const m = new MapBuilder();
  m.box(-60, -1, -60, 60, 0, 60, 'grass');
  for (let i = 0; i < 8; i++) m.spawn(-40 + i * 10, 0, 0, 0);
  return m.build('test', { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [0, 1, 0]);
}

function setup(players = 3) {
  let t = 1000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room(arena(), { dev: false, now: clock.now });
  const all = Array.from({ length: players }, (_, i) => {
    const ws = new FakeSocket();
    const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name: `P${i}` })!;
    const phone = new FakeSocket();
    room.phoneJoin(phone as never, { t: 'phoneHello', v: PROTOCOL_VERSION, pair: p.phone.pairToken }, false);
    return { p, ws, phone };
  });
  const run = (ms: number) => {
    for (let i = 0; i < ms / 20; i++) {
      clock.advance(20);
      room.tick(0.02);
    }
  };
  let rid = 0;
  const send = (p: ServerPlayer, text: string, conv: string = V.number) =>
    room.onPhoneMessage(p, { t: 'send', rid: `r${++rid}`, conv, text, life: p.life, round: room.round.n });
  const kill = (a: ServerPlayer, v: ServerPlayer) => {
    v.protectedUntil = 0;
    room.damage(v, a, 1000, 'body', 'rifle', [0, 1, 0]);
    run(3000);
  };
  const texts = (phone: FakeSocket, conv?: string) =>
    phone
      .phone()
      .filter((m): m is Extract<PhoneServerMsg, { t: 'msg' }> => m.t === 'msg' && m.m.from === 'them' && (!conv || m.conv === conv))
      .map((m) => m.m);
  return { room, clock, all, run, send, kill, texts };
}

describe('the TJ ladder', () => {
  it('opens on the first kill, stage 1 delivers the rifle and a promotion', () => {
    const { all, kill, send, run, texts } = setup();
    const [a, b] = all;
    expect(a!.p.ladder.open).toBeNull();
    kill(a!.p, b!.p);
    const c = a!.p.ladder.open!;
    expect(c.stage).toBe(1);
    expect(c.conv).toBe(V.number);
    expect(FI.ladder.stage1Codes).toContain(c.code);
    // The victim got their first offer from the death.
    expect(b!.p.ladder.open?.stage).toBe(1);
    run(4000);
    expect(texts(a!.phone, V.number).some((m) => m.text?.includes(c.code))).toBe(true);
    send(a!.p, c.code.toLowerCase() + '!');
    expect(a!.p.owned).toContain('rifle');
    expect(a!.p.rank).toBe(1);
    expect(a!.p.ladder.tj).toBe(5);
  });

  it('codes are unique between players while the pool lasts', () => {
    const { all, kill } = setup(4);
    const [a, b, c, d] = all;
    kill(a!.p, b!.p);
    kill(c!.p, d!.p);
    const codes = [a, b, c, d].map((x) => x!.p.ladder.open!.code);
    expect(new Set(codes).size).toBe(4);
  });

  it('offers every 3rd kill and every 3rd death, independently; self-kills do not count', () => {
    const { all, kill, room, send } = setup();
    const [a, b] = all;
    kill(a!.p, b!.p);
    send(a!.p, a!.p.ladder.open!.code);
    expect(a!.p.ladder.open).toBeNull();
    kill(a!.p, b!.p);
    kill(a!.p, b!.p);
    expect(a!.p.ladder.open).toBeNull();
    kill(a!.p, b!.p);
    expect(a!.p.ladder.open?.stage).toBe(2);
    // Deaths are their own counter.
    const before = a!.p.ladder.deaths;
    a!.p.protectedUntil = 0;
    room.damage(a!.p, a!.p, 1000, 'body', 'grenade', [0, 1, 0]);
    expect(a!.p.ladder.deaths).toBe(before);
  });

  it('one open challenge at a time: further offers queue and arrive in order', () => {
    const { all, kill, send, room } = setup();
    const [a, b] = all;
    kill(a!.p, b!.p);
    const first = a!.p.ladder.open!;
    for (let i = 0; i < 3; i++) kill(a!.p, b!.p);
    expect(a!.p.ladder.queued).toBe(1);
    expect(a!.p.ladder.open).toBe(first);
    expect(a!.p.phoneStatus(room.round.n).queued).toBe(1);
    send(a!.p, first.code);
    expect(a!.p.ladder.open?.stage).toBe(2);
    expect(a!.p.ladder.queued).toBe(0);
  });

  it('stage 2 opens the upgrade screen; the choice applies once', () => {
    const { all, kill, send, room, phone } = (() => {
      const s = setup();
      return { ...s, phone: s.all[0]!.phone };
    })();
    const [a, b] = all;
    kill(a!.p, b!.p);
    send(a!.p, a!.p.ladder.open!.code);
    a!.p.ladder.kills = 2;
    kill(a!.p, b!.p);
    send(a!.p, a!.p.ladder.open!.code);
    expect(a!.p.rank).toBe(2);
    const offer = phone.phone().filter((m): m is Extract<PhoneServerMsg, { t: 'upgrade' }> => m.t === 'upgrade').pop()!.offer!;
    expect(offer.title).toBe(FI.ladder.upgradeTitle);
    expect(offer.options.length).toBe(3);
    expect(offer.options.every((o) => o.benefit.length > 0)).toBe(true);
    const id = offer.options[0]!.id;
    room.onPhoneMessage(a!.p, { t: 'choose', rid: 'c1', id });
    room.onPhoneMessage(a!.p, { t: 'choose', rid: 'c1', id });
    expect(a!.p.ladder.upgrades[id]).toBe(1);
    expect(a!.p.ladder.choice).toBeNull();
  });

  it('stage 3 needs the office number opened by hand; the code elsewhere is the wrong chat', () => {
    const { all, kill, send, room, run, texts } = setup();
    const [a, b] = all;
    const p = a!.p;
    p.ladder.stage = 2;
    p.rank = 2;
    p.ladder.started = true;
    p.ladder.kills = 2;
    kill(p, b!.p);
    const c = p.ladder.open!;
    expect(c.stage).toBe(3);
    expect(c.conv).not.toBe(V.number);
    expect(/^[2-9]\d{3}$/.test(c.conv)).toBe(true);
    run(4000);
    // Nothing from the office yet: we never open the chat for the player.
    expect(texts(a!.phone, c.conv).length).toBe(0);
    send(p, c.code);
    expect(p.ladder.open).toBe(c);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    run(6000);
    expect(texts(a!.phone, c.conv).some((m) => normalize(m.text ?? '').includes(c.answer))).toBe(true);
    send(p, c.code, c.conv);
    expect(p.ladder.stage).toBe(3);
  });

  it('stage 4 sends a spelled voice note from a 17-digit number', () => {
    const { all, kill, send, room, run, texts } = setup();
    const [a, b] = all;
    const p = a!.p;
    Object.assign(p.ladder, { stage: 3, started: true, kills: 2 });
    p.rank = 3;
    kill(p, b!.p);
    const c = p.ladder.open!;
    expect(c.stage).toBe(4);
    expect(c.conv.replace('+', '').length).toBe(17);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    run(15000);
    const voice = texts(a!.phone, c.conv).find((m) => m.voice);
    expect(voice?.voice?.url).toMatch(/^\/voicenote\/[0-9a-f]{16}\.wav$/);
    send(p, c.code, c.conv);
    expect(p.ladder.stage).toBe(4);
  });

  it('stage 5 asks for the serial number off the gun', () => {
    const { all, kill, send, room } = setup();
    const [a, b] = all;
    const p = a!.p;
    Object.assign(p.ladder, { stage: 4, started: true, kills: 2 });
    p.rank = 4;
    p.owned = ['pistol', 'rifle'];
    kill(p, b!.p);
    const c = p.ladder.open!;
    expect(c.stage).toBe(5);
    const s = p.serials;
    expect([s.rifle, s.rifle.slice(-3), [...s.rifle].reverse().join(''), s.pistol]).toContain(c.code);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    send(p, `${c.code}.`, c.conv);
    expect(p.ladder.stage).toBe(5);
  });

  it('stage 6 is in Swedish; Finnish answers get "svara på svenska"; then TJ 0', () => {
    const { all, kill, send, room, run, texts } = setup();
    const [a, b] = all;
    const p = a!.p;
    Object.assign(p.ladder, { stage: 5, started: true, kills: 2 });
    p.rank = 5;
    kill(p, b!.p);
    const c = p.ladder.open!;
    expect(c.stage).toBe(6);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    // Messages queue one after another with typing pauses.
    run(15000);
    const voice = texts(a!.phone, c.conv).find((m) => m.voice);
    expect(voice?.voice?.url).toMatch(/^\/voice\/ruotsi_/);
    send(p, FI.ladder.swedishInFinnish[c.code]!.toLowerCase(), c.conv);
    run(8000);
    expect(p.ladder.stage).toBe(5);
    expect(texts(a!.phone, c.conv).some((m) => FI.ladder.nylandsFinnish.includes(m.text ?? ''))).toBe(true);
    send(p, c.code, c.conv);
    expect(p.ladder.stage).toBe(6);
    expect(p.ladder.tj).toBe(0);
    expect(p.rank).toBe(6);
    run(8000);
    expect(texts(a!.phone, V.number).some((m) => m.text === FI.ladder.tj0)).toBe(true);
    // Done: no more offers, but the services keep working.
    p.ladder.choice = null;
    p.ladder.kills = 2;
    kill(p, b!.p);
    expect(p.ladder.open).toBeNull();
    p.ammo.pistol = 1;
    p.weapon = 'pistol';
    send(p, 'Lataa');
    expect(p.reload).not.toBeNull();
  });

  it('Sotkun munkkikahvit: KIITOS to the asevarasto completes the next challenge', () => {
    const { all, kill, send } = setup();
    const [a, b] = all;
    const p = a!.p;
    kill(p, b!.p);
    p.ladder.munkki = true;
    send(p, 'Kiitos');
    expect(p.ladder.stage).toBe(1);
    expect(p.ladder.munkki).toBe(false);
  });

  it('a new round starts everyone from alokas again', () => {
    const { all, kill, send, room } = setup();
    const [a, b] = all;
    kill(a!.p, b!.p);
    send(a!.p, a!.p.ladder.open!.code);
    a!.p.ladder.upgrades.vyo = 1;
    room.startRound();
    expect(a!.p.rank).toBe(0);
    expect(a!.p.ladder.stage).toBe(0);
    expect(a!.p.ladder.upgrades).toEqual({});
    expect(a!.p.owned).toEqual(['pistol']);
  });

  it('upgrades change the numbers the server checks against', () => {
    expect(weaponStats('rifle', { lipas: 2 }).magazine).toBe(50);
    expect(weaponStats('rifle', { rumpu: 1 }).magazine).toBe(75);
    expect(weaponStats('rifle', { lukko: 1 }).rpm).toBe(700);
    expect(weaponStats('pistol', { suujarru: 2 }).recoilMul).toBeCloseTo(0.6);
  });
});
