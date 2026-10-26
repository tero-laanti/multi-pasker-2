/**
 * Builds the weapon sounds from Snake's Authentic Gun Sounds packs (F8 Studios).
 *
 *   npx tsx tools/import-sfx.ts <path to "Snake's Authentic Gun Sounds"> <path to "Snake's SECOND Authentic Gun Sounds">
 *
 * Shots are split into a dry "close" layer and a reverb "tail" layer (full recording minus the
 * isolated one, which are sample-aligned in these packs), so automatic fire can retrigger the
 * close layer while one tail rings out. Output goes to assets/sfx/_base.
 */
import fs from 'node:fs';
import path from 'node:path';
import { biquad, fade, gain, normalize, peak, slice, sub, zeros, type Signal } from './lib/dsp';
import { mono, readWav, writeWav, type Wav } from './lib/wav';

const [firstPack, secondPack] = process.argv.slice(2);
if (!firstPack || !secondPack) {
  console.error('käyttö: npx tsx tools/import-sfx.ts <Snake\'s Authentic Gun Sounds> <Snake\'s SECOND Authentic Gun Sounds>');
  process.exit(1);
}
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/sfx/_base');
fs.mkdirSync(OUT, { recursive: true });

const p1 = (...p: string[]) => path.join(secondPack, ...p);
const p2 = (...p: string[]) => path.join(firstPack, ...p);

function load(file: string): Wav {
  if (!fs.existsSync(file)) throw new Error(`puuttuu: ${file}`);
  return readWav(file);
}

/** Onsets of individual shots: sharp local peaks well above the preceding 40 ms. */
function shotOnsets(x: Signal, rate: number): number[] {
  const hop = Math.round(rate * 0.002);
  const env: number[] = [];
  for (let i = 0; i < x.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop && j < x.length; j++) e = Math.max(e, Math.abs(x[j]!));
    env.push(e);
  }
  const g = Math.max(...env);
  const out: number[] = [];
  let last = -1000;
  for (let k = 1; k < env.length - 1; k++) {
    const e = env[k]!;
    if (e < 0.4 * g || e < env[k - 1]! || e < env[k + 1]! || k - last < 30) continue;
    let lo = Infinity;
    for (let j = Math.max(0, k - 20); j < k - 1; j++) lo = Math.min(lo, env[j]!);
    if (k > 20 && e < 2.2 * lo) continue;
    let s = k;
    while (s > 0 && env[s - 1]! > e * 0.2 && k - s < 6) s--;
    out.push(s * hop);
    last = k;
  }
  return out;
}

function write(name: string, rate: number, chans: Signal[]): void {
  writeWav(path.join(OUT, `${name}.wav`), rate, chans);
  console.log(`  ${name}.wav  ${(chans[0]!.length / rate).toFixed(2)} s  ${chans.length} ch`);
}

function chanSlice(w: Wav, from: number, to: number): Signal[] {
  return w.channels.map((c) => slice(c, w.sampleRate, from, to));
}

function normStereo(chans: Signal[], db: number): Signal[] {
  const p = Math.max(...chans.map(peak));
  const g = Math.pow(10, db / 20) / Math.max(p, 1e-9);
  return chans.map((c) => gain(c, g));
}

function toMono(chans: Signal[]): Signal {
  const out = zeros(chans[0]!.length);
  for (const c of chans) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / chans.length;
  return out;
}

/** Slower and lower by `factor` (< 1), linear interpolation. */
function repitch(x: Signal, factor: number): Signal {
  const n = Math.floor(x.length / factor);
  const out = zeros(n);
  for (let i = 0; i < n; i++) {
    const p = i * factor;
    const a = Math.floor(p);
    const t = p - a;
    out[i] = (x[a] ?? 0) * (1 - t) + (x[a + 1] ?? 0) * t;
  }
  return out;
}

interface ShotSource {
  isolated: string;
  full: string;
}

function buildShots(prefix: string, sources: ShotSource[], closeLen: number, tailLen: number, farLowpass: number): void {
  let i = 0;
  const fars: Signal[] = [];
  for (const src of sources) {
    const iso = load(src.isolated);
    const full = load(src.full);
    const rate = iso.sampleRate;
    const onsets = shotOnsets(mono(iso), rate);
    const at = (onsets[onsets.length - 1] ?? 0) / rate - 0.001;
    i++;
    const close = chanSlice(iso, at, at + closeLen).map((c) => fade(c, rate, 0.0005, 0.06));
    write(`${prefix}_shot_${i}`, rate, normStereo(close, -1));
    const tail = full.channels.map((c, ci) => fade(slice(sub(c, iso.channels[ci]!), rate, at, at + tailLen), rate, 0.004, 0.3));
    write(`${prefix}_tail_${i}`, rate, normStereo(tail, -3));
    if (fars.length < 3) {
      const m = toMono(chanSlice(full, at, at + tailLen));
      const lowClose = biquad(toMono(chanSlice(iso, at, at + tailLen)), rate, 'lowpass', farLowpass, 0.6);
      const far = zeros(m.length);
      for (let k = 0; k < far.length; k++) far[k] = lowClose[k]! * 0.55 + (m[k]! - (toMono(chanSlice(iso, at, at + tailLen))[k] ?? 0)) * 1.1;
      fars.push(fade(biquad(far, rate, 'highpass', 90), rate, 0.002, 0.3));
      write(`${prefix}_far_${fars.length}`, rate, [normalize(fars[fars.length - 1]!, -3)]);
    }
  }
}

