import { PAD } from '../shared/config';
import { ACTIONS, type Action, type Bindings } from './bindings';

/**
 * A game controller in the Gamepad API's standard mapping (Xbox and PlayStation pads in Chrome
 * and Edge). Its buttons do what the player's bindings say (bindings.ts, the game's own controls
 * by default); the left stick moves and the right stick turns.
 */

/** Standard-mapping button indices. */
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export type NavDir = 'up' | 'down' | 'left' | 'right';

/** What the game reads of a gamepad: its buttons and its four axes. */
export interface PadLike {
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

/** One frame of a controller, as the game's controls. */
export interface PadState {
  /** Actions held, and pressed since the last frame, through their bound buttons. */
  held: Set<Action>;
  hit: Set<Action>;
  /** Left stick: -1..1 forward and right. */
  forward: number;
  right: number;
  /** Right stick past its dead zone and curve: -1..1 right and down. */
  lookX: number;
  lookY: number;
  /** Buttons pressed since the last frame. */
  pressed: Set<number>;
  /** Used this frame: a button pressed or a stick pushed past PAD.wake. */
  used: boolean;
  /** A step through a menu this frame (the D-pad or the left stick; held, it repeats). */
  nav: NavDir | null;
}

/** A stick past its radial dead zone, rescaled to start from 0, its length raised to `curve`. */
export function stick(x: number, y: number, deadZone: number, curve: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= deadZone) return [0, 0];
  const k = Math.pow(Math.min(1, (m - deadZone) / (1 - deadZone)), curve) / m;
  return [x * k, y * k];
}

/** Reads a controller frame by frame: its button presses, and sprint, which a click turns on. */
export class PadReader {
  private down: boolean[] = [];
  private sprint = false;
  private navDir: NavDir | null = null;
  private navAt = 0;

  /** One frame of `pad` at time `t` (seconds), its buttons bound as `buttons` says. */
  read(pad: PadLike, t: number, buttons: Bindings['buttons']): PadState {
    // The triggers are analog: pulled past PAD.trigger.
    const isDown = (i: number) => (i === BUTTON.LT || i === BUTTON.RT ? (pad.buttons[i]?.value ?? 0) > PAD.trigger : pad.buttons[i]?.pressed === true);
    const now = pad.buttons.map((_, i) => isDown(i));
    const pressed = new Set<number>();
    for (let i = 0; i < now.length; i++) if (now[i] && !this.down[i]) pressed.add(i);
    this.down = now;
    const ax = (i: number) => pad.axes[i] ?? 0;
    const [right, back] = stick(ax(0), ax(1), PAD.deadZone, 1);
    const [lookX, lookY] = stick(ax(2), ax(3), PAD.deadZone, PAD.lookCurve);
    const forward = back === 0 ? 0 : -back;
    const held = new Set<Action>();
    const hit = new Set<Action>();
    for (const a of ACTIONS) {
      for (const i of buttons[a]) {
        if (now[i]) held.add(a);
        if (pressed.has(i)) hit.add(a);
      }
    }
    // Sprint as in Call of Duty: a click turns it on and it lasts while the stick points forward,
    // until the gun fires or aims.
    if (hit.has('sprint')) this.sprint = true;
    if (forward < PAD.sprintForward || held.has('fire') || held.has('aim')) this.sprint = false;
    if (this.sprint) held.add('sprint');
    else held.delete('sprint');
    const used = pressed.size > 0 || Math.hypot(ax(0), ax(1)) > PAD.wake || Math.hypot(ax(2), ax(3)) > PAD.wake;
    return { held, hit, forward, right, lookX, lookY, pressed, used, nav: this.navStep(now, ax(0), ax(1), t) };
  }

  /** Menu steps: the D-pad, or the left stick pushed past PAD.navStick; held, a step repeats. */
  private navStep(now: boolean[], x: number, y: number, t: number): NavDir | null {
    const pushed = Math.max(Math.abs(x), Math.abs(y)) < PAD.navStick ? null : Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'up' : 'down') : x < 0 ? 'left' : 'right';
    const dir: NavDir | null = now[BUTTON.UP] ? 'up' : now[BUTTON.DOWN] ? 'down' : now[BUTTON.LEFT] ? 'left' : now[BUTTON.RIGHT] ? 'right' : pushed;
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navAt = t + PAD.navDelay;
      return dir;
    }
    if (dir && t >= this.navAt) {
      this.navAt = t + PAD.navRepeat;
      return dir;
    }
    return null;
  }
}
