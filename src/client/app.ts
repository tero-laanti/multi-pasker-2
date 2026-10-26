import * as THREE from 'three';
import type { KillSpeedPreset, WeaponId } from '../shared/config';
import { UI } from '../shared/ui';
import { buildGarrison } from '../shared/map/garrison';
import { buildRange } from '../shared/map/range';
import type { ServerMsg } from '../shared/protocol';
import { AudioEngine } from './audio/engine';
import { Game, type GameDeps } from './game/game';
import { MatchMode } from './game/match';
import { prepareHands } from './game/models/hands';
import { RangeMode } from './game/rangeMode';
import { ViewModel } from './game/viewmodel';
import { Input } from './input';
import { Net } from './net';
import { Renderer } from './render/renderer';
import { loadSettings, saveSettings, type Settings } from './settings';
import { DevPanel } from './ui/dev';
import { Hud } from './ui/hud';
import { MatchHud } from './ui/matchHud';
import { Menu, loadName, saveName } from './ui/menu';
import { PairPanel, type PairInfo } from './ui/pair';
import { StatsOverlay } from './ui/stats';
import { TuningPanel } from './ui/tuning';

type Mode = 'loading' | 'menu' | 'range' | 'match';

const TOKEN_KEY = 'pasker.token';
const IN_MATCH_KEY = 'pasker.inMatch';

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

/** Top-level client: owns the renderer, audio, input and UI, and drives the frame loop. */
export class App {
  private settings: Settings = loadSettings();
  private canvas: HTMLCanvasElement;
  private renderer!: Renderer;
  private audio = new AudioEngine();
  private input: Input;
  private net = new Net();
  private hud: Hud;
  private matchHud: MatchHud;
  private menu: Menu;
  private pairPanels: PairPanel[];
  private stats: StatsOverlay;
  private tuning: TuningPanel;
  private dev!: DevPanel;
  private viewmodel!: ViewModel;
  private rangeGame: Game | null = null;
  private range: RangeMode | null = null;
  private matchGame: Game | null = null;
  private match: MatchMode | null = null;
  private mode: Mode = 'loading';
  private killSpeed: KillSpeedPreset = 'cod';
  /** Tests drive frames themselves (see exposeDebug). */
  private manualClock = false;
  private last = performance.now();
  private attractTime = 0;
  private joinTimer = 0;

  constructor(private root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view';
    root.appendChild(this.canvas);
    this.input = new Input(this.canvas);
    this.hud = new Hud(root);
    this.hud.setVisible(false);
    this.matchHud = new MatchHud(this.hud.root);
    this.matchHud.setVisible(false);
    this.stats = new StatsOverlay(root);
    this.tuning = new TuningPanel(root);
    this.menu = new Menu(root, this.settings, {
      startRange: () => this.startRange(),
      joinMatch: (name) => this.joinMatch(name),
      resume: () => void this.lock(),
      quit: () => this.quitToMenu(),
      settingsChanged: (s, reload) => this.applySettings(s, reload),
      toggleTuning: () => this.tuning.toggle(),
      toggleStats: () => this.stats.toggle(),
      toggleDev: () => this.dev.toggle(),
    });
    this.pairPanels = [new PairPanel(() => this.openSimulator()), new PairPanel(() => this.openSimulator())];
    this.menu.addPairPanels(this.pairPanels[0]!.root, this.pairPanels[1]!.root);
    this.input.onLook = (dx, dy) => this.game?.onLook(dx, dy);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKeyDown = (code) => this.onKey(code);
    this.menu.overlayElement().addEventListener('click', () => void this.lock());
    window.addEventListener('resize', () => this.renderer?.resize());
    window.addEventListener('beforeunload', (e) => {
      if (this.mode === 'match') {
        e.preventDefault();
        e.returnValue = UI.menu.leaveConfirm;
      }
    });
    document.addEventListener('pointerdown', () => this.audio.unlock());
    document.addEventListener('keydown', () => this.audio.unlock());
    this.net.onMessage = (msg) => this.onServerMessage(msg);
    this.net.onSnapshot = (s, at) => this.match?.onSnapshot(s, at);
    this.net.onOpen = () => {
      if (this.match) this.match.hello();
    };
    this.net.onClose = () => this.match?.connectionLost();
  }

  /** The game currently shown: the match while in one, otherwise the range. */
  get game(): Game | null {
    return this.mode === 'match' ? this.matchGame : this.rangeGame;
  }

  private deps(): GameDeps {
    return { renderer: this.renderer, audio: this.audio, input: this.input, settings: this.settings, hud: this.hud, viewmodel: this.viewmodel };
  }

