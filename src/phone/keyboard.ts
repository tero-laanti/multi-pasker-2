/**
 * The phone's own keyboard. The compose field is not an <input>, so the operating system's
 * keyboard (with its autocorrect, prediction, swipe typing and paste) never appears; every
 * keystroke goes through here. Keys act on touch start, several fingers at once.
 */

export type KeyboardMode = 'letters' | 'symbols' | 'numpad';

export interface KeyboardHandlers {
  input(ch: string): void;
  backspace(): void;
  enter(): void;
}

const LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'å'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
  ['SHIFT', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'BACK'],
  ['SYM', ',', 'SPACE', '.', 'ENTER'],
];

const SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '€', '&', '@', '"'],
  ['#', '+', '=', '?', '!', "'", '%', '*', 'BACK'],
  ['ABC', ',', 'SPACE', '.', 'ENTER'],
];

const NUMPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['+', '0', 'BACK'],
];

const SPECIAL_LABEL: Record<string, string> = {
  SHIFT: '⇧',
  BACK: '⌫',
  SYM: '123',
  ABC: 'ABC',
  SPACE: '',
  ENTER: '↵',
};

/** Characters the physical keyboard may type in the simulator. */
const ALLOWED = /^[\p{L}\p{N} .,!?'"():;\-/€&@#+=%*]$/u;

export class Keyboard {
  readonly root: HTMLDivElement;
  private mode: KeyboardMode = 'letters';
  private shift: 'off' | 'once' | 'lock' = 'once';
  private lastShiftTap = 0;
  private preview: HTMLDivElement;
  private repeatTimer = 0;
  private repeatPointer = -1;
  private enterLabel = '↵';
  /** Automatic capital at the start of a message. */
  autoShift = true;

  constructor(
    private h: KeyboardHandlers,
    private onActivity: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'kb';
    this.preview = document.createElement('div');
    this.preview.className = 'kb-preview hidden';
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointerup', (e) => this.up(e));
    this.root.addEventListener('pointercancel', (e) => this.up(e));
    this.root.addEventListener('pointerleave', (e) => this.up(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.render();
  }

  setMode(mode: KeyboardMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.render();
  }

  setEnterLabel(label: string): void {
    this.enterLabel = label;
    const k = this.root.querySelector<HTMLElement>('[data-k="ENTER"]');
    if (k) k.textContent = label;
  }

  /** Called when the text becomes empty (or a sentence ends) to capitalise the next letter. */
  wantCapital(on: boolean): void {
    if (!this.autoShift || this.shift === 'lock') return;
    const next = on ? 'once' : 'off';
    if (next !== this.shift) {
      this.shift = next;
      this.updateCase();
    }
  }

  private render(): void {
    this.root.innerHTML = '';
    this.root.dataset.mode = this.mode;
    const rows = this.mode === 'letters' ? LETTERS : this.mode === 'symbols' ? SYMBOLS : NUMPAD;
    for (const row of rows) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      for (const k of row) {
        const key = document.createElement('div');
        key.className = 'kb-key';
        key.dataset.k = k;
        if (k in SPECIAL_LABEL) {
          key.classList.add('special', `k-${k.toLowerCase()}`);
          key.textContent = k === 'ENTER' ? this.enterLabel : SPECIAL_LABEL[k]!;
        } else {
          key.textContent = k;
        }
        r.appendChild(key);
      }
      this.root.appendChild(r);
    }
    this.root.appendChild(this.preview);
    this.updateCase();
  }

  private updateCase(): void {
    const upper = this.shift !== 'off';
    this.root.classList.toggle('upper', upper);
    const sk = this.root.querySelector<HTMLElement>('[data-k="SHIFT"]');
    if (sk) {
      sk.classList.toggle('on', this.shift === 'once');
      sk.classList.toggle('lock', this.shift === 'lock');
    }
    if (this.mode !== 'letters') return;
    for (const el of this.root.querySelectorAll<HTMLElement>('.kb-key:not(.special)')) {
      const k = el.dataset.k!;
      el.textContent = upper && k.length === 1 ? k.toLocaleUpperCase('fi-FI') : k;
    }
  }

  private keyAt(e: PointerEvent): HTMLElement | null {
    const t = e.target as HTMLElement;
    return t.closest<HTMLElement>('.kb-key');
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    this.onActivity();
    const key = this.keyAt(e);
    if (!key) return;
    const k = key.dataset.k!;
    key.classList.add('pressed');
    (key as HTMLElement & { _pid?: number })._pid = e.pointerId;
    if (navigator.vibrate) navigator.vibrate(4);
    switch (k) {
      case 'SHIFT': {
        const now = performance.now();
        if (this.shift === 'lock') this.shift = 'off';
        else if (now - this.lastShiftTap < 320) this.shift = 'lock';
        else this.shift = this.shift === 'once' ? 'off' : 'once';
        this.lastShiftTap = now;
        this.updateCase();
        return;
      }
      case 'BACK':
        this.h.backspace();
        this.repeatPointer = e.pointerId;
        window.clearTimeout(this.repeatTimer);
        this.repeatTimer = window.setTimeout(() => this.repeat(), 380);
        return;
      case 'SYM':
        this.setMode('symbols');
        return;
      case 'ABC':
        this.setMode('letters');
        return;
      case 'ENTER':
        this.h.enter();
        return;
      case 'SPACE':
        this.h.input(' ');
        return;
    }
    let ch = k;
    if (this.mode === 'letters' && this.shift !== 'off') ch = k.toLocaleUpperCase('fi-FI');
    this.h.input(ch);
    this.showPreview(key, ch);
    if (this.shift === 'once') {
      this.shift = 'off';
      this.updateCase();
    }
  }

  private repeat(): void {
    this.h.backspace();
    this.repeatTimer = window.setTimeout(() => this.repeat(), 60);
  }

  private up(e: PointerEvent): void {
    for (const el of this.root.querySelectorAll<HTMLElement & { _pid?: number }>('.kb-key.pressed')) {
      if (el._pid === e.pointerId) el.classList.remove('pressed');
    }
    if (e.pointerId === this.repeatPointer) {
      window.clearTimeout(this.repeatTimer);
      this.repeatPointer = -1;
    }
    this.preview.classList.add('hidden');
  }

  private showPreview(key: HTMLElement, ch: string): void {
    if (this.mode === 'numpad') return;
    const kr = key.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    this.preview.textContent = ch;
    this.preview.style.left = `${kr.left - rr.left + kr.width / 2}px`;
    this.preview.style.top = `${kr.top - rr.top}px`;
    this.preview.classList.remove('hidden');
  }

  /** Simulator: a physical keyboard types through the same handlers. */
  attachPhysical(): void {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      this.onActivity();
      if (e.key === 'Backspace') this.h.backspace();
      else if (e.key === 'Enter') this.h.enter();
      else if (e.key.length === 1 && ALLOWED.test(e.key)) this.h.input(e.key);
      else return;
      e.preventDefault();
    });
  }
}
