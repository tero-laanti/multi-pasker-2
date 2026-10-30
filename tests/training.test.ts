import { describe, expect, it } from 'vitest';
import { FI } from '../src/shared/fi';
import { MapBuilder } from '../src/shared/map/builder';
import { PROTOCOL_VERSION, decodeSnapshot, type GameEvent, type PhoneServerMsg } from '../src/shared/protocol';
import { Evening } from '../src/server/game/awards';
import { ROUND_TIME, Room } from '../src/server/game/room';
import { isRadioCheckReply } from '../src/server/game/varusmestari';

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
  events(): GameEvent[] {
    return this.sent.flatMap((m) => ((m as { t?: string }).t === 'events' ? (m as { e: GameEvent[] }).e : []));
  }
  texts(): string[] {
    return (this.sent as PhoneServerMsg[]).filter((m): m is Extract<PhoneServerMsg, { t: 'msg' }> => m.t === 'msg' && m.m.from === 'them').map((m) => m.m.text ?? '');
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
  const room = new Room(arena(), { dev: false, now: clock.now, evening: new Evening(null) });
  const join = (name: string, train = false) => {
    const ws = new FakeSocket();
    const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name, train })!;
    return { p, ws };
  };
  const pair = (p: ReturnType<typeof join>['p']) => {
    const ws = new FakeSocket();
    room.phoneJoin(ws as never, { t: 'phoneHello', v: PROTOCOL_VERSION, pair: p.phone.pairToken }, false);
    return ws;
  };
  const run = (ms: number) => {
    for (let i = 0; i < ms / 10; i++) {
      clock.advance(10);
      room.tick(0.01);
    }
  };
  let rid = 0;
  const send = (p: ReturnType<typeof join>['p'], text: string) => room.onPhoneMessage(p, { t: 'send', rid: `r${++rid}`, conv: V.number, text, life: p.life, round: room.round.n });
  return { room, clock, join, pair, run, send };
}

describe('the shooting range tutorial', () => {
  it('keeps a recruit on the range out of the match until they deploy', () => {
    const { room, join, run } = setup();
    const a = join('Aapo');
    const b = join('Bertta', true);
    expect(b.p.training).toBe(true);
    expect(b.p.alive).toBe(false);
    expect(room.activeCount()).toBe(1);
    run(5000);
    expect(b.p.alive).toBe(false);
    const snap = a.ws.sent.filter((m): m is Buffer => m instanceof Buffer || m instanceof ArrayBuffer).pop()!;
    const buf = snap instanceof ArrayBuffer ? snap : (snap.buffer.slice(snap.byteOffset, snap.byteOffset + snap.byteLength) as ArrayBuffer);
    expect(decodeSnapshot(buf)!.players.map((p) => p.id)).toEqual([a.p.id]);
    expect(room.playerList().find((p) => p.id === b.p.id)?.training).toBe(true);
    room.onMessage(b.p, { t: 'deploy' });
    expect(b.p.training).toBe(false);
    expect(b.p.alive).toBe(true);
    expect(room.activeCount()).toBe(2);
  });

  it('sends the radio check when the phone is picked up and refills on YK', () => {
    const { room, join, pair, run, send } = setup();
    const a = join('Aapo', true);
    room.onMessage(a.p, { t: 'radioCheck' });
    expect(a.p.radioCheck).toBe('armed');
    const phone = pair(a.p);
    run(4000);
    // The first text is just "YK"; anything else gets the explanation, then the tellings-off.
    expect(phone.texts()).toEqual(['**YK**']);
    send(a.p, 'moi');
    run(4000);
    expect(phone.texts().at(-1)).toBe(FI.training.radioCheckExplain[0]);
    send(a.p, 'mitä?');
    run(4000);
    expect(FI.training.radioCheckWrong.map((s) => s.replace('{rank}', 'alokas'))).toContain(phone.texts().at(-1));
    expect(a.ws.events().some((e) => e.k === 'training')).toBe(false);
    send(a.p, 'yk');
    run(4000);
    expect(a.p.radioCheck).toBe('done');
    expect(a.ws.events().filter((e) => e.k === 'training')).toEqual([{ k: 'training', what: 'radioCheck' }]);
    expect(phone.texts().at(-1)).toBe(FI.training.radioCheckOk[0]);
    // Then the services work on the range's own guns.
    send(a.p, 'LATAA');
    send(a.p, 'kranaatti');
    run(1000);
    expect(a.ws.events().filter((e) => e.k === 'training').map((e) => (e as { what: string }).what)).toEqual(['radioCheck', 'ammo', 'grenade']);
  });

  it('a phone paired before the pickup gets the radio check once the welcome is read', () => {
    const { room, join, pair, run } = setup();
    const a = join('Aapo', true);
    const phone = pair(a.p);
    run(3000);
    // The usual welcome is already in the chat it was sent (pairing happened before the pickup).
    expect(a.p.phone.convs.get(V.number)?.messages.map((m) => m.text)).toEqual(V.welcome);
    room.onMessage(a.p, { t: 'radioCheck' });
    run(4000);
    // One new message per chat: it waits behind the unread welcome.
    expect(phone.texts()).not.toContain(FI.training.radioCheck[0]);
    room.onPhoneMessage(a.p, { t: 'read', conv: V.number });
    run(4000);
    expect(phone.texts().at(-1)).toBe(FI.training.radioCheck[0]);
    expect(a.p.radioCheck).toBe('waiting');
  });

  it('accepts YK however it is typed', () => {
    for (const t of ['YK', 'yk', 'Yk.', ' y k ', 'Y.K.', 'yhteyskoe']) expect(isRadioCheckReply(t)).toBe(true);
    for (const t of ['yj', 'ok', 'kyllä', 'y']) expect(isRadioCheckReply(t)).toBe(false);
  });

  it('a recruit on the range is left out of the match and its results', () => {
    const { room, clock, join } = setup();
    room.setSettings({ rounds: 1 });
    const a = join('Aapo');
    const b = join('Bertta', true);
    a.p.kills = 2;
    b.p.kills = 5;
    clock.advance(ROUND_TIME + 10);
    room.tick(1 / 60);
    expect(room.round.matchOver).toBe(true);
    expect(room.evening.matches().map((m) => m.winner)).toEqual(['Aapo']);
    expect(b.p.alive).toBe(false);
  });
});
