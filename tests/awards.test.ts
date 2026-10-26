import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FI } from '../src/shared/fi';
import { MapBuilder } from '../src/shared/map/builder';
import { PROTOCOL_VERSION, type GameEvent, type ServerMsg } from '../src/shared/protocol';
import { Evening, roundAwards } from '../src/server/game/awards';
import { ROUND_TIME, Room } from '../src/server/game/room';

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
  for (let i = 0; i < 4; i++) m.spawn(-30 + i * 20, 0, 0, 0);
  return m.build('test', { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [0, 1, 0]);
}

function setup(file: string | null = null) {
  let t = 1000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room(arena(), { dev: false, now: clock.now, evening: new Evening(file) });
  const join = (name: string) => {
    const ws = new FakeSocket();
    const p = room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name })!;
    return { p, ws };
  };
  return { room, clock, join };
}

describe('awards', () => {
  it('go to the right players, with what won them', () => {
    const { join } = setup();
    const a = join('Aapo').p;
    const b = join('Bertta').p;
    const c = join('Cecilia').p;
    a.kills = 5;
    a.deaths = 2;
    b.kills = 5;
    b.deaths = 1;
    c.stats.deathsTyping = 3;
    c.stats.deathDraft = 'pyydän lupaa puh';
    a.stats.typos = 7;
    b.stats.phoneMs = 61_000;
    c.stats.pushups = 2;
    a.stats.swedishAt = 5000;
    b.stats.swedishAt = 3000;
    const list = roundAwards([a, b, c]);
    const by = (id: string) => list.find((x) => x.id === id);
    expect(by('winner')?.playerName).toBe('Bertta');
    expect(by('winner')?.name).toBe(FI.awards.winner);
    expect(by('deathsTyping')?.playerName).toBe('Cecilia');
    expect(by('longestDraft')?.value).toBe('pyydän lupaa puh');
    expect(by('typos')?.playerName).toBe('Aapo');
    expect(by('phoneTime')?.value).toBe('61');
    expect(by('pushups')?.value).toBe('20');
    expect(by('swedish')?.playerName).toBe('Bertta');
  });

  it('nobody gets an award for nothing', () => {
    const { join } = setup();
    const a = join('Aapo').p;
    expect(roundAwards([a])).toEqual([]);
  });
});

describe('the evening scoreboard', () => {
  it('adds up rounds, survives a restart, and leaves bots out', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pasker-')), 'evening.json');
    const { room, clock, join } = setup(file);
    const a = join('Aapo');
    join('Bertta');
    room.addBot();
    a.p.kills = 4;
    clock.advance(ROUND_TIME + 10);
    room.tick(1 / 60);
    expect(a.ws.events().some((e) => e.k === 'awards')).toBe(true);
    const sent = a.ws.sent.filter((m): m is Extract<ServerMsg, { t: 'evening' }> => (m as { t?: string }).t === 'evening').pop()!;
    expect(sent.rows.map((r) => r.name).sort()).toEqual(['Aapo', 'Bertta']);
    // A server restart reads the same evening back.
    const again = new Evening(file);
    const row = again.list().find((r) => r.name === 'Aapo')!;
    expect(row).toMatchObject({ rounds: 1, wins: 1, kills: 4 });
    again.reset();
    expect(new Evening(file).list()).toEqual([]);
  });
});
