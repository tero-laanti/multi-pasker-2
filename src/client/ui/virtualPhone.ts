import { UI } from '../../shared/ui';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/**
 * The virtual phone, for players without a phone of their own: the phone app in a frame on
 * this screen. It pairs like a phone (replacing one) and stays connected while hidden; typing
 * is clicking its keys with the mouse. While it shows, the character has the phone out.
 */
export class VirtualPhone {
  readonly root: HTMLDivElement;
  private frame: HTMLIFrameElement | null = null;
  private pairToken = '';
  shown = false;
  /** The close button (`false`) or Esc in the frame (`true`). */
  onClose: (escape: boolean) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = el('div', 'vphone hidden', parent);
    const bar = el('div', 'vphone-bar', this.root);
    el('div', 'vphone-title', bar, UI.virtualPhone.title);
    const close = el('button', 'btn small', bar, UI.virtualPhone.close);
    close.onclick = () => this.onClose(false);
    el('div', 'vphone-hint', this.root, UI.virtualPhone.hint);
    window.addEventListener('message', (e) => {
      if (e.origin === location.origin && e.source === this.frame?.contentWindow && (e.data as { t?: string })?.t === 'virtualClose') this.onClose(true);
    });
  }

  /** Shows it; the first time (or for another player) it pairs with that player's phone link. */
  show(pairToken: string): void {
    if (!this.frame || pairToken !== this.pairToken) {
      this.frame?.remove();
      this.pairToken = pairToken;
      this.frame = el('iframe', 'vphone-frame', this.root);
      this.frame.title = UI.virtualPhone.title;
      this.frame.onload = () => this.tell();
      this.frame.src = `/phone?virtual=1#${pairToken}`;
    }
    this.shown = true;
    this.root.classList.remove('hidden');
    this.tell();
    this.frame.focus();
  }

  hide(): void {
    this.shown = false;
    this.root.classList.add('hidden');
    this.tell();
  }

  /** Leaving the match: the virtual phone goes with it. */
  dispose(): void {
    this.hide();
    this.frame?.remove();
    this.frame = null;
    this.pairToken = '';
  }

  /** The phone app puts the phone in the character's hand exactly while it shows. */
  private tell(): void {
    this.frame?.contentWindow?.postMessage({ t: 'virtualShown', on: this.shown }, location.origin);
  }
}
