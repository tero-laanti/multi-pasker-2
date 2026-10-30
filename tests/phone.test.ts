import { describe, expect, it, vi } from 'vitest';
import { classify, normalize } from '../src/shared/chat';
import { PHONE, TUNING } from '../src/shared/config';
import { FI } from '../src/shared/fi';
import { MapBuilder } from '../src/shared/map/builder';
import { PF, PROTOCOL_VERSION, decodeSnapshot, type GameEvent, type PhoneServerMsg } from '../src/shared/protocol';
import { Room } from '../src/server/game/room';

const V = FI.varusmestari;

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  closed = false;
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.closed = true;
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
  m.spawn(0, 0, 0, 0);
  m.spawn(20, 0, 20, 0);
  return m.build('test', { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [0, 1, 0]);
}

function setup() {
  let t = 1000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room(arena(), { dev: false, now: clock.now, publicUrl: 'http://10.0.0.5:8088/' });
  const join = (name: string) => {
    const ws = new FakeSocket();
    const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name })!;
    return { p, ws };
  };
  const pair = (p: ReturnType<typeof join>['p'], how: 'qr' | 'code' = 'qr') => {
    const ws = new FakeSocket();
    room.phoneJoin(ws as never, { t: 'phoneHello', v: PROTOCOL_VERSION, ...(how === 'qr' ? { pair: p.phone.pairToken } : { code: p.phone.pairCode }) }, false);
    return ws;
  };
  const run = (ms: number) => {
    for (let i = 0; i < ms / 10; i++) {
      clock.advance(10);
      room.tick(0.01);
    }
  };
  let rid = 0;
  const send = (p: ReturnType<typeof join>['p'], text: string, extra: Partial<{ rid: string; life: number; round: number; conv: string }> = {}) =>
    room.onPhoneMessage(p, { t: 'send', rid: extra.rid ?? `r${++rid}`, conv: extra.conv ?? V.number, text, life: extra.life ?? p.life, round: extra.round ?? room.round.n });
  const replies = (ws: FakeSocket) =>
    ws
      .phone()
      .filter((m): m is Extract<PhoneServerMsg, { t: 'msg' }> => m.t === 'msg' && m.m.from === 'them')
      .map((m) => m.m.text);
  return { room, clock, join, pair, run, send, replies };
}

describe('chat matching', () => {
  it('ignores case, whitespace and punctuation but is otherwise exact', () => {
    expect(normalize('  lataa!! ')).toBe('LATAA');
    expect(classify('Lataa.')).toEqual({ kind: 'command', cmd: 'LATAA' });
    expect(classify('kranaatti?')).toEqual({ kind: 'command', cmd: 'KRANAATTI' });
    expect(classify('la taa').kind).not.toBe('command');
    expect(classify('kranaati')).toEqual({ kind: 'nearMiss', cmd: 'KRANAATTI' });
    expect(classify('lataa nyt')).toEqual({ kind: 'nearMiss', cmd: 'LATAA' });
    expect(classify('L').kind).toBe('other');
    expect(classify('L', true)).toEqual({ kind: 'command', cmd: 'LATAA' });
  });

  it('recognises swearing, questions, help, languages, greetings, thanks and numbers', () => {
    expect(classify('voi vittu').kind).toBe('swear');
    expect(classify('lataa perkele').kind).toBe('swear');
    expect(classify('?').kind).toBe('question');
    expect(classify('apua').kind).toBe('help');
    expect(classify('reload please').kind).toBe('english');
    expect(classify('hej, tack').kind).toBe('swedish');
    expect(classify('moi').kind).toBe('greeting');
    expect(classify('kiitos').kind).toBe('thanks');
    expect(classify('112').kind).toBe('numbers');
    expect(classify('missä sotku on').kind).toBe('other');
  });
});

