import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalize } from '../src/shared/chat';
import { GEAR, MATCH, SERVICE, SOTKU, TUNING } from '../src/shared/config';
import { FI } from '../src/shared/fi';
import { UI } from '../src/shared/ui';
import { explosionDamage } from '../src/shared/grenade';
import { MapBuilder } from '../src/shared/map/builder';
import { PROTOCOL_VERSION, type GameEvent, type PhoneServerMsg } from '../src/shared/protocol';
import { canBuy, earn, payFor, rankFor, SHOP_IDS } from '../src/shared/service';
import { weaponStats } from '../src/shared/upgrades';
import { damageFor } from '../src/shared/weapons';
import { Evening } from '../src/server/game/awards';
import { ROUND_TIME, Room } from '../src/server/game/room';
import type { ServerPlayer } from '../src/server/game/player';
import { eveningFile } from '../src/server/storage';

const V = FI.varusmestari;
const C = FI.commander;

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

function setup(players = 3, evening?: Evening) {
  let t = 1000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room(arena(), { dev: false, now: clock.now, evening });
  const join = (name: string) => {
    const ws = new FakeSocket();
    const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name })!;
    const phone = new FakeSocket();
    room.phoneJoin(phone as never, { t: 'phoneHello', v: PROTOCOL_VERSION, pair: p.phone.pairToken }, false);
    return { p, ws, phone };
  };
  const all = Array.from({ length: players }, (_, i) => join(`P${i}`));
  /** Players who glance at their phones: whatever comes in is read (so what waits behind it comes too). */
  const readAll = () => {
    for (const { p } of all) for (const c of p.phone.convs.values()) if (c.unread > 0) room.onPhoneMessage(p, { t: 'read', conv: c.id });
  };
  const run = (ms: number) => {
    for (let i = 0; i < ms / 20; i++) {
      clock.advance(20);
      room.tick(0.02);
      readAll();
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
  const buy = (p: ServerPlayer, id: string) => room.onPhoneMessage(p, { t: 'buy', rid: `b${++rid}`, id });
  const texts = (phone: FakeSocket, conv?: string) =>
    phone
      .phone()
      .filter((m): m is Extract<PhoneServerMsg, { t: 'msg' }> => m.t === 'msg' && m.m.from === 'them' && (!conv || m.conv === conv))
      .map((m) => m.m);
  const store = (phone: FakeSocket) => phone.phone().filter((m): m is Extract<PhoneServerMsg, { t: 'store' }> => m.t === 'store').pop()?.s;
  /** Serves days straight away (as kills would), for getting somewhere in the service quickly. */
  const serve = (p: ServerPlayer, days: number) => room.service.serve(p, days, 'kill');
  /** Does whatever paperwork is open: opens the contact's chat, waits for the task, sends the code. */
  const paperwork = (p: ServerPlayer) => {
    const c = p.service.open!;
    if (c.conv !== V.number) room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    run(15000);
    send(p, c.code, c.conv);
  };
  return { room, clock, all, join, run, send, kill, buy, texts, store, serve, paperwork };
}

describe('päiväraha and ranks', () => {
  it('pays 5, 10 and 15 € a day in the three bands: 3,105 € for the whole service', () => {
    expect(payFor(1)).toBe(5);
    expect(payFor(165)).toBe(5);
    expect(payFor(166)).toBe(10);
    expect(payFor(255)).toBe(10);
    expect(payFor(256)).toBe(15);
    expect(payFor(347)).toBe(15);
    expect(earn(0, 3)).toBe(15);
    // A kill across a band boundary pays each day at its own rate.
    expect(earn(164, 3)).toBe(5 + 10 + 10);
    expect(earn(0, SERVICE.days)).toBe(3105);
    // Nothing after TJ 0.
    expect(earn(346, 3)).toBe(15);
  });

  it('ranks follow the days: alokas, sotamies after P-kausi, a promotion with each pay rise', () => {
    expect(rankFor(0)).toBe(0);
    expect(rankFor(41)).toBe(0);
    expect(rankFor(42)).toBe(1);
    expect(rankFor(165)).toBe(1);
    expect(rankFor(166)).toBe(2);
    expect(rankFor(256)).toBe(3);
    expect(rankFor(347)).toBe(3);
    expect(rankFor(347, true)).toBe(4);
    expect(FI.ranks[rankFor(347, true)]).toBe('kersantti');
  });

  it('every node of the tree can be reached, and the tree costs more than a service pays', () => {
    const all = new Set<string>();
    let left = [...SHOP_IDS];
    for (let round = 0; round < 5 && left.length; round++) {
      for (const id of left.filter((id) => canBuy(id, all))) all.add(id);
      left = left.filter((id) => !all.has(id));
    }
    expect(left).toEqual([]);
    const total = SHOP_IDS.reduce((sum, id) => sum + SOTKU.items[id].price, 0);
    expect(total).toBeGreaterThan(earn(0, SERVICE.days) * 2);
  });
});

describe('the service', () => {
  it('a kill serves 3 days and pays the killer, shown under the kill; the victim serves a day', () => {
    const { all, kill } = setup();
    const [a, b] = all;
    kill(a!.p, b!.p);
    expect(a!.p.service.days).toBe(3);
    expect(a!.p.service.money).toBe(15);
    expect(a!.p.service.tj).toBe(344);
    expect(a!.ws.events().find((e) => e.k === 'pay')).toEqual({ k: 'pay', eur: 15, days: 3, senior: false, caught: false });
    expect(b!.p.service.days).toBe(1);
    expect(b!.p.service.money).toBe(5);
  });

  it('suicides serve nothing', () => {
    const { all, room } = setup();
    const [a] = all;
    a!.p.protectedUntil = 0;
    room.damage(a!.p, a!.p, 1000, 'body', 'grenade', [0, 1, 0]);
    expect(a!.p.service.days).toBe(0);
  });

  it('killing someone with a lower TJ serves one extra day', () => {
    const { all, kill, serve } = setup();
    const [a, b] = all;
    serve(b!.p, 10);
    kill(a!.p, b!.p);
    expect(a!.p.service.days).toBe(SERVICE.killDays + SERVICE.seniorDays);
    expect(a!.ws.events().find((e) => e.k === 'pay')).toMatchObject({ days: 4, senior: true });
    // The same TJ (or a higher one) is a plain kill.
    const before = b!.p.service.days;
    a!.p.service.days = before;
    kill(b!.p, a!.p);
    expect(b!.p.service.days).toBe(before + SERVICE.killDays);
  });

  it('a kill of someone caught texting serves a day more, with a phone in the feed and a word from the asevarasto', () => {
    const { all, kill, texts, room, clock, run } = setup();
    const [a, b, c] = all;
    // The welcome read, and no rifle paperwork to fill the asevarasto chat first.
    a!.p.service.give('rifle');
    run(100);
    room.onPhoneMessage(b!.p, { t: 'out', on: true });
    kill(a!.p, b!.p);
    expect(a!.p.service.days).toBe(SERVICE.killDays + SERVICE.caughtDays);
    expect(a!.ws.events().find((e) => e.k === 'pay')).toMatchObject({ days: 4, senior: false, caught: true });
    expect(c!.ws.events().find((e) => e.k === 'kill')).toMatchObject({ a: a!.p.id, v: b!.p.id, phone: true });
    const said = V.caught.map((l) => l.replace(/\{days\}/g, '4').replace(/\{tj\}/g, String(SERVICE.days - 4)).replace(/\{name\}/g, 'P1'));
    const caughtTexts = () => texts(a!.phone, V.number).filter((m) => said.includes(m.text ?? '')).length;
    expect(caughtTexts()).toBe(1);
    // With a lower TJ as well, both extras count; the asevarasto doesn't say it again this soon.
    room.onPhoneMessage(c!.p, { t: 'out', on: true });
    c!.p.service.days = 10;
    const before = texts(a!.phone, V.number).length;
    kill(a!.p, c!.p);
    expect(a!.ws.events().filter((e) => e.k === 'pay').pop()).toMatchObject({ days: 5, senior: true, caught: true });
    expect(texts(a!.phone, V.number).length).toBe(before);
    clock.advance(SERVICE.caughtTextGap * 1000);
    run(100);
    // A chat put away in time is a plain kill.
    room.onPhoneMessage(b!.p, { t: 'out', on: false });
    b!.p.service.days = 0;
    a!.p.service.days = 0;
    expect(b!.p.alive).toBe(true);
    kill(a!.p, b!.p);
    expect(a!.ws.events().filter((e) => e.k === 'pay').pop()).toMatchObject({ days: 3, caught: false });
    expect(caughtTexts()).toBe(1);
  });

  it('the first kill brings the rifle as paperwork; it stays for the rest of the evening', () => {
    const { all, kill, send, run, texts, room } = setup();
    const [a, b] = all;
    kill(a!.p, b!.p);
    const c = a!.p.service.open!;
    expect(c.due).toBe('rifle');
    expect(c.conv).toBe(V.number);
    expect(FI.ladder.stage1Codes).toContain(c.code);
    // The victim's day brings theirs too.
    expect(b!.p.service.open?.due).toBe('rifle');
    run(4000);
    expect(texts(a!.phone, V.number).some((m) => m.text?.includes(c.code))).toBe(true);
    send(a!.p, c.code.toLowerCase() + '!');
    expect(a!.p.owned).toContain('rifle');
    expect(a!.p.service.owned.has('rifle')).toBe(true);
    room.startRound();
    expect(a!.p.owned).toContain('rifle');
    expect(a!.p.service.days).toBe(3);
  });

  it('codes are unique between players while the pool lasts', () => {
    const { all, kill } = setup(4);
    const [a, b, c, d] = all;
    kill(a!.p, b!.p);
    kill(c!.p, d!.p);
    const codes = [a, b, c, d].map((x) => x!.p.service.open!.code);
    expect(new Set(codes).size).toBe(4);
  });

  it('P-kausi gear comes due on its days, one paperwork at a time, in order', () => {
    const { all, serve, send } = setup();
    const p = all[0]!.p;
    serve(p, 25);
    expect(p.service.waiting).toEqual(['rifle', 'lipas', 'puukko']);
    expect(p.service.open?.due).toBe('rifle');
    expect(p.phoneStatus(1).queued).toBe(2);
    send(p, p.service.open!.code);
    expect(p.service.open?.due).toBe('lipas');
    expect(p.service.open?.kind).toBe('phrase');
    send(p, p.service.open!.code);
    expect(p.service.upgrades.lipas).toBe(1);
    expect(p.gun('rifle').magazine).toBe(40);
    expect(p.service.open?.due).toBe('puukko');
    expect(p.service.open?.kind).toBe('office');
  });

  it('the office needs its number opened by hand; the code elsewhere is the wrong chat', () => {
    const { all, serve, send, room, run, texts, paperwork } = setup();
    const [a] = all;
    const p = a!.p;
    serve(p, 20);
    paperwork(p);
    paperwork(p);
    const c = p.service.open!;
    expect(c.due).toBe('puukko');
    expect(/^[2-9]\d{3}$/.test(c.conv)).toBe(true);
    run(4000);
    // Nothing from the office yet: we never open the chat for the player.
    expect(texts(a!.phone, c.conv).length).toBe(0);
    send(p, c.code);
    expect(p.service.open).toBe(c);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    run(6000);
    expect(texts(a!.phone, c.conv).some((m) => normalize(m.text ?? '').includes(c.answer))).toBe(true);
    send(p, c.code, c.conv);
    expect(p.service.owned.has('puukko')).toBe(true);
  });

  it('the grenade belt comes as the supply chief’s voice note from a 17-digit number', () => {
    const { all, serve, room, run, texts, paperwork, send } = setup();
    const [a] = all;
    const p = a!.p;
    serve(p, 30);
    paperwork(p);
    paperwork(p);
    paperwork(p);
    const c = p.service.open!;
    expect(c.due).toBe('vyo');
    expect(c.conv.replace('+', '').length).toBe(17);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    run(15000);
    const voice = texts(a!.phone, c.conv).find((m) => m.voice);
    expect(voice?.voice?.url).toMatch(/^\/voicenote\/[0-9a-f]{16}\.wav$/);
    send(p, c.code, c.conv);
    expect(p.maxGrenades).toBe(2);
  });

  it('P-kausi is passed with its 42 days and its gear signed for: then the commander opens the Sotku App', () => {
    const { all, serve, run, texts, store, paperwork } = setup();
    const [a] = all;
    serve(a!.p, SERVICE.pkausi);
    run(4000);
    // The days are served, but the gear's paperwork isn't done: still alokas, the shop shut.
    expect(store(a!.phone)?.open).toBe(false);
    expect(store(a!.phone)?.paper).toEqual({ item: 'rifle', where: FI.varusmestari.name });
    expect(a!.p.rank).toBe(0);
    expect(a!.p.phone.convs.has(C.number)).toBe(false);
    for (let i = 0; i < 4; i++) paperwork(a!.p);
    // The commander's text comes after the asevarasto's replies on their way.
    run(15000);
    expect(store(a!.phone)?.open).toBe(true);
    expect(store(a!.phone)?.money).toBe(210 + SERVICE.promotionBonus);
    expect(a!.p.rank).toBe(1);
    expect(texts(a!.phone, C.number).pop()?.text).toBe('Congratulations on passing P-kausi. You are promoted to sotamies and get a 100 € promotion bonus. You may now use the Sotku App to buy goods and services.');
    expect(a!.p.phone.convs.get(C.number)?.name).toBe(C.name);
  });

  it('the debug skip hands P-kausi over at once, gear and all', () => {
    const { all, room, run, store } = setup();
    const [a] = all;
    a!.p.isHost = true;
    room.onMessage(a!.p, { t: 'dev', cmd: 'serve' });
    run(4000);
    expect(a!.p.service.days).toBe(SERVICE.pkausi);
    expect(store(a!.phone)?.open).toBe(true);
    expect(store(a!.phone)?.waiting).toEqual([]);
    expect(a!.p.owned).toContain('rifle');
    expect(a!.p.maxGrenades).toBe(2);
  });

  it('the pay rises are texted (to you only) and promote you', () => {
    const { all, room, serve, run, texts } = setup();
    const [a, b] = all;
    room.service.skipPkausi(a!.p);
    serve(a!.p, 166 - SERVICE.pkausi);
    run(20000);
    const rise = texts(a!.phone, C.number).find((m) => m.text?.includes('10 €'));
    expect(rise?.text).toBe('TJ 181! You are promoted to korpraali and get a 100 € promotion bonus. Your Päiväraha is now 10 € a day.');
    expect(a!.p.rank).toBe(2);
    expect(texts(b!.phone, C.number).length).toBe(0);
    serve(a!.p, 90);
    run(20000);
    expect(texts(a!.phone, C.number).some((m) => m.text?.includes('15 €') && m.text.includes('alikersantti'))).toBe(true);
    expect(a!.p.rank).toBe(3);
    // Someone still in P-kausi only hears of the pay.
    serve(b!.p, 166);
    run(20000);
    expect(texts(b!.phone, C.number).pop()?.text).toBe('TJ 181! Your Päiväraha is now 10 € a day.');
  });

  it('each promotion pays a bonus once, and passing P-kausi late pays it for every rank skipped', () => {
    const { all, room, serve } = setup();
    const [a, b] = all;
    room.service.skipPkausi(a!.p);
    expect(a!.p.service.money).toBe(earn(0, SERVICE.pkausi) + SERVICE.promotionBonus);
    const money = a!.p.service.money;
    serve(a!.p, 166 - SERVICE.pkausi);
    expect(a!.p.service.money).toBe(money + earn(SERVICE.pkausi, 166 - SERVICE.pkausi) + SERVICE.promotionBonus);
    serve(a!.p, 3);
    expect(a!.p.service.money).toBe(money + earn(SERVICE.pkausi, 169 - SERVICE.pkausi) + SERVICE.promotionBonus);
    // Still in P-kausi at the pay rise: the pay, no bonus. Its gear signed for late: sotamies and korpraali at once.
    serve(b!.p, 166);
    expect(b!.p.service.money).toBe(earn(0, 166));
    room.service.skipPkausi(b!.p);
    expect(b!.p.rank).toBe(2);
    expect(b!.p.service.money).toBe(earn(0, 166) + 2 * SERVICE.promotionBonus);
  });

  it('the shop: row I at once, the rest after paperwork; needs, money and P-kausi are checked', () => {
    const { all, room, serve, buy, store, send } = setup();
    const [a] = all;
    const p = a!.p;
    serve(p, 10);
    p.service.money = 1000;
    buy(p, 'suujarru');
    // The shop is shut in P-kausi.
    expect(p.service.owned.has('suujarru')).toBe(false);
    // P-kausi done at once (its gear without paperwork).
    room.service.skipPkausi(p);
    p.service.money = 330;
    buy(p, 'punapiste');
    expect(p.service.waiting).toEqual([]);
    buy(p, 'suujarru');
    expect(p.service.owned.has('suujarru')).toBe(true);
    expect(p.service.money).toBe(210);
    expect(weaponStats('rifle', p.service.upgrades).recoilMul).toBeCloseTo(0.75);
    buy(p, 'punapiste');
    expect(p.service.money).toBe(10);
    expect(p.service.waiting).toEqual(['punapiste']);
    expect(store(a!.phone)?.waiting).toEqual(['punapiste']);
    expect(store(a!.phone)?.paper).toEqual({ item: 'punapiste', where: FI.varusmestari.name });
    expect(p.service.open?.kind).toBe('word');
    send(p, p.service.open!.code);
    expect(p.gun('rifle').adsMul).toBeCloseTo(0.7);
    // Not enough money: refused, and the phone is told how things are.
    const sent = a!.phone.sent.length;
    buy(p, 'rumpu');
    expect(p.service.owned.has('rumpu')).toBe(false);
    expect(a!.phone.sent.length).toBeGreaterThan(sent);
  });

  it('the café: munkki does the next paperwork with KIITOS, nakkisuoja skips an inventory check', () => {
    const { all, buy, send, run, room, texts } = setup();
    const [a] = all;
    const p = a!.p;
    room.service.skipPkausi(p);
    p.service.money = 420;
    buy(p, 'munkki');
    buy(p, 'nakkisuoja');
    expect(p.service.cafe).toEqual({ munkki: 1, nakkisuoja: 1 });
    expect(p.service.money).toBe(350);
    buy(p, 'suujarru');
    buy(p, 'lipas2');
    expect(p.service.open?.due).toBe('lipas2');
    send(p, 'Kiitos');
    expect(p.service.owned.has('lipas2')).toBe(true);
    expect(p.service.cafe.munkki).toBe(0);
    p.inventoryAt = 0;
    room.onPhoneMessage(p, { t: 'read', conv: V.number });
    p.phone.conv(FI.inventory.number, FI.inventory.name);
    // The vääpeli's note comes after the asevarasto's messages already on their way.
    run(20000);
    expect(p.inventory).toBeNull();
    expect(p.service.cafe.nakkisuoja).toBe(0);
    expect(texts(a!.phone, FI.inventory.number).some((m) => FI.abilities.nakkisuoja.includes(m.text ?? ''))).toBe(true);
  });

  it('TJ 0: Nylands brigad in Swedish, then the star and a free pick from the Sotku', () => {
    const { all, serve, send, room, run, texts, buy } = setup();
    const [a, b] = all;
    const p = a!.p;
    void b;
    room.service.skipPkausi(p);
    p.service.days = SERVICE.days - 1;
    serve(p, 3);
    expect(p.service.tj).toBe(0);
    // Serving more pays nothing.
    expect(serve(p, 3)).toBe(0);
    const c = p.service.open!;
    expect(c.kind).toBe('nylands');
    // Behind P-kausi's text in the commander's chat: each is read, then typed (up to ~3.7 s each).
    run(15000);
    expect(texts(a!.phone, C.number).some((m) => m.text?.includes(c.conv))).toBe(true);
    room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    run(15000);
    expect(texts(a!.phone, c.conv).some((m) => m.voice?.url.includes('ruotsi_'))).toBe(true);
    send(p, FI.ladder.swedishInFinnish[c.code]!.toLowerCase(), c.conv);
    run(8000);
    expect(p.service.discharged).toBe(false);
    expect(texts(a!.phone, c.conv).some((m) => FI.ladder.nylandsFinnish.includes(m.text ?? ''))).toBe(true);
    const money = p.service.money;
    send(p, c.code, c.conv);
    expect(p.service.discharged).toBe(true);
    expect(p.rank).toBe(4);
    // No päiväraha after TJ 0, but the last promotion pays its bonus.
    expect(p.service.money).toBe(money + SERVICE.promotionBonus);
    expect(p.info().star).toBe(true);
    expect(p.service.voucher).toBe(true);
    p.service.money = 0;
    buy(p, 'tumma');
    expect(p.service.owned.has('tumma')).toBe(true);
    expect(p.service.voucher).toBe(false);
  });

  it('kept all evening by name: leaving and joining again, and over a server restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp2-service-'));
    const file = path.join(dir, 'evening.json');
    const first = setup(2, new Evening(eveningFile(file)));
    const [a, b] = first.all;
    first.kill(a!.p, b!.p);
    first.send(a!.p, a!.p.service.open!.code);
    first.serve(a!.p, 50);
    first.run(6000);
    const days = a!.p.service.days;
    expect(days).toBe(53);
    // A new server with the same evening file: the same name finds its service again.
    const second = setup(0, new Evening(eveningFile(file)));
    const again = second.join('P0').p;
    expect(again.service.days).toBe(days);
    expect(again.service.money).toBe(a!.p.service.money);
    expect(again.owned).toContain('rifle');
    // Still alokas: P-kausi's gear waits for its paperwork, which starts again.
    expect(again.rank).toBe(0);
    expect(again.service.open?.due).toBe('lipas');
    // A new evening (the host's dev command) starts everyone again.
    again.isHost = true;
    second.room.onMessage(again, { t: 'dev', cmd: 'newEvening' });
    expect(again.service.days).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the phone while dead', () => {
  it('a message bounces and the Sotku sells nothing until the respawn', () => {
    const { all, room, send, buy, run } = setup();
    const [a, b] = all;
    const p = a!.p;
    room.service.skipPkausi(p);
    p.service.money = 1000;
    p.protectedUntil = 0;
    room.damage(p, b!.p, 1000, 'body', 'rifle', [0, 1, 0]);
    expect(p.alive).toBe(false);
    send(p, 'LATAA');
    const msgs = p.phone.convs.get(V.number)!.messages;
    expect(msgs.at(-2)).toMatchObject({ from: 'me', text: 'LATAA', state: 'failed' });
    expect(msgs.at(-1)).toMatchObject({ from: 'system', text: UI.phone.dead });
    buy(p, 'tumma');
    expect(p.service.owned.has('tumma')).toBe(false);
    // Back alive: both work again.
    run(4000);
    expect(p.alive).toBe(true);
    buy(p, 'tumma');
    expect(p.service.owned.has('tumma')).toBe(true);
  });
});

