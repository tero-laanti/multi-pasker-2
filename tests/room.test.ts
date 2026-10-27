import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/shared/config';
import { MapBuilder } from '../src/shared/map/builder';
import { buildGarrison } from '../src/shared/map/garrison';
import { PROTOCOL_VERSION, type GameEvent } from '../src/shared/protocol';
import { GATE_PLAYERS, ROUND_TIME, Room } from '../src/server/game/room';

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  events(): GameEvent[] {
    return this.sent.flatMap((m) => ((m as { t?: string }).t === 'events' ? (m as { e: GameEvent[] }).e : []));
  }
}

function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function arena() {
  const m = new MapBuilder();
  m.box(-60, -1, -60, 60, 0, 60, 'grass');
  // A wall that blocks shots between x = -1..1 at z = -20.
  m.box(-1, 0, -21, 1, 3, -20, 'concrete');
  m.spawn(0, 0, 0, 0);
  m.spawn(10, 0, 10, 0);
  return m.build('test', { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [0, 1, 0]);
}

function join(room: Room, name: string) {
  const ws = new FakeSocket();
  const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name })!;
  return { p, ws };
}

function place(room: Room, p: ReturnType<typeof join>['p'], x: number, z: number, t: number) {
  p.x = x;
  p.y = 0;
  p.z = z;
  p.alive = true;
  p.protectedUntil = 0;
  p.history.push(t, x, 0, z, false, true);
}

describe('shot validation with rewind', () => {
  it('hits where the target was at the shooter’s render time', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'Ampuja');
    const b = join(room, 'Kohde');
    place(room, a.p, 0, 10, 1000);
    place(room, b.p, 0, 0, 1000);
    c.advance(100);
    place(room, b.p, 3, 0, 1100);
    c.advance(30);
    // The shooter saw B at x = 0 (render time 1000) and aimed straight at it.
    room.fire(a.p, 'pistol', [0, a.p.eyeY(), 10], [0, -0.03, -1], 1000, { p: b.p.id, z: 'body', at: [0, 1.2, 0] });
    expect(b.p.hp).toBe(100 - TUNING.killSpeed.cod.pistolBody);
    // A render time older than the rewind limit is clamped: aiming where the target was then misses.
    c.advance(200);
    room.fire(a.p, 'pistol', [0, a.p.eyeY(), 10], [0, -0.03, -1], 1000, { p: b.p.id, z: 'body', at: [0, 1.2, 0] });
    expect(b.p.hp).toBe(100 - TUNING.killSpeed.cod.pistolBody);
  });

  it('cover blocks shots even when the client claims a hit', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'Ampuja');
    const b = join(room, 'Kohde');
    place(room, a.p, 0, -10, 1000);
    place(room, b.p, 0, -30, 1000);
    c.advance(20);
    room.fire(a.p, 'pistol', [0, a.p.eyeY(), -10], [0, -0.02, -1], 1000, { p: b.p.id, z: 'head', at: [0, 1.6, -30] });
    expect(b.p.hp).toBe(100);
  });

  it('caps fire rate and ammo, and headshots kill in two pistol hits', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'Ampuja');
    const b = join(room, 'Kohde');
    place(room, a.p, 0, 10, 1000);
    place(room, b.p, 0, 0, 1000);
    const head: [number, number, number] = [0, (1.64 - a.p.eyeY()) / 10, -1];
    room.fire(a.p, 'pistol', [0, a.p.eyeY(), 10], head, c.now(), { p: b.p.id, z: 'head', at: [0, 1.64, 0] });
    // Too soon: refused.
    c.advance(20);
    room.fire(a.p, 'pistol', [0, a.p.eyeY(), 10], head, c.now(), { p: b.p.id, z: 'head', at: [0, 1.64, 0] });
    expect(b.p.hp).toBe(50);
    c.advance(160);
    b.p.history.push(c.now(), 0, 0, 0, false, true);
    room.fire(a.p, 'pistol', [0, a.p.eyeY(), 10], head, c.now(), { p: b.p.id, z: 'head', at: [0, 1.64, 0] });
    expect(b.p.alive).toBe(false);
    expect(a.p.kills).toBe(1);
    expect(a.p.ammo.pistol).toBe(TUNING.pistol.magazine - 2);
    room.tick(1 / 60);
    const kills = a.ws.events().filter((e) => e.k === 'kill');
    expect(kills.length).toBe(1);
  });
});

