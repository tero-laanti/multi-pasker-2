import { renderSVG } from 'uqr';
import { UI } from '../../shared/ui';

export interface PairInfo {
  url: string;
  token: string;
  code: string;
  phone: 'none' | 'online' | 'offline';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/**
 * How to pair a phone with this player: a QR code with the pairing link, and the short code
 * for typing in at /phone. Shown after joining and in the Esc menu.
 */
export class PairPanel {
  readonly root: HTMLDivElement;
  private qr: HTMLDivElement;
  private manual: HTMLDivElement;
  private code: HTMLDivElement;
  private status: HTMLDivElement;
  private sim: HTMLButtonElement;
  private lastUrl = '';

  constructor(onSimulator: () => void) {
    this.root = el('div', 'pair-panel hidden');
    el('div', 'pair-title', this.root, UI.pair.title);
    this.qr = el('div', 'pair-qr', this.root);
    el('div', 'pair-scan', this.root, UI.pair.scan);
    this.manual = el('div', 'pair-manual', this.root);
    this.code = el('div', 'pair-code', this.root);
    this.status = el('div', 'pair-status', this.root);
    this.sim = el('button', 'btn small pair-sim hidden', this.root, UI.pair.simulator);
    this.sim.onclick = (e) => {
      e.stopPropagation();
      onSimulator();
    };
  }

  update(info: PairInfo | null, dev: boolean): void {
    this.root.classList.toggle('hidden', !info);
    if (!info) return;
    this.sim.classList.toggle('hidden', !dev);
    const phoneUrl = info.url ? info.url.slice(0, info.url.indexOf('#')) : '';
    if (info.url !== this.lastUrl) {
      this.lastUrl = info.url;
      this.qr.innerHTML = info.url ? renderSVG(info.url, { border: 2, pixelSize: 6, blackColor: '#111', whiteColor: '#fff' }) : '';
      this.qr.classList.toggle('missing', !info.url);
      if (!info.url) this.qr.textContent = UI.pair.noLan;
    }
    this.manual.textContent = UI.pair.manual.replace('{url}', phoneUrl.replace(/^https?:\/\//, '') || `<server>/phone`);
    this.code.textContent = info.code;
    this.status.textContent = info.phone === 'online' ? UI.pair.online : info.phone === 'offline' ? UI.pair.offline : UI.pair.none;
    this.status.dataset.state = info.phone;
  }
}
