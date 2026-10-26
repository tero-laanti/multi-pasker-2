import { describe, expect, it } from 'vitest';
import { MASK } from '../src/shared/collision/brush';
import { CollisionWorld } from '../src/shared/collision/world';
import { SIM_DT, TUNING } from '../src/shared/config';
import { MapBuilder } from '../src/shared/map/builder';
import { Mover, emptyCmd, newMoveState, type MoveCmd, type MoveState } from '../src/shared/movement';
import { makeRng } from '../src/shared/math';

const T = TUNING.move;

function testWorld() {
  const m = new MapBuilder();
  m.box(-50, -1, -50, 50, 0, 50, 'grass');
  // Wall across -z at z = -10.
  m.box(-20, 0, -11, 20, 3, -10, 'concrete');
  // A 0.3 m step and a 0.8 m crate at x = 10.
  m.box(8, 0, -10, 12, 0.3, -4, 'concrete');
  m.box(8, 0, 4, 12, 0.8, 6, 'planks');
  // Stairs rising towards -x up to 2 m, then a landing.
  m.stairs(-14, 0, 10, -8, 2, 12, '-x', 8, 'concrete');
  m.box(-18, 0, 10, -14, 2, 12, 'concrete');
  // Walkable 25 degree ramp and a 60 degree wedge.
  m.wedge(20, 0, -4, 26, Math.tan((25 * Math.PI) / 180) * 6, -2, '+x', 'concrete');
  m.wedge(20, 0, 4, 22, Math.tan((60 * Math.PI) / 180) * 2, 6, '+x', 'concrete');
  // Low ceiling tunnel for crouching: roof underside at 1.4 m.
  m.box(-30, 1.4, -30, -26, 2, -20, 'concrete');
  return new CollisionWorld(m.brushes);
}

function run(mover: Mover, st: MoveState, cmd: MoveCmd, seconds: number) {
  const steps = Math.round(seconds / SIM_DT);
  const events = [];
  for (let i = 0; i < steps; i++) events.push(mover.step(st, cmd, SIM_DT));
  return events;
}

function settle(mover: Mover, st: MoveState) {
  run(mover, st, emptyCmd(), 0.5);
}