describe('pairing', () => {
  it('pairs by QR token or code, and a new phone replaces the old one with a notice on both', () => {
    const { join, pair, room } = setup();
    const a = join('Aapo');
    const first = pair(a.p, 'qr');
    const welcome = first.phone().find((m) => m.t === 'phoneWelcome');
    expect(welcome && welcome.t === 'phoneWelcome' && welcome.player.name).toBe('Aapo');
    expect(a.p.phone.status()).toBe('online');
    const second = pair(a.p, 'code');
    expect(first.phone().some((m) => m.t === 'replaced')).toBe(true);
    expect(first.closed).toBe(true);
    room.tick(0.01);
    const paired = a.ws.events().filter((e) => e.k === 'paired');
    expect(paired.map((e) => e.k === 'paired' && e.replaced)).toEqual([false, true]);
    // The newest phone resumes with its own token after a reconnect.
    const token = (second.phone().find((m) => m.t === 'phoneWelcome') as Extract<PhoneServerMsg, { t: 'phoneWelcome' }>).token;
    const again = new FakeSocket();
    room.phoneJoin(again as never, { t: 'phoneHello', v: PROTOCOL_VERSION, token }, false);
    expect(again.phone().some((m) => m.t === 'phoneWelcome')).toBe(true);
    const stale = new FakeSocket();
    room.phoneJoin(stale as never, { t: 'phoneHello', v: PROTOCOL_VERSION, token: 'nope' }, false);
    expect(stale.phone()[0]).toEqual({ t: 'pairFailed', reason: 'token' });
  });

  it('refuses the phone simulator outside development', () => {
    const { join, room } = setup();
    const a = join('Aapo');
    const ws = new FakeSocket();
    room.phoneJoin(ws as never, { t: 'phoneHello', v: PROTOCOL_VERSION, pair: a.p.phone.pairToken, sim: true }, false);
    expect(ws.phone()[0]).toEqual({ t: 'pairFailed', reason: 'sim' });
  });
});

