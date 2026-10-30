import { describe, expect, it } from 'vitest';
import { hint, key, padKind, withKeys, type Control } from '../src/client/controls';
import { UI } from '../src/shared/ui';

describe('a controller’s make', () => {
  it('is PlayStation for Sony’s pads', () => {
    expect(padKind('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padKind('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padKind('054c-0ce6-DualSense Wireless Controller')).toBe('playstation');
    expect(padKind('Wireless Controller')).toBe('playstation');
  });

  it('is Xbox for Microsoft’s pads, wireless ones too', () => {
    expect(padKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padKind('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padKind('045e-028e-Microsoft X-Box 360 pad')).toBe('xbox');
  });

  it('is Xbox for any other pad', () => {
    expect(padKind('8BitDo SN30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6101)')).toBe('xbox');
  });
});

describe('hints', () => {
  it('read exactly as before on the keyboard', () => {
    expect(withKeys(UI.hud.reloadKey, 'keyboard')).toBe('Press R to reload.');
    expect(withKeys(UI.hud.outOfAmmoNoPhone, 'keyboard')).toBe('Out of ammo. No phone yet: Esc → Open a virtual phone, then text LATAA.');
    expect(withKeys(UI.hud.phoneNone, 'keyboard')).toBe('No phone: Esc → pair');
    expect(withKeys(UI.hud.phoneVirtual, 'keyboard')).toBe('Virtual phone: Esc');
    expect(withKeys(UI.tutorial.settled, 'keyboard')).toBe('Esc → Go to the match when you are ready.');
    expect(withKeys(UI.range.closeControls, 'keyboard')).toBe('E or step back to close');
    expect(withKeys(UI.tutorial.steps.reload!.body, 'keyboard')).toBe('Press R.');
    expect(withKeys(UI.tutorial.steps.phone!.body, 'keyboard')).toBe('There is a phone on the duty table behind you. Walk up to it and press E.');
    expect(withKeys(UI.tutorial.steps.done!.body, 'keyboard')).toBe(
      'Press R to reload your gun. Text LATAA for full magazines, KRANAATTI for a grenade (G pulls the pin, let go to throw). V stabs with the knife. The range has a rifle too: 2. Train as long as you like, then Esc → Go to the match.',
    );
    const walk = UI.tutorial.steps.walk!;
    expect(hint(walk.body, UI.tutorial.padSteps.walk!.body, 'keyboard')).toBe(walk.body);
  });

  it('list the keys as the controls always did', () => {
    expect(UI.menu.controls.map(([c, what]) => [key(c as Control, 'keyboard'), what])).toEqual([
      ['WASD', 'move'],
      ['Mouse', 'look'],
      ['Left', 'fire'],
      ['Right / Q', 'aim down sights'],
      ['Shift', 'sprint'],
      ['Space', 'jump'],
      ['C', 'crouch'],
      ['1 / 2 / 3 / wheel', 'pistol / rifle / sniper rifle'],
      ['G', 'grenade: pulls the pin, let go to throw'],
      ['V', 'knife: two stabs kill'],
      ['I', 'inspect weapon'],
      ['Tab', 'scoreboard'],
      ['R', 'reload (one spare magazine)'],
      ['E', 'pick up, read'],
      ['Esc', 'menu'],
    ]);
  });

  it('name the PlayStation and Xbox buttons on a controller', () => {
    expect(withKeys(UI.hud.reloadKey, 'playstation')).toBe('Press □ to reload.');
    expect(withKeys(UI.hud.reloadKey, 'xbox')).toBe('Press X to reload.');
    expect(withKeys(UI.tutorial.settled, 'playstation')).toBe('Options → Go to the match when you are ready.');
    expect(hint(UI.tutorial.steps.walk!.body, UI.tutorial.padSteps.walk!.body, 'xbox')).toContain('X reads it');
    expect(hint(UI.tutorial.steps.shoot!.body, UI.tutorial.padSteps.shoot!.body, 'playstation')).toBe('Hold L2 to aim, pull R2 to fire. Knock down the marked target.');
  });

  it('leave other placeholders alone', () => {
    expect(withKeys('{name} pressed {jump}', 'xbox')).toBe('{name} pressed A');
  });
});