describe('ground movement', () => {
  const w = testWorld();

  it('reaches walk speed quickly and stops crisply', () => {
    const mover = new Mover(w);
    const st = newMoveState(0, 0.5, 0);
    settle(mover, st);
    expect(st.onGround).toBe(true);
    expect(st.y).toBeCloseTo(0, 2);
    const cmd = { ...emptyCmd(), forward: 1, yaw: Math.PI / 2 }; // facing -x
    let t90 = -1;
    for (let i = 0; i < 120; i++) {
      mover.step(st, cmd, SIM_DT);
      if (t90 < 0 && Math.hypot(st.vx, st.vz) >= T.walkSpeed * 0.9) t90 = (i + 1) * SIM_DT;
    }
    expect(Math.hypot(st.vx, st.vz)).toBeCloseTo(T.walkSpeed, 1);
    expect(t90).toBeGreaterThan(0.05);
    expect(t90).toBeLessThan(0.25);
    const x0 = st.x;
    let tStop = -1;
    for (let i = 0; i < 120; i++) {
      mover.step(st, emptyCmd(), SIM_DT);
      if (tStop < 0 && Math.hypot(st.vx, st.vz) === 0) tStop = (i + 1) * SIM_DT;
    }
    expect(tStop).toBeGreaterThan(0.05);
    expect(tStop).toBeLessThan(0.3);
    expect(Math.abs(st.x - x0)).toBeLessThan(0.8);
  });

  it('cannot walk through a wall and keeps its distance', () => {
    const mover = new Mover(w);
    const st = newMoveState(0, 0, -5);
    settle(mover, st);
    run(mover, st, { ...emptyCmd(), forward: 1, sprint: true }, 3);
    expect(st.z).toBeGreaterThan(-10 + T.radius - 0.01);
    expect(st.z).toBeLessThan(-10 + T.radius + 0.02);
  });

  it('slides along a wall when walking into it at an angle', () => {
    const mover = new Mover(w);
    const st = newMoveState(0, 0, -9);
    settle(mover, st);
    run(mover, st, { ...emptyCmd(), forward: 1, yaw: Math.PI / 4 }, 1);
    // Moved sideways (-x) at roughly walkSpeed * cos(45 deg).
    expect(st.x).toBeLessThan(-2.5);
    expect(st.z).toBeGreaterThan(-10);
  });

  it('steps up a 0.3 m step but not a 0.8 m crate', () => {
    const mover = new Mover(w);
    const st = newMoveState(10, 0, -1);
    settle(mover, st);
    const events = run(mover, st, { ...emptyCmd(), forward: 1 }, 1.2);
    expect(st.y).toBeCloseTo(0.3, 1);
    expect(events.some((e) => e.stepped > 0.2)).toBe(true);

    const st2 = newMoveState(10, 0, 1);
    settle(mover, st2);
    run(mover, st2, { ...emptyCmd(), forward: -1 }, 1.2);
    expect(st2.y).toBeCloseTo(0, 2);
    expect(st2.z).toBeLessThan(4 - T.radius + 0.02);
  });

  it('jumps onto the 0.8 m crate', () => {
    const mover = new Mover(w);
    const st = newMoveState(10, 0, 2.5);
    settle(mover, st);
    const cmd = { ...emptyCmd(), forward: -1 };
    let landedAt = -1;
    for (let i = 0; i < 120; i++) {
      const ev = mover.step(st, i >= 12 && i < 20 ? { ...cmd, jump: true } : cmd, SIM_DT);
      if (ev.landed > 0) {
        landedAt = st.y;
        break;
      }
    }
    expect(landedAt).toBeCloseTo(0.8, 1);
    expect(st.onGround).toBe(true);
  });

  it('jump height matches v^2/2g', () => {
    const mover = new Mover(w);
    const st = newMoveState(0, 0, 0);
    settle(mover, st);
    let maxY = 0;
    run(mover, st, { ...emptyCmd(), jump: true }, SIM_DT);
    for (let i = 0; i < 240; i++) {
      mover.step(st, emptyCmd(), SIM_DT);
      maxY = Math.max(maxY, st.y);
    }
    const expected = (T.jumpVelocity * T.jumpVelocity) / (2 * T.gravity);
    expect(maxY).toBeGreaterThan(expected - 0.05);
    expect(maxY).toBeLessThan(expected + 0.05);
    expect(st.onGround).toBe(true);
  });

  it('walks up and down stairs staying grounded', () => {
    const mover = new Mover(w);
    const st = newMoveState(-6, 0, 11);
    settle(mover, st);
    const up = { ...emptyCmd(), forward: 1, yaw: Math.PI / 2 };
    let airborne = 0;
    for (let i = 0; i < 216; i++) {
      mover.step(st, up, SIM_DT);
      if (!st.onGround) airborne++;
    }
    expect(st.x).toBeLessThan(-14);
    expect(st.y).toBeCloseTo(2, 1);
    expect(airborne).toBe(0);
    const down = { ...up, forward: -1 };
    for (let i = 0; i < 260; i++) {
      mover.step(st, down, SIM_DT);
      if (!st.onGround) airborne++;
    }
    expect(st.x).toBeGreaterThan(-7.5);
    expect(st.y).toBeCloseTo(0, 1);
    expect(airborne).toBe(0);
  });

  it('walks up a 25 degree ramp at full speed but slides off a 60 degree one', () => {
    const mover = new Mover(w);
    const st = newMoveState(18, 0, -3);
    settle(mover, st);
    const cmd = { ...emptyCmd(), forward: 1, yaw: -Math.PI / 2 }; // facing +x
    run(mover, st, cmd, 0.4);
    const speeds: number[] = [];
    for (let i = 0; i < 120; i++) {
      mover.step(st, cmd, SIM_DT);
      if (st.x > 21 && st.x < 25) speeds.push(Math.hypot(st.vx, st.vy, st.vz));
    }
    expect(st.y).toBeGreaterThan(1.5);
    expect(Math.min(...speeds)).toBeGreaterThan(T.walkSpeed * 0.9);

    const st2 = newMoveState(18, 0, 5);
    settle(mover, st2);
    run(mover, st2, cmd, 2);
    expect(st2.y).toBeLessThan(0.6);
  });

  it('crouches under a low ceiling and cannot stand until out', () => {
    const mover = new Mover(w);
    const st = newMoveState(-28, 0, -15);
    settle(mover, st);
    const cmd = { ...emptyCmd(), forward: 1, crouch: true };
    run(mover, st, cmd, 3);
    expect(st.crouched).toBe(true);
    expect(st.z).toBeLessThan(-20);
    // Stand up while still under the roof: blocked.
    run(mover, st, { ...emptyCmd(), crouch: false }, 0.2);
    expect(st.crouched).toBe(true);
    run(mover, st, { ...emptyCmd(), forward: 1, crouch: false }, 5);
    expect(st.z).toBeLessThan(-30);
    expect(st.crouched).toBe(false);
  });

  it('is deterministic and never ends inside solid on random walks', () => {
    const a = randomWalk(w, 99);
    const b = randomWalk(w, 99);
    expect(a.trace).toEqual(b.trace);
    expect(a.stuck).toBe(0);
  });
});

