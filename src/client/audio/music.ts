import songUrl from '../../../assets/music/main-menu.mp3?url';
import { AUDIO } from '../../shared/config';

type Scene = 'off' | 'menu' | 'range' | 'clip';

/**
 * The soundtrack: one song, streamed through the mixer (an <audio> element, not a decoded
 * buffer). The main menu plays it from the top; on the range it carries on very quietly; a match
 * is silent, except a clip from 2:20 that fades in and out over a break and the match's results.
 */
export class Music {
  private el = new Audio(songUrl);
  private gain: GainNode;
  private scene: Scene = 'off';
  private stopTimer = 0;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    this.el.loop = true;
    this.el.preload = 'auto';
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(this.el).connect(this.gain).connect(out);
  }

  /** The main menu: from the top (or louder, if the range had it going). */
  menu(): void {
    this.to('menu', AUDIO.music.menu);
  }

  /** On the range: the same song, very quietly. */
  range(): void {
    this.to('range', AUDIO.music.range);
  }

  /** A round under way: silence. */
  off(): void {
    if (this.scene === 'off') return;
    this.scene = 'off';
    this.fade(0, AUDIO.music.fadeOut);
    this.stopAfter(AUDIO.music.fadeOut);
  }

  /** A break of `seconds` (the match's results if `long`): the clip fades in, and out as it ends. */
  clip(seconds: number, long: boolean): void {
    const M = AUDIO.music;
    const len = Math.min(seconds, long ? M.resultsClip : M.breakClip);
    if (len < M.fadeIn + M.fadeOut) return;
    this.scene = 'clip';
    this.el.loop = false;
    this.el.currentTime = M.clipFrom;
    this.play();
    const g = this.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(M.clip, t + M.fadeIn);
    g.setValueAtTime(M.clip, t + len - M.fadeOut);
    g.linearRampToValueAtTime(0, t + len);
    this.stopAfter(len);
  }

  /** After the first click or key: browsers don't let the song start before one. */
  resume(): void {
    if (this.scene !== 'off' && this.el.paused) this.play();
  }

  private to(scene: 'menu' | 'range', level: number): void {
    if (this.scene === scene) return;
    // From silence the song starts over; between the menu and the range it carries on.
    const fromTop = this.scene === 'off' || this.scene === 'clip';
    this.scene = scene;
    window.clearTimeout(this.stopTimer);
    this.el.loop = true;
    if (fromTop) {
      this.el.currentTime = 0;
      this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    this.play();
    this.fade(level, fromTop ? AUDIO.music.fadeIn : AUDIO.music.fadeOut);
  }

  private fade(level: number, seconds: number): void {
    const g = this.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + seconds);
  }

  /** Pauses the element once the fade is over (unless something else wants it by then). */
  private stopAfter(seconds: number): void {
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      if (this.scene === 'off' || this.scene === 'clip') this.el.pause();
    }, seconds * 1000 + 100);
  }

  private play(): void {
    this.el.play().catch(() => undefined);
  }
}