function handling(name: string, file: string, from = 0, to = Infinity, db = -3): void {
  const w = load(file);
  const rate = w.sampleRate;
  const end = Math.min(to, w.channels[0]!.length / rate);
  write(name, rate, [normalize(fade(toMono(chanSlice(w, from, end)), rate, 0.002, 0.03), db)]);
}

console.log('Pistooli (9 mm)');
buildShots(
  'pistol',
  ['Single', 'Double Tap', 'Burst', 'Slow Burst', 'Spray'].map((n) => ({
    isolated: p1('Isolated', '9mm', 'WAV', `9mm ${n} Isolated.wav`),
    full: p1('Full Sounds', '9mm', 'WAV', `9mm ${n}.wav`),
  })),
  0.55,
  1.9,
  2600,
);
handling('pistol_mag_out', p1('& More', 'Pistol', 'WAV', '9mm Pistol Reload 1.wav'), 0, Infinity, -5);
handling('pistol_mag_in', p1('& More', 'Pistol', 'WAV', '9mm Pistol Reload 2.wav'), 0.26, Infinity, -2);
handling('pistol_bolt_back', p1('& More', 'Pistol', 'WAV', '9mm Pistol Rack Part 1.wav'), 0, Infinity, -3);
handling('pistol_bolt_fwd', p1('& More', 'Pistol', 'WAV', '9mm Pistol Slide Release.wav'), 0, Infinity, -2);
handling('pistol_dry', p1('& More', 'Pistol', 'WAV', '9mm Pistol Dry Fire.wav'), 0, 0.15, -4);
handling('pistol_inspect', p1('& More', 'Pistol', 'WAV', '9mm Pistol Chamber Check Full.wav'), 0, Infinity, -6);
handling('pistol_draw', p1('& More', 'Mag Pack', 'WAV', '9mm Magazine Unpack.wav'), 0, Infinity, -9);

console.log('Rynnäkkökivääri (7.62x39)');
buildShots(
  'rifle',
  ['Single', 'Double Tap', 'Burst', 'Spray'].map((n) => ({
    isolated: p2('Isolated', '7.62x39', 'WAV', `762x39 ${n} Isolated WAV.wav`),
    full: p2('Full Sound', '7.62x39', 'WAV', `762x39 ${n} WAV.wav`),
  })),
  0.5,
  1.8,
  2200,
);
handling('rifle_mag_out', p2('Reloads, Cycling & More', 'WAV', 'AK Reload Part 1 WAV.wav'), 0, Infinity, -3);
handling('rifle_mag_in', p2('Reloads, Cycling & More', 'WAV', 'AK Reload Part 2 WAV.wav'), 0, Infinity, -2);
handling('rifle_bolt_back', p2('Reloads, Cycling & More', 'WAV', 'AK Rack WAV.wav'), 0, 0.38, -3);
handling('rifle_bolt_fwd', p2('Reloads, Cycling & More', 'WAV', 'AK Rack WAV.wav'), 0.38, Infinity, -2);
handling('rifle_inspect', p2('Reloads, Cycling & More', 'WAV', 'AK Reload Part 1 WAV.wav'), 0, Infinity, -9);
handling('rifle_draw', p1('& More', 'Mag Pack', 'WAV', 'AK PolyMag Unpack.wav'), 0, Infinity, -9);
{
  const w = load(p1('& More', 'Pistol', 'WAV', '9mm Pistol Dry Fire.wav'));
  const x = repitch(slice(toMono(w.channels), w.sampleRate, 0, 0.15), 0.8);
  write('rifle_dry', w.sampleRate, [normalize(fade(x, w.sampleRate, 0.001, 0.02), -4)]);
}

console.log('Hylsyt');
{
  let n = 0;
  for (const f of [
    p1('& More', 'Revolver', '44 Magnum', 'WAV', '44 Magnum Eject Floor Impact.wav'),
    p1('& More', 'Revolver', '32 SW Long', 'WAV', '32 SW Eject One Casing.wav'),
    p1('& More', 'Revolver', '44 Magnum', 'WAV', '44 Magnum Eject One Casing.wav'),
  ]) {
    const w = load(f);
    const x = toMono(w.channels);
    const rate = w.sampleRate;
    for (const o of shotOnsets(x, rate).slice(0, 3)) {
      const s = slice(x, rate, o / rate - 0.002, o / rate + 0.35);
      if (peak(s) < 0.01) continue;
      write(`casing_${++n}`, rate, [normalize(fade(s, rate, 0.001, 0.12), -8)]);
    }
  }
}
console.log('Valmis →', OUT);
