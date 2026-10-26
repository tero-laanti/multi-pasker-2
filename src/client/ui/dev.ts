import { UI } from '../../shared/ui';
import type { KillSpeedPreset } from '../../shared/config';
import type { PlayerInfo } from '../../shared/protocol';

export interface DevActions {
  inMatch(): boolean;
  reload(): void;
  giveRifle(all: boolean): void;
  giveGrenade(): void;
  startDrill(): void;
  setDirectReload(on: boolean): void;
  directReload(): boolean;
  setKillSpeed(p: KillSpeedPreset): void;
  killSpeed(): KillSpeedPreset;
  connection(): string;
  addBot(): void;
  removeBot(): void;
  fillBots(): void;
  restartRound(): void;
  killMe(): void;
  setGate(open: boolean): void;
  gateOpen(): boolean;
  setNetConditions(latencyMs: number, jitterMs: number): void;
  players(): PlayerInfo[];
}

/** F2 developer panel. Match buttons act on the server (dev servers or the host machine). */
export class DevPanel {
  readonly root: HTMLDivElement;
  private conn: HTMLDivElement;
  private list: HTMLDivElement;
  private rangeBox: HTMLDivElement;
  private matchBox: HTMLDivElement;
  private direct: HTMLInputElement;
  private gate: HTMLInputElement;
  private kill: HTMLSelectElement;
  visible = false;

  constructor(
    parent: HTMLElement,
    private a: DevActions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'dev hidden';
    parent.appendChild(this.root);
    const add = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, to: HTMLElement, text?: string) => {
      const e = document.createElement(tag);
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      to.appendChild(e);
      return e;
    };
    add('div', 'dev-title', this.root, UI.dev.title);
    const btn = (to: HTMLElement, label: string, fn: () => void) => {
      const b = add('button', 'btn small', to, label);
      b.onclick = fn;
      return b;
    };
    const check = (to: HTMLElement, label: string, get: () => boolean, set: (on: boolean) => void) => {
      const l = add('label', 'dev-check', to);
      const cb = add('input', '', l);
      cb.type = 'checkbox';
      cb.checked = get();
      cb.onchange = () => set(cb.checked);
      l.append(document.createTextNode(' ' + label));
      return cb;
    };

    btn(this.root, UI.dev.reload, () => a.reload());
    btn(this.root, UI.dev.giveRifle, () => a.giveRifle(false));
    btn(this.root, UI.dev.giveGrenade, () => a.giveGrenade());
    this.rangeBox = add('div', 'dev-box', this.root);
    btn(this.rangeBox, UI.dev.restartDrill, () => a.startDrill());
    this.matchBox = add('div', 'dev-box', this.root);
    btn(this.matchBox, UI.dev.giveRifleAll, () => a.giveRifle(true));
    btn(this.matchBox, UI.dev.addBot, () => a.addBot());
    btn(this.matchBox, UI.dev.removeBot, () => a.removeBot());
    btn(this.matchBox, UI.dev.fillBots, () => a.fillBots());
    btn(this.matchBox, UI.dev.restartRound, () => a.restartRound());
    btn(this.matchBox, UI.dev.killMe, () => a.killMe());
    this.gate = check(this.matchBox, UI.dev.gateOpen, () => a.gateOpen(), (on) => a.setGate(on));
    this.direct = check(this.root, UI.dev.rDirect, () => a.directReload(), (on) => a.setDirectReload(on));

    const ks = add('div', 'dev-row', this.root, UI.dev.killSpeed + ': ');
    this.kill = add('select', '', ks);
    for (const [v, l] of [
      ['cod', UI.dev.killSpeedCod],
      ['scramble', UI.dev.killSpeedScramble],
    ] as [KillSpeedPreset, string][]) {
      const o = add('option', '', this.kill, l);
      o.value = v;
    }
    this.kill.value = a.killSpeed();
    this.kill.onchange = () => a.setKillSpeed(this.kill.value as KillSpeedPreset);

    // Network conditioner: delay added to both directions, applied by this client.
    add('div', 'dev-sub', this.root, UI.dev.netTitle);
    let lat = 0;
    let jit = 0;
    const slider = (label: string, max: number, set: (v: number) => void) => {
      const row = add('label', 'dev-slider', this.root);
      add('span', '', row, label);
      const input = add('input', '', row);
      input.type = 'range';
      input.min = '0';
      input.max = String(max);
      input.step = '5';
      input.value = '0';
      const val = add('span', 'dev-val', row, '0');
      input.oninput = () => {
        val.textContent = input.value;
        set(Number(input.value));
        a.setNetConditions(lat, jit);
      };
    };
    slider(UI.dev.latency, 200, (v) => (lat = v));
    slider(UI.dev.jitter, 60, (v) => (jit = v));

    this.conn = add('div', 'dev-row', this.root);
    add('div', 'dev-sub', this.root, UI.dev.players);
    this.list = add('div', 'dev-list', this.root);
    window.setInterval(() => {
      if (this.visible) this.refresh();
    }, 500);
  }

  private refresh(): void {
    const match = this.a.inMatch();
    this.rangeBox.classList.toggle('hidden', match);
    this.matchBox.classList.toggle('hidden', !match);
    this.direct.checked = this.a.directReload();
    this.gate.checked = this.a.gateOpen();
    this.kill.value = this.a.killSpeed();
    this.conn.textContent = `${UI.dev.connection}: ${this.a.connection()}`;
    const rows = this.a
      .players()
      .map((p) => `${p.id.toString().padStart(2)}  ${p.name.padEnd(12)} ${p.bot ? 'bot ' : p.connected ? `${String(p.ping).padStart(3)} ms` : 'away'}`);
    this.list.textContent = rows.join('\n');
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
    if (this.visible) this.refresh();
  }
}
