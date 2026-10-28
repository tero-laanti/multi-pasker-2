/** Small offline DSP toolkit for building the sound set (mono Float32Array signals). */

export type Signal = Float32Array;

export function zeros(n: number): Signal {
  return new Float32Array(n);
}

export function slice(x: Signal, rate: number, from: number, to: number): Signal {
  const a = Math.max(0, Math.round(from * rate));
  const b = Math.min(x.length, Math.round(to * rate));
  return x.slice(a, Math.max(a, b));
}

/** Linear fade in over `fin` seconds and an equal-power fade out over `fout` seconds. */
export function fade(x: Signal, rate: number, fin: number, fout: number): Signal {
  const ni = Math.round(fin * rate);
  const no = Math.round(fout * rate);
  for (let i = 0; i < ni && i < x.length; i++) x[i]! *= i / ni;
  for (let i = 0; i < no && i < x.length; i++) {
    const k = i / no;
    x[x.length - 1 - i]! *= Math.sin((k * Math.PI) / 2);
  }
  return x;
}

export function peak(x: Signal): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

export function gain(x: Signal, g: number): Signal {
  for (let i = 0; i < x.length; i++) x[i]! *= g;
  return x;
}

export function normalize(x: Signal, targetDb: number): Signal {
  const p = peak(x);
  if (p < 1e-9) return x;
  return gain(x, Math.pow(10, targetDb / 20) / p);
}

export function mix(len: number, ...parts: [Signal, number, number?][]): Signal {
  const out = zeros(len);
  for (const [s, g, offset = 0] of parts) {
    for (let i = 0; i < s.length && i + offset < len; i++) out[i + offset]! += s[i]! * g;
  }
  return out;
}

export function sub(a: Signal, b: Signal): Signal {
  const out = zeros(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) - (b[i] ?? 0);
  return out;
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';

/** RBJ cookbook biquad, applied in place. `freq` may be a function of time for sweeps. */
export function biquad(x: Signal, rate: number, type: FilterType, freq: number | ((t: number) => number), q = 0.707, dbGain = 0): Signal {
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    a1 = 0,
    a2 = 0;
  const design = (f: number) => {
    const w0 = (2 * Math.PI * Math.min(f, rate * 0.49)) / rate;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, dbGain / 40);
    let a0 = 1;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = (1 - cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = (1 + cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cw);
        b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s;
        a1 = -2 * (A - 1 + (A + 1) * cw);
        a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cw);
        b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s;
        a1 = 2 * (A - 1 - (A + 1) * cw);
        a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    b0 /= a0;
    b1 /= a0;
    b2 /= a0;
    a1 /= a0;
    a2 /= a0;
  };
  const sweep = typeof freq === 'function';
  if (!sweep) design(freq);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (sweep && i % 32 === 0) design((freq as (t: number) => number)(i / rate));
    const x0 = x[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
  return x;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise(n: number, r: () => number): Signal {
  const x = zeros(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  return x;
}

/** Brown-ish noise (integrated white), good for rumble and dirt. */
export function brown(n: number, r: () => number): Signal {
  const x = zeros(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = v * 0.985 + (r() * 2 - 1) * 0.15;
    x[i] = v;
  }
  return x;
}

export function expEnv(x: Signal, rate: number, attack: number, decay: number, delay = 0): Signal {
  for (let i = 0; i < x.length; i++) {
    const t = i / rate - delay;
    if (t < 0) {
      x[i] = 0;
      continue;
    }
    const a = attack > 0 ? Math.min(1, t / attack) : 1;
    x[i]! *= a * Math.exp(-t / decay);
  }
  return x;
}

/** Sum of exponentially decaying sines (bells, clangs, knocks). */
export function modes(n: number, rate: number, partials: [freq: number, amp: number, decay: number][], drop = 0): Signal {
  const x = zeros(n);
  for (const [f, a, d] of partials) {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const fi = f * (1 - drop * Math.min(1, t * 4));
      ph += (2 * Math.PI * fi) / rate;
      x[i]! += Math.sin(ph) * a * Math.exp(-t / d);
    }
  }
  return x;
}

export function sine(n: number, rate: number, f0: number, f1: number, sweep: number): Signal {
  const x = zeros(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f1 + (f0 - f1) * Math.exp(-t / sweep);
    ph += (2 * Math.PI * f) / rate;
    x[i] = Math.sin(ph);
  }
  return x;
}

export function shape(x: Signal, drive: number): Signal {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i]! * drive) / k;
  return x;
}

/** Compact Freeverb-style reverb; returns only the wet signal (length n + tail). */
export function reverb(x: Signal, rate: number, room = 0.7, damp = 0.4, tail = 1.0): Signal {
  const n = x.length + Math.round(tail * rate);
  const out = zeros(n);
  const scale = rate / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => Math.round(l * scale));
  const aps = [556, 441, 341, 225].map((l) => Math.round(l * scale));
  const fb = 0.28 + room * 0.7;
  for (const len of combs) {
    const buf = new Float32Array(len);
    let idx = 0;
    let store = 0;
    for (let i = 0; i < n; i++) {
      const input = i < x.length ? x[i]! : 0;
      const y = buf[idx]!;
      store = y * (1 - damp) + store * damp;
      buf[idx] = input + store * fb;
      idx = (idx + 1) % len;
      out[i]! += y;
    }
  }
  for (const len of aps) {
    const buf = new Float32Array(len);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[idx]!;
      const v = out[i]!;
      out[i] = b - v;
      buf[idx] = v + b * 0.5;
      idx = (idx + 1) % len;
    }
  }
  return gain(out, 0.12);
}

export function concat(...parts: Signal[]): Signal {
  const out = zeros(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** In-place radix-2 FFT of a complex signal (length a power of two). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }
}
