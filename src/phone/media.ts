import wakeMp4 from '../../assets/phone/wake.mp4?url';
import wakeWebm from '../../assets/phone/wake.webm?url';

/**
 * Keeps the screen on with a hidden, muted, looping video (the Wake Lock API needs HTTPS),
 * and plays sounds through <audio> elements, which also work with an iPhone's silent switch on.
 * Both need a tap first; `start()` is called from one.
 */
export class Media {
  private video: HTMLVideoElement;
  private sounds = new Map<string, HTMLAudioElement>();
  started = false;

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.className = 'wake-video';
    for (const [src, type] of [
      [wakeWebm, 'video/webm'],
      [wakeMp4, 'video/mp4'],
    ]) {
      const s = document.createElement('source');
      s.src = src!;
      s.type = type!;
      v.appendChild(s);
    }
    document.body.appendChild(v);
    this.video = v;
    for (const name of ['phone_chime', 'phone_in', 'phone_out']) {
      const a = new Audio(`/sfx/${name}`);
      a.preload = 'auto';
      this.sounds.set(name, a);
    }
    // Locking the screen pauses media; resume the video when the page is shown again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.started) void this.video.play().catch(() => undefined);
    });
  }

  /** From a tap: start the wake video and allow sounds. */
  async start(): Promise<void> {
    this.started = true;
    try {
      await this.video.play();
    } catch {
      // Some browsers refuse; the screen may then dim as usual.
    }
    // Touching each sound inside the gesture unlocks it for later playback on iOS.
    for (const a of this.sounds.values()) {
      a.muted = true;
      void a
        .play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {
          a.muted = false;
        });
    }
  }

  get awake(): boolean {
    return !this.video.paused;
  }

  play(name: string, volume = 1): void {
    const a = this.sounds.get(name);
    if (!a || !this.started) return;
    a.volume = volume;
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  }
}
