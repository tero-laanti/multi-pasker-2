/**
 * Synthesises the non-weapon sounds (footsteps, impacts, steel targets, hit markers, whistle,
 * grenade) into assets/sfx/_base. Deterministic: the same seed gives the same files.
 *
 *   npm run gen:sfx
 */
import fs from 'node:fs';
import path from 'node:path';
import { biquad, brown, concat, expEnv, fade, gain, mix, modes, noise, normalize, reverb, rng, shape, sine, zeros, type Signal } from './lib/dsp';
import { writeWav } from './lib/wav';

const RATE = 44100;
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/sfx/_base');
fs.mkdirSync(OUT, { recursive: true });
const N = (s: number) => Math.round(s * RATE);

function out(name: string, x: Signal, db = -3): void {
  writeWav(path.join(OUT, `${name}.wav`), RATE, [normalize(fade(x, RATE, 0.0005, 0.02), db)]);
  console.log(`  ${name}.wav ${(x.length / RATE).toFixed(2)} s`);
}

function burst(r: () => number, len: number, type: 'lowpass' | 'highpass' | 'bandpass', f: number, q: number, attack: number, decay: number, delay = 0): Signal {
  return expEnv(biquad(noise(N(len), r), RATE, type, f, q), RATE, attack, decay, delay);
}

function grains(r: () => number, len: number, count: number, lo: number, hi: number, spread: number): Signal {
  const x = zeros(N(len));
  for (let i = 0; i < count; i++) {
    const t = Math.pow(r(), 1.8) * spread;
    const g = burst(r, 0.006, 'bandpass', lo + r() * (hi - lo), 1.5, 0.0003, 0.0015 + r() * 0.002);
    const o = N(t);
    const a = (1 - t / spread) * (0.4 + r() * 0.6);
    for (let k = 0; k < g.length && o + k < x.length; k++) x[o + k]! += g[k]! * a;
  }
  return x;
}

function room(x: Signal, amount: number, size = 0.4, tail = 0.4): Signal {
  const wet = reverb(x, RATE, size, 0.5, tail);
  return mix(wet.length, [x, 1], [wet, amount]);
}