describe('life cycle', () => {
  it('respawns after the respawn time with full magazines and regenerates health', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    const b = join(room, 'B');
    place(room, b.p, 0, 0, 1000);
    room.damage(b.p, a.p, 40, 'body', 'pistol', [0, 1, 5]);
    expect(b.p.hp).toBe(60);
    for (let i = 0; i < 60 * 6; i++) {
      c.advance(1000 / 60);
      room.tick(1 / 60);
    }
    expect(b.p.hp).toBe(100);
    b.p.ammo.pistol = 3;
    room.damage(b.p, a.p, 200, 'body', 'pistol', [0, 1, 5]);
    expect(b.p.alive).toBe(false);
    for (let i = 0; i < 60 * 3; i++) {
      c.advance(1000 / 60);
      room.tick(1 / 60);
    }
    expect(b.p.alive).toBe(true);
    expect(b.p.ammo.pistol).toBe(TUNING.pistol.magazine);
  });

  it('R puts in the spare magazine at the refill moment, once', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    const T = TUNING.pistol;
    expect(a.p.reserve.pistol).toBe(T.magazine * TUNING.ammo.spareMagazines);
    expect(room.startReload(a.p, 'spare')).toBe('full');
    a.p.ammo.pistol = 0;
    expect(room.startReload(a.p, 'spare')).toBe('ok');
    expect(room.startReload(a.p, 'spare')).toBe('busy');
    let refillAt = -1;
    for (let i = 0; i < 200; i++) {
      c.advance(10);
      room.tick(0.01);
      if (refillAt < 0 && a.p.ammo.pistol === T.magazine) refillAt = (i + 1) * 10;
    }
    expect(Math.abs(refillAt - T.reloadEmptyTime * T.reloadRefill * 1000)).toBeLessThan(20);
    expect(a.p.reserve.pistol).toBe(T.magazine * (TUNING.ammo.spareMagazines - 1));
    // A part-used magazine takes only what it needs; with no spare left, R does nothing.
    a.p.reserve.pistol = 5;
    a.p.ammo.pistol = 10;
    expect(room.startReload(a.p, 'spare')).toBe('ok');
    c.advance(T.reloadTime * 1000 + 20);
    room.tick(0.01);
    expect(a.p.ammo.pistol).toBe(T.magazine);
    expect(a.p.reserve.pistol).toBe(3);
    a.p.reserve.pistol = 0;
    a.p.ammo.pistol = 0;
    expect(room.startReload(a.p, 'spare')).toBe('noSpare');
  });

  it("the armoury's reload fills every magazine and spare", () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    room.giveWeapon(a.p, 'rifle');
    a.p.weapon = 'rifle';
    expect(room.startReload(a.p, 'armoury')).toBe('full');
    a.p.ammo.rifle = 3;
    a.p.reserve.rifle = 0;
    a.p.ammo.pistol = 1;
    a.p.reserve.pistol = 0;
    expect(room.startReload(a.p, 'armoury')).toBe('ok');
    // The holstered pistol and both spares at once, the rifle in hand at its refill moment.
    expect(a.p.ammo.pistol).toBe(TUNING.pistol.magazine);
    expect(a.p.reserve.pistol).toBe(a.p.spare('pistol'));
    expect(a.p.reserve.rifle).toBe(a.p.spare('rifle'));
    expect(a.p.ammo.rifle).toBe(3);
    expect(room.startReload(a.p, 'armoury')).toBe('busy');
    c.advance(TUNING.rifle.reloadTime * 1000 + 20);
    room.tick(0.01);
    expect(a.p.ammo.rifle).toBe(TUNING.rifle.magazine);
    expect(a.p.reserve.rifle).toBe(a.p.spare('rifle'));
    // LATAA during an R reload makes it a full one: nothing comes off the spare.
    a.p.ammo.rifle = 0;
    a.p.reserve.rifle = 4;
    expect(room.startReload(a.p, 'spare')).toBe('ok');
    expect(room.startReload(a.p, 'armoury')).toBe('ok');
    c.advance(TUNING.rifle.reloadEmptyTime * 1000 + 20);
    room.tick(0.01);
    expect(a.p.ammo.rifle).toBe(TUNING.rifle.magazine);
    expect(a.p.reserve.rifle).toBe(a.p.spare('rifle'));
  });

  it('rejoins the same player with the token', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    a.p.kills = 3;
    room.disconnect(a.p);
    const ws2 = new FakeSocket();
    const again = room.join(ws2 as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'A', token: a.p.token })!;
    expect(again).toBe(a.p);
    expect(again.kills).toBe(3);
    expect(room.players.size).toBe(1);
  });
});

