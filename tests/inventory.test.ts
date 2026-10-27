import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/shared/config';
import { FI } from '../src/shared/fi';
import { MapBuilder } from '../src/shared/map/builder';
import { PROTOCOL_VERSION, type GameEvent, type PhoneServerMsg } from '../src/shared/protocol';
import { Room } from '../src/server/game/room';

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
  const room = new Room(arena(), { dev: false, now: clock.now });
  const join = (name: string) => {
    const ws = new FakeSocket();
    const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name })!;
    const phone = new FakeSocket();
    room.phoneJoin(phone as never, { t: 'phoneHello', v: PROTOCOL_VERSION, pair: p.phone.pairToken }, false);
    return { p, ws, phone };
  };
  const run = (ms: number) => {
    for (let i = 0; i < ms / 10; i++) {
      clock.advance(10);
      room.tick(0.01);
    }
  };
  let rid = 0;
  const send = (p: ReturnType<typeof join>['p'], text: string) => room.onPhoneMessage(p, { t: 'send', rid: `r${++rid}`, conv: V.number, text, life: p.life, round: room.round.n });
  /** Makes the check due now and lets the question arrive. */
  const ask = (p: ReturnType<typeof join>['p']) => {
    p.inventoryAt = clock.now();
    run(4000);
  };
  return { room, clock, join, run, send, ask };
}

const asked = (texts: string[]) => texts.find((x) => Object.values(FI.inventory.ask).some((list) => list.some((q) => q.replace('{s}', String(INVENTORY.answerTime)) === x)));

describe('the inventory check', () => {
  it('asks about your own kit, and a right number earns a grenade', () => {
    const { join, send, ask, run } = setup();
    const a = join('Aapo');
    ask(a.p);
    expect(a.p.inventory).not.toBeNull();
    expect(asked(a.phone.texts())).toBeDefined();
    expect(a.ws.events().some((e) => e.k === 'inventory' && e.until > 0)).toBe(true);
    expect(a.phone.sent.some((m) => (m as PhoneServerMsg).t === 'inventory' && (m as { left: number }).left === INVENTORY.answerTime)).toBe(true);
    a.p.inventory!.kind = 'mag';
    a.p.inventory!.asked = a.p.ammo.pistol;
    send(a.p, String(a.p.ammo.pistol));
    run(4000);
    expect(a.p.inventory).toBeNull();
    expect(a.p.grenades).toBe(1);
    expect(FI.inventory.right).toContain(a.phone.texts().at(-1));
    expect(a.ws.events().filter((e) => e.k === 'inventory').at(-1)).toEqual({ k: 'inventory', until: 0 });
  });

  it('counts the number as it is when the answer arrives, too', () => {
    const { join, send, ask } = setup();
    const a = join('Aapo');
    ask(a.p);
    a.p.inventory!.kind = 'mag';
    a.p.inventory!.asked = 12;
    a.p.ammo.pistol = 9;
    send(a.p, '9');
    expect(a.p.inventory).toBeNull();
  });

  it('a wrong number keeps the check open; no answer in time means push-ups', () => {
    const { join, send, ask, run } = setup();
    const a = join('Aapo');
    ask(a.p);
    a.p.inventory!.kind = 'kills';
    a.p.inventory!.asked = 0;
    send(a.p, '7');
    run(3000);
    expect(a.p.inventory).not.toBeNull();
    expect(FI.inventory.wrong.map((s) => s.replace('{rank}', 'alokas')).map((s) => s[0]!.toUpperCase() + s.slice(1))).toContain(a.phone.texts().at(-1));
    run(INVENTORY.answerTime * 1000);
    expect(a.p.inventory).toBeNull();
    expect(a.p.phone.locked).toBe(true);
    expect(a.p.stats.pushups).toBe(1);
    run(4000);
    expect(FI.inventory.timeout.map((s) => s[0]!.toUpperCase() + s.slice(1))).toContain(a.phone.texts().at(-1));
    // No service until the push-ups are reported.
    a.p.ammo.pistol = 1;
    send(a.p, 'LATAA');
    expect(a.p.reload).toBeNull();
    send(a.p, 'PUNNERRETTU');
    expect(a.p.phone.locked).toBe(false);
  });

  it('waits for a good moment: not while dead, without a phone or between rounds', () => {
    const { join, run, room, clock } = setup();
    const a = join('Aapo');
    a.p.alive = false;
    a.p.inventoryAt = clock.now();
    run(1000);
    expect(a.p.inventory).toBeNull();
    expect(a.p.inventoryAt).toBeGreaterThan(clock.now());
    const b = join('Bertta');
    b.p.phone.ws = null;
    b.p.inventoryAt = clock.now();
    run(1000);
    expect(b.p.inventory).toBeNull();
    room.round = { ...room.round, state: 'ended' };
    const c = join('Cecilia');
    c.p.inventoryAt = clock.now();
    run(1000);
    expect(c.p.inventory).toBeNull();
  });

  it('bots answer, mostly right, and report their push-ups', () => {
    const { room, run } = setup();
    const bots = Array.from({ length: 6 }, () => room.addBot()!);
    for (const b of bots) b.inventoryAt = 0;
    let answered = 0;
    for (let s = 0; s < 60; s++) {
      run(1000);
      for (const b of bots) {
        if (!b.inventory && b.grenades > 0) answered++;
        b.grenades = 0;
      }
    }
    expect(answered).toBeGreaterThan(0);
    // Whoever missed one has reported the push-ups by now.
    expect(bots.filter((b) => b.phone.locked).length).toBeLessThan(bots.length);
  });
});