console.log('Footsteps');
const steps: Record<string, (r: () => number) => Signal> = {
  concrete: (r) =>
    room(
      mix(
        N(0.16),
        [expEnv(biquad(brown(N(0.16), r), RATE, 'lowpass', 1600 + r() * 400, 0.8), RATE, 0.001, 0.022), 1],
        [burst(r, 0.16, 'highpass', 3500, 0.7, 0.001, 0.01, 0.012 + r() * 0.01), 0.35],
        [expEnv(sine(N(0.16), RATE, 110, 60, 0.03), RATE, 0.001, 0.025), 0.5],
      ),
      0.25,
    ),
  gravel: (r) =>
    mix(N(0.2), [grains(r, 0.2, 55, 1800, 6500, 0.11), 1], [expEnv(biquad(brown(N(0.2), r), RATE, 'lowpass', 700, 0.7), RATE, 0.002, 0.03), 0.8]),
  grass: (r) =>
    mix(
      N(0.2),
      [expEnv(biquad(noise(N(0.2), r), RATE, 'bandpass', 2200 + r() * 800, 0.9), RATE, 0.01, 0.05), 0.7],
      [expEnv(biquad(brown(N(0.2), r), RATE, 'lowpass', 500, 0.7), RATE, 0.004, 0.035), 1],
    ),
  dirt: (r) =>
    mix(N(0.18), [expEnv(biquad(brown(N(0.18), r), RATE, 'lowpass', 800, 0.7), RATE, 0.002, 0.03), 1], [grains(r, 0.18, 18, 1500, 4000, 0.06), 0.35]),
  sand: (r) =>
    mix(N(0.2), [expEnv(biquad(noise(N(0.2), r), RATE, 'bandpass', 1400, 0.8), RATE, 0.008, 0.05), 0.6], [grains(r, 0.2, 40, 2500, 7000, 0.08), 0.5]),
  wood: (r) =>
    room(
      mix(
        N(0.22),
        [modes(N(0.22), RATE, [[130 + r() * 30, 1, 0.07], [310 + r() * 40, 0.6, 0.045], [620 + r() * 60, 0.3, 0.025]]), 1],
        [burst(r, 0.22, 'bandpass', 2500, 1, 0.0005, 0.006), 0.6],
      ),
      0.3,
    ),
  metal: (r) =>
    mix(
      N(0.3),
      [modes(N(0.3), RATE, [[420 + r() * 50, 1, 0.12], [1130 + r() * 80, 0.6, 0.08], [2350 + r() * 120, 0.35, 0.05], [3700, 0.2, 0.03]]), 0.7],
      [expEnv(biquad(brown(N(0.3), r), RATE, 'lowpass', 900, 0.7), RATE, 0.001, 0.02), 1],
    ),
  canvas: (r) => expEnv(biquad(noise(N(0.18), r), RATE, 'bandpass', 600, 0.7), RATE, 0.005, 0.04),
};
for (const [surf, fn] of Object.entries(steps)) {
  for (let i = 1; i <= 4; i++) out(`step_${surf}_${i}`, fn(rng(1000 + i * 17 + surf.length * 131)), -6);
}
for (let i = 1; i <= 2; i++) {
  const r = rng(77 + i);
  out(
    `land_${i}`,
    room(
      mix(
        N(0.35),
        [expEnv(biquad(brown(N(0.35), r), RATE, 'lowpass', 500, 0.7), RATE, 0.002, 0.07), 1],
        [expEnv(sine(N(0.35), RATE, 90, 45, 0.05), RATE, 0.002, 0.06), 0.8],
        [burst(r, 0.35, 'bandpass', 1800, 0.8, 0.002, 0.03, 0.01), 0.3],
      ),
      0.2,
    ),
    -4,
  );
}

console.log('Impacts');
const impacts: Record<string, (r: () => number) => Signal> = {
  concrete: (r) =>
    room(
      mix(
        N(0.4),
        [burst(r, 0.4, 'highpass', 1500, 0.7, 0.0002, 0.006), 1],
        [grains(r, 0.4, 40, 1500, 5000, 0.22), 0.45],
        [expEnv(biquad(brown(N(0.4), r), RATE, 'lowpass', 900, 0.7), RATE, 0.001, 0.03), 0.7],
      ),
      0.35,
    ),
  wood: (r) =>
    room(
      mix(
        N(0.3),
        [modes(N(0.3), RATE, [[210 + r() * 40, 1, 0.045], [520 + r() * 60, 0.7, 0.03], [990, 0.4, 0.015]]), 1],
        [burst(r, 0.3, 'bandpass', 3200, 1, 0.0002, 0.012), 0.8],
        [grains(r, 0.3, 12, 2500, 6000, 0.08), 0.3],
      ),
      0.25,
    ),
  metal: (r) =>
    mix(
      N(0.6),
      [modes(N(0.6), RATE, [[1800 + r() * 200, 1, 0.25], [2930 + r() * 200, 0.7, 0.18], [4420, 0.5, 0.11], [6100, 0.3, 0.07]], 0.04), 0.6],
      [burst(r, 0.6, 'highpass', 2500, 0.7, 0.0001, 0.004), 1],
    ),
  dirt: (r) =>
    mix(
      N(0.3),
      [expEnv(biquad(brown(N(0.3), r), RATE, 'lowpass', 600, 0.7), RATE, 0.001, 0.05), 1],
      [grains(r, 0.3, 30, 2000, 5500, 0.12), 0.5],
    ),
  sand: (r) => mix(N(0.3), [grains(r, 0.3, 50, 1500, 5000, 0.12), 0.8], [expEnv(biquad(brown(N(0.3), r), RATE, 'lowpass', 500, 0.7), RATE, 0.002, 0.04), 1]),
  flesh: (r) =>
    shape(
      mix(
        N(0.25),
        [expEnv(biquad(noise(N(0.25), r), RATE, 'lowpass', 1300, 0.9), RATE, 0.0008, 0.028), 1],
        [expEnv(sine(N(0.25), RATE, 160, 70, 0.04), RATE, 0.001, 0.05), 0.9],
      ),
      2,
    ),
  canvas: (r) => expEnv(biquad(noise(N(0.25), r), RATE, 'bandpass', 700, 0.6), RATE, 0.002, 0.05),
};
for (const [surf, fn] of Object.entries(impacts)) {
  for (let i = 1; i <= 3; i++) out(`impact_${surf}_${i}`, fn(rng(5000 + i * 29 + surf.length * 71)), surf === 'flesh' ? -3 : -4);
}

