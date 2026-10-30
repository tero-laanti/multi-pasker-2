import { UI } from '../shared/ui';

/**
 * The controls the player is using, for every hint that names a key: the keyboard and mouse, or a
 * controller, named as PlayStation or Xbox buttons. Hints follow whichever was used last.
 */

export type Device = 'keyboard' | 'playstation' | 'xbox';
export type Control = keyof typeof UI.keys;

let current: Device = 'keyboard';
const listeners = new Set<(d: Device) => void>();

export function device(): Device {
  return current;
}

export function setDevice(d: Device): void {
  if (d === current) return;
  current = d;
  for (const f of listeners) f(d);
}

/** Calls `f` whenever the device changes; returns the unsubscribe. */
export function onDevice(f: (d: Device) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * A controller's make, by the name the browser gives it (Chrome adds the USB vendor ID): Xbox for
 * Microsoft's (045e) or a name with Xbox or XInput in it, PlayStation for Sony's (054c) or a
 * DualSense or DualShock (macOS calls the DualShock 4 "Wireless Controller"). Any other pad gets
 * Xbox names: most PC pads copy its layout.
 */
export function padKind(id: string): 'playstation' | 'xbox' {
  if (/045e|xbox|xinput/i.test(id)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock|wireless controller/i.test(id)) return 'playstation';
  return 'xbox';
}

/** A control's key or button on `d`. */
export function key(c: Control, d: Device = current): string {
  const [keyboard, playstation, xbox] = UI.keys[c];
  return d === 'playstation' ? playstation : d === 'xbox' ? xbox : keyboard;
}

/** Fills a hint's `{reload}`-style controls in for `d`; other placeholders are left alone. */
export function withKeys(text: string, d: Device = current): string {
  return text.replace(/\{(\w+)\}/g, (m, c: string) => (c in UI.keys ? key(c as Control, d) : m));
}

/** A hint with its controller wording when a controller is in use and it has one. */
export function hint(keyboard: string, pad: string | undefined, d: Device = current): string {
  return withKeys(d !== 'keyboard' && pad !== undefined ? pad : keyboard, d);
}
