import { boxPlanes, brushFromPlanes } from '../../shared/collision/brush';
import { CollisionWorld } from '../../shared/collision/world';
import { SIM_DT, TUNING, type WeaponId } from '../../shared/config';
import { WEAPON_IDS } from '../../shared/protocol';
import { UI } from '../../shared/ui';
import { Mover, emptyCmd, newMoveState } from '../../shared/movement';
import { cloneTuning, flattenTuning, getTuning, mergeTuning, setTuning, type TuningNode } from '../../shared/tuningTree';
import { recoilKick, timeToKill } from '../../shared/weapons';
import { WEB } from '../web';

const STORE = 'pasker.tuning.session';
const INTEGER = /(rpm|magazine|Body|Head|health|damage|RampShots|Period)$/;

/** Explicit slider ranges where the automatic guess is not good enough. */
const RANGES: Record<string, [number, number]> = {
  'move.groundAccel': [2, 40],
  'move.friction': [1, 20],
  'move.airAccel': [0, 12],
  'move.gravity': [8, 30],
  'pistol.rpm': [120, 900],
  'rifle.rpm': [300, 1100],
  'pistol.magazine': [6, 20],
  'rifle.magazine': [10, 75],
  'pistol.recoilAimShare': [0, 1],
  'rifle.recoilAimShare': [0, 1],
  'pistol.kickAdsMul': [0, 1],
  'rifle.kickAdsMul': [0, 1],
  'pistol.vmHipX': [-0.05, 0.3],
  'rifle.vmHipX': [-0.05, 0.3],
  'pistol.vmHipY': [-0.3, 0],
  'rifle.vmHipY': [-0.3, 0],
  'pistol.vmHipZ': [-0.6, -0.1],
  'rifle.vmHipZ': [-0.6, -0.05],
  'pistol.vmAdsZ': [-0.5, -0.05],
  'rifle.vmAdsZ': [-0.5, 0],
  'pistol.recoilYawBias': [-0.5, 0.5],
  'rifle.recoilYawBias': [-0.5, 0.5],
};

function guessRange(path: string, v: number): [number, number] {
  if (RANGES[path]) return RANGES[path]!;
  if (v < 0) return [v * 2.5, 0];
  if (v === 0) return [0, 1];
  return [0, v * 3];
}

