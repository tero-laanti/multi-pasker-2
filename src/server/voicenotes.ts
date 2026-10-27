import { FI } from '../shared/fi';

/**
 * Voice notes spelled in the Finnish phonetic alphabet, spliced from the recorded words so any
 * code word works: intro, "Tunnus:", one word per letter, outro. Clips come from a VoiceSource
 * (the voice folder on the server, where recordings win over placeholders; clips fetched from
 * the site in the browser version); only WAV can be spliced, so a clip recorded in another
 * format falls back to its placeholder WAV.
 */

const RATE = 44100;

/** Where clips come from and where finished notes and lines are served from. */
export interface VoiceSource {
  /** A clip's WAV bytes, or null. */
  wav(name: string): Uint8Array | null;
  /** The URL of a whole recorded line. */
  lineUrl(name: string): string;
  /** The URL of a spliced note. */
  noteUrl(id: string, wav: Uint8Array): string;
}

/** Mono samples in -1..1 at the clip's own rate. */
interface Clip {
  rate: number;
  data: Float32Array;
}

const ascii = (buf: Uint8Array, at: number, n: number) => String.fromCharCode(...buf.subarray(at, at + n));

/** Reads PCM (8/16/24/32-bit) or float WAV; null when the file isn't a WAV we understand. */
export function readWav(buf: Uint8Array): Clip | null {
  if (buf.length < 44 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WAVE') return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= buf.length) {
    const id = ascii(buf, o, 4);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
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
          let x: number;
          if (format === 3 && bits === 32) x = v.getFloat32(at, true);
          else if (format === 3 && bits === 64) x = v.getFloat64(at, true);
          else if (bits === 8) x = (v.getUint8(at) - 128) / 128;
          else if (bits === 16) x = v.getInt16(at, true) / 32768;
          else if (bits === 24) x = (v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16)) / 8388608;
          else if (bits === 32) x = v.getInt32(at, true) / 2147483648;
          else return null;
          sum += x;
        }
        data[i] = sum / channels;
      }
      return { rate, data };
    }
    o = body + size + (size % 2);
  }
  return null;
}

export function writeWav(data: Float32Array, rate = RATE): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(44 + data.length * 2);
  const v = new DataView(buf.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + data.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, data[i]!)) * 32767), true);
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

/** A stable 16-hex-digit id for a note's parts (two 32-bit FNV-1a hashes). */
function noteId(key: string): string {
  const fnv = (s: string, h: number) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  return fnv(key, 0x811c9dc5) + fnv(`#${key}`, 0x9e3779b9);
}

/** Spliced notes kept ready (about 1 MB each); older ones are built again if asked for. */
const KEEP_BUILT = 24;

export class VoiceNotes {
  private notes = new Map<string, { parts: string[]; wav?: Uint8Array; url?: string; duration: number }>();
  private clips = new Map<string, Float32Array>();
  /** Ids of the notes with a WAV in memory, least recently used first. */
  private built = new Set<string>();

  /** Without a source (tests) every clip is silence. */
  constructor(private source: VoiceSource | null) {}

  private clip(name: string): Float32Array {
    const cached = this.clips.get(name);
    if (cached) return cached;
    const wav = this.source?.wav(name);
    const c = wav ? readWav(wav) : null;
    const data = c ? tidy(resample(c, RATE), RATE) : new Float32Array(0);
    this.clips.set(name, data);
    return data;
  }

  /** A whole recorded line and its length. */
  line(name: string): { url: string; duration: number } {
    const wav = this.source?.wav(name);
    const c = wav ? readWav(wav) : null;
    return { url: this.source?.lineUrl(name) ?? `/voice/${name}`, duration: c ? c.data.length / c.rate : 3 };
  }

  /** Forget cached clips (recordings were added while the server runs). */
  reload(): void {
    this.clips.clear();
    this.built.clear();
    for (const n of this.notes.values()) n.wav = n.url = undefined;
  }

  /**
   * Reads every clip a note is made of, once, so the first voice note of the evening doesn't
   * hold up the game while they load (later notes take a few milliseconds).
   */
  warm(): void {
    const V = FI.voice;
    for (const name of [V.codeWord[0], ...V.intros.map((x) => x[0]), ...V.outros.map((x) => x[0]), ...V.alphabet.map((x) => x[2])]) this.clip(name);
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
    const id = noteId(parts.join('|'));
    let note = this.notes.get(id);
    if (!note) {
      note = { parts, duration: 0 };
      this.notes.set(id, note);
    }
    const wav = this.build(id)!;
    note.url ??= this.source ? this.source.noteUrl(id, wav) : `/voicenote/${id}.wav`;
    return { url: note.url, duration: (wav.length - 44) / 2 / RATE };
  }

  /** The spliced WAV for a note id, built on first use. */
  build(id: string): Uint8Array | null {
    const note = this.notes.get(id);
    if (!note) return null;
    this.built.delete(id);
    this.built.add(id);
    if (note.wav) return note.wav;
    if (this.built.size > KEEP_BUILT) {
      const oldest = this.built.values().next().value!;
      this.built.delete(oldest);
      this.notes.get(oldest)!.wav = undefined;
    }
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