  async start(): Promise<void> {
    this.menu.showLoading();
    this.net.connect();
    const map = buildRange();
    this.renderer = new Renderer(this.canvas, this.settings.quality, map.sunDir);
    this.renderer.setView(this.settings.fov, this.settings.renderScale);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.effectsVolume);
    await document.fonts.ready.catch(() => undefined);
    const audioLoad = this.audio.load((done, total) => this.menu.showLoading(`${UI.menu.loading} ${done}/${total}`));
    await prepareHands();
    const t0 = performance.now();
    this.viewmodel = new ViewModel(this.renderer.vmScene);
    this.viewmodelBuildMs = performance.now() - t0;
    this.rangeGame = new Game(this.deps(), map);
    this.range = new RangeMode(this.rangeGame);
    this.rangeGame.mode = this.range;
    this.rangeGame.activate();
    this.renderer.warmup();
    this.dev = new DevPanel(this.root, {
      inMatch: () => this.mode === 'match',
      reload: () => (this.mode === 'match' ? this.devCommand('reload') : this.range?.reload()),
      giveRifle: (all) => (this.mode === 'match' ? this.devCommand('giveRifle', all ? 'all' : 'me') : this.range?.give('rifle')),
      giveGrenade: () => (this.mode === 'match' ? this.devCommand('giveGrenade') : this.range?.giveGrenade()),
      startDrill: () => this.range?.range.startDrill(),
      setDirectReload: (on) => {
        const g = this.game;
        if (g) g.devDirectReload = on;
        if (this.mode === 'match') this.devCommand('directReload', on);
      },
      directReload: () => this.game?.devDirectReload ?? true,
      setKillSpeed: (p) => {
        this.killSpeed = p;
        if (this.rangeGame) this.rangeGame.killSpeed = p;
        if (this.mode === 'match') this.devCommand('killSpeed', p);
      },
      killSpeed: () => this.killSpeed,
      connection: () => {
        const s = this.net.stats;
        return s.connected ? `${UI.dev.connected}, RTT ${Number.isFinite(s.rtt) ? s.rtt.toFixed(1) : '–'} ms` : UI.dev.disconnected;
      },
      addBot: () => this.devCommand('addBot'),
      removeBot: () => this.devCommand('removeBot'),
      fillBots: () => this.devCommand('fillBots'),
      restartRound: () => this.devCommand('restartRound'),
      killMe: () => this.devCommand('killMe'),
      offer: () => this.devCommand('offer'),
      advance: () => this.devCommand('advance'),
      endRound: () => this.devCommand('endRound'),
      newEvening: () => this.devCommand('newEvening'),
      openSimulator: () => this.openSimulator(),
      setGate: (open) => this.devCommand('gate', open),
      gateOpen: () => this.match?.round?.gateOpen ?? false,
      setNetConditions: (lat, jit) => {
        this.net.lagMs = lat;
        this.net.jitterMs = jit;
      },
      players: () => (this.match ? [...this.match.players.values()] : []),
    });
    await audioLoad;
    this.mode = 'menu';
    this.menu.showMain();
    this.exposeDebug();
    requestAnimationFrame((t) => this.loop(t));
    // A tab reloaded during a match rejoins its player straight away.
    const name = loadName();
    if (storage('session')?.getItem(IN_MATCH_KEY) === '1' && name) this.joinMatch(name);
  }

  /** Time spent building weapon models and hands at start-up (ms). */
  viewmodelBuildMs = 0;

  private devCommand(cmd: string, arg?: unknown): void {
    this.match?.send({ t: 'dev', cmd, arg });
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const dtMs = now - this.last;
    this.last = now;
    const dt = Math.min(0.25, Math.max(0, dtMs / 1000));
    const game = this.game;
    const t0 = performance.now();
    if (game && !this.manualClock) {
      if (this.mode === 'menu') this.attract(dt);
      game.frame(dt);
    }
    this.cpuMs = performance.now() - t0;
    const remotes = this.match?.remotes;
    this.stats.frame(dtMs, {
      net: this.net.stats,
      draws: this.renderer.info.calls,
      tris: this.renderer.info.triangles,
      gpu: (this.gpuName ??= this.renderer.gpuName()),
      simSteps: game?.lastFrameSteps ?? 0,
      snapshotRate: this.mode === 'match' ? this.net.stats.snapshotRate : null,
      interpDelay: this.mode === 'match' && remotes ? remotes.clock.delay / 1000 : null,
      cpuMs: this.cpuMs,
      extra: () => [
        `Raw input: ${this.input.rawActive ? 'on' : 'off'}   Gunshot voices: ${this.audio.activeGunshots}`,
        ...(this.mode === 'match' && remotes ? [`Players drawn: ${[...remotes.players.values()].filter((p) => p.char.object.visible).length}   State age: ${remotes.buffer.age.toFixed(0)} ms`] : []),
      ],
    });
  }

  private gpuName: string | undefined;
  /** Main-thread time of the last frame (ms). */
  cpuMs = 0;

  /** Slow camera pan over the range behind the main menu. */
  private attract(dt: number): void {
    const g = this.rangeGame;
    if (!g) return;
    this.attractTime += dt;
    g.paused = true;
    const t = this.attractTime * 0.05;
    g.camOverride = { x: -9 + Math.sin(t) * 3, y: 6.8, z: 15, yaw: -0.24 + Math.sin(t * 0.7) * 0.06, pitch: -0.15 };
  }

  private startRange(): void {
    this.audio.unlock();
    this.mode = 'range';
    this.hud.setVisible(true);
    this.matchHud.setVisible(false);
    const g = this.rangeGame;
    if (g) {
      g.camOverride = null;
      g.yaw = 0;
      g.pitch = 0;
    }
    void this.lock();
  }

  /** Builds the garrison and asks the server to let us in (or back in, with our token). */
  private joinMatch(name: string): void {
    this.audio.unlock();
    saveName(name);
    if (!this.matchGame) {
      this.matchGame = new Game(this.deps(), buildGarrison());
      this.matchGame.killSpeed = this.killSpeed;
    }
    if (this.match) this.match.dispose();
    const token = storage('local')?.getItem(TOKEN_KEY) ?? undefined;
    this.match = new MatchMode(this.matchGame, this.net, this.matchHud, { name, token });
    this.match.onPairInfo = (info) => this.showPairInfo(info);
    this.matchGame.mode = this.match;
    this.match.hello();
    window.clearTimeout(this.joinTimer);
    this.joinTimer = window.setTimeout(() => {
      if (this.match && !this.match.joined && this.mode !== 'match') this.menu.showJoin(UI.menu.serverOffline);
    }, 4000);
  }

  private showPairInfo(info: PairInfo | null): void {
    for (const p of this.pairPanels) p.update(info, this.match?.dev ?? false);
  }

  /** Development: the phone app in a phone-sized window, typed on with the real keyboard. */
  private openSimulator(): void {
    const token = this.match?.pairInfo?.token;
    if (!token) return;
    window.open(`/phone?sim=1#${token}`, 'kenttaposti-sim', 'width=460,height=960');
  }

  private onServerMessage(msg: ServerMsg): void {
    const m = this.match;
    if (!m) return;
    const first = msg.t === 'welcome' && this.mode !== 'match';
    m.onMessage(msg);
    if (msg.t === 'welcome') {
      storage('local')?.setItem(TOKEN_KEY, msg.token);
      storage('session')?.setItem(IN_MATCH_KEY, '1');
    }
    if (first) this.enterMatch();
  }

  private enterMatch(): void {
    window.clearTimeout(this.joinTimer);
    this.rangeGame?.deactivate();
    this.matchGame!.activate();
    this.mode = 'match';
    this.menu.setInMatch(true);
    this.hud.setMatch(true);
    this.hud.setVisible(true);
    this.matchHud.setVisible(true);
    this.matchGame!.paused = true;
    this.renderer.warmup();
    this.menu.showOverlay(false);
    void this.lock();
  }

  private async lock(): Promise<void> {
    this.audio.unlock();
    try {
      await this.input.lock(this.settings.rawInput);
    } catch {
      this.menu.showOverlay(false, UI.menu.pointerLockFailed);
    }
  }

  private onLockChange(locked: boolean): void {
    const g = this.game;
    if ((this.mode !== 'range' && this.mode !== 'match') || !g) return;
    if (locked) {
      this.menu.hide();
      g.paused = false;
      this.input.clearPresses();
    } else {
      g.paused = true;
      this.menu.showPause();
    }
  }

  private onKey(code: string): void {
    if (code === 'F3') this.stats.toggle();
    else if (code === 'F4') this.tuning.toggle();
    else if (code === 'F2' || code === 'Backquote') this.dev?.toggle();
  }

  private quitToMenu(): void {
    if (this.mode === 'match') {
      this.match?.leave();
      this.match?.dispose();
      this.match = null;
      this.matchGame?.deactivate();
      storage('session')?.removeItem(IN_MATCH_KEY);
      this.menu.setInMatch(false);
      this.showPairInfo(null);
      this.hud.setMatch(false);
      this.matchHud.setVisible(false);
      this.matchHud.reset();
      this.rangeGame?.activate();
    }
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
    const app = this;
    (window as unknown as { __pasker: unknown }).__pasker = {
      app: this,
      get game() {
        return app.game;
      },
      get match() {
        return app.match;
      },
      get range() {
        return app.range;
      },
      renderer: this.renderer,
      audio: this.audio,
      stats: this.stats,
      input: this.input,
      net: this.net,
      manual: (on: boolean) => {
        this.manualClock = on;
      },
      /** Renders the held weapon and hands from an orbit camera (degrees, metres). */
      vmOrbit: (yawDeg: number, pitchDeg: number, dist: number, fov = 30) => {
        const g = this.game;
        const m = g?.viewmodel.model(g.weapons.current);
        if (!m) return;
        m.root.updateWorldMatrix(true, true);
        const target = new THREE.Vector3(0, -0.03, -0.06).applyMatrix4(m.root.matrixWorld);
        this.renderer.renderViewmodelOrbit(target, (yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180, dist, fov);
      },
      play: () => {
        if (this.mode === 'menu' || this.mode === 'loading') this.mode = 'range';
        this.hud.setVisible(true);
        this.menu.hide();
        this.input.locked = true;
        const g = this.game;
        if (g) {
          g.camOverride = null;
          g.paused = false;
        }
      },
      join: (name: string) => this.joinMatch(name),
      give: (w: WeaponId) => this.range?.give(w),
    };
  }
}