describe('the Sotku’s gear at work', () => {
  it('pistol, knife and grenade gear change what the server checks', () => {
    expect(weaponStats('pistol', { plipas: 1 }).magazine).toBe(18);
    expect(weaponStats('pistol', { sarja: 1 })).toMatchObject({ auto: true, rpm: 1000 });
    expect(weaponStats('pistol', { pveto: 1 }).drawMul).toBeCloseTo(0.5);
    expect(damageFor('pistol', 'body', 10, 'cod', { ontelo: 1 })).toBe(37);
    expect(damageFor('pistol', 'head', 10, 'cod', { ontelo: 1 })).toBe(75);
    expect(damageFor('pistol', 'body', 10, 'cod')).toBe(25);
    expect(damageFor('sniper', 'head', 300, 'cod')).toBeGreaterThanOrEqual(100);
    expect(weaponStats('pistol', { kevyt: 1 }).moveMul).toBeCloseTo(GEAR.pistolMoveMul);
    expect(weaponStats('rifle', { lipas: 2 }).magazine).toBe(50);
    expect(weaponStats('rifle', { rumpu: 1 }).magazine).toBe(75);
    expect(weaponStats('rifle', { punapiste: 1 })).toMatchObject({ adsMul: GEAR.redDotAdsMul, adsMoveMul: GEAR.redDotAdsMoveMul });
    expect(weaponStats('rifle', {})).toMatchObject({ adsMul: 1, adsMoveMul: 1 });
  });

  it('more shrapnel hurts more, and the heavy charge reaches farther', () => {
    const { all, room } = setup();
    const [a, b] = all;
    const v = b!.p;
    /** Damage to the other player from the first one's grenade going off this far from them. */
    const blast = (dist: number) => {
      v.hp = 100;
      v.protectedUntil = 0;
      (room as unknown as { explode(g: object): void }).explode({ id: 1, owner: a!.p.id, x: v.x + dist, y: v.y + 1, z: v.z, vx: 0, vy: 0, vz: 0, fuse: 0, resting: true });
      return 100 - v.hp;
    };
    const T = TUNING.grenade;
    const shrapnel = { ...T, damage: T.damage * GEAR.grenadeDamageMul };
    expect(blast(4)).toBe(explosionDamage(4));
    a!.p.service.give('sirpale');
    expect(blast(4)).toBe(explosionDamage(4, shrapnel));
    expect(blast(T.radius + 0.5)).toBe(0);
    a!.p.service.give('raskas');
    expect(blast(T.radius + 0.5)).toBe(explosionDamage(T.radius + 0.5, { ...shrapnel, radius: T.radius * GEAR.blastRadiusMul }));
    expect(blast(T.radius + 0.5)).toBeGreaterThan(0);
  });

  it('the one-stab knife kills from full health', () => {
    const { all, room } = setup();
    const [a, b] = all;
    a!.p.service.give('puukko');
    b!.p.protectedUntil = 0;
    b!.p.history.push(room.now(), 0.5, 0, -40, false, true);
    b!.p.x = a!.p.x;
    b!.p.z = a!.p.z - 1;
    b!.p.history.clear();
    b!.p.history.push(room.now(), b!.p.x, b!.p.y, b!.p.z, false, true);
    a!.p.lastMeleeAt = -1e9;
    room.melee(a!.p, [a!.p.x, a!.p.eyeY(), a!.p.z], [0, -0.3, -1], room.now(), b!.p.id);
    expect(b!.p.alive).toBe(false);
  });

  it('LENNOKKI and TULI work once a round, and only for those who bought them', () => {
    const { all, send, run, room } = setup();
    const [a, b] = all;
    const p = a!.p;
    send(p, 'LENNOKKI');
    run(1000);
    expect(a!.ws.events().some((e) => e.k === 'drone')).toBe(false);
    p.service.give('lennokki');
    p.service.give('tuli');
    send(p, 'Lennokki');
    run(1000);
    expect(a!.ws.events().filter((e) => e.k === 'drone').length).toBe(1);
    send(p, 'LENNOKKI');
    run(1000);
    expect(a!.ws.events().filter((e) => e.k === 'drone').length).toBe(1);
    // Look down at the ground a few metres ahead of the other player and call it in.
    b!.p.x = p.x;
    b!.p.z = p.z - 8;
    p.yaw = 0;
    p.pitch = Math.atan2(-p.eyeY(), 8);
    b!.p.protectedUntil = 0;
    send(p, 'TULI');
    run(500);
    const rounds = b!.ws.events().filter((e) => e.k === 'mortar');
    expect(rounds.length).toBe(3);
    run(14000);
    expect(b!.ws.events().filter((e) => e.k === 'boom').length).toBeGreaterThanOrEqual(3);
    room.startRound();
    expect(p.service.used.size).toBe(0);
  });
});

