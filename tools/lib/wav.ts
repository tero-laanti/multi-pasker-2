import fs from 'node:fs';

export interface Wav {
  sampleRate: number;
  channels: Float32Array[];
}

/** Minimal PCM/float WAV reader (16/24/32-bit int, 32-bit float). */
export function readWav(file: string): Wav {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`not a WAV: ${file}`);
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const rate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe) format = buf.readUInt16LE(body + 24);
      fmt = { format, channels, rate, bits };
    } else if (id === 'data' && fmt) {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const chans = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          const o = body + (i * fmt.channels + c) * bytes;
          let v: number;
          if (fmt.format === 3) v = buf.readFloatLE(o);
          else if (fmt.bits === 16) v = buf.readInt16LE(o) / 32768;
          else if (fmt.bits === 24) v = buf.readIntLE(o, 3) / 8388608;
          else if (fmt.bits === 32) v = buf.readInt32LE(o) / 2147483648;
          else throw new Error(`unsupported bits ${fmt.bits}`);
          chans[c]![i] = v;
        }
      }
      return { sampleRate: fmt.rate, channels: chans };
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`no data chunk: ${file}`);
}

/** Writes 16-bit PCM WAV. */
export function writeWav(file: string, sampleRate: number, channels: Float32Array[]): void {
  const n = channels[0]!.length;
  const ch = channels.length;
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      data.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), (i * ch + c) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(ch, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * ch * 2, 28);
  header.writeUInt16LE(ch * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

export function mono(w: Wav): Float32Array {
  const n = w.channels[0]!.length;
  const out = new Float32Array(n);
  for (const c of w.channels) for (let i = 0; i < n; i++) out[i]! += c[i]! / w.channels.length;
  return out;
}

/** Sample indices where a sharp energy rise starts (gunshot onsets). */
export function onsets(x: Float32Array, rate: number, minGap = 0.05, ratio = 8, floor = 0.02): number[] {
  const hop = Math.round(rate * 0.002);
  const out: number[] = [];
  let slow = 1e-6;
  let lastOnset = -Infinity;
  for (let i = 0; i + hop < x.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e = Math.max(e, Math.abs(x[j]!));
    if (e > floor && e > slow * ratio && i - lastOnset > minGap * rate) {
      // Walk back to the first sample above 10 % of this window's peak.
      let s = i;
      while (s > 0 && Math.abs(x[s - 1]!) > e * 0.1 && i - s < hop * 2) s--;
      out.push(s);
      lastOnset = i;
    }
    slow = slow * 0.97 + e * 0.03;
  }
  return out;
}
