/**
 * What each key, mouse button and controller button does: the actions a player can bind, and
 * their bindings. The defaults are the game's own controls; Settings → Controls changes them.
 * Keys are `event.code` (physical positions), mouse buttons Mouse0–Mouse4, controller buttons the
 * standard mapping's indices.
 */

export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'sprint',
  'fire',
  'aim',
  'pistol',
  'rifle',
  'sniper',
  'nextWeapon',
  'prevWeapon',
  'grenade',
  'knife',
  'inspect',
  'reload',
  'use',
  'scoreboard',
] as const;
export type Action = (typeof ACTIONS)[number];

export interface Bindings {
  /** Keys and mouse buttons, up to two per action. */
  keys: Record<Action, string[]>;
  /** Controller buttons, up to two per action. */
  buttons: Record<Action, number[]>;
}

/** Bindings per action: the keyboard's and the controller's two slots. */
export const SLOTS = 2;

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    forward: ['KeyW'],
    back: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    jump: ['Space'],
    crouch: ['KeyC'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    fire: ['Mouse0'],
    // Q aims too, for a mouse without a right button to hold (a Magic Mouse, a trackpad).
    aim: ['Mouse2', 'KeyQ'],
    pistol: ['Digit1'],
    rifle: ['Digit2'],
    sniper: ['Digit3'],
    nextWeapon: [],
    prevWeapon: [],
    grenade: ['KeyG'],
    knife: ['KeyV'],
    inspect: ['KeyI'],
    reload: ['KeyR'],
    use: ['KeyE'],
    scoreboard: ['Tab'],
  },
  buttons: {
    forward: [],
    back: [],
    left: [],
    right: [],
    jump: [0],
    crouch: [1],
    sprint: [10],
    fire: [7],
    aim: [6],
    pistol: [],
    rifle: [],
    sniper: [],
    nextWeapon: [3, 15],
    prevWeapon: [14],
    grenade: [5],
    knife: [4, 11],
    inspect: [13],
    // X / □ reloads, and picks up or reads where there is something to.
    reload: [2],
    use: [2],
    scoreboard: [8],
  },
};

/** Keys no binding takes: Esc (the menu, and how the browser gives the mouse back), the F keys and ` (the tools). */
export function reservedKey(code: string): boolean {
  return code === 'Escape' || code === 'Backquote' || /^F\d{1,2}$/.test(code);
}

/** Controller buttons no binding takes: Start (pause and play) and the home button. */
export function reservedButton(i: number): boolean {
  return i === 9 || i === 16;
}

/** Stored bindings over the defaults: an action missing or malformed keeps its default. */
export function mergeBindings(stored: unknown): Bindings {
  const s = (stored ?? {}) as Partial<Record<'keys' | 'buttons', Record<string, unknown>>>;
  const pick = <T>(kind: 'keys' | 'buttons', ok: (v: unknown) => v is T): Record<Action, T[]> => {
    const out = {} as Record<Action, T[]>;
    for (const a of ACTIONS) {
      const v = s[kind]?.[a];
      out[a] = Array.isArray(v) && v.every(ok) ? v.slice(0, SLOTS) : [...(DEFAULT_BINDINGS[kind][a] as T[])];
    }
    return out;
  };
  return {
    keys: pick('keys', (v): v is string => typeof v === 'string'),
    buttons: pick('buttons', (v): v is number => Number.isInteger(v)),
  };
}

/** A copy of the defaults (bindings are never changed in place). */
export function defaultBindings(): Bindings {
  return mergeBindings(undefined);
}

/**
 * Binds `value` (a key code or a button) to `action`'s `slot`, or clears the slot (null). A key
 * or button already bound elsewhere moves here: no two actions share one. Returns new bindings.
 */
export function bind<K extends keyof Bindings>(b: Bindings, kind: K, action: Action, slot: number, value: Bindings[K][Action][number] | null): Bindings {
  const table = { ...b[kind] } as Record<Action, (string | number)[]>;
  if (value !== null) for (const a of ACTIONS) table[a] = table[a]!.filter((v) => v !== value);
  const slots = [...table[action]!];
  if (value === null) slots.splice(slot, 1);
  else if (slot < slots.length) slots[slot] = value;
  else slots.push(value);
  table[action] = slots.slice(0, SLOTS);
  return { ...b, [kind]: table };
}