console.log('Steel targets');
const plate = (r: () => number, base: number, len: number) =>
  mix(
    N(len),
    [modes(N(len), RATE, [[base, 1, len * 0.45], [base * 2.49, 0.7, len * 0.3], [base * 4.1, 0.45, len * 0.2], [base * 5.66, 0.3, len * 0.14], [base * 7.8, 0.15, len * 0.09]]), 0.8],
    [burst(r, len, 'highpass', 1800, 0.7, 0.0001, 0.004), 0.9],
  );
for (let i = 1; i <= 2; i++) out(`steel_plate_${i}`, plate(rng(300 + i), 740 + i * 40, 1.6), -3);
for (let i = 1; i <= 2; i++) out(`steel_gong_${i}`, plate(rng(400 + i), 330 + i * 25, 2.6), -3);

console.log('Hit markers');
{
  const r = rng(9);
  out('hit_body', mix(N(0.08), [burst(r, 0.08, 'bandpass', 3200, 1.2, 0.0002, 0.005), 1], [expEnv(sine(N(0.08), RATE, 1900, 1700, 0.02), RATE, 0.0005, 0.012), 0.4]), -6);
  out('hit_head', mix(N(0.25), [modes(N(0.25), RATE, [[3300, 1, 0.07], [5150, 0.6, 0.05], [7400, 0.25, 0.03]]), 0.8], [burst(r, 0.25, 'highpass', 4000, 0.8, 0.0001, 0.003), 0.8]), -5);
  out(
    'hit_kill',
    mix(N(0.3), [expEnv(sine(N(0.3), RATE, 260, 110, 0.05), RATE, 0.001, 0.07), 1], [burst(r, 0.3, 'bandpass', 3000, 1.2, 0.0002, 0.006), 0.8]),
    -5,
  );
  out('ui_click', burst(r, 0.04, 'bandpass', 2400, 1.5, 0.0002, 0.004), -12);
}

console.log('Whistle');
{
  const len = 0.75;
  const x = zeros(N(len));
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const trill = 0.55 + 0.45 * Math.sin(2 * Math.PI * 32 * t);
    const env = Math.min(1, t / 0.02) * Math.min(1, (len - t) / 0.08);
    p1 += (2 * Math.PI * (2650 + 40 * Math.sin(2 * Math.PI * 32 * t))) / RATE;
    p2 += (2 * Math.PI * 2930) / RATE;
    x[i] = (Math.sin(p1) * 0.7 + Math.sin(p2) * 0.3) * trill * env;
  }
  const breath = biquad(noise(x.length, rng(5)), RATE, 'bandpass', 2800, 2);
  out('whistle', room(mix(x.length, [x, 1], [gain(breath, 0.25), 1]), 0.3, 0.6, 0.6), -6);
}

