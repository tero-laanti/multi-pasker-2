import { describe, expect, it } from 'vitest';
import { MapBuilder } from '../src/shared/map/builder';
import { buildGarrison } from '../src/shared/map/garrison';
import { PROTOCOL_VERSION, type GameEvent } from '../src/shared/protocol';
import { matchAwards } from '../src/server/game/awards';
import type { ServerPlayer } from '../src/server/game/player';
import { Room } from '../src/server/game/room';

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

function arena() {
  const m = new MapBuilder();
  m.box(-60, -1, -60, 60, 0, 60, 'grass');
  for (let i = 0; i < 8; i++) m.spawn(-40 + i * 10, 0, 0, 0);
  return m.build('test', { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [0, 1, 0]);
}

function setup(bots = 0) {
  let t = 1000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room(arena(), { dev: false, now: clock.now, bots });
  room.setSettings({ teams: true });
  const join = (name: string, host = false, train = false) => room.join(new FakeSocket() as never, { t: 'hello', v: PROTOCOL_VERSION, name, train }, host)!;
  /** Team sizes, largest first. */
  const sizes = () => {
    const n = new Map<number, number>();
    for (const p of room.players.values()) if (p.team >= 0) n.set(p.team, (n.get(p.team) ?? 0) + 1);
    return [...n.values()].sort((a, b) => b - a);
  };
  const mates = (p: ServerPlayer) => [...room.players.values()].filter((x) => x.team === p.team);
  return { room, clock, join, sizes, mates };
}

describe('team mode', () => {
  it('pairs everyone up, each pair in its own colour; free-for-all again breaks them up', () => {
    const { room, join, sizes, mates } = setup(2);
    const a = join('Aapo');
    join('Bertta');
    expect(sizes()).toEqual([2, 2]);
    const all = [...room.players.values()];
    for (const p of all) expect(mates(p).map((m) => m.info().color)).toEqual([p.info().color, p.info().color]);
    expect(new Set(all.map((p) => p.info().color)).size).toBe(2);
    expect(a.info().team).toBe(a.team);
    room.setSettings({ teams: false });
    expect(all.every((p) => p.team === -1 && p.info().team === -1)).toBe(true);
    expect(a.info().color).toBe(a.color);
  });

  it('with an odd number the host plays alone; whoever comes next pairs up with them', () => {
    const { join, mates } = setup();
    const host = join('Isäntä', true);
    expect(host.team).toBeGreaterThanOrEqual(0);
    const a = join('Aapo');
    expect(mates(host)).toEqual([host, a]);
    // Odd again: the host is on their own, and their partner gets the newcomer.
    const b = join('Bertta');
    expect(mates(host)).toEqual([host]);
    expect(mates(a)).toEqual([a, b]);
    const c = join('Cecilia');
    expect(mates(host)).toEqual([host, c]);
    expect(mates(a)).toEqual([a, b]);
  });

  it('players on the range have no partner until they deploy; a new match draws the pairs again', () => {
    const { room, join, sizes, mates } = setup(3);
    const host = join('Isäntä', true);
    const rookie = join('Rekry', false, true);
    expect(rookie.team).toBe(-1);
    expect(sizes()).toEqual([2, 2]);
    room.deploy(rookie);
    expect(rookie.team).toBeGreaterThanOrEqual(0);
    expect(mates(host)).toEqual([host]);
    expect(sizes()).toEqual([2, 2, 1]);
    for (let i = 0; i < 5; i++) {
      room.startRound(true);
      expect(sizes()).toEqual([2, 2, 1]);
      expect(mates(host)).toEqual([host]);
    }
  });

  it('no friendly fire: shots and blasts pass a partner by, though your own grenade still gets you', () => {
    const { room, clock, join } = setup();
    const a = join('Aapo');
    const b = join('Bertta');
    const c = join('Cecilia');
    const d = join('Daavid');
    expect(a.team).toBe(b.team);
    expect(c.team).toBe(d.team);
    expect(a.team).not.toBe(c.team);
    for (const p of [a, b, c, d]) p.protectedUntil = 0;
    room.damage(b, a, 50, 'body', 'rifle', [0, 1, 0]);
    expect(b.hp).toBe(100);
    room.damage(a, a, 30, 'body', 'grenade', [0, 1, 0]);
    expect(a.hp).toBe(70);
    room.damage(c, a, 50, 'body', 'rifle', [0, 1, 0]);
    expect(c.hp).toBe(50);
    // A claimed hit on a partner isn't one: the shot flies on.
    const place = (p: ServerPlayer, x: number, z: number) => {
      p.x = x;
      p.y = 0;
      p.z = z;
      p.history.push(clock.now(), x, 0, z, false, true);
    };
    place(a, 0, 10);
    place(b, 0, 0);
    room.fire(a, 'pistol', [0, a.eyeY(), 10], [0, -0.03, -1], clock.now(), { p: b.id, z: 'body', at: [0, 1.2, 0] });
    expect(b.hp).toBe(100);
  });

  it('the match goes to the pair with the most kills together', () => {
    const { join } = setup();
    const [a, b, c, d] = ['Aapo', 'Bertta', 'Cecilia', 'Daavid'].map((n) => join(n));
    a!.kills = 5;
    c!.kills = 3;
    d!.kills = 3;
    const winner = matchAwards([a!, b!, c!, d!], true).find((x) => x.id === 'winner')!;
    expect(winner).toMatchObject({ player: c!.id, playerName: 'Cecilia & Daavid', value: '6' });
    expect(matchAwards([a!, b!, c!, d!]).find((x) => x.id === 'winner')?.playerName).toBe('Aapo');
  });

  it('fifteen bots in pairs fight for a minute and never kill their partner', () => {
    let t = 1000;
    const room = new Room(buildGarrison(), { dev: true, now: () => t });
    room.setSettings({ teams: true });
    for (let i = 0; i < 15; i++) room.addBot();
    const ws = new FakeSocket();
    room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Katsoja', train: true });
    const team = new Map([...room.players.values()].map((p) => [p.id, p.team]));
    for (let i = 0; i < 60 * 60; i++) {
      t += 1000 / 60;
      room.tick(1 / 60);
    }
    const kills = ws.events().filter((e): e is Extract<GameEvent, { k: 'kill' }> => e.k === 'kill' && e.a !== e.v);
    expect(kills.length).toBeGreaterThan(3);
    expect(kills.filter((e) => team.get(e.a) === team.get(e.v))).toEqual([]);
  });
});
