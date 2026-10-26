import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { FI } from '../shared/fi';
import type { AudioFolder } from './http';

/**
 * Voice notes spelled in the Finnish phonetic alphabet, spliced from the recorded words so any
 * code word works: intro, "Tunnus:", one word per letter, outro. Clips are read from the voice
 * folder (recordings win over placeholders); only WAV can be spliced, so a clip recorded in
 * another format falls back to its placeholder WAV.
 */

const RATE = 44100;

/** Mono samples in -1..1 at the clip's own rate. */
interface Clip {
  rate: number;
  data: Float32Array;
}

/** Reads PCM (8/16/24/32-bit) or float WAV; null when the file isn't a WAV we understand. */
export function readWav(buf: Buffer): Clip | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24);
      fmt = { format, channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      const { format, channels, rate, bits } = fmt;
      const bytes = bits / 8;
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (bytes * channels));
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + (i * channels + c) * bytes;
          let v: number;
          if (format === 3 && bits === 32) v = buf.readFloatLE(at);
          else if (format === 3 && bits === 64) v = buf.readDoubleLE(at);
          else if (bits === 8) v = (buf.readUInt8(at) - 128) / 128;
          else if (bits === 16) v = buf.readInt16LE(at) / 32768;
          else if (bits === 24) v = buf.readIntLE(at, 3) / 8388608;
          else if (bits === 32) v = buf.readInt32LE(at) / 2147483648;
          else return null;
          sum += v;
        }
        data[i] = sum / channels;
      }
      return { rate, data };
    }
    o = body + size + (size % 2);
  }
  return null;
}

export function writeWav(data: Float32Array, rate = RATE): Buffer {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i]!)) * 32767), 44 + i * 2);
  return buf;
}

/** Linear-interpolation resampling (plenty for speech). */
function resample(c: Clip, rate: number): Float32Array {
  if (c.rate === rate) return c.data;
  const n = Math.floor((c.data.length * rate) / c.rate);
  const out = new Float32Array(n);
  const k = c.rate / rate;
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = (c.data[i0] ?? 0) * (1 - f) + (c.data[i0 + 1] ?? c.data[i0] ?? 0) * f;
  }
  return out;
}

/** Trims leading and trailing silence (keeping a little air) and evens out the level. */
function tidy(x: Float32Array, rate: number): Float32Array {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-4) return x;
  const gate = peak * 0.05;
  let a = 0;
  while (a < x.length && Math.abs(x[a]!) < gate) a++;
  let b = x.length - 1;
  while (b > a && Math.abs(x[b]!) < gate) b--;
  const pad = Math.round(rate * 0.03);
  const out = x.slice(Math.max(0, a - pad), Math.min(x.length, b + pad));
  const g = 0.7 / peak;
  for (let i = 0; i < out.length; i++) out[i]! *= g;
  return out;
}

export class VoiceNotes {
  private notes = new Map<string, { parts: string[]; wav?: Buffer; duration: number }>();
  private clips = new Map<string, Float32Array>();

  /** Without a folder (tests) every clip is silence. */
  constructor(private voice: AudioFolder | null) {}

  private clip(name: string): Float32Array {
    const cached = this.clips.get(name);
    if (cached) return cached;
    const file = this.voice?.resolveWav(name);
    let data: Float32Array = new Float32Array(0);
    if (file) {
      try {
        const c = readWav(fs.readFileSync(file));
        if (c) data = tidy(resample(c, RATE), RATE);
      } catch {
        // Unreadable clip: silence.
      }
    }
    this.clips.set(name, data);
    return data;
  }

  /** A whole recorded line (served from /voice/<name>) and its length. */
  line(name: string): { url: string; duration: number } {
    const file = this.voice?.resolveWav(name);
    let duration = 3;
    if (file) {
      try {
        const c = readWav(fs.readFileSync(file));
        if (c) duration = c.data.length / c.rate;
      } catch {
        // Keep the estimate.
      }
    }
    return { url: `/voice/${name}`, duration };
  }

  /** Forget cached clips (recordings were added while the server runs). */
  reload(): void {
    this.clips.clear();
    for (const n of this.notes.values()) n.wav = undefined;
  }

  /**
   * A voice note spelling `letters` (e.g. [...'KETTU']); returns its URL and duration.
   * Letters without an alphabet word are skipped.
   */
  spell(letters: string[]): { url: string; duration: number } {
    const V = FI.voice;
    const words = letters.map((ch) => V.alphabet.find(([l]) => l === ch.toLocaleUpperCase('fi-FI'))?.[2]).filter((f): f is string => !!f);
    const intro = V.intros[Math.floor(Math.random() * V.intros.length)]![0];
    const outro = V.outros[Math.floor(Math.random() * V.outros.length)]![0];
    const parts = [intro, V.codeWord[0], ...words, outro];
    const id = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
    let note = this.notes.get(id);
    if (!note) {
      note = { parts, duration: 0 };
      this.notes.set(id, note);
    }
    const wav = this.build(id);
    return { url: `/voicenote/${id}.wav`, duration: wav ? (wav.length - 44) / 2 / RATE : 0 };
  }

  /** The spliced WAV for a note id, built on first use. */
  build(id: string): Buffer | null {
    const note = this.notes.get(id);
    if (!note) return null;
    if (note.wav) return note.wav;
    const gap = (s: number) => new Float32Array(Math.round(RATE * s));
    const pieces: Float32Array[] = [gap(0.15)];
    note.parts.forEach((name, i) => {
      pieces.push(this.clip(name));
      const last = i === note!.parts.length - 1;
      // Longer pauses around the spelled word, so the letters are easy to count.
      pieces.push(gap(last ? 0.2 : i === 0 ? 0.45 : i === note!.parts.length - 2 ? 0.55 : 0.32));
    });
    const len = pieces.reduce((a, p) => a + p.length, 0);
    const all = new Float32Array(len);
    let o = 0;
    for (const p of pieces) {
      all.set(p, o);
      o += p.length;
    }
    note.wav = writeWav(all);
    note.duration = len / RATE;
    return note.wav;
  }
}
