import { describe, expect, it } from 'vitest';
import { BUTTON, PadReader, stick, type PadLike } from '../src/client/gamepad';
import { PAD } from '../src/shared/config';

/** A standard-mapping pad with these buttons held (triggers fully) and these axes. */
function pad(held: number[] = [], axes: number[] = [0, 0, 0, 0]): PadLike {
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
    axes,
  };
}

describe('a stick', () => {
  it('reads nothing inside its dead zone, and starts from zero past it', () => {
    expect(stick(0.1, -0.08, 0.15, 1)).toEqual([0, 0]);
    const [x] = stick(0.16, 0, 0.15, 1);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.02);
  });

  it('reaches full length at full deflection, with or without a curve', () => {
    for (const curve of [1, 2]) {
      const [x, y] = stick(Math.SQRT1_2, Math.SQRT1_2, 0.15, curve);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 5);
    }
  });

  it('turns slower at half deflection with the look curve', () => {
    const [linear] = stick(0.575, 0, 0.15, 1);
    const [curved] = stick(0.575, 0, 0.15, 2);
    expect(linear).toBeCloseTo(0.5, 5);
    expect(curved).toBeCloseTo(0.25, 5);
  });
});

describe('a controller', () => {
  it('holds the keys its buttons stand for', () => {
    const s = new PadReader().read(pad([BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.RB, BUTTON.VIEW, BUTTON.DOWN]));
    expect([...s.keys].sort()).toEqual(['KeyC', 'KeyE', 'KeyG', 'KeyI', 'KeyR', 'Space', 'Tab']);
  });

  it('knifes from LB and from R3', () => {
    expect(new PadReader().read(pad([BUTTON.LB])).keys.has('KeyV')).toBe(true);
    expect(new PadReader().read(pad([BUTTON.R3])).keys.has('KeyV')).toBe(true);
  });

  it('fires and aims on the triggers past their threshold', () => {
    const r = new PadReader();
    const light = pad();
    (light.buttons as { pressed: boolean; value: number }[])[BUTTON.RT] = { pressed: true, value: PAD.trigger / 2 };
    expect(r.read(light).fire).toBe(false);
    const s = r.read(pad([BUTTON.RT, BUTTON.LT]));
    expect(s.fire).toBe(true);
    expect(s.aim).toBe(true);
  });

  it('counts a press once, on the frame it goes down', () => {
    const r = new PadReader();
    expect(r.read(pad([BUTTON.START])).pressed.has(BUTTON.START)).toBe(true);
    expect(r.read(pad([BUTTON.START])).pressed.has(BUTTON.START)).toBe(false);
    r.read(pad());
    expect(r.read(pad([BUTTON.START])).pressed.has(BUTTON.START)).toBe(true);
  });

  it('moves forward on the stick pushed up', () => {
    const s = new PadReader().read(pad([], [0, -1, 0, 0]));
    expect(s.forward).toBeCloseTo(1, 5);
    expect(s.right).toBe(0);
  });

  it('steps weapons on Y and the D-pad', () => {
    const r = new PadReader();
    expect(r.read(pad([BUTTON.Y])).wheel).toBe(1);
    expect(r.read(pad([BUTTON.Y, BUTTON.LEFT])).wheel).toBe(-1);
    expect(r.read(pad([BUTTON.RIGHT])).wheel).toBe(1);
  });

  it('sprints from a click of L3 while the stick points forward, until it lets go, fires or aims', () => {
    const r = new PadReader();
    const ahead = [0, -1, 0, 0];
    expect(r.read(pad([], ahead)).keys.has('ShiftLeft')).toBe(false);
    expect(r.read(pad([BUTTON.L3], ahead)).keys.has('ShiftLeft')).toBe(true);
    // L3 let go: still sprinting while the stick stays forward.
    expect(r.read(pad([], ahead)).keys.has('ShiftLeft')).toBe(true);
    expect(r.read(pad([], [0, -0.3, 0, 0])).keys.has('ShiftLeft')).toBe(false);
    expect(r.read(pad([], ahead)).keys.has('ShiftLeft')).toBe(false);
    r.read(pad([BUTTON.L3], ahead));
    expect(r.read(pad([BUTTON.RT], ahead)).keys.has('ShiftLeft')).toBe(false);
  });

  it('is not used by sticks drifting short of the wake threshold', () => {
    const r = new PadReader();
    expect(r.read(pad([], [0.3, 0.2, -0.3, 0.25])).used).toBe(false);
    expect(r.read(pad([], [0, 0, 0.8, 0])).used).toBe(true);
    expect(new PadReader().read(pad([BUTTON.A])).used).toBe(true);
  });
});
