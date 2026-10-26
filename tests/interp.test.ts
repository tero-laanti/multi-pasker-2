import { describe, expect, it } from 'vitest';
import { InterpClock, SnapshotBuffer, type Interp } from '../src/client/game/interp';
import { PF, type PlayerSnap } from '../src/shared/protocol';

function snap(id: number, x: number, age = 0, flags = PF.ALIVE | PF.GROUND): PlayerSnap {
  return { id, flags, age, x, y: 0, z: 0, yaw: 0, pitch: 0, weapon: 0, hp: 100 };
}

const out = (): Interp => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, flags: 0, weapon: 0, hp: 0, extrapolated: false });

describe('snapshot interpolation', () => {
  it('places each state on its own timeline using its age', () => {
    const b = new SnapshotBuffer();
    // The client sent x = 0 at t = 990 and x = 1 at t = 1020; snapshots went out at 1000 and 1033.
    b.push({ time: 1000, players: [snap(1, 0, 10)] });
    b.push({ time: 1033, players: [snap(1, 1, 13)] });
    const o = out();
    expect(b.sample(1, 1005, o)).toBe(true);
    expect(o.x).toBeCloseTo(0.5, 5);
    expect(o.vx).toBeCloseTo(1 / 0.03, 3);
  });

  it('extrapolates at most 100 ms past the newest state, then holds', () => {
    const b = new SnapshotBuffer();
    b.push({ time: 1000, players: [snap(1, 0)] });
    b.push({ time: 1100, players: [snap(1, 1)] });
    const o = out();
    b.sample(1, 1150, o);
    expect(o.x).toBeCloseTo(1.5, 5);
    expect(o.extrapolated).toBe(true);
    b.sample(1, 1600, o);
    expect(o.x).toBeCloseTo(2, 5);
  });

  it('does not blend across a respawn', () => {
    const b = new SnapshotBuffer();
    b.push({ time: 1000, players: [snap(1, 0, 0, 0)] });
    b.push({ time: 1033, players: [snap(1, 40, 0, PF.ALIVE)] });
    const o = out();
    b.sample(1, 1020, o);
    expect(o.x).toBe(0);
    b.sample(1, 1033, o);
    expect(o.x).toBe(40);
  });

  it('applies server-side changes (death) to a held state', () => {
    const b = new SnapshotBuffer();
    b.push({ time: 1000, players: [snap(1, 3, 5)] });
    // No newer state from that client, but the server now reports them dead.
    b.push({ time: 1033, players: [snap(1, 3, 38, 0)] });
    const o = out();
    b.sample(1, 1050, o);
    expect(o.flags & PF.ALIVE).toBe(0);
  });

  it('leaves our own state age out of the delay statistics', () => {
    const b = new SnapshotBuffer();
    for (let i = 0; i < 30; i++) b.push({ time: 1000 + i * 33, players: [snap(1, i, 2), snap(2, i, 120)] }, 2);
    expect(b.age).toBe(2);
  });
});

describe('interpolation clock', () => {
  it('settles near 1.5 snapshot intervals on a steady stream and follows the server clock', () => {
    const c = new InterpClock();
    let local = 5000;
    for (let i = 0; i < 300; i++) {
      // Server time runs 2000 ms ahead of local time; 4 ms of delivery delay.
      c.onSnapshot(local + 2000 - 4, local);
      c.update(local, 33.3);
      local += 33.3;
    }
    expect(c.delay).toBeGreaterThan(45);
    expect(c.delay).toBeLessThan(60);
    expect(Math.abs(c.renderTime - (local - 33.3 + 2000 - 4 - c.delay))).toBeLessThan(5);
  });

  it('grows the delay with jitter', () => {
    const steady = new InterpClock();
    const jittery = new InterpClock();
    let local = 0;
    for (let i = 0; i < 300; i++) {
      steady.onSnapshot(local, local);
      jittery.onSnapshot(local, local + (i % 3) * 15);
      local += 33.3;
    }
    expect(jittery.delay).toBeGreaterThan(steady.delay + 20);
  });
});