describe('matches', () => {
  it('a match is the host’s number of rounds; after the last one everything starts again', () => {
    const { all, room, clock, kill, run, send, texts } = setup();
    const [a, b] = all;
    room.setSettings({ rounds: 2 });
    kill(a!.p, b!.p);
    send(a!.p, a!.p.service.open!.code);
    room.service.skipPkausi(a!.p);
    room.service.serve(a!.p, 21, 'kill');
    run(8000);
    expect(a!.p.owned).toContain('rifle');
    expect(a!.p.phone.convs.has(C.number)).toBe(true);
    // Round 1 ends: a short break, no awards, and round 2 carries everything on.
    clock.advance(ROUND_TIME);
    run(100);
    expect(room.round).toMatchObject({ state: 'ended', round: 1, of: 2, matchOver: false });
    expect(a!.ws.events().some((e) => e.k === 'awards')).toBe(false);
    run(MATCH.intermission * 1000 + 100);
    expect(room.round).toMatchObject({ state: 'playing', round: 2, match: 1 });
    expect(a!.p.kills).toBe(1);
    expect(a!.p.service.days).toBe(63);
    // The last round ends: the match's awards and its winner.
    clock.advance(room.roundMs);
    run(100);
    expect(room.round.matchOver).toBe(true);
    expect(a!.ws.events().find((e) => e.k === 'awards')).toBeTruthy();
    expect(room.evening.matches()).toEqual([{ match: 1, winner: a!.p.name, kills: 1, bot: false }]);
    // The next match: TJ, money, gear, kills and the match's chats are gone.
    run(MATCH.matchIntermission * 1000 + 100);
    expect(room.round).toMatchObject({ state: 'playing', round: 1, match: 2 });
    expect(a!.p.kills).toBe(0);
    expect(a!.p.service.days).toBe(0);
    expect(a!.p.service.money).toBe(0);
    expect(a!.p.owned).toEqual(['pistol']);
    expect(a!.p.service.owned.size).toBe(0);
    expect([...a!.p.phone.convs.keys()].sort()).toEqual([V.number]);
    const convs = a!.phone.phone().filter((m) => m.t === 'convs').pop() as Extract<PhoneServerMsg, { t: 'convs' }>;
    expect(convs.convs.map((c) => c.id)).toEqual([V.number]);
    expect(texts(a!.phone, V.number).length).toBeGreaterThan(0);
    // The asevarasto chat gets a divider for the new match.
    expect(a!.phone.phone().some((m) => m.t === 'msg' && m.m.from === 'system' && m.m.text === '#match 2')).toBe(true);
  });

  it('the host’s settings: only offered choices, bots kept at the number, days per kill used at once', () => {
    const { all, room, kill } = setup();
    const [a, b] = all;
    room.setSettings({ bots: 3 });
    expect(room.bots.length).toBe(3);
    room.setSettings({ rounds: 99, roundMinutes: 7, killDays: 5 } as never);
    expect(room.settings).toMatchObject({ rounds: MATCH.rounds, roundMinutes: MATCH.roundMinutes, killDays: 5, bots: 3 });
    kill(a!.p, b!.p);
    expect(a!.p.service.days).toBe(5);
    // Only the host may change them.
    room.onMessage(a!.p, { t: 'settings', s: { bots: 0 } });
    expect(room.bots.length).toBe(3);
    a!.p.isHost = true;
    room.onMessage(a!.p, { t: 'settings', s: { bots: 0, rounds: 3 } });
    expect(room.bots.length).toBe(0);
    expect(room.round.of).toBe(3);
    expect(a!.ws.sent.some((m) => (m as { t?: string }).t === 'settings')).toBe(true);
  });

  it('nobody gets hurt between rounds, so the match’s results stand', () => {
    const { all, room, clock, run } = setup();
    const [a, b] = all;
    clock.advance(room.roundMs);
    run(100);
    expect(room.round.state).toBe('ended');
    b!.p.protectedUntil = 0;
    room.damage(b!.p, a!.p, 1000, 'body', 'rifle', [0, 1, 0]);
    expect(b!.p.alive).toBe(true);
    expect(a!.p.kills).toBe(0);
  });

  it('fewer rounds than played so far end the match after the current round', () => {
    const { room, clock, run } = setup(2);
    room.setSettings({ rounds: 3 });
    for (let i = 0; i < 2; i++) {
      clock.advance(room.roundMs);
      run(MATCH.intermission * 1000 + 200);
    }
    expect(room.round.round).toBe(3);
    room.setSettings({ rounds: 2 });
    clock.advance(room.roundMs);
    run(100);
    expect(room.round.matchOver).toBe(true);
  });
});
