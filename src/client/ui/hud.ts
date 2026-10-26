import { UI } from '../../shared/ui';
import { DRILL, type DrillResult } from '../../shared/rangeSim';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** DOM heads-up display. Setters only touch the DOM when a value changes. */
export class Hud {
  readonly root: HTMLDivElement;
  private cross: HTMLDivElement;
  private hit: HTMLDivElement;
  private weaponName: HTMLDivElement;
  private ammo: HTMLDivElement;
  private ammoMax: HTMLDivElement;
  private ammoBox: HTMLDivElement;
  private banner: HTMLDivElement;
  private hint: HTMLDivElement;
  private drill: HTMLDivElement;
  private results: HTMLDivElement;
  private centerNote: HTMLDivElement;
  private prompt: HTMLDivElement;
  private grenadeEl: HTMLDivElement;
  private last = new Map<string, string | number | boolean>();
  private bannerTimer = 0;
  private hitTimer = 0;
  private noteTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.cross = el('div', 'crosshair', this.root);
    for (const d of ['t', 'b', 'l', 'r']) el('div', `ch ch-${d}`, this.cross);
    el('div', 'ch-dot', this.cross);
    this.hit = el('div', 'hitmarker', this.root);
    for (const d of ['a', 'b', 'c', 'd']) el('div', `hm hm-${d}`, this.hit);
    this.ammoBox = el('div', 'ammo-box', this.root);
    this.weaponName = el('div', 'weapon-name', this.ammoBox);
    const row = el('div', 'ammo-row', this.ammoBox);
    this.ammo = el('div', 'ammo', row);
    this.ammoMax = el('div', 'ammo-max', row);
    this.grenadeEl = el('div', 'grenade-count', this.ammoBox);
    this.banner = el('div', 'banner', this.root);
    this.hint = el('div', 'hint', this.root);
    this.drill = el('div', 'drill', this.root);
    this.results = el('div', 'results', this.root);
    this.centerNote = el('div', 'center-note', this.root);
    this.prompt = el('div', 'prompt', this.root);
  }

  /** "[E] Pick up …" under the crosshair while something can be used. */
  setPrompt(key: string, text: string): void {
    if (this.changed('prompt', key + text)) {
      this.prompt.textContent = '';
      if (text) {
        el('span', 'key', this.prompt, key);
        this.prompt.append(text);
      }
      this.prompt.classList.toggle('show', text.length > 0);
    }
  }

  private changed(key: string, v: string | number | boolean): boolean {
    if (this.last.get(key) === v) return false;
    this.last.set(key, v);
    return true;
  }

  /** Crosshair gap in pixels from the spread cone; hidden while aiming or sprinting. */
  crosshair(gapPx: number, visible: boolean): void {
    const g = Math.round(gapPx);
    if (this.changed('gap', g)) this.cross.style.setProperty('--gap', `${g}px`);
    if (this.changed('crossVis', visible)) this.cross.classList.toggle('hidden', !visible);
  }

  hitMarker(kind: 'body' | 'head' | 'kill'): void {
    this.hit.classList.remove('show', 'head', 'kill');
    void this.hit.offsetWidth;
    this.hit.classList.add('show');
    if (kind !== 'body') this.hit.classList.add(kind);
    this.hitTimer = kind === 'kill' ? 0.45 : 0.25;
  }

  /** Rounds in the magazine and the spare rounds (`null`: endless, the practice range). */
  weapon(name: string, ammo: number, max: number, spare: number | null, reloading: boolean): void {
    if (this.changed('wname', name)) this.weaponName.textContent = name;
    const a = reloading ? UI.hud.reloading : String(ammo);
    if (this.changed('ammo', a)) {
      this.ammo.textContent = a;
      this.ammo.classList.toggle('reloading', reloading);
    }
    const s = spare === null ? '∞' : String(spare);
    if (this.changed('ammoMax', s)) {
      this.ammoMax.textContent = `/ ${s}`;
      this.ammoMax.classList.toggle('none', spare === 0);
    }
    const low = !reloading && ammo <= Math.ceil(max * 0.25);
    if (this.changed('low', low)) this.ammoBox.classList.toggle('low', low);
    const empty = !reloading && ammo === 0;
    if (this.changed('empty', empty)) this.ammoBox.classList.toggle('empty', empty);
  }

  grenades(n: number, max: number): void {
    const text = n > 0 ? `${UI.hud.grenade} ${'●'.repeat(n)}${'○'.repeat(Math.max(0, max - n))}` : '';
    if (this.changed('gren', text)) this.grenadeEl.textContent = text;
  }

  refillFlash(): void {
    this.ammoBox.classList.remove('refill');
    void this.ammoBox.offsetWidth;
    this.ammoBox.classList.add('refill');
  }

  showBanner(text: string, seconds = 2.2): void {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  note(text: string, seconds = 2.5): void {
    this.centerNote.textContent = text;
    this.centerNote.classList.add('show');
    this.noteTimer = seconds;
  }

  setHint(text: string): void {
    if (this.changed('hint', text)) {
      this.hint.textContent = text;
      this.hint.classList.toggle('show', text.length > 0);
    }
  }

  drillStatus(phase: 'idle' | 'briefing' | 'running', time: number, score: number): void {
    const text =
      phase === 'idle'
        ? UI.range.freeFire
        : phase === 'briefing'
          ? UI.range.drillIntro
          : `${UI.range.drill} · ${UI.range.time} ${Math.max(0, DRILL.duration - time).toFixed(1)} s · ${UI.range.score} ${score}`;
    if (this.changed('drill', text)) this.drill.textContent = text;
    if (this.changed('drillPhase', phase)) this.drill.classList.toggle('active', phase !== 'idle');
  }

  hideDrill(): void {
    if (this.changed('drill', '')) this.drill.textContent = '';
    if (this.changed('drillPhase', 'hidden')) this.drill.classList.remove('active');
  }

  showResults(r: DrillResult, best: number, isBest: boolean): void {
    const acc = r.shots > 0 ? Math.round((r.hits / r.shots) * 100) : 0;
    this.results.innerHTML = '';
    el('div', 'results-title', this.results, isBest ? UI.range.newBest : UI.range.score);
    el('div', 'results-score', this.results, String(r.score));
    const grid = el('div', 'results-grid', this.results);
    const row = (k: string, v: string) => {
      el('div', 'k', grid, k);
      el('div', 'v', grid, v);
    };
    row(UI.range.downs, `${r.downs} / ${r.spawned}`);
    row(UI.range.hits, String(r.hits));
    row(UI.range.heads, String(r.heads));
    row(UI.range.accuracy, `${acc} %`);
    row(UI.range.best, String(best));
    this.results.classList.add('show');
    window.setTimeout(() => this.results.classList.remove('show'), 7000);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** Match layout: hides the range's drill line and results. */
  setMatch(on: boolean): void {
    this.root.classList.toggle('in-match', on);
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hit.classList.remove('show', 'head', 'kill');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.noteTimer > 0) {
      this.noteTimer -= dt;
      if (this.noteTimer <= 0) this.centerNote.classList.remove('show');
    }
  }
}