console.log('Grenade');
{
  const r = rng(42);
  out('grenade_pin', concat(modes(N(0.08), RATE, [[2400, 1, 0.02], [3900, 0.6, 0.015]]), burst(r, 0.25, 'bandpass', 3500, 2, 0.02, 0.05)), -6);
  out('grenade_throw', expEnv(biquad(noise(N(0.35), r), RATE, 'bandpass', (t) => 600 + t * 3000, 1.2), RATE, 0.12, 0.08), -8);
  for (let i = 1; i <= 3; i++) {
    const rr = rng(60 + i);
    out(`grenade_bounce_${i}`, mix(N(0.2), [modes(N(0.2), RATE, [[680 + rr() * 120, 1, 0.05], [1650 + rr() * 200, 0.5, 0.03]]), 1], [burst(rr, 0.2, 'lowpass', 1200, 0.7, 0.0005, 0.01), 1]), -6);
  }
  for (let i = 1; i <= 2; i++) {
    const rr = rng(90 + i);
    const len = 3.2;
    const blast = expEnv(biquad(noise(N(len), rr), RATE, 'lowpass', (t) => 200 + 7000 * Math.exp(-t / 0.08), 0.7), RATE, 0.0005, 0.25);
    const boom = expEnv(sine(N(len), RATE, 95, 32, 0.15), RATE, 0.001, 0.35);
    const debris = grains(rr, len, 60, 800, 4000, 1.2);
    const dry = shape(mix(N(len), [blast, 1], [boom, 1.2], [debris, 0.25]), 2.5);
    out(`grenade_explode_${i}`, room(dry, 0.9, 0.85, 1.5), -1);
    out(`grenade_far_${i}`, biquad(room(dry, 1.4, 0.9, 2), RATE, 'lowpass', 900, 0.7), -3);
  }
}
console.log('Bullets passing and taking hits');
{
  // Supersonic crack (sharp N-wave) followed by a short falling whizz.
  for (let v = 1; v <= 3; v++) {
    const r = rng(300 + v);
    const len = 0.32;
    const crack = zeros(N(len));
    const w = N(0.0006 + r() * 0.0003);
    for (let i = 0; i < w * 2; i++) crack[i + 20] = i < w ? 1 - i / w : -(1 - (i - w) / w) * 0.9;
    const snap = biquad(crack, RATE, 'highpass', 900, 0.7);
    const whizz = expEnv(biquad(noise(N(len), r), RATE, 'bandpass', (t) => 5200 - t * 9000 + r() * 400, 3.5), RATE, 0.004, 0.06, 0.003);
    out(`bullet_by_${v}`, room(mix(N(len), [snap, 1], [whizz, 0.45]), 0.18, 0.25, 0.2), -4);
  }
  // Taking a hit: dull body thump with a muffled flesh layer.
  for (let v = 1; v <= 3; v++) {
    const r = rng(320 + v);
    const len = 0.35;
    const thump = expEnv(sine(N(len), RATE, 95 + r() * 20, 48, 0.08), RATE, 0.001, 0.09);
    const flesh = expEnv(biquad(brown(N(len), r), RATE, 'lowpass', 900 + r() * 300, 0.8), RATE, 0.001, 0.05);
    const tick = burst(r, len, 'bandpass', 1700, 1.4, 0.0003, 0.008);
    out(`player_hurt_${v}`, mix(N(len), [thump, 1], [flesh, 0.8], [tick, 0.25]), -4);
  }
  // Death: heavy thump, a low muffled boom and a ringing that fades.
  {
    const r = rng(340);
    const len = 1.6;
    const thump = expEnv(sine(N(len), RATE, 80, 36, 0.2), RATE, 0.002, 0.22);
    const boom = expEnv(biquad(brown(N(len), r), RATE, 'lowpass', 260, 0.7), RATE, 0.004, 0.35);
    const ring = gain(expEnv(sine(N(len), RATE, 3150, 3100, 1), RATE, 0.25, 0.7, 0.05), 0.05);
    out('player_death', mix(N(len), [thump, 1], [boom, 0.9], [ring, 1]), -4);
  }
}

console.log('Done →', OUT);