describe('the varusmestari', () => {
  it('LATAA reloads only the sender, refuses a full magazine and never stacks', () => {
    const { join, pair, send, run, replies } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    const pa = pair(a.p);
    pair(b.p);
    a.p.ammo.pistol = 2;
    b.p.ammo.pistol = 3;
    send(a.p, 'Lataa');
    expect(a.p.reload).not.toBeNull();
    expect(b.p.reload).toBeNull();
    send(a.p, 'lataa');
    run(TUNING.pistol.reloadTime * 1000 + 50);
    expect(a.p.ammo.pistol).toBe(TUNING.pistol.magazine);
    expect(b.p.ammo.pistol).toBe(3);
    send(a.p, 'LATAA');
    // Two replies, typed one after the other.
    run(6000);
    const r = replies(pa);
    expect(r.some((x) => V.reloadBusy.includes(x!))).toBe(true);
    expect(r.some((x) => V.reloadFull.some((v) => v.replace('{rank}', 'alokas') === x))).toBe(true);
  });

  it('a retried request is acknowledged but not carried out twice', () => {
    const { join, pair, send, room } = setup();
    const a = join('Aapo');
    pair(a.p);
    send(a.p, 'kranaatti', { rid: 'same' });
    expect(a.p.grenades).toBe(1);
    a.p.grenades = 0;
    send(a.p, 'kranaatti', { rid: 'same' });
    expect(a.p.grenades).toBe(0);
    expect(room.players.size).toBe(1);
  });

  it('KRANAATTI respects the carry limit and the supply cooldown', () => {
    const { join, pair, send, clock } = setup();
    const a = join('Aapo');
    pair(a.p);
    send(a.p, 'Kranaatti');
    expect(a.p.grenades).toBe(1);
    send(a.p, 'Kranaatti');
    expect(a.p.grenades).toBe(1);
    a.p.grenades = 0;
    send(a.p, 'Kranaatti');
    expect(a.p.grenades).toBe(0);
    clock.advance(TUNING.grenade.supplyCooldown * 1000);
    send(a.p, 'Kranaatti');
    expect(a.p.grenades).toBe(1);
  });

  it('refuses the dead, requests from a previous life and from an old round', () => {
    const { join, pair, send, room, run } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    pair(a.p);
    a.p.ammo.pistol = 1;
    const life = a.p.life;
    a.p.protectedUntil = 0;
    room.damage(a.p, b.p, 500, 'body', 'pistol', [0, 1, 0]);
    send(a.p, 'Lataa');
    expect(a.p.reload).toBeNull();
    run(TUNING.player.respawnTime * 1000 + 100);
    expect(a.p.alive).toBe(true);
    a.p.ammo.pistol = 1;
    send(a.p, 'Lataa', { life });
    expect(a.p.reload).toBeNull();
    send(a.p, 'Lataa', { round: room.round.n - 1 });
    expect(a.p.reload).toBeNull();
    send(a.p, 'Lataa');
    expect(a.p.reload).not.toBeNull();
  });

  it('a round restart forgets old requests and locks; late requests from the old round do nothing', () => {
    const { join, pair, send, room } = setup();
    const a = join('Aapo');
    pair(a.p);
    send(a.p, 'perkele');
    expect(a.p.phone.locked).toBe(true);
    const oldRound = room.round.n;
    room.startRound();
    expect(a.p.phone.locked).toBe(false);
    a.p.ammo.pistol = 1;
    send(a.p, 'Lataa', { round: oldRound });
    expect(a.p.reload).toBeNull();
  });

  it('remembers typos all evening and now and then quotes an old one back with a service', () => {
    const { join, pair, send, run, replies, clock, room } = setup();
    const a = join('Aapo');
    const pa = pair(a.p);
    const kept = () => room.evening.typos('Aapo').map((t) => t.text);
    send(a.p, 'LATAAA');
    send(a.p, 'anna ammuksia');
    expect(kept()).toEqual(['LATAAA', 'anna ammuksia']);
    // The roast's dice always say yes here; a typo this fresh is not quoted yet.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const roasts = () => replies(pa).filter((x) => x?.includes('”'));
    const reload = () => {
      a.p.ammo.pistol = 0;
      send(a.p, 'LATAA');
      run(TUNING.pistol.reloadTime * 1000 + 3000);
    };
    reload();
    expect(roasts()).toEqual([]);
    // Older, it is: the latest one first, and only once.
    for (const t of room.evening.typos('Aapo')) t.at -= PHONE.roastAge * 1000;
    reload();
    const quoted = `${V.reloadOk[0]} ${V.roast[0]!.replace('{rank}', 'alokas').replace('{typo}', 'anna ammuksia')}`;
    expect(roasts()).toEqual([quoted]);
    expect(kept()).toEqual(['LATAAA']);
    // Not again so soon. A new match starts the service again, not the asevarasto's memory.
    reload();
    expect(roasts().length).toBe(1);
    room.startRound(true);
    expect(kept()).toEqual(['LATAAA']);
    clock.advance(PHONE.roastGap * 1000);
    send(a.p, 'Kranaatti');
    run(3000);
    expect(roasts().length).toBe(2);
    expect(roasts()[1]).toContain('“LATAAA”');
    expect(kept()).toEqual([]);
    random.mockRestore();
  });

  it('swearing locks every service until PUNNERRETTU', () => {
    const { join, pair, send } = setup();
    const a = join('Aapo');
    pair(a.p);
    a.p.ammo.pistol = 0;
    send(a.p, 'lataa saatana');
    expect(a.p.reload).toBeNull();
    send(a.p, 'Lataa');
    expect(a.p.reload).toBeNull();
    send(a.p, 'Punnerrettu!');
    send(a.p, 'Lataa');
    expect(a.p.reload).not.toBeNull();
    expect(a.p.stats.pushups).toBe(1);
  });
});

