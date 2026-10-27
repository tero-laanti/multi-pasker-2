import { describe, expect, it } from 'vitest';
import { SIM_DT, TUNING } from '../src/shared/config';
import { MapBuilder } from '../src/shared/map/builder';
import { meleeReaches, meleeTarget } from '../src/shared/melee';
import { PROTOCOL_VERSION, type GameEvent } from '../src/shared/protocol';
import { Room } from '../src/server/game/room';
import { WeaponController, type WeaponInput } from '../src/client/game/weapons';

const M = TUNING.melee;

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
  // A thin wall between z = -0.6 and -0.5, across x = 4..8.
  m.box(4, 0, -0.6, 8, 3, -0.5, 'concrete');
  m.spawn(0, 0, 0, 0);
  m.spawn(10, 0, 10, 0);
  return m.build('test', { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, [0, 1, 0]);
}

function setup() {
  let t = 1000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const room = new Room(arena(), { dev: true, now: clock.now });
  const join = (name: string) => {
    const ws = new FakeSocket();
    return { p: room.join(ws as never, { t: 'hello', v: PROTOCOL_VERSION, name })!, ws };
  };
  const place = (p: ReturnType<typeof join>['p'], x: number, z: number) => {
    p.x = x;
    p.y = 0;
    p.z = z;
    p.alive = true;
    p.protectedUntil = 0;
    p.history.push(clock.now(), x, 0, z, false, true);
  };
  return { room, clock, join, place };
}

const north: [number, number, number] = [0, 0, -1];

describe('knife reach', () => {
  it('reaches a body in front within arm’s length, not behind, beside or further', () => {
    const eye: [number, number, number] = [0, 1.62, 0];
    expect(meleeReaches(eye, north, { x: 0, y: 0, z: -1.6, crouched: false })).toBe(true);
    expect(meleeReaches(eye, north, { x: 0, y: 0, z: -1.6, crouched: true })).toBe(true);
    expect(meleeReaches(eye, north, { x: 0, y: 0, z: -2.8, crouched: false })).toBe(false);
    expect(meleeReaches(eye, north, { x: 0, y: 0, z: 1.2, crouched: false })).toBe(false);
    expect(meleeReaches(eye, north, { x: 1.4, y: 0, z: 0, crouched: false })).toBe(false);
    // The nearest of two bodies in reach takes it.
    const near = { id: 1, x: 0.2, y: 0, z: -1.2, crouched: false };
    const far = { id: 2, x: -0.1, y: 0, z: -1.9, crouched: false };
    expect(meleeTarget(eye, north, [far, near])?.id).toBe(1);
  });
});

describe('knife on the server', () => {
  it('two stabs kill from full health, credited to the knife', () => {
    const { room, clock, join, place } = setup();
    const a = join('Puukko');
    const b = join('Kohde');
    place(a.p, 0, 0);
    place(b.p, 0, -1.4);
    room.melee(a.p, [0, a.p.eyeY(), 0], north, clock.now(), b.p.id);
    expect(b.p.hp).toBe(100 - M.damage);
    // Too soon for a second stab: ignored.
    clock.advance(100);
    room.melee(a.p, [0, a.p.eyeY(), 0], north, clock.now(), b.p.id);
    expect(b.p.hp).toBe(100 - M.damage);
    clock.advance(M.time * 1000);
    place(b.p, 0, -1.4);
    b.p.hp = 100 - M.damage;
    room.melee(a.p, [0, a.p.eyeY(), 0], north, clock.now(), b.p.id);
    expect(b.p.alive).toBe(false);
    room.tick(0.01);
    const kill = a.ws.events().find((e) => e.k === 'kill');
    expect(kill && kill.k === 'kill' && kill.w).toBe('knife');
  });

  it('misses out of reach, behind cover, behind the back and on spawn protection', () => {
    const { room, clock, join, place } = setup();
    const a = join('Puukko');
    const b = join('Kohde');
    const stab = (d: [number, number, number] = north) => {
      clock.advance(M.time * 1000);
      room.melee(a.p, [a.p.x, a.p.eyeY(), a.p.z], d, clock.now(), b.p.id);
    };
    place(a.p, 0, 0);
    place(b.p, 0, -3);
    stab();
    expect(b.p.hp).toBe(100);
    // Through the wall at x = 4..8, z = -0.6.
    place(a.p, 6, 0);
    place(b.p, 6, -1.2);
    stab();
    expect(b.p.hp).toBe(100);
    // Facing away.
    place(a.p, 0, 0);
    place(b.p, 0, -1.3);
    stab([0, 0, 1]);
    expect(b.p.hp).toBe(100);
    b.p.protectedUntil = clock.now() + 5000;
    stab();
    expect(b.p.hp).toBe(100);
  });
});

describe('knife on the client', () => {
  const idle: WeaponInput = { fireHeld: false, firePressed: false, adsHeld: false, sprinting: false, speed: 0, maxSpeed: 5, airborne: false, crouched: false, phone: false };
  const aim = { yaw: 0, pitch: 0 };
  const ready = () => {
    const w = new WeaponController();
    for (let i = 0; i < 120; i++) w.step(SIM_DT, idle, aim);
    return w;
  };

  it('lands once, at its moment, and the gun is ready again after the stab', () => {
    const w = ready();
    expect(w.stab()).toBe(true);
    expect(w.state).toBe('stabbing');
    const landed: number[] = [];
    for (let i = 0; i < Math.round((M.time + 0.1) / SIM_DT); i++) {
      w.step(SIM_DT, { ...idle, fireHeld: true, firePressed: i === 3 }, aim);
      if (w.stabNow) {
        landed.push((i + 1) * SIM_DT);
        w.stabNow = false;
      }
      // No shots while the knife is out.
      if (w.state === 'stabbing') expect(w.shots).toHaveLength(0);
    }
    expect(landed).toHaveLength(1);
    expect(landed[0]).toBeCloseTo(M.time * M.hitAt, 1);
    expect(w.state).toBe('ready');
  });

  it('waits for a reload or a grenade', () => {
    const w = ready();
    w.ammo.pistol = 3;
    expect(w.startReload()).toBe('ok');
    expect(w.stab()).toBe(false);
    const g = ready();
    g.grenades = 1;
    expect(g.primeGrenade()).toBe(true);
    expect(g.stab()).toBe(false);
  });
});
