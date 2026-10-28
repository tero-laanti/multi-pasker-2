import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIO } from '../src/shared/config';
import type { Music } from '../src/client/audio/music';

// The browser parts the soundtrack uses, faked: a clock, a gain whose automation is recorded,
// and an <audio> element that plays and pauses.
type Ramp = [kind: string, value: number, at: number];
class FakeParam {
  value = 0;
  events: Ramp[] = [];
  cancelScheduledValues(at: number) {
    this.events.push(['cancel', 0, at]);
  }
  setValueAtTime(v: number, at: number) {
    this.events.push(['set', v, at]);
  }
  linearRampToValueAtTime(v: number, at: number) {
    this.events.push(['ramp', v, at]);
  }
}
class FakeAudio {
  loop = false;
  preload = '';
  currentTime = 0;
  paused = true;
  constructor(readonly src: string) {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
const ctx = {
  currentTime: 10,
  createGain: () => ({ gain: new FakeParam(), connect: (n: unknown) => n }),
  createMediaElementSource: () => ({ connect: (n: unknown) => n }),
};
let timers: (() => void)[] = [];

let MusicClass: typeof Music;
beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.Audio = FakeAudio;
  g.window = { setTimeout: (f: () => void) => timers.push(f), clearTimeout: () => undefined };
  MusicClass = (await import('../src/client/audio/music')).Music;
});

function setup() {
  timers = [];
  const m = new MusicClass(ctx as unknown as AudioContext, {} as AudioNode);
  const inner = m as unknown as { el: FakeAudio; gain: { gain: FakeParam } };
  return { m, el: inner.el, gain: inner.gain.gain };
}
const M = AUDIO.music;
const last = (p: FakeParam) => p.events[p.events.length - 1]!;

describe('the soundtrack', () => {
  it('plays from the top in the main menu, and on very quietly on the range', () => {
    const { m, el, gain } = setup();
    m.menu();
    expect(el.paused).toBe(false);
    expect(el.loop).toBe(true);
    expect(el.currentTime).toBe(0);
    expect(last(gain)).toEqual(['ramp', M.menu, 10 + M.fadeIn]);
    el.currentTime = 42;
    m.range();
    // The same song carries on, turned down.
    expect(el.currentTime).toBe(42);
    expect(last(gain)).toEqual(['ramp', M.range, 10 + M.fadeOut]);
    expect(M.range).toBeLessThan(M.menu / 4);
  });

  it('a round is silent; a break gets the clip from 2:20, faded in and out within it', () => {
    const { m, el, gain } = setup();
    m.menu();
    m.off();
    expect(last(gain)).toEqual(['ramp', 0, 10 + M.fadeOut]);
    timers.forEach((f) => f());
    expect(el.paused).toBe(true);
    m.clip(12, false);
    expect(el.currentTime).toBe(M.clipFrom);
    expect(el.loop).toBe(false);
    expect(el.paused).toBe(false);
    const ramps = gain.events.filter((e) => e[0] === 'ramp').slice(-2);
    expect(ramps).toEqual([
      ['ramp', M.clip, 10 + M.fadeIn],
      ['ramp', 0, 10 + 12],
    ]);
  });

  it('the match’s results get a longer clip; a break about to end gets none', () => {
    const { m, gain } = setup();
    m.clip(20, true);
    expect(last(gain)).toEqual(['ramp', 0, 10 + Math.min(20, M.resultsClip)]);
    m.clip(40, false);
    expect(last(gain)).toEqual(['ramp', 0, 10 + M.breakClip]);
    const n = gain.events.length;
    m.clip(1, false);
    expect(gain.events.length).toBe(n);
  });

  it('starts once the browser allows it (after a click or a key)', () => {
    const { m, el } = setup();
    m.menu();
    el.paused = true; // play() was refused before a gesture
    m.resume();
    expect(el.paused).toBe(false);
    m.off();
    timers.forEach((f) => f());
    m.resume();
    expect(el.paused).toBe(true);
  });
});
