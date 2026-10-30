import { UI } from '../shared/ui';
import { DEFAULT_BINDINGS, type Action, type Bindings } from './bindings';

/**
 * The controls the player is using, for every hint that names a key: the keyboard and mouse, or a
 * controller, named as PlayStation or Xbox buttons. Hints follow whichever was used last, and the
 * player's bindings.
 */

export type Device = 'keyboard' | 'playstation' | 'xbox';
export type PadMake = Exclude<Device, 'keyboard'>;

/** The controls hints can name, as `{reload}` and the like. */
export const CONTROLS = ['move', 'look', 'fire', 'aim', 'sprint', 'jump', 'crouch', 'weapons', 'rifle', 'grenade', 'knife', 'inspect', 'scoreboard', 'reload', 'use', 'menu'] as const;
export type Control = (typeof CONTROLS)[number];

let current: Device = 'keyboard';
let lastPad: PadMake = 'xbox';
let bindings: Bindings = DEFAULT_BINDINGS;
const listeners = new Set<() => void>();
const changed = () => {
  for (const f of listeners) f();
};

export function device(): Device {
  return current;
}

/** The make of the controller used last (Xbox until one is): its button names in Settings → Controls. */
export function padMake(): PadMake {
  return lastPad;
}

export function setDevice(d: Device): void {
  if (d !== 'keyboard') lastPad = d;
  if (d === current) return;
  current = d;
  changed();
}

export function setBindings(b: Bindings): void {
  bindings = b;
  changed();
}

/** Calls `f` whenever the device or the bindings change; returns the unsubscribe. */
export function onControls(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * A controller's make, by the name the browser gives it (Chrome adds the USB vendor ID): Xbox for
 * Microsoft's (045e) or a name with Xbox or XInput in it, PlayStation for Sony's (054c) or a
 * DualSense or DualShock (macOS calls the DualShock 4 "Wireless Controller"). Any other pad gets
 * Xbox names: most PC pads copy its layout.
 */
export function padKind(id: string): PadMake {
  if (/045e|xbox|xinput/i.test(id)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock|wireless controller/i.test(id)) return 'playstation';
  return 'xbox';
}

/** A key's name (`long`: telling left from right, as Settings → Controls does). */
export function keyName(code: string, long = false): string {
  const N = UI.keyNames;
  return (long ? N.long[code] : undefined) ?? N.short[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
}

/** A controller button's name on `make`. */
export function buttonName(i: number, make: PadMake): string {
  return UI.keyNames[make][i] ?? `#${i}`;
}

/** What an action is bound to on `d`, as names (each once, in slot order). */
function boundNames(a: Action, d: Device): string[] {
  const names = d === 'keyboard' ? bindings.keys[a].map((c) => keyName(c)) : bindings.buttons[a].map((i) => buttonName(i, d));
  return [...new Set(names)];
}

const joined = (names: string[]) => (names.length ? names.join(' / ') : UI.keyNames.unbound);

/** A control's key or button on `d`, from the bindings. */
export function key(c: Control, d: Device = current): string {
  const N = UI.keyNames;
  const pad = d !== 'keyboard';
  switch (c) {
    case 'move': {
      if (pad) return N.leftStick;
      const names = (['forward', 'left', 'back', 'right'] as const).map((a) => boundNames(a, d)[0] ?? N.unbound);
      // WASD: single letters and digits read as one word.
      return names.every((n) => /^[A-Z0-9]$/.test(n)) ? names.join('') : names.join(' / ');
    }
    case 'look':
      return pad ? N.rightStick : N.mouse;
    case 'menu':
      return N.menu[d === 'playstation' ? 1 : d === 'xbox' ? 2 : 0];
    case 'weapons': {
      if (!pad) return [...(['pistol', 'rifle', 'sniper'] as const).map((a) => boundNames(a, d)[0] ?? N.unbound), N.wheel].join(' / ');
      const names = [...boundNames('nextWeapon', d), ...boundNames('prevWeapon', d)];
      // The D-pad's two sides read as one: "D-pad ← →".
      const l = names.indexOf(N[d][14]!);
      const r = names.indexOf(N[d][15]!);
      if (l >= 0 && r >= 0) {
        names[Math.min(l, r)] = 'D-pad ← →';
        names.splice(Math.max(l, r), 1);
      }
      return joined(names);
    }
    case 'rifle':
      return boundNames(pad ? 'nextWeapon' : 'rifle', d)[0] ?? N.unbound;
    default:
      return joined(boundNames(c, d));
  }
}

/** Fills a hint's `{reload}`-style controls in for `d`; other placeholders are left alone. */
export function withKeys(text: string, d: Device = current): string {
  return text.replace(/\{(\w+)\}/g, (m, c: string) => ((CONTROLS as readonly string[]).includes(c) ? key(c as Control, d) : m));
}

/** A hint with its controller wording when a controller is in use and it has one. */
export function hint(keyboard: string, pad: string | undefined, d: Device = current): string {
  return withKeys(d !== 'keyboard' && pad !== undefined ? pad : keyboard, d);
}
