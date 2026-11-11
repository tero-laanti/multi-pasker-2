import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TutorialMode, type TutorialStep } from '../src/client/game/tutorial';

// The phone on the duty table draws its screen on a canvas, which tests don't have.
vi.mock('../src/client/game/models/phone', () => ({ buildPhone: () => ({ root: new THREE.Group(), setGlow: () => {} }) }));

function setup(stage: TutorialStep) {
  const calls: string[] = [];
  const game = { root: new THREE.Group() };
  const range = { range: { targets: [] } };
  const t = new TutorialMode(game as never, range as never, {
    pickedUp: () => calls.push('pickedUp'),
    radioCheck: () => calls.push('radioCheck'),
    phoneOut: () => false,
    phoneOnline: () => true,
  });
  t.stage = stage;
  return { t, calls };
}

describe('the tutorial and a phone that comes online early', () => {
  it('a phone online while the arrow points at the table goes on to the reply, with the radio check asked for', () => {
    const { t, calls } = setup('phone');
    t.paired();
    expect(t.stage).toBe('reply');
    expect(calls).toEqual(['radioCheck']);
  });

  it('a phone online before the phone step changes nothing until the pickup', () => {
    for (const stage of ['walk', 'shoot', 'reload'] as TutorialStep[]) {
      const { t, calls } = setup(stage);
      t.paired();
      expect(t.stage).toBe(stage);
      expect(calls).toEqual([]);
    }
  });

  it('pairing on the pairing screen asks for the radio check too', () => {
    const { t, calls } = setup('pair');
    t.paired();
    expect(t.stage).toBe('reply');
    expect(calls).toEqual(['radioCheck']);
  });
});
