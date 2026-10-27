import { AUDIO } from '../../shared/config';

export interface PlayOptions {
  volume?: number;
  /** Playback rate; small random variation is added unless `exactRate` is set. */
  rate?: number;
  exactRate?: boolean;
  delay?: number;
  bus?: 'sfx' | 'ui' | 'voice';
  /** Counts towards the gunshot voice cap. */
  gunshot?: boolean;
}

export interface SpatialOptions extends PlayOptions {
  refDistance?: number;
  rolloff?: number;
  maxDistance?: number;
  /** Delay by the speed of sound (on by default). */
  soundDelay?: boolean;
}

interface Voice {
  src: AudioBufferSourceNode;
  dist: number;
  end: number;
}

const SPEED_OF_SOUND = 343;

/**
 * Sound effects. Files come from /sfx/<name> (see the server's AudioFolder); variants are
 * named `<base>_1`, `<base>_2`… and picked at random without immediate repeats.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly ui: GainNode;
  readonly voice: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  private gunVoices: Voice[] = [];
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private voices = new Map<string, Promise<AudioBuffer | null>>();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.connect(limiter);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.ui = this.ctx.createGain();
    this.ui.connect(this.master);
    this.voice = this.ctx.createGain();
    this.voice.connect(this.master);
  }

  /** Must be called from a user gesture before anything is audible. */
  unlock(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolumes(master: number, effects: number, guns = 1): void {
    this.master.gain.value = master;
    this.sfx.gain.value = effects;
    this.guns = guns;
  }

  /** The player's gunshot level (Settings), on top of AUDIO.gunVolume. */
  private guns = 1;

  /** A gunshot sound's volume: its own level times AUDIO.gunVolume and the player's setting. */
  gun(volume: number): number {
    return volume * AUDIO.gunVolume * this.guns;
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const manifest = (await (await fetch('/sfx/manifest.json')).json()) as Record<string, string>;
    const names = Object.keys(manifest);
    let done = 0;
    await Promise.all(
      names.map(async (file) => {
        try {
          const data = await (await fetch(`/sfx/${file}`)).arrayBuffer();
          const buf = await this.ctx.decodeAudioData(data);
          const base = file.replace(/_\d+$/, '');
          const list = this.buffers.get(base) ?? [];
          list.push(buf);
          this.buffers.set(base, list);
        } catch (err) {
          console.warn('sound failed to load', file, err);
        }
        onProgress?.(++done, names.length);
      }),
    );
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  duration(name: string): number {
    return this.buffers.get(name)?.[0]?.duration ?? 0;
  }

  private pick(name: string): AudioBuffer | null {
    const list = this.buffers.get(name);
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list[0]!;
    const prev = this.last.get(name) ?? -1;
    let i = Math.floor(Math.random() * list.length);
    if (i === prev) i = (i + 1) % list.length;
    this.last.set(name, i);
    return list[i]!;
  }

  private source(buf: AudioBuffer, o: PlayOptions): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rate = o.rate ?? 1;
    src.playbackRate.value = o.exactRate ? rate : rate * (0.97 + Math.random() * 0.06);
    return src;
  }

  private bus(o: PlayOptions): GainNode {
    return o.bus === 'ui' ? this.ui : o.bus === 'voice' ? this.voice : this.sfx;
  }

  /** Non-positional sound (own weapon, UI). */
  play(name: string, o: PlayOptions = {}): AudioBufferSourceNode | null {
    const buf = this.pick(name);
    if (!buf || this.ctx.state !== 'running') return null;
    const src = this.source(buf, o);
    const g = this.ctx.createGain();
    g.gain.value = o.volume ?? 1;
    src.connect(g).connect(this.bus(o));
    const when = this.ctx.currentTime + (o.delay ?? 0);
    src.start(when);
    if (o.gunshot) this.trackGunshot(src, 0, when + buf.duration);
    return src;
  }

  /** Positional sound with HRTF panning, distance attenuation, air absorption and travel delay. */
  playAt(name: string, x: number, y: number, z: number, o: SpatialOptions = {}): void {
    const buf = this.pick(name);
    if (!buf || this.ctx.state !== 'running') return;
    const dist = Math.hypot(x - this.lx, y - this.ly, z - this.lz);
    const maxD = o.maxDistance ?? AUDIO.hearingRange;
    if (dist > maxD) return;
    if (o.gunshot && !this.makeRoomForGunshot(dist)) return;
    const ctx = this.ctx;
    const src = this.source(buf, o);
    const g = ctx.createGain();
    g.gain.value = o.volume ?? 1;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = o.refDistance ?? 2;
    p.rolloffFactor = o.rolloff ?? 1;
    p.maxDistance = maxD;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(2500, 20000 - dist * 160);
    src.connect(lp).connect(g).connect(p).connect(this.bus(o));
    const delay = (o.delay ?? 0) + (o.soundDelay === false ? 0 : dist / SPEED_OF_SOUND);
    const when = ctx.currentTime + delay;
    src.start(when);
    if (o.gunshot) this.trackGunshot(src, dist, when + buf.duration);
  }

  /** Voice lines from /voice/<name> (recordings override placeholders), loaded on first use. */
  playVoice(name: string, volume = 1): void {
    let p = this.voices.get(name);
    if (!p) {
      p = fetch(`/voice/${name}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx.decodeAudioData(b))
        .catch(() => null);
      this.voices.set(name, p);
    }
    void p.then((buf) => {
      if (!buf || this.ctx.state !== 'running') return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.voice);
      src.start();
    });
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(ux, t);
      l.upY.setValueAtTime(uy, t);
      l.upZ.setValueAtTime(uz, t);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  get activeGunshots(): number {
    this.pruneGunshots();
    return this.gunVoices.length;
  }

  private pruneGunshots(): void {
    const now = this.ctx.currentTime;
    this.gunVoices = this.gunVoices.filter((v) => v.end > now);
  }

  /** Keeps at most AUDIO.maxGunshotVoices, dropping the farthest first. */
  private makeRoomForGunshot(dist: number): boolean {
    this.pruneGunshots();
    if (this.gunVoices.length < AUDIO.maxGunshotVoices) return true;
    let far = 0;
    for (let i = 1; i < this.gunVoices.length; i++) if (this.gunVoices[i]!.dist > this.gunVoices[far]!.dist) far = i;
    if (this.gunVoices[far]!.dist < dist) return false;
    try {
      this.gunVoices[far]!.src.stop();
    } catch {
      // Already stopped.
    }
    this.gunVoices.splice(far, 1);
    return true;
  }

  private trackGunshot(src: AudioBufferSourceNode, dist: number, end: number): void {
    if (!this.makeRoomForGunshot(dist)) {
      src.stop();
      return;
    }
    this.gunVoices.push({ src, dist, end });
  }
}
