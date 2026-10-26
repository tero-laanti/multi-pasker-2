import { FI } from '../shared/fi';
import { buildRange } from '../shared/map/range';
import { AudioEngine } from './audio/engine';
import { Game } from './game/game';
import { Input } from './input';
import { Net } from './net';
import { Renderer } from './render/renderer';
import { loadSettings, saveSettings, type Settings } from './settings';
import { DevPanel } from './ui/dev';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { StatsOverlay } from './ui/stats';
import { TuningPanel } from './ui/tuning';

type Mode = 'loading' | 'menu' | 'playing';

/** Top-level client: owns the renderer, audio, input and UI, and drives the frame loop. */
export class App {
  private settings: Settings = loadSettings();
  private canvas: HTMLCanvasElement;
  private renderer!: Renderer;
  private audio = new AudioEngine();
  private input: Input;
  private net = new Net();
  private hud: Hud;
  private menu: Menu;
  private stats: StatsOverlay;
  private tuning: TuningPanel;
  private dev!: DevPanel;
  private game: Game | null = null;
  private mode: Mode = 'loading';
  /** Tests drive frames themselves (see exposeDebug). */
  private manualClock = false;
  private last = performance.now();
  private attractTime = 0;

  constructor(private root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view';
    root.appendChild(this.canvas);
    this.input = new Input(this.canvas);
    this.hud = new Hud(root);
    this.hud.setVisible(false);
    this.stats = new StatsOverlay(root);
    this.tuning = new TuningPanel(root);
    this.menu = new Menu(root, this.settings, {
      startRange: () => this.startRange(),
      resume: () => void this.lock(),
      quit: () => this.quitToMenu(),
      settingsChanged: (s, reload) => this.applySettings(s, reload),
      toggleTuning: () => this.tuning.toggle(),
      toggleStats: () => this.stats.toggle(),
      toggleDev: () => this.dev.toggle(),
    });
    this.input.onLook = (dx, dy) => this.game?.onLook(dx, dy);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKeyDown = (code) => this.onKey(code);
    this.menu.overlayElement().addEventListener('click', () => void this.lock());
    window.addEventListener('resize', () => this.renderer?.resize());
    window.addEventListener('beforeunload', (e) => {
      if (this.mode === 'playing') {
        e.preventDefault();
        e.returnValue = FI.menu.leaveConfirm;
      }
    });
    document.addEventListener('pointerdown', () => this.audio.unlock());
    document.addEventListener('keydown', () => this.audio.unlock());
  }

  async start(): Promise<void> {
    this.menu.showLoading();
    this.net.connect();
    const map = buildRange();
    this.renderer = new Renderer(this.canvas, this.settings.quality, map.sunDir);
    this.renderer.setView(this.settings.fov, this.settings.renderScale);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.effectsVolume);
    await document.fonts.ready.catch(() => undefined);
    const audioLoad = this.audio.load((done, total) => this.menu.showLoading(`${FI.menu.loading} ${done}/${total}`));
    this.game = new Game({ renderer: this.renderer, audio: this.audio, input: this.input, settings: this.settings, hud: this.hud }, map);
    this.dev = new DevPanel(this.root, {
      reload: () => this.game?.reload(),
      startDrill: () => this.game?.range.startDrill(),
      setDirectReload: (on) => {
        if (this.game) this.game.devDirectReload = on;
      },
      directReload: () => this.game?.devDirectReload ?? true,
      setKillSpeed: (p) => {
        if (this.game) this.game.killSpeed = p;
      },
      killSpeed: () => this.game?.killSpeed ?? 'cod',
      connection: () => (this.net.stats.connected ? FI.dev.connected : FI.dev.disconnected),
    });
    await audioLoad;
    this.mode = 'menu';
    this.menu.showMain();
    this.exposeDebug();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const dtMs = now - this.last;
    this.last = now;
    const dt = Math.min(0.25, Math.max(0, dtMs / 1000));
    if (this.game && !this.manualClock) {
      if (this.mode === 'menu') this.attract(dt);
      this.game.frame(dt);
    }
    this.stats.frame(dtMs, {
      net: this.net.stats,
      draws: this.renderer.info.calls,
      tris: this.renderer.info.triangles,
      gpu: this.gpuName ??= this.renderer.gpuName(),
      simSteps: this.game?.lastFrameSteps ?? 0,
      snapshotRate: null,
      interpDelay: null,
      extra: () => [`Raakasyöte: ${this.input.rawActive ? 'käytössä' : 'ei käytössä'}   Ääniä: ${this.audio.activeGunshots}`],
    });
  }

  private gpuName: string | undefined;

  /** Slow camera pan over the range behind the main menu. */
  private attract(dt: number): void {
    if (!this.game) return;
    this.attractTime += dt;
    this.game.paused = true;
    // Slow drift above and behind the firing point, looking down the lanes.
    const t = this.attractTime * 0.05;
    this.game.attractCam = { x: -9 + Math.sin(t) * 3, y: 6.8, z: 15, yaw: -0.24 + Math.sin(t * 0.7) * 0.06, pitch: -0.15 };
  }

  private startRange(): void {
    this.audio.unlock();
    this.mode = 'playing';
    this.hud.setVisible(true);
    if (this.game) {
      this.game.attractCam = null;
      this.game.yaw = 0;
      this.game.pitch = 0;
    }
    void this.lock();
  }

  private async lock(): Promise<void> {
    this.audio.unlock();
    try {
      await this.input.lock(this.settings.rawInput);
    } catch {
      this.menu.showOverlay(false, FI.menu.pointerLockFailed);
    }
  }

  private onLockChange(locked: boolean): void {
    if (this.mode !== 'playing' || !this.game) return;
    if (locked) {
      this.menu.hide();
      this.game.paused = false;
      this.input.clearPresses();
    } else {
      this.game.paused = true;
      this.menu.showPause();
    }
  }

  private onKey(code: string): void {
    if (code === 'F3') this.stats.toggle();
    else if (code === 'F4') this.tuning.toggle();
    else if (code === 'F2' || code === 'Backquote') this.dev?.toggle();
  }

  private quitToMenu(): void {
    this.mode = 'menu';
    this.attractTime = 0;
    this.hud.setVisible(false);
    this.input.unlock();
    this.menu.showMain();
  }

  private applySettings(s: Settings, reloadNeeded: boolean): void {
    saveSettings(s);
    this.renderer.setView(s.fov, s.renderScale);
    this.audio.setVolumes(s.masterVolume, s.effectsVolume);
    if (reloadNeeded) location.reload();
  }

  /** Hooks for automated browser tests (tools/e2e). */
  private exposeDebug(): void {
    (window as unknown as { __pasker: unknown }).__pasker = {
      app: this,
      game: this.game,
      renderer: this.renderer,
      audio: this.audio,
      stats: this.stats,
      input: this.input,
      manual: (on: boolean) => {
        this.manualClock = on;
      },
      play: () => {
        this.mode = 'playing';
        this.hud.setVisible(true);
        this.menu.hide();
        this.input.locked = true;
        if (this.game) {
          this.game.attractCam = null;
          this.game.paused = false;
        }
      },
    };
  }
}
