import { afterEach, describe, expect, it } from 'vitest';
import { bind, DEFAULT_BINDINGS, defaultBindings, mergeBindings, reservedButton, reservedKey } from '../src/client/bindings';
import { key, setBindings, withKeys } from '../src/client/controls';
import { UI } from '../src/shared/ui';

describe('binding a key', () => {
  it('puts it in the slot', () => {
    const b = bind(DEFAULT_BINDINGS, 'keys', 'jump', 0, 'KeyF');
    expect(b.keys.jump).toEqual(['KeyF']);
  });

  it('moves a key from the action it was on: no two actions share one', () => {
    const b = bind(DEFAULT_BINDINGS, 'keys', 'jump', 0, 'KeyC');
    expect(b.keys.jump).toEqual(['KeyC']);
    expect(b.keys.crouch).toEqual([]);
  });

  it('fills a second slot, and clears a slot', () => {
    const two = bind(DEFAULT_BINDINGS, 'keys', 'jump', 1, 'KeyJ');
    expect(two.keys.jump).toEqual(['Space', 'KeyJ']);
    expect(bind(two, 'keys', 'jump', 0, null).keys.jump).toEqual(['KeyJ']);
  });

  it('binds controller buttons the same way', () => {
    const b = bind(DEFAULT_BINDINGS, 'buttons', 'jump', 0, 3);
    expect(b.buttons.jump).toEqual([3]);
    expect(b.buttons.nextWeapon).toEqual([15]);
  });

  it('leaves the defaults as they are', () => {
    bind(DEFAULT_BINDINGS, 'keys', 'jump', 0, 'KeyC');
    expect(DEFAULT_BINDINGS.keys.crouch).toEqual(['KeyC']);
    expect(defaultBindings()).toEqual(DEFAULT_BINDINGS);
  });
});

describe('stored bindings', () => {
  it('keep the defaults for actions missing or malformed', () => {
    const b = mergeBindings({ keys: { jump: ['KeyF'], crouch: 'KeyC', fire: [1] }, buttons: { jump: [3, 4, 5] } });
    expect(b.keys.jump).toEqual(['KeyF']);
    expect(b.keys.crouch).toEqual(['KeyC']);
    expect(b.keys.fire).toEqual(['Mouse0']);
    expect(b.buttons.jump).toEqual([3, 4]);
    expect(mergeBindings(undefined)).toEqual(DEFAULT_BINDINGS);
  });
});

describe('reserved', () => {
  it('are Esc, the F keys and ` on the keyboard, Start and home on a controller', () => {
    for (const k of ['Escape', 'F1', 'F4', 'F12', 'Backquote']) expect(reservedKey(k)).toBe(true);
    for (const k of ['KeyF', 'Space', 'Tab', 'Mouse0']) expect(reservedKey(k)).toBe(false);
    expect(reservedButton(9)).toBe(true);
    expect(reservedButton(16)).toBe(true);
    expect(reservedButton(0)).toBe(false);
  });
});

describe('hints with the player’s bindings', () => {
  afterEach(() => setBindings(DEFAULT_BINDINGS));

  it('name the keys and buttons bound', () => {
    let b = bind(DEFAULT_BINDINGS, 'keys', 'reload', 0, 'KeyF');
    b = bind(b, 'buttons', 'reload', 0, 3);
    setBindings(b);
    expect(withKeys(UI.hud.reloadKey, 'keyboard')).toBe('Press F to reload.');
    expect(withKeys(UI.hud.reloadKey, 'playstation')).toBe('Press △ to reload.');
  });

  it('spell out movement keys that read as one word, and others one by one', () => {
    setBindings(bind(bind(bind(bind(DEFAULT_BINDINGS, 'keys', 'forward', 0, 'KeyE'), 'keys', 'left', 0, 'KeyS'), 'keys', 'back', 0, 'KeyD'), 'keys', 'right', 0, 'KeyF'));
    expect(key('move', 'keyboard')).toBe('ESDF');
    setBindings(bind(DEFAULT_BINDINGS, 'keys', 'forward', 0, 'ArrowUp'));
    expect(key('move', 'keyboard')).toBe('↑ / A / S / D');
  });

  it('say so when nothing is bound', () => {
    setBindings(bind(DEFAULT_BINDINGS, 'keys', 'reload', 0, null));
    expect(withKeys(UI.hud.reloadKey, 'keyboard')).toBe(`Press ${UI.keyNames.unbound} to reload.`);
  });
});
