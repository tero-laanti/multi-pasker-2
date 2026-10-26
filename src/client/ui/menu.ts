import { FI } from '../../shared/fi';
import { DEFAULT_SETTINGS, type Quality, type Settings } from '../settings';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export interface MenuActions {
  startRange(): void;
  resume(): void;
  quit(): void;
  settingsChanged(s: Settings, reloadNeeded: boolean): void;
  toggleTuning(): void;
  toggleStats(): void;
  toggleDev(): void;
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
  private settingsReturn: 'main' | 'pause' = 'main';

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private actions: MenuActions,
  ) {
    this.root = h('div', 'menu-root', undefined, parent);
    this.loading = h('div', 'screen loading', undefined, this.root);
    h('div', 'title', FI.appTitle, this.loading);
    h('div', 'loading-text', FI.menu.loading, this.loading);

    this.main = h('div', 'screen main hidden', undefined, this.root);
    const brand = h('div', 'brand', undefined, this.main);
    h('div', 'title', FI.appTitle, brand);
    h('div', 'tagline', FI.menu.tagline, brand);
    const buttons = h('div', 'buttons', undefined, this.main);
    const range = h('button', 'btn primary', FI.menu.range, buttons);
    range.onclick = () => actions.startRange();
    h('div', 'btn-desc', FI.menu.rangeDesc, buttons);
    const join = h('button', 'btn', FI.menu.join, buttons);
    join.disabled = true;
    h('div', 'btn-desc', FI.menu.joinSoon, buttons);
    const set = h('button', 'btn', FI.menu.settings, buttons);
    set.onclick = () => this.showSettings('main');
    this.main.appendChild(this.controls());
    h('div', 'footer', 'F2 kehitys · F3 suorituskyky · F4 säätö', this.main);

    this.settingsScreen = h('div', 'screen settings hidden', undefined, this.root);

    this.overlay = h('div', 'screen overlay hidden', undefined, this.root);
    this.overlayText = h('div', 'overlay-text', FI.menu.clickToPlay, this.overlay);
    this.overlay.appendChild(this.controls());

    this.pause = h('div', 'screen pause hidden', undefined, this.root);
    h('div', 'title small', FI.menu.paused, this.pause);
    const pb = h('div', 'buttons', undefined, this.pause);
    const resume = h('button', 'btn primary', FI.menu.resume, pb);
    resume.onclick = () => actions.resume();
    const ps = h('button', 'btn', FI.menu.settings, pb);
    ps.onclick = () => this.showSettings('pause');
    const dev = h('div', 'dev-row', undefined, pb);
    for (const [label, fn] of [
      [FI.dev.title + ' (F2)', () => actions.toggleDev()],
      [FI.dev.stats, () => actions.toggleStats()],
      [FI.dev.tuning, () => actions.toggleTuning()],
    ] as const) {
      const b = h('button', 'btn small', label, dev);
      b.onclick = fn;
    }
    const quit = h('button', 'btn', FI.menu.quit, pb);
    quit.onclick = () => actions.quit();
  }

  private controls(): HTMLDivElement {
    const box = h('div', 'controls');
    h('div', 'controls-title', FI.menu.controlsTitle, box);
    const grid = h('div', 'controls-grid', undefined, box);
    for (const [k, v] of FI.menu.controls) {
      h('div', 'key', k, grid);
      h('div', 'desc', v, grid);
    }
    return box;
  }

  private hideAll(): void {
    for (const s of [this.loading, this.main, this.settingsScreen, this.overlay, this.pause]) s.classList.add('hidden');
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
    this.overlayText.textContent = error ?? (resume ? FI.menu.clickToResume : FI.menu.clickToPlay);
    this.overlay.classList.remove('hidden');
  }

  showPause(): void {
    this.hideAll();
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

  private showSettings(from: 'main' | 'pause'): void {
    this.settingsReturn = from;
    this.hideAll();
    const s = this.settings;
    const root = this.settingsScreen;
    root.innerHTML = '';
    h('div', 'title small', FI.settings.title, root);
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
    slider(FI.settings.sensitivity, 'sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2));
    slider(FI.settings.adsSensitivity, 'adsSensitivity', 0.3, 1.5, 0.01, (v) => v.toFixed(2));
    slider(FI.settings.fov, 'fov', 75, 115, 1, (v) => `${v}°`);
    toggle(FI.settings.invertY, 'invertY');
    toggle(FI.settings.crouchToggle, 'crouchToggle');
    toggle(FI.settings.rawInput, 'rawInput');
    slider(FI.settings.masterVolume, 'masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`);
    slider(FI.settings.effectsVolume, 'effectsVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`);
    const qrow = h('label', 'row', undefined, form);
    h('span', 'label', FI.settings.quality, qrow);
    const sel = h('select', '', undefined, qrow);
    for (const [q, label] of [
      ['low', FI.settings.qualityLow],
      ['medium', FI.settings.qualityMedium],
      ['high', FI.settings.qualityHigh],
    ] as [Quality, string][]) {
      const o = h('option', '', label, sel);
      o.value = q;
      if (s.quality === q) o.selected = true;
    }
    h('span', 'value', '', qrow);
    sel.onchange = () => {
      s.quality = sel.value as Quality;
    };
    slider(FI.settings.renderScale, 'renderScale', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)} %`);
    h('div', 'note', FI.settings.qualityNote, form);
    const btns = h('div', 'buttons row-buttons', undefined, root);
    const back = h('button', 'btn primary', FI.menu.back, btns);
    back.onclick = () => {
      this.actions.settingsChanged(s, s.quality !== quality0);
      if (this.settingsReturn === 'pause') this.showPause();
      else this.showMain();
    };
    const reset = h('button', 'btn', FI.settings.reset, btns);
    reset.onclick = () => {
      Object.assign(s, DEFAULT_SETTINGS);
      this.actions.settingsChanged(s, s.quality !== quality0);
      this.showSettings(this.settingsReturn);
    };
    root.classList.remove('hidden');
  }
}
