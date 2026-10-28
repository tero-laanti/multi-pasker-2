/**
 * Cleans recorded voice lines (the recording booth's takes) and puts them in assets/voice: a low
 * cut for rumble and hum (firmer when the take is noisy), then a spectral noise gate that learns
 * each take's background from its silent lead-in and its quietest moments, and turns it down by
 * up to 18 dB without touching the voice above it. The voice keeps its loudness (the peak at most
 * -0.5 dBFS).
 *
 *   npx tsx tools/clean-voice.ts <folder of takes> [--out=assets/voice]
 *
 * Prints each take's noise floor and voice level before and after.
 */
import fs from 'node:fs';
import path from 'node:path';
import { biquad, fft } from './lib/dsp';
import { mono, readWav, writeWav } from './lib/wav';

/**
 * Low cut (Hz, 24 dB/octave): firmer for a take whose lead-in is noisier than NOISY (dBFS), gentle
 * for a clean one so it keeps its body. Then how far the gate turns noise down, and how much
 * above the noise still counts as noise.
 */
const LOW_CUT = { noisy: 110, clean: 60 };
const NOISY = -48;
const MAX_CUT_DB = 18;
const OVER = 2;
const N = 1024;
const HOP = N / 4;

const args = process.argv.slice(2);
const inDir = args.find((a) => !a.startsWith('--'));
const outDir = args.find((a) => a.startsWith('--out='))?.slice(6) ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'assets/voice');
if (!inDir) {
  console.error('Usage: npx tsx tools/clean-voice.ts <folder of takes> [--out=assets/voice]');
  process.exit(1);
}

const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

function clean(x: Float32Array, rate: number): { y: Float32Array; cut: number } {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length || 1;
  const y = x.map((v) => v - mean);
  // The lead-in (the booth keeps 80 ms before the voice) tells how noisy the take is.
  const leadIn = Math.min(y.length, Math.round(rate * 0.07));
  let e = 0;
  for (let i = 0; i < leadIn; i++) e += y[i]! * y[i]!;
  const cut = 10 * Math.log10(e / Math.max(1, leadIn) + 1e-20) > NOISY ? LOW_CUT.noisy : LOW_CUT.clean;
  biquad(y, rate, 'highpass', cut);
  biquad(y, rate, 'highpass', cut);

  // The spectrum, frame by frame.
  const frames = Math.max(1, Math.ceil((y.length - N) / HOP) + 1);
  const spec: { re: Float64Array; im: Float64Array; power: Float64Array; total: number }[] = [];
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (y[f * HOP + i] ?? 0) * hann[i]!;
    fft(re, im);
    const power = new Float64Array(N / 2 + 1);
    let total = 0;
    for (let k = 0; k <= N / 2; k++) total += power[k] = re[k]! ** 2 + im[k]! ** 2;
    spec.push({ re, im, power, total });
  }

  // The noise: the lead-in before the voice, and the quietest frames; per bin the lower of the two.
  const meanOf = (list: typeof spec) => {
    const p = new Float64Array(N / 2 + 1);
    for (const s of list) for (let k = 0; k <= N / 2; k++) p[k]! += s.power[k]! / list.length;
    return p;
  };
  const leadFrames = spec.slice(0, Math.max(1, Math.floor((rate * 0.07 - N) / HOP) + 1));
  const quiet = [...spec].sort((a, b) => a.total - b.total).slice(0, Math.max(2, Math.round(spec.length * 0.15)));
  const lead = meanOf(leadFrames);
  const low = meanOf(quiet);
  const noise = lead.map((v, k) => Math.min(v, low[k]!));

  // The gate: a gain per bin from how far it stands above the noise, smoothed across neighbouring
  // bins and held briefly over time, so the voice's edges and soft consonants stay.
  const floor = Math.pow(10, -MAX_CUT_DB / 20);
  const release = Math.exp(-HOP / rate / 0.06);
  const held = new Float64Array(N / 2 + 1).fill(1);
  const out = new Float64Array(y.length + N);
  const norm = new Float64Array(y.length + N);
  for (let f = 0; f < frames; f++) {
    const s = spec[f]!;
    const raw = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) raw[k] = Math.max(floor, 1 - (OVER * noise[k]!) / Math.max(1e-20, s.power[k]!));
    for (let k = 0; k <= N / 2; k++) {
      let g = 0;
      let n = 0;
      for (let j = Math.max(0, k - 2); j <= Math.min(N / 2, k + 2); j++, n++) g += raw[j]!;
      g /= n;
      held[k] = Math.max(g, held[k]! * release);
      const gain = held[k]!;
      s.re[k]! *= gain;
      s.im[k]! *= gain;
      if (k > 0 && k < N / 2) {
        s.re[N - k] = s.re[k]!;
        s.im[N - k] = -s.im[k]!;
      }
    }
    fft(s.re, s.im, true);
    for (let i = 0; i < N; i++) {
      out[f * HOP + i]! += s.re[i]! * hann[i]!;
      norm[f * HOP + i]! += hann[i]! * hann[i]!;
    }
  }
  const z = new Float32Array(y.length);
  let peak = 0;
  for (let i = 0; i < z.length; i++) {
    z[i] = norm[i]! > 1e-6 ? out[i]! / norm[i]! : 0;
    peak = Math.max(peak, Math.abs(z[i]!));
  }
  // As loud as it was recorded: the voice's level back where it was, unless the peak would clip.
  const before = levels(x, rate).voice;
  const after = levels(z, rate).voice;
  const gain = Math.min(Math.pow(10, (before - after) / 20), peak > 0 ? 0.944 / peak : 1);
  const fade = Math.round(rate * 0.01);
  for (let i = 0; i < z.length; i++) {
    const edge = Math.min(1, i / fade, (z.length - 1 - i) / fade);
    z[i] = z[i]! * gain * edge;
  }
  return { y: z, cut };
}

/** Noise floor (the quietest tenth of 20 ms frames) and voice level (the loudest tenth), in dBFS. */
function levels(x: Float32Array, rate: number): { noise: number; voice: number } {
  const win = Math.round(rate * 0.02);
  const rms: number[] = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += x[j]! * x[j]!;
    rms.push(Math.sqrt(e / win));
  }
  rms.sort((a, b) => a - b);
  const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
  return { noise: db(rms[Math.floor(rms.length * 0.1)]!), voice: db(rms[Math.floor(rms.length * 0.9)]!) };
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(inDir).filter((f) => f.toLowerCase().endsWith('.wav')).sort()) {
  const w = readWav(path.join(inDir, f));
  const x = mono(w);
  const { y, cut } = clean(x, w.sampleRate);
  writeWav(path.join(outDir, f), w.sampleRate, [y]);
  const a = levels(x, w.sampleRate);
  const b = levels(y, w.sampleRate);
  console.log(`${f.padEnd(24)} low cut ${String(cut).padStart(3)} Hz   noise ${a.noise.toFixed(1).padStart(6)} → ${b.noise.toFixed(1).padStart(6)} dBFS   voice ${a.voice.toFixed(1).padStart(6)} → ${b.voice.toFixed(1).padStart(6)}`);
}