describe('public shame', () => {
  it('the typo feed shows one line per interval, preferring the longest, and keeps commands private', () => {
    const { join, pair, send, run, room } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    pair(a.p);
    pair(b.p);
    a.p.ammo.pistol = 0;
    send(a.p, 'Lataa');
    send(a.p, 'kranaati');
    send(b.p, 'antakaa nyt se kranaatti jo');
    run(100);
    const typos = () => a.ws.events().filter((e): e is Extract<GameEvent, { k: 'typo' }> => e.k === 'typo');
    expect(typos().length).toBe(1);
    expect(typos()[0]!.text).toBe('antakaa nyt se kranaatti jo');
    expect(typos()[0]!.reply.length).toBeGreaterThan(0);
    send(a.p, 'moi');
    run(500);
    expect(typos().length).toBe(1);
    run(1200);
    expect(typos().length).toBe(2);
    expect(typos().every((t) => t.text.toUpperCase() !== 'LATAA')).toBe(true);
    expect(room.round.n).toBe(1);
  });

  it('a kill while typing puts the draft in the kill feed', () => {
    const { join, pair, room } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    pair(b.p);
    room.onPhoneMessage(b.p, { t: 'draft', conv: V.number, text: 'pyydän lupaa puh' });
    b.p.protectedUntil = 0;
    room.damage(b.p, a.p, 500, 'body', 'rifle', [0, 1, 0]);
    room.tick(0.01);
    const kill = a.ws.events().find((e) => e.k === 'kill');
    expect(kill && kill.k === 'kill' && kill.draft).toBe('pyydän lupaa puh');
  });

  it('a kill with the phone out tells the phone who did it and what never got sent', () => {
    const { join, pair, room } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    const phone = pair(b.p);
    room.onPhoneMessage(b.p, { t: 'out', on: true });
    room.onPhoneMessage(b.p, { t: 'draft', conv: V.number, text: 'LAT' });
    b.p.protectedUntil = 0;
    room.damage(b.p, a.p, 500, 'head', 'rifle', [0, 1, 0]);
    expect(phone.phone().filter((m) => m.t === 'killed')).toEqual([{ t: 'killed', by: 'Aapo', w: 'rifle', head: true, draft: 'LAT' }]);
    // The draft is gone with the player: the next death has nothing to quote.
    expect(b.p.phone.draft).toBeNull();
  });

  it('a kill with the phone put away, or your own grenade, says so only when the phone was out', () => {
    const { join, pair, room } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    const phone = pair(b.p);
    b.p.protectedUntil = 0;
    room.damage(b.p, a.p, 500, 'body', 'pistol', [0, 1, 0]);
    expect(phone.phone().some((m) => m.t === 'killed')).toBe(false);
    const c = join('Cecilia');
    const cPhone = pair(c.p);
    room.onPhoneMessage(c.p, { t: 'out', on: true });
    room.kill(c.p, c.p, 'grenade', false);
    expect(cPhone.phone().filter((m) => m.t === 'killed')).toEqual([{ t: 'killed', by: '', w: 'grenade', head: false, draft: '' }]);
  });

  it('the phone is in the player\u2019s hand exactly while a chat is open', () => {
    const { join, pair, room } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    pair(a.p);
    const flagsOf = () => {
      const bin = b.ws.sent.filter((m): m is ArrayBuffer => m instanceof ArrayBuffer);
      const snap = decodeSnapshot(bin[bin.length - 1]!)!;
      return snap.players.find((x) => x.id === a.p.id)!.flags;
    };
    room.sendSnapshot(room.now());
    expect(flagsOf() & PF.PHONE).toBe(0);
    room.onPhoneMessage(a.p, { t: 'out', on: true });
    room.sendSnapshot(room.now());
    expect(flagsOf() & PF.PHONE).toBe(PF.PHONE);
    room.onPhoneMessage(a.p, { t: 'out', on: false });
    room.sendSnapshot(room.now());
    expect(flagsOf() & PF.PHONE).toBe(0);
  });
});