function stepFor(path: string, v: number): number {
  if (INTEGER.test(path)) return 1;
  const m = Math.abs(v) || 1;
  return Math.pow(10, Math.floor(Math.log10(m)) - 2);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** F4 live tuning panel for every movement and weapon value. */
export class TuningPanel {
  readonly root: HTMLDivElement;
  private defaults: TuningNode;
  private rows: { path: string[]; row: HTMLElement; range: HTMLInputElement; num: HTMLInputElement }[] = [];
  private derived: HTMLPreElement;
  private plot: HTMLCanvasElement;
  private status: HTMLDivElement;
  private plotWeapon: WeaponId = 'pistol';
  visible = false;

  constructor(parent: HTMLElement) {
    this.defaults = cloneTuning(TUNING as unknown as TuningNode);
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) mergeTuning(TUNING as unknown as TuningNode, JSON.parse(saved));
    } catch {
      // Session storage unavailable.
    }
    this.root = h('div', 'tuning hidden', undefined, parent);
    const head = h('div', 'tuning-head', undefined, this.root);
    h('div', 'tuning-title', UI.tuning.title, head);
    const filter = h('input', 'tuning-filter', undefined, head);
    filter.placeholder = UI.tuning.filter;
    filter.oninput = () => this.filter(filter.value.trim().toLowerCase());
    h('div', 'tuning-hint', UI.tuning.hint, this.root);
    const actions = h('div', 'tuning-actions', undefined, this.root);
    // Saving writes config.ts on the server machine; the web version has no server.
    if (!WEB) {
      const save = h('button', 'btn small primary', UI.tuning.save, actions);
      save.onclick = () => void this.save();
    }
    const text = h('button', 'btn small', UI.tuning.exportText, actions);
    text.onclick = () => this.showText();
    const reset = h('button', 'btn small', UI.tuning.resetAll, actions);
    reset.onclick = () => this.resetAll();
    this.status = h('div', 'tuning-status', '', this.root);

    const der = h('div', 'tuning-derived', undefined, this.root);
    h('div', 'tuning-group-title', UI.tuning.derived, der);
    this.derived = h('pre', '', '', der);
    const plotHead = h('div', 'tuning-plot-head', UI.tuning.recoilPattern, der);
    const sel = h('select', '', undefined, plotHead);
    for (const w of WEAPON_IDS) {
      const o = h('option', '', UI.hud.weapons[w], sel);
      o.value = w;
    }
    sel.onchange = () => {
      this.plotWeapon = sel.value as WeaponId;
      this.refresh();
    };
    this.plot = h('canvas', 'tuning-plot', undefined, der);
    this.plot.width = 340;
    this.plot.height = 220;

    const body = h('div', 'tuning-body', undefined, this.root);
    let group = '';
    let groupEl: HTMLElement = body;
    for (const leaf of flattenTuning(TUNING as unknown as TuningNode)) {
      const top = leaf.path.slice(0, -1).join('.');
      if (top !== group) {
        group = top;
        groupEl = h('details', 'tuning-group', undefined, body);
        (groupEl as HTMLDetailsElement).open = top === 'pistol' || top === 'move';
        h('summary', 'tuning-group-title', top, groupEl);
      }
      if (typeof leaf.value !== 'number') continue;
      const path = leaf.path.join('.');
      const def = getTuning(this.defaults, leaf.path) as number;
      const [min, max] = guessRange(path, def);
      const row = h('div', 'tuning-row', undefined, groupEl);
      row.dataset.key = path.toLowerCase();
      h('span', 'k', leaf.path[leaf.path.length - 1], row);
      const range = h('input', '', undefined, row);
      range.type = 'range';
      range.min = String(Math.min(min, leaf.value));
      range.max = String(Math.max(max, leaf.value));
      range.step = String(stepFor(path, def));
      range.value = String(leaf.value);
      const num = h('input', 'num', undefined, row);
      num.type = 'number';
      num.step = range.step;
      num.value = String(leaf.value);
      const apply = (v: number) => {
        if (!Number.isFinite(v)) return;
        setTuning(TUNING as unknown as TuningNode, leaf.path, v);
        range.value = String(v);
        num.value = String(v);
        this.markChanged(row, leaf.path);
        this.persist();
        this.refresh();
      };
      range.oninput = () => apply(Number(range.value));
      num.onchange = () => apply(Number(num.value));
      this.rows.push({ path: leaf.path, row, range, num });
      this.markChanged(row, leaf.path);
    }
    this.refresh();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('hidden', !this.visible);
    if (this.visible) this.refresh();
  }

  private markChanged(row: HTMLElement, path: string[]): void {
    const cur = getTuning(TUNING as unknown as TuningNode, path);
    const def = getTuning(this.defaults, path);
    row.classList.toggle('changed', cur !== def);
  }

  private filter(q: string): void {
    for (const r of this.rows) r.row.style.display = !q || r.row.dataset.key!.includes(q) ? '' : 'none';
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(TUNING));
    } catch {
      // Not persisted.
    }
  }

  private resetAll(): void {
    mergeTuning(TUNING as unknown as TuningNode, this.defaults);
    for (const r of this.rows) {
      const v = getTuning(TUNING as unknown as TuningNode, r.path) as number;
      r.range.value = String(v);
      r.num.value = String(v);
      this.markChanged(r.row, r.path);
    }
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      // Ignore.
    }
    this.refresh();
  }

  private async save(): Promise<void> {
    try {
      const res = await fetch('/dev/tuning', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(TUNING) });
      const body = (await res.json()) as { changed?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? String(res.status));
      this.defaults = cloneTuning(TUNING as unknown as TuningNode);
      for (const r of this.rows) this.markChanged(r.row, r.path);
      this.status.textContent = `${UI.tuning.saved} (${body.changed?.length ?? 0})`;
    } catch (err) {
      this.status.textContent = `${UI.tuning.saveFailed} ${(err as Error).message}`;
    }
  }

  private showText(): void {
    const text = 'export const TUNING = ' + JSON.stringify(TUNING, null, 2).replace(/"(\w+)":/g, '$1:') + ';\n';
    const modal = h('div', 'modal', undefined, document.body);
    const ta = h('textarea', '', undefined, modal);
    ta.value = text;
    ta.readOnly = true;
    const close = h('button', 'btn', UI.menu.back, modal);
    close.onclick = () => modal.remove();
    ta.focus();
    ta.select();
  }

  /** Recomputes derived numbers and the recoil plot. */
  refresh(): void {
    if (!this.visible) return;
    const lines: string[] = [];
    for (const w of WEAPON_IDS) {
      const cb = timeToKill(w, 'body', 10, 'cod');
      const ch = timeToKill(w, 'head', 10, 'cod');
      const sb = timeToKill(w, 'body', 10, 'scramble');
      const far = timeToKill(w, 'body', 60, 'cod');
      lines.push(
        `${UI.hud.weapons[w]}: CoD ${cb.seconds.toFixed(2)} s (${cb.shots}) body, ${ch.seconds.toFixed(2)} s (${ch.shots}) head, 60 m ${far.seconds.toFixed(2)} s · Scramble ${sb.seconds.toFixed(2)} s`,
      );
      const T = TUNING[w];
      lines.push(`  ADS ${Math.round(T.adsTime * 1000)} ms / ${Math.round(T.adsOutTime * 1000)} ms · sprint-to-fire ${Math.round(T.sprintToFire * 1000)} ms · reload ${T.reloadTime} / ${T.reloadEmptyTime} s`);
    }
    const mv = movementMetrics();
    lines.push(`Movement: 90 % of top speed in ${mv.t90.toFixed(2)} s · stop in ${mv.stopTime.toFixed(2)} s / ${mv.stopDist.toFixed(2)} m`);
    lines.push(`Jump ${mv.jumpHeight.toFixed(2)} m (+${TUNING.move.airStepHeight.toFixed(2)} m ledge assist), airborne ${mv.airTime.toFixed(2)} s · sprint ${TUNING.move.sprintSpeed} m/s`);
    this.derived.textContent = lines.join('\n');
    this.drawRecoil();
  }

  private drawRecoil(): void {
    const T = TUNING[this.plotWeapon];
    const g = this.plot.getContext('2d')!;
    const W = this.plot.width;
    const H = this.plot.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, W, H);
    // Simulate 30 shots at the fire rate with no compensation: aim share + punch.
    const interval = 60 / T.rpm;
    let aimP = 0;
    let aimY = 0;
    let punchP = 0;
    let punchY = 0;
    let tP = 0;
    let tY = 0;
    let pendP = 0;
    let pendY = 0;
    const pts: [number, number][] = [];
    const kick = { pitch: 0, yaw: 0 };
    let t = 0;
    let next = 0;
    for (let shot = 0; shot < 30; ) {
      if (t >= next) {
        pts.push([aimY + punchY, aimP + punchP]);
        recoilKick(T, shot, 0, 0, kick);
        pendP += kick.pitch * T.recoilAimShare;
        pendY += kick.yaw * T.recoilAimShare;
        tP += kick.pitch * (1 - T.recoilAimShare);
        tY += kick.yaw * (1 - T.recoilAimShare);
        shot++;
        next += interval;
      }
      const dt = SIM_DT;
      tP *= Math.exp(-T.recoilReturn * dt);
      tY *= Math.exp(-T.recoilReturn * dt);
      punchP = tP + (punchP - tP) * Math.exp(-T.recoilRise * dt);
      punchY = tY + (punchY - tY) * Math.exp(-T.recoilRise * dt);
      const feed = 1 - Math.exp(-T.recoilRise * dt);
      aimP += pendP * feed;
      aimY += pendY * feed;
      pendP -= pendP * feed;
      pendY -= pendY * feed;
      t += dt;
    }
    const maxP = Math.max(4, ...pts.map((p) => p[1])) * 1.1;
    const maxY = Math.max(2, ...pts.map((p) => Math.abs(p[0]))) * 1.2;
    const sx = (y: number) => W / 2 + (y / maxY) * (W / 2 - 10);
    const sy = (p: number) => H - 10 - (p / maxP) * (H - 20);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    for (let d = 0; d <= maxP; d += 2) {
      g.beginPath();
      g.moveTo(0, sy(d));
      g.lineTo(W, sy(d));
      g.stroke();
    }
    g.beginPath();
    g.moveTo(sx(0), 0);
    g.lineTo(sx(0), H);
    g.stroke();
    g.strokeStyle = '#e2b21f';
    g.beginPath();
    pts.forEach(([y, p], i) => (i === 0 ? g.moveTo(sx(y), sy(p)) : g.lineTo(sx(y), sy(p))));
    g.stroke();
    pts.forEach(([y, p], i) => {
      g.fillStyle = i === 0 ? '#ffffff' : '#e2b21f';
      g.fillRect(sx(y) - 2, sy(p) - 2, 4, 4);
    });
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '11px monospace';
    g.fillText(`${maxP.toFixed(0)}°`, 4, 12);
  }
}

