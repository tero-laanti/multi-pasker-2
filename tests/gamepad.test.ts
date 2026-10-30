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
    const s = new PadReader().read(pad([BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.RB, BUTTON.VIEW, BUTTON.DOWN]), 0);
    expect([...s.keys].sort()).toEqual(['KeyC', 'KeyE', 'KeyG', 'KeyI', 'KeyR', 'Space', 'Tab']);
  });

  it('knifes from LB and from R3', () => {
    expect(new PadReader().read(pad([BUTTON.LB]), 0).keys.has('KeyV')).toBe(true);
    expect(new PadReader().read(pad([BUTTON.R3]), 0).keys.has('KeyV')).toBe(true);
  });

  it('fires and aims on the triggers past their threshold', () => {
    const r = new PadReader();
    const light = pad();
    (light.buttons as { pressed: boolean; value: number }[])[BUTTON.RT] = { pressed: true, value: PAD.trigger / 2 };
    expect(r.read(light, 0).fire).toBe(false);
    const s = r.read(pad([BUTTON.RT, BUTTON.LT]), 0);
    expect(s.fire).toBe(true);
    expect(s.aim).toBe(true);
  });

  it('counts a press once, on the frame it goes down', () => {
    const r = new PadReader();
    expect(r.read(pad([BUTTON.START]), 0).pressed.has(BUTTON.START)).toBe(true);
    expect(r.read(pad([BUTTON.START]), 0).pressed.has(BUTTON.START)).toBe(false);
    r.read(pad(), 0);
    expect(r.read(pad([BUTTON.START]), 0).pressed.has(BUTTON.START)).toBe(true);
  });

  it('moves forward on the stick pushed up', () => {
    const s = new PadReader().read(pad([], [0, -1, 0, 0]), 0);
    expect(s.forward).toBeCloseTo(1, 5);
    expect(s.right).toBe(0);
  });

  it('steps weapons on Y and the D-pad', () => {
    const r = new PadReader();
    expect(r.read(pad([BUTTON.Y]), 0).wheel).toBe(1);
    expect(r.read(pad([BUTTON.Y, BUTTON.LEFT]), 0).wheel).toBe(-1);
    expect(r.read(pad([BUTTON.RIGHT]), 0).wheel).toBe(1);
  });

  it('sprints from a click of L3 while the stick points forward, until it lets go, fires or aims', () => {
    const r = new PadReader();
    const ahead = [0, -1, 0, 0];
    expect(r.read(pad([], ahead), 0).keys.has('ShiftLeft')).toBe(false);
    expect(r.read(pad([BUTTON.L3], ahead), 0).keys.has('ShiftLeft')).toBe(true);
    // L3 let go: still sprinting while the stick stays forward.
    expect(r.read(pad([], ahead), 0).keys.has('ShiftLeft')).toBe(true);
    expect(r.read(pad([], [0, -0.3, 0, 0]), 0).keys.has('ShiftLeft')).toBe(false);
    expect(r.read(pad([], ahead), 0).keys.has('ShiftLeft')).toBe(false);
    r.read(pad([BUTTON.L3], ahead), 0);
    expect(r.read(pad([BUTTON.RT], ahead), 0).keys.has('ShiftLeft')).toBe(false);
  });

  it('is not used by sticks drifting short of the wake threshold', () => {
    const r = new PadReader();
    expect(r.read(pad([], [0.3, 0.2, -0.3, 0.25]), 0).used).toBe(false);
    expect(r.read(pad([], [0, 0, 0.8, 0]), 0).used).toBe(true);
    expect(new PadReader().read(pad([BUTTON.A]), 0).used).toBe(true);
  });
});

describe('menu steps', () => {
  it('come once on a D-pad press, then repeat while it is held', () => {
    const r = new PadReader();
    expect(r.read(pad([BUTTON.DOWN]), 0).nav).toBe('down');
    expect(r.read(pad([BUTTON.DOWN]), 0.2).nav).toBe(null);
    expect(r.read(pad([BUTTON.DOWN]), PAD.navDelay + 0.01).nav).toBe('down');
    expect(r.read(pad([BUTTON.DOWN]), PAD.navDelay + 0.05).nav).toBe(null);
    expect(r.read(pad([BUTTON.DOWN]), PAD.navDelay + PAD.navRepeat + 0.02).nav).toBe('down');
    expect(r.read(pad(), 1).nav).toBe(null);
    expect(r.read(pad([BUTTON.UP]), 1.01).nav).toBe('up');
  });

  it('come from the left stick pushed firmly, in its main direction', () => {
    expect(new PadReader().read(pad([], [0.3, 0.5, 0, 0]), 0).nav).toBe(null);
    expect(new PadReader().read(pad([], [0.9, 0.3, 0, 0]), 0).nav).toBe('right');
    expect(new PadReader().read(pad([], [0.2, -0.8, 0, 0]), 0).nav).toBe('up');
  });
});
