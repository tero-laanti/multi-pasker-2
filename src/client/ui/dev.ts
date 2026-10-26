import { FI } from '../../shared/fi';
import type { KillSpeedPreset } from '../../shared/config';

export interface DevActions {
  reload(): void;
  startDrill(): void;
  setDirectReload(on: boolean): void;
  directReload(): boolean;
  setKillSpeed(p: KillSpeedPreset): void;
  killSpeed(): KillSpeedPreset;
  connection(): string;
}

/** F2 developer panel. */
export class DevPanel {
  readonly root: HTMLDivElement;
  private conn: HTMLDivElement;
  visible = false;

  constructor(
    parent: HTMLElement,
    private a: DevActions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'dev hidden';
    parent.appendChild(this.root);
    const title = document.createElement('div');
    title.className = 'dev-title';
    title.textContent = FI.dev.title;
    this.root.appendChild(title);
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = label;
      b.onclick = fn;
      this.root.appendChild(b);
      return b;
    };
    btn(FI.dev.reload, () => a.reload());
    btn(FI.dev.restartDrill, () => a.startDrill());
    const direct = document.createElement('label');
    direct.className = 'dev-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = a.directReload();
    cb.onchange = () => a.setDirectReload(cb.checked);
    direct.append(cb, document.createTextNode(' ' + FI.dev.rDirect));
    this.root.appendChild(direct);
    const ks = document.createElement('div');
    ks.className = 'dev-row';
    ks.textContent = FI.dev.killSpeed + ': ';
    const sel = document.createElement('select');
    for (const [v, l] of [
      ['cod', FI.dev.killSpeedCod],
      ['scramble', FI.dev.killSpeedScramble],
    ] as [KillSpeedPreset, string][]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      if (a.killSpeed() === v) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => a.setKillSpeed(sel.value as KillSpeedPreset);
    ks.appendChild(sel);
    this.root.appendChild(ks);
    this.conn = document.createElement('div');
    this.conn.className = 'dev-row';
    this.root.appendChild(this.conn);
    window.setInterval(() => {
      if (this.visible) this.conn.textContent = `${FI.dev.connection}: ${a.connection()}`;
    }, 500);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
  }
}
