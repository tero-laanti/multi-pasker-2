import * as THREE from 'three';
import { WEB_MATCH, type KillSpeedPreset, type WeaponId } from '../shared/config';
import { UI } from '../shared/ui';
import { buildGarrison } from '../shared/map/garrison';
import { buildRange } from '../shared/map/range';
import type { ServerMsg } from '../shared/protocol';
import { AudioEngine } from './audio/engine';
import { Game, type GameDeps } from './game/game';
import { MatchMode } from './game/match';
import { RangeMode } from './game/rangeMode';
import { TutorialMode, markTutorialDone, tutorialDone } from './game/tutorial';
import { ViewModel } from './game/viewmodel';
import { Input } from './input';
import type { LocalServer } from './local/server';
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
import { TutorialHud } from './ui/tutorialHud';
import { VirtualPhone } from './ui/virtualPhone';
import { WEB } from './web';

type Mode = 'loading' | 'menu' | 'range' | 'training' | 'match';

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
  /** The training on the range before a first match. */
  private tutorial: TutorialMode | null = null;
  /** The web version's bot match: the server running in this page, from the first Start on. */
  private local: LocalServer | null = null;
  private tutorialHud: TutorialHud;
  private virtualPhone: VirtualPhone;
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
      deploy: () => this.deploy(),
      quit: () => this.quitToMenu(),
      settingsChanged: (s, reload) => this.applySettings(s, reload),
      toggleTuning: () => this.tuning.toggle(),
      toggleStats: () => this.stats.toggle(),
      toggleDev: () => this.dev.toggle(),
      matchSettings: () => (this.mode === 'match' && this.match?.devAllowed && !this.match.training ? this.match.settings : null),
      setMatchSettings: (s) => this.match?.send({ t: 'settings', s }),
      newMatch: () => this.devCommand('newMatch'),
    });
    const pairPanel = () => new PairPanel(() => this.openSimulator(), () => this.openVirtualPhone());
    this.pairPanels = [pairPanel(), pairPanel()];
    this.menu.addPairPanels(this.pairPanels[0]!.root, this.pairPanels[1]!.root);
    this.tutorialHud = new TutorialHud(this.hud.root, root, {
      resume: () => {
        this.tutorialHud.hideModal();
        void this.lock();
      },
      openSimulator: () => this.openSimulator(),
      openVirtual: () => this.openVirtualPhone(),
    });
    this.pairPanels.push(this.tutorialHud.pair);
    this.virtualPhone = new VirtualPhone(root);
    this.virtualPhone.onClose = (escape) => this.closeVirtualPhone(escape);
    this.menu.setTrainingNote(!tutorialDone());
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
    if (!WEB) this.net.connect();
    const map = buildRange();
    this.renderer = new Renderer(this.canvas, this.settings.quality, map.sunDir);
    this.renderer.setView(this.settings.fov, this.settings.renderScale);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.effectsVolume, this.settings.gunVolume, this.settings.musicVolume);
    await document.fonts.ready.catch(() => undefined);
    const audioLoad = this.audio.load((done, total) => this.menu.showLoading(`${UI.menu.loading} ${done}/${total}`));
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
      devAllowed: () => this.match?.devAllowed ?? false,
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
      serve: () => this.devCommand('serve'),
      money: () => this.devCommand('money'),
      advance: () => this.devCommand('advance'),
      inventory: () => this.devCommand('inventory'),
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
    this.switchMode('menu');
    this.menu.showMain();
    this.exposeDebug();
    requestAnimationFrame((t) => this.loop(t));
    // A tab reloaded during a match rejoins its player straight away (a bot match went with the page).
    const name = loadName();
    if (!WEB && storage('session')?.getItem(IN_MATCH_KEY) === '1' && name) this.joinMatch(name);
  }

  /** Time spent building weapon models and hands at start-up (ms). */
  viewmodelBuildMs = 0;

  /**
   * The app's state, and the soundtrack that goes with it: the song in the main menu, quietly on
   * the range, and in a match whatever its round calls for (silence, or a clip over a break).
   */
  private switchMode(mode: Mode): void {
    this.mode = mode;
    const music = this.audio.music;
    if (mode === 'menu') music.menu();
    else if (mode === 'range' || mode === 'training') music.range();
    else if (mode === 'match') {
      if (this.match) this.match.syncMusic();
      else music.off();
    }
  }

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
    this.switchMode('range');
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
    if (WEB && !this.local) {
      void this.startLocal().then(() => this.joinMatch(name));
      return;
    }
    if (!this.matchGame) {
      this.matchGame = new Game(this.deps(), buildGarrison());
      this.matchGame.killSpeed = this.killSpeed;
    }
    if (this.match) this.match.dispose();
    const token = storage('local')?.getItem(TOKEN_KEY) ?? undefined;
    this.match = new MatchMode(this.matchGame, this.net, this.matchHud, { name, token, train: !tutorialDone() });
    this.match.onPairInfo = (info) => this.showPairInfo(info);
    this.match.onTraining = (what) => this.tutorial?.supply(what);
    this.matchGame.mode = this.match;
    this.match.hello();
    window.clearTimeout(this.joinTimer);
    this.joinTimer = window.setTimeout(() => {
      if (this.match && !this.match.joined && this.mode !== 'match') this.menu.showJoin(UI.menu.serverOffline);
    }, 4000);
  }

  /**
   * The web version has no server to join: its bot match runs one in this page, with bots, and
   * stays for the page's lifetime. The virtual phone's frame finds it here too.
   */
  private async startLocal(): Promise<void> {
    // Spelled out (not WEB) so the bundler sees a constant and leaves the server code out of the LAN build.
    if (import.meta.env.MODE !== 'web') return;
    const { LocalServer } = await import('./local/server');
    if (this.local) return;
    this.local = new LocalServer(WEB_MATCH.bots);
    (window as unknown as { __paskerLocal: LocalServer }).__paskerLocal = this.local;
    this.net.socket = () => this.local!.connect();
    this.net.connect();
  }

  private showPairInfo(info: PairInfo | null): void {
    for (const p of this.pairPanels) p.update(info, this.match?.dev ?? false);
    // On the range, a phone coming online moves the training on to the radio check.
    if (this.mode === 'training' && this.tutorial && info?.phone === 'online') {
      this.tutorial.paired();
      if (this.tutorialHud.modalOpen) this.tutorialHud.showConnected();
    }
  }

  /**
   * The virtual phone: the phone app on this screen for players without one of their own.
   * The game waits while it is open (the character stands with the phone out).
   */
  private openVirtualPhone(): void {
    const token = this.match?.pairInfo?.token;
    const g = this.game;
    if (!token || !g || (this.mode !== 'match' && this.mode !== 'training')) return;
    this.tutorialHud.hideModal();
    this.menu.hide();
    g.paused = true;
    // The range stands still while paused; keep it running so the phone comes up in the hand.
    g.keepRunning = true;
    this.virtualPhone.show(token);
    this.input.unlock();
  }

  /** Back into the game from the virtual phone (its button is a click, so the mouse locks again). */
  private closeVirtualPhone(toMenu = false): void {
    if (!this.virtualPhone.shown) return;
    this.virtualPhone.hide();
    if (this.mode !== 'match' && this.rangeGame) this.rangeGame.keepRunning = false;
    if (toMenu) this.menu.showPause();
    else void this.lock();
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
    const first = msg.t === 'welcome' && this.mode !== 'match' && this.mode !== 'training';
    m.onMessage(msg);
    if (msg.t === 'welcome') {
      storage('local')?.setItem(TOKEN_KEY, msg.token);
      storage('session')?.setItem(IN_MATCH_KEY, '1');
    }
    if (first && msg.t === 'welcome') {
      if (msg.training) this.enterTraining();
      else this.enterMatch();
    }
  }

  /** Joined the server, but first the training on the range (the server keeps us out of the match). */
  private enterTraining(): void {
    window.clearTimeout(this.joinTimer);
    const g = this.rangeGame!;
    const range = this.range!;
    this.switchMode('training');
    this.menu.setInMatch(false);
    this.menu.setTraining(true, false);
    this.hud.setMatch(false);
    this.hud.setVisible(true);
    this.matchHud.setVisible(false);
    g.camOverride = null;
    g.paused = true;
    range.showDrill = false;
    const t = new TutorialMode(g, range, {
      pickedUp: () => this.pickedUpPhone(),
      phoneOut: () => this.match?.phoneOut ?? false,
      phoneOnline: () => this.match?.pairInfo?.phone === 'online',
    });
    t.onStep = (step) => {
      this.tutorialHud.show(step);
      this.menu.setTraining(true, step === 'done');
    };
    t.onNoSpare = () => this.tutorialHud.noSpare();
    t.onSettled = () => {
      this.tutorialHud.settle();
      range.showDrill = true;
    };
    this.tutorial = t;
    g.mode = t;
    t.start();
    this.tutorialHud.setVisible(true);
    this.menu.showOverlay(false);
    void this.lock();
  }

  /** The phone on the duty table was picked up: pair it (unless one is connected already). */
  private pickedUpPhone(): void {
    this.match?.send({ t: 'radioCheck' });
    if (this.match?.pairInfo?.phone === 'online') return;
    this.tutorialHud.showModal();
    // The pairing screen needs the mouse; no pause menu over it.
    this.input.unlock();
  }

  /** Training done: off the range and into the match. */
  private deploy(): void {
    if (this.mode !== 'training' || !this.tutorial?.complete || !this.match) return;
    markTutorialDone();
    this.menu.setTrainingNote(false);
    this.match.deploy();
    this.leaveTraining();
    this.enterMatch();
  }

  /** The range goes back to plain practice. */
  private leaveTraining(): void {
    this.tutorial?.dispose();
    this.tutorial = null;
    this.tutorialHud.setVisible(false);
    this.menu.setTraining(false, false);
    const g = this.rangeGame;
    if (g && this.range) {
      g.mode = this.range;
      this.range.showDrill = true;
      g.weapons.endlessSpare = true;
      g.weapons.give('pistol');
      g.weapons.give('rifle');
    }
  }

  private enterMatch(): void {
    window.clearTimeout(this.joinTimer);
    this.rangeGame?.deactivate();
    this.matchGame!.activate();
    this.switchMode('match');
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
    if ((this.mode !== 'range' && this.mode !== 'match' && this.mode !== 'training') || !g) return;
    if (!locked && (this.tutorialHud.modalOpen || this.virtualPhone.shown)) {
      g.paused = true;
      return;
    }
    this.tutorialHud.setPanelVisible(locked);
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
    // Esc doesn't count as a click, so it can't lock the mouse: back to the menu instead.
    if (code === 'Escape' && this.virtualPhone.shown) this.closeVirtualPhone(true);
    else if (code === 'F3') this.stats.toggle();
    else if (code === 'F4') this.showPanel(this.tuning);
    else if (code === 'F2' || code === 'Backquote') this.showPanel(this.dev);
  }

  /** Toggles a clickable panel; opening one mid-game frees the mouse (and pauses) so it can be used. */
  private showPanel(panel: { toggle(): void; visible: boolean } | undefined): void {
    if (!panel) return;
    panel.toggle();
    if (panel.visible && this.input.locked) this.input.unlock();
  }

  private quitToMenu(): void {
    this.virtualPhone.dispose();
    if (this.mode === 'training') this.leaveTraining();
    if (this.mode === 'match' || this.mode === 'training') {
      const wasMatch = this.mode === 'match';
      this.match?.leave();
      this.match?.dispose();
      this.match = null;
      if (wasMatch) this.matchGame?.deactivate();
      storage('session')?.removeItem(IN_MATCH_KEY);
      this.menu.setInMatch(false);
      this.showPairInfo(null);
      this.hud.setMatch(false);
      this.matchHud.setVisible(false);
      this.matchHud.reset();
      this.rangeGame?.activate();
    }
    this.switchMode('menu');
    this.attractTime = 0;
    this.hud.setVisible(false);
    this.input.unlock();
    this.menu.showMain();
  }

  private applySettings(s: Settings, reloadNeeded: boolean): void {
    saveSettings(s);
    this.renderer.setView(s.fov, s.renderScale);
    this.audio.setVolumes(s.masterVolume, s.effectsVolume, s.gunVolume, s.musicVolume);
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
        if (this.mode === 'menu' || this.mode === 'loading') this.switchMode('range');
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
