import { MATCH } from '../../shared/config';
import { cleanName, type MatchSettings } from '../../shared/protocol';
import { UI } from '../../shared/ui';
import { DEFAULT_SETTINGS, defaultQuality, type Quality, type Settings } from '../settings';
import { REPO_URL, WEB } from '../web';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const NAME_KEY = 'pasker.name';

export function loadName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) ?? '');
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not persisted.
  }
}

export interface MenuActions {
  startRange(): void;
  joinMatch(name: string): void;
  resume(): void;
  /** Training done: from the range into the match. */
  deploy(): void;
  quit(): void;
  settingsChanged(s: Settings, reloadNeeded: boolean): void;
  toggleTuning(): void;
  toggleStats(): void;
  toggleDev(): void;
  /** The match settings, for the host in a match (null for everyone else). */
  matchSettings(): MatchSettings | null;
  setMatchSettings(s: Partial<MatchSettings>): void;
  newMatch(): void;
}

/** Main menu, settings, click-to-play and pause screens. */
export class Menu {
  readonly root: HTMLDivElement;
  private main: HTMLDivElement;
  private settingsScreen: HTMLDivElement;
  private overlay: HTMLDivElement;
  private overlayText: HTMLDivElement;
  private pause: HTMLDivElement;
  private loading: HTMLDivElement;
  private join: HTMLDivElement;
  private joinInput!: HTMLInputElement;
  private joinError!: HTMLDivElement;
  private joinButton!: HTMLButtonElement;
  private quitButton: HTMLButtonElement;
  private deployButton: HTMLButtonElement;
  private resumeButton: HTMLButtonElement;
  private deployNote: HTMLDivElement;
  private joinNote!: HTMLDivElement;
  private overlayRow: HTMLDivElement;
  private pauseRow: HTMLDivElement;
  private hostButton: HTMLButtonElement;
  private settingsReturn: 'main' | 'pause' = 'main';

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private actions: MenuActions,
  ) {
    this.root = h('div', 'menu-root', undefined, parent);
    this.loading = h('div', 'screen loading', undefined, this.root);
    h('div', 'title', UI.appTitle, this.loading);
    h('div', 'loading-text', UI.menu.loading, this.loading);

    this.main = h('div', 'screen main hidden', undefined, this.root);
    const brand = h('div', 'brand', undefined, this.main);
    h('div', 'title', UI.appTitle, brand);
    h('div', 'tagline', UI.menu.tagline, brand);
    const buttons = h('div', 'buttons', undefined, this.main);
    const range = h('button', 'btn primary', UI.menu.range, buttons);
    range.onclick = () => actions.startRange();
    h('div', 'btn-desc', UI.menu.rangeDesc, buttons);
    const join = h('button', 'btn', WEB ? UI.web.join : UI.menu.join, buttons);
    join.onclick = () => this.showJoin();
    h('div', 'btn-desc', WEB ? UI.web.joinDesc : UI.menu.joinDesc, buttons);
    const set = h('button', 'btn', UI.menu.settings, buttons);
    set.onclick = () => this.showSettings('main');
    this.main.appendChild(this.controls());
    h('div', 'footer', UI.menu.footer, this.main);
    if (WEB) {
      const notice = h('div', 'web-notice', undefined, this.main);
      h('div', 'web-notice-title', UI.web.noticeTitle, notice);
      for (const p of UI.web.notice) h('p', '', p, notice);
      const link = h('a', 'web-notice-link', UI.web.noticeLink, notice);
      link.href = REPO_URL;
      link.target = '_blank';
      link.rel = 'noopener';
    }

    this.settingsScreen = h('div', 'screen settings hidden', undefined, this.root);
    this.join = h('div', 'screen join hidden', undefined, this.root);
    this.buildJoin();

    this.overlay = h('div', 'screen overlay hidden', undefined, this.root);
    this.overlayText = h('div', 'overlay-text', UI.menu.clickToPlay, this.overlay);
    this.overlayRow = h('div', 'overlay-row', undefined, this.overlay);
    this.overlayRow.appendChild(this.controls());

    this.pause = h('div', 'screen pause hidden', undefined, this.root);
    h('div', 'title small', UI.menu.paused, this.pause);
    this.pauseRow = h('div', 'overlay-row', undefined, this.pause);
    const pb = h('div', 'buttons', undefined, this.pauseRow);
    this.deployButton = h('button', 'btn primary hidden', UI.tutorial.toMatch, pb);
    this.deployButton.onclick = () => actions.deploy();
    this.deployNote = h('div', 'btn-desc hidden', UI.tutorial.finishFirst, pb);
    this.resumeButton = h('button', 'btn primary', UI.menu.resume, pb);
    this.resumeButton.onclick = () => actions.resume();
    const ps = h('button', 'btn', UI.menu.settings, pb);
    ps.onclick = () => this.showSettings('pause');
    this.hostButton = h('button', 'btn hidden', UI.host.open, pb);
    this.hostButton.onclick = () => this.showMatchSettings();
    const dev = h('div', 'dev-row', undefined, pb);
    for (const [label, fn] of [
      [UI.dev.title + ' (F2)', () => actions.toggleDev()],
      [UI.dev.stats, () => actions.toggleStats()],
      [UI.dev.tuning, () => actions.toggleTuning()],
    ] as const) {
      const b = h('button', 'btn small', label, dev);
      b.onclick = fn;
    }
    this.quitButton = h('button', 'btn', UI.menu.quit, pb);
    this.quitButton.onclick = () => actions.quit();
  }

  private buildJoin(): void {
    const root = this.join;
    h('div', 'title small', WEB ? UI.web.joinTitle : UI.menu.joinTitle, root);
    const form = h('div', 'join-form', undefined, root);
    h('label', 'join-label', UI.menu.nameLabel, form);
    this.joinInput = h('input', 'join-name', undefined, form);
    this.joinInput.maxLength = 12;
    this.joinInput.autocomplete = 'off';
    this.joinInput.spellcheck = false;
    this.joinInput.value = loadName();
    this.joinInput.oninput = () => {
      const clean = cleanName(this.joinInput.value);
      if (clean !== this.joinInput.value) this.joinInput.value = clean;
      this.joinButton.disabled = clean.length === 0;
      this.joinError.textContent = '';
    };
    this.joinInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !this.joinButton.disabled) this.submitJoin();
    };
    h('div', 'join-hint', UI.menu.nameHint, form);
    this.joinNote = h('div', 'join-hint', UI.tutorial.joinNote, form);
    this.joinError = h('div', 'join-error', '', form);
    const btns = h('div', 'buttons row-buttons', undefined, root);
    this.joinButton = h('button', 'btn primary', WEB ? UI.web.joinButton : UI.menu.joinButton, btns);
    this.joinButton.onclick = () => this.submitJoin();
    const back = h('button', 'btn', UI.menu.back, btns);
    back.onclick = () => this.showMain();
  }

  private submitJoin(): void {
    const name = cleanName(this.joinInput.value);
    if (!name) return;
    saveName(name);
    this.joinButton.disabled = true;
    this.joinError.textContent = UI.menu.joining;
    this.actions.joinMatch(name);
  }

  showJoin(error?: string): void {
    this.hideAll();
    this.joinButton.disabled = cleanName(this.joinInput.value).length === 0;
    this.joinError.textContent = error ?? '';
    this.join.classList.remove('hidden');
    this.joinInput.focus();
    this.joinInput.select();
  }

  /** Phone pairing panels in the click-to-play and pause screens (matches only). */
  addPairPanels(overlay: HTMLElement, pause: HTMLElement): void {
    this.overlayRow.appendChild(overlay);
    this.pauseRow.appendChild(pause);
  }

  /** In a match the pause menu leaves the match instead of quitting the range. */
  setInMatch(on: boolean): void {
    this.quitButton.textContent = on ? UI.menu.leaveMatch : UI.menu.quit;
  }

  /** On the range before the match: "Go to the match", usable once the training is done. */
  setTraining(on: boolean, complete: boolean): void {
    this.deployButton.classList.toggle('hidden', !on);
    this.deployButton.disabled = !complete;
    this.deployNote.classList.toggle('hidden', !on || complete);
    this.resumeButton.classList.toggle('primary', !on || !complete);
  }

  /** The join screen mentions the training only to those who haven't done it. */
  setTrainingNote(show: boolean): void {
    this.joinNote.classList.toggle('hidden', !show);
  }

  private controls(): HTMLDivElement {
    const box = h('div', 'controls');
    h('div', 'controls-title', UI.menu.controlsTitle, box);
    const grid = h('div', 'controls-grid', undefined, box);
    for (const [k, v] of UI.menu.controls) {
      h('div', 'key', k, grid);
      h('div', 'desc', v, grid);
    }
    return box;
  }

  private hideAll(): void {
    for (const s of [this.loading, this.main, this.settingsScreen, this.overlay, this.pause, this.join]) s.classList.add('hidden');
  }

  showLoading(text?: string): void {
    this.hideAll();
    if (text) (this.loading.querySelector('.loading-text') as HTMLElement).textContent = text;
    this.loading.classList.remove('hidden');
  }

  showMain(): void {
    this.hideAll();
    this.main.classList.remove('hidden');
  }

  showOverlay(resume: boolean, error?: string): void {
    this.hideAll();
    this.overlayText.textContent = error ?? (resume ? UI.menu.clickToResume : UI.menu.clickToPlay);
    this.overlay.classList.remove('hidden');
  }

  showPause(): void {
    this.hideAll();
    this.hostButton.classList.toggle('hidden', !this.actions.matchSettings());
    this.pause.classList.remove('hidden');
  }

  hide(): void {
    this.hideAll();
  }

  get overlayVisible(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  get pauseVisible(): boolean {
    return !this.pause.classList.contains('hidden');
  }

  overlayElement(): HTMLElement {
    return this.overlay;
  }

  /** The host's match settings: each change goes to the server at once. */
  private showMatchSettings(): void {
    const s = this.actions.matchSettings();
    if (!s) {
      this.showPause();
      return;
    }
    this.hideAll();
    const root = this.settingsScreen;
    root.innerHTML = '';
    h('div', 'title small', UI.host.title, root);
    const form = h('div', 'settings-form', undefined, root);
    const fill = (t: string, n: number) => t.replace('{n}', String(n));
    const choice = <K extends keyof MatchSettings>(label: string, key: K, values: MatchSettings[K][], text: (v: MatchSettings[K]) => string) => {
      const row = h('label', 'row', undefined, form);
      h('span', 'label', label, row);
      const sel = h('select', '', undefined, row);
      for (const v of values) {
        const o = h('option', '', text(v), sel);
        o.value = String(v);
        o.selected = s[key] === v;
      }
      h('span', 'value', '', row);
      sel.onchange = () => {
        const v = values.find((x) => String(x) === sel.value);
        if (v !== undefined) this.actions.setMatchSettings({ [key]: v } as Partial<MatchSettings>);
      };
    };
    choice(UI.host.rounds, 'rounds', MATCH.roundChoices, (v) => String(v));
    choice(UI.host.roundMinutes, 'roundMinutes', MATCH.minuteChoices, (v) => fill(UI.host.minutes, v));
    choice(UI.host.killDays, 'killDays', MATCH.killDayChoices, (v) => fill(UI.host.days, v));
    choice(UI.host.bots, 'bots', Array.from({ length: MATCH.maxPlayers }, (_, i) => i), (v) => String(v));
    choice(UI.host.killSpeed, 'killSpeed', ['cod', 'scramble'], (v) => (v === 'cod' ? UI.dev.killSpeedCod : UI.dev.killSpeedScramble));
    choice(UI.host.mode, 'teams', [false, true], (v) => (v ? UI.host.pairs : UI.host.ffa));
    h('div', 'note', UI.host.note, form);
    const btns = h('div', 'buttons row-buttons', undefined, root);
    h('button', 'btn primary', UI.menu.back, btns).onclick = () => this.showPause();
    h('button', 'btn', UI.host.newMatch, btns).onclick = () => {
      if (!window.confirm(`${UI.host.newMatch}?`)) return;
      this.actions.newMatch();
      this.showPause();
    };
    root.classList.remove('hidden');
  }

  private showSettings(from: 'main' | 'pause'): void {
    this.settingsReturn = from;
    this.hideAll();
    const s = this.settings;
    const root = this.settingsScreen;
    root.innerHTML = '';
    h('div', 'title small', UI.settings.title, root);
    const form = h('div', 'settings-form', undefined, root);
    const quality0 = s.quality;
    const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const row = h('label', 'row', undefined, form);
      h('span', 'label', label, row);
      const input = h('input', '', undefined, row);
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(s[key]);
      const val = h('span', 'value', fmt(s[key] as number), row);
      input.oninput = () => {
        (s[key] as number) = Number(input.value);
        val.textContent = fmt(Number(input.value));
        this.actions.settingsChanged(s, false);
      };
    };
    const toggle = (label: string, key: keyof Settings) => {
      const row = h('label', 'row check', undefined, form);
      const input = h('input', '', undefined, row);
      input.type = 'checkbox';
      input.checked = Boolean(s[key]);
      h('span', 'label', label, row);
      input.onchange = () => {
        (s[key] as boolean) = input.checked;
        this.actions.settingsChanged(s, false);
      };
    };
    slider(UI.settings.sensitivity, 'sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2));
    slider(UI.settings.adsSensitivity, 'adsSensitivity', 0.3, 1.5, 0.01, (v) => v.toFixed(2));
    slider(UI.settings.fov, 'fov', 75, 115, 1, (v) => `${v}°`);
    toggle(UI.settings.invertY, 'invertY');
    toggle(UI.settings.crouchToggle, 'crouchToggle');
    toggle(UI.settings.adsToggle, 'adsToggle');
    toggle(UI.settings.rawInput, 'rawInput');
    toggle(UI.settings.minimap, 'minimap');
    slider(UI.settings.masterVolume, 'masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`);
    slider(UI.settings.effectsVolume, 'effectsVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`);
    slider(UI.settings.gunVolume, 'gunVolume', 0, 1.5, 0.01, (v) => `${Math.round(v * 100)} %`);
    slider(UI.settings.musicVolume, 'musicVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`);
    const qrow = h('label', 'row', undefined, form);
    h('span', 'label', UI.settings.quality, qrow);
    const sel = h('select', '', undefined, qrow);
    for (const [q, label] of [
      ['low', UI.settings.qualityLow],
      ['medium', UI.settings.qualityMedium],
      ['high', UI.settings.qualityHigh],
    ] as [Quality, string][]) {
      const o = h('option', '', label, sel);
      o.value = q;
      if (s.quality === q) o.selected = true;
    }
    h('span', 'value', '', qrow);
    sel.onchange = () => {
      s.quality = sel.value as Quality;
    };
    slider(UI.settings.renderScale, 'renderScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)} %`);
    h('div', 'note', UI.settings.qualityNote, form);
    const btns = h('div', 'buttons row-buttons', undefined, root);
    const back = h('button', 'btn primary', UI.menu.back, btns);
    back.onclick = () => {
      this.actions.settingsChanged(s, s.quality !== quality0);
      if (this.settingsReturn === 'pause') this.showPause();
      else this.showMain();
    };
    const reset = h('button', 'btn', UI.settings.reset, btns);
    reset.onclick = () => {
      Object.assign(s, DEFAULT_SETTINGS, { quality: defaultQuality() });
      this.actions.settingsChanged(s, s.quality !== quality0);
      this.showSettings(this.settingsReturn);
    };
    root.classList.remove('hidden');
  }
}