function randomWalk(w: CollisionWorld, seed: number) {
  const mover = new Mover(w);
  const rnd = makeRng(seed);
  const st = newMoveState(0, 0, 0);
  const cmd = emptyCmd();
  const trace: number[] = [];
  let stuck = 0;
  for (let i = 0; i < 6000; i++) {
    if (i % 30 === 0) {
      cmd.forward = Math.round(rnd() * 2 - 1);
      cmd.right = Math.round(rnd() * 2 - 1);
      cmd.yaw = rnd() * Math.PI * 2;
      cmd.jump = rnd() < 0.2;
      cmd.crouch = rnd() < 0.15;
      cmd.sprint = rnd() < 0.5;
    }
    mover.step(st, cmd, SIM_DT);
    const h = st.crouched ? T.crouchHeight : T.standHeight;
    if (w.testBox(st.x, st.y + h / 2, st.z, T.radius - 0.002, h / 2 - 0.002, T.radius - 0.002, MASK.MOVE)) stuck++;
    if (i % 100 === 0) trace.push(Math.round(st.x * 1000), Math.round(st.y * 1000), Math.round(st.z * 1000));
  }
  return { trace, stuck };
}

describe('ledge assist', () => {
  function ledgeWorld(h: number) {
    const m = new MapBuilder();
    m.box(-20, -1, -20, 20, 0, 20, 'grass');
    m.box(-3, 0, -14, 3, h, -4, 'concrete');
    m.box(10, 0, -6, 14, 3, -4, 'concrete');
    return new CollisionWorld(m.brushes);
  }

  function jumpAt(world: CollisionWorld, x: number, z: number, runUp: number) {
    const mover = new Mover(world);
    const st = newMoveState(x, 0, z);
    for (let i = 0; i < 60; i++) mover.step(st, emptyCmd(), SIM_DT);
    const cmd = { ...emptyCmd(), forward: 1 };
    for (let i = 0; i < Math.round(runUp / SIM_DT); i++) mover.step(st, cmd, SIM_DT);
    let maxY = 0;
    for (let i = 0; i < 150; i++) {
      mover.step(st, { ...cmd, jump: i < 3 }, SIM_DT);
      maxY = Math.max(maxY, st.y);
    }
    return { st, maxY };
  }

  it('clears a ledge a little above the jump apex, from a run-up and from standing against it', () => {
    const w = ledgeWorld(1.04);
    const run = jumpAt(w, 0, -1.5, 0.15);
    expect(run.st.y).toBeCloseTo(1.04, 1);
    const pressed = jumpAt(w, 0, -3.62, 0.3);
    expect(pressed.st.y).toBeCloseTo(1.04, 1);
  });

  it('does not clear a ledge well above the apex', () => {
    const w = ledgeWorld(1.15);
    const r = jumpAt(w, 0, -1.5, 0.15);
    expect(r.st.y).toBeLessThan(0.1);
  });

  it('gains no extra height against a tall wall', () => {
    const w = ledgeWorld(1.05);
    const r = jumpAt(w, 12, -3.62, 0.3);
    const apex = (TUNING.move.jumpVelocity * TUNING.move.jumpVelocity) / (2 * TUNING.move.gravity);
    expect(r.maxY).toBeLessThan(apex + 0.03);
  });
});

describe('ledge assist smoothing', () => {
  it('reports the lift as a step and keeps forward speed over the ledge', () => {
    const m = new MapBuilder();
    m.box(-20, -1, -20, 20, 0, 20, 'grass');
    m.box(-3, 0, -14, 3, 1.04, -4, 'concrete');
    const w = new CollisionWorld(m.brushes);
    const mover = new Mover(w);
    const st = newMoveState(0, 0, -1.5);
    for (let i = 0; i < 60; i++) mover.step(st, emptyCmd(), SIM_DT);
    const cmd = { ...emptyCmd(), forward: 1 };
    for (let i = 0; i < 18; i++) mover.step(st, cmd, SIM_DT);
    let lift = 0;
    let minSpeedAfter = Infinity;
    let onLedge = false;
    for (let i = 0; i < 120; i++) {
      const ev = mover.step(st, { ...cmd, jump: i < 3 }, SIM_DT);
      if (ev.stepped > 0) lift = Math.max(lift, ev.stepped);
      if (onLedge) minSpeedAfter = Math.min(minSpeedAfter, Math.hypot(st.vx, st.vz));
      if (st.y > 1.0) onLedge = true;
    }
    expect(onLedge).toBe(true);
    expect(lift).toBeGreaterThan(0.01);
    expect(minSpeedAfter).toBeGreaterThan(2);
  });
});
