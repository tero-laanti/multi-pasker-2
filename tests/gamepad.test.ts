import { describe, expect, it } from 'vitest';
import { bind, DEFAULT_BINDINGS } from '../src/client/bindings';
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
  const B = DEFAULT_BINDINGS.buttons;
  const held = (s: { held: Set<string> }) => [...s.held].sort();

  it('holds the actions its buttons are bound to', () => {
    const s = new PadReader().read(pad([BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.RB, BUTTON.VIEW, BUTTON.DOWN]), 0, B);
    expect(held(s)).toEqual(['crouch', 'grenade', 'inspect', 'jump', 'reload', 'scoreboard', 'use']);
  });

  it('knifes from LB and from R3', () => {
    expect(new PadReader().read(pad([BUTTON.LB]), 0, B).held.has('knife')).toBe(true);
    expect(new PadReader().read(pad([BUTTON.R3]), 0, B).held.has('knife')).toBe(true);
  });

  it('fires and aims on the triggers past their threshold', () => {
    const r = new PadReader();
    const light = pad();
    (light.buttons as { pressed: boolean; value: number }[])[BUTTON.RT] = { pressed: true, value: PAD.trigger / 2 };
    expect(r.read(light, 0, B).held.has('fire')).toBe(false);
    const s = r.read(pad([BUTTON.RT, BUTTON.LT]), 0, B);
    expect(s.held.has('fire')).toBe(true);
    expect(s.held.has('aim')).toBe(true);
    expect(s.hit.has('fire')).toBe(true);
  });

  it('counts a press once, on the frame it goes down', () => {
    const r = new PadReader();
    const first = r.read(pad([BUTTON.START, BUTTON.A]), 0, B);
    expect(first.pressed.has(BUTTON.START)).toBe(true);
    expect(first.hit.has('jump')).toBe(true);
    const again = r.read(pad([BUTTON.START, BUTTON.A]), 0, B);
    expect(again.pressed.has(BUTTON.START)).toBe(false);
    expect(again.hit.has('jump')).toBe(false);
    r.read(pad(), 0, B);
    expect(r.read(pad([BUTTON.START]), 0, B).pressed.has(BUTTON.START)).toBe(true);
  });

  it('moves forward on the stick pushed up', () => {
    const s = new PadReader().read(pad([], [0, -1, 0, 0]), 0, B);
    expect(s.forward).toBeCloseTo(1, 5);
    expect(s.right).toBe(0);
  });

  it('steps weapons on Y and the D-pad', () => {
    expect(new PadReader().read(pad([BUTTON.Y]), 0, B).hit.has('nextWeapon')).toBe(true);
    expect(new PadReader().read(pad([BUTTON.RIGHT]), 0, B).hit.has('nextWeapon')).toBe(true);
    expect(new PadReader().read(pad([BUTTON.LEFT]), 0, B).hit.has('prevWeapon')).toBe(true);
  });

  it('sprints from a click of L3 while the stick points forward, until it lets go, fires or aims', () => {
    const r = new PadReader();
    const ahead = [0, -1, 0, 0];
    expect(r.read(pad([], ahead), 0, B).held.has('sprint')).toBe(false);
    expect(r.read(pad([BUTTON.L3], ahead), 0, B).held.has('sprint')).toBe(true);
    // L3 let go: still sprinting while the stick stays forward.
    expect(r.read(pad([], ahead), 0, B).held.has('sprint')).toBe(true);
    expect(r.read(pad([], [0, -0.3, 0, 0]), 0, B).held.has('sprint')).toBe(false);
    expect(r.read(pad([], ahead), 0, B).held.has('sprint')).toBe(false);
    r.read(pad([BUTTON.L3], ahead), 0, B);
    expect(r.read(pad([BUTTON.RT], ahead), 0, B).held.has('sprint')).toBe(false);
  });

  it('is not used by sticks drifting short of the wake threshold', () => {
    const r = new PadReader();
    expect(r.read(pad([], [0.3, 0.2, -0.3, 0.25]), 0, B).used).toBe(false);
    expect(r.read(pad([], [0, 0, 0.8, 0]), 0, B).used).toBe(true);
    expect(new PadReader().read(pad([BUTTON.A]), 0, B).used).toBe(true);
  });

  it('follows the player’s bindings', () => {
    const b = bind(DEFAULT_BINDINGS, 'buttons', 'jump', 0, BUTTON.Y).buttons;
    expect(new PadReader().read(pad([BUTTON.Y]), 0, b).held.has('jump')).toBe(true);
    expect(new PadReader().read(pad([BUTTON.Y]), 0, b).held.has('nextWeapon')).toBe(false);
    expect(new PadReader().read(pad([BUTTON.A]), 0, b).held.has('jump')).toBe(false);
  });
});

describe('menu steps', () => {
  it('come once on a D-pad press, then repeat while it is held', () => {
    const r = new PadReader();
    expect(r.read(pad([BUTTON.DOWN]), 0, DEFAULT_BINDINGS.buttons).nav).toBe('down');
    expect(r.read(pad([BUTTON.DOWN]), 0.2, DEFAULT_BINDINGS.buttons).nav).toBe(null);
    expect(r.read(pad([BUTTON.DOWN]), PAD.navDelay + 0.01, DEFAULT_BINDINGS.buttons).nav).toBe('down');
    expect(r.read(pad([BUTTON.DOWN]), PAD.navDelay + 0.05, DEFAULT_BINDINGS.buttons).nav).toBe(null);
    expect(r.read(pad([BUTTON.DOWN]), PAD.navDelay + PAD.navRepeat + 0.02, DEFAULT_BINDINGS.buttons).nav).toBe('down');
    expect(r.read(pad(), 1, DEFAULT_BINDINGS.buttons).nav).toBe(null);
    expect(r.read(pad([BUTTON.UP]), 1.01, DEFAULT_BINDINGS.buttons).nav).toBe('up');
  });

  it('come from the left stick pushed firmly, in its main direction', () => {
    expect(new PadReader().read(pad([], [0.3, 0.5, 0, 0]), 0, DEFAULT_BINDINGS.buttons).nav).toBe(null);
    expect(new PadReader().read(pad([], [0.9, 0.3, 0, 0]), 0, DEFAULT_BINDINGS.buttons).nav).toBe('right');
    expect(new PadReader().read(pad([], [0.2, -0.8, 0, 0]), 0, DEFAULT_BINDINGS.buttons).nav).toBe('up');
  });
});