describe('grenades', () => {
  const tick = (room: Room, c: ReturnType<typeof clock>, ms: number) => {
    for (let i = 0; i < ms / 10; i++) {
      c.advance(10);
      room.tick(0.01);
    }
  };

  it('the fuse burns from the pin, so a cooked grenade lands with less of it', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    a.p.grenades = 1;
    room.onMessage(a.p, { t: 'pin' });
    expect(a.p.grenades).toBe(0);
    tick(room, c, 1000);
    room.onMessage(a.p, { t: 'grenade', o: [a.p.x, a.p.eyeY(), a.p.z - 0.3], v: [0, 3, -10] });
    tick(room, c, 10);
    const nade = a.ws.events().find((e) => e.k === 'nade') as Extract<GameEvent, { k: 'nade' }>;
    expect(nade.fuse).toBeCloseTo(TUNING.grenade.fuse - 1, 1);
  });

  it('held past its fuse, it goes off in the hand', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    a.p.grenades = 1;
    room.onMessage(a.p, { t: 'pin' });
    tick(room, c, TUNING.grenade.fuse * 1000 + 50);
    expect(a.p.alive).toBe(false);
    expect(a.ws.events().some((e) => e.k === 'boom')).toBe(true);
    expect(a.ws.events().some((e) => e.k === 'kill' && e.v === a.p.id && e.a === a.p.id)).toBe(true);
  });

  it('a player killed with the pin out drops the grenade, still burning', () => {
    const c = clock();
    const room = new Room(arena(), { dev: true, now: c.now });
    const a = join(room, 'A');
    const b = join(room, 'B');
    a.p.grenades = 1;
    room.onMessage(a.p, { t: 'pin' });
    tick(room, c, 500);
    a.p.protectedUntil = 0;
    room.damage(a.p, b.p, 200, 'body', 'pistol', [0, 1, 5]);
    tick(room, c, 10);
    const nade = a.ws.events().find((e) => e.k === 'nade') as Extract<GameEvent, { k: 'nade' }>;
    expect(nade).toBeDefined();
    expect(nade.fuse).toBeCloseTo(TUNING.grenade.fuse - 0.5, 1);
    expect(a.p.pinAt).toBe(0);
  });
});

describe('bots in the garrison', () => {
  it('fifteen bots fight for a minute without errors and within the tick budget', () => {
    const c = clock();
    const room = new Room(buildGarrison(), { dev: true, now: c.now });
    for (let i = 0; i < 15; i++) room.addBot();
    expect(room.round.gateOpen).toBe(room.players.size > GATE_PLAYERS);
    const start = new Map([...room.players.values()].map((p) => [p.id, { x: p.x, z: p.z }]));
    let maxTick = 0;
    let total = 0;
    for (let i = 0; i < 60 * 60; i++) {
      c.advance(1000 / 60);
      const t0 = performance.now();
      room.tick(1 / 60);
      const dt = performance.now() - t0;
      total += dt;
      if (i > 60) maxTick = Math.max(maxTick, dt);
    }
    const kills = [...room.players.values()].reduce((a, p) => a + p.kills, 0);
    const moved = [...room.players.values()].filter((p) => Math.hypot(p.x - start.get(p.id)!.x, p.z - start.get(p.id)!.z) > 3).length;
    expect(kills).toBeGreaterThan(3);
    expect(moved).toBeGreaterThan(10);
    expect(total / 3600).toBeLessThan(4);
    console.log(`bots: ${kills} kills in 60 s, ${moved}/15 moved, avg tick ${(total / 3600).toFixed(3)} ms, max ${maxTick.toFixed(2)} ms`);
  });

  it('ends the round after the round time and starts the next one', () => {
    const c = clock();
    const room = new Room(buildGarrison(), { dev: true, now: c.now });
    room.addBot();
    c.advance(ROUND_TIME + 10);
    room.tick(1 / 60);
    expect(room.round.state).toBe('ended');
    c.advance(13_000);
    room.tick(1 / 60);
    expect(room.round.state).toBe('playing');
    expect(room.round.n).toBe(2);
  });
});