let testWorld: CollisionWorld | null = null;

/** Measures movement feel numbers by running the real movement code on flat ground. */
function movementMetrics(): { t90: number; stopTime: number; stopDist: number; jumpHeight: number; airTime: number } {
  testWorld ??= new CollisionWorld([brushFromPlanes(boxPlanes(-500, -1, -500, 500, 0, 500))]);
  const mover = new Mover(testWorld);
  const st = newMoveState(0, 0.05, 0);
  for (let i = 0; i < 30; i++) mover.step(st, emptyCmd(), SIM_DT);
  const cmd = { ...emptyCmd(), forward: 1 };
  let t90 = NaN;
  for (let i = 0; i < 240; i++) {
    mover.step(st, cmd, SIM_DT);
    if (Number.isNaN(t90) && Math.hypot(st.vx, st.vz) >= TUNING.move.walkSpeed * 0.9) t90 = (i + 1) * SIM_DT;
  }
  const z0 = st.z;
  let stopTime = NaN;
  for (let i = 0; i < 240; i++) {
    mover.step(st, emptyCmd(), SIM_DT);
    if (Number.isNaN(stopTime) && Math.hypot(st.vx, st.vz) === 0) stopTime = (i + 1) * SIM_DT;
  }
  const g = TUNING.move.gravity;
  const v = TUNING.move.jumpVelocity;
  return { t90, stopTime, stopDist: Math.abs(st.z - z0), jumpHeight: (v * v) / (2 * g), airTime: (2 * v) / g };
}
