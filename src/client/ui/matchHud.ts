import { PHONE } from '../../shared/config';
import { ACCENTS, type PlayerInfo, type RoundInfo } from '../../shared/protocol';
import { UI } from '../../shared/ui';
import { wrapAngle } from '../../shared/math';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
export const accentOf = (info: PlayerInfo | undefined) => hex(ACCENTS[(info?.color ?? 0) % ACCENTS.length]!);

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}

interface DamageDir {
  x: number;
  z: number;
  t: number;
  strength: number;
  node: HTMLDivElement;
}

interface FeedLine {
  node: HTMLDivElement;
  t: number;
}

/** Match HUD: health, damage direction, kill feed, round timer, scoreboard and death screen. */
export class MatchHud {
  readonly root: HTMLDivElement;
  private healthBox: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private healthNum: HTMLDivElement;
  private vignette: HTMLDivElement;
  private dirs: HTMLDivElement;
  private feed: HTMLDivElement;
  private timer: HTMLDivElement;
  private timerRound: HTMLDivElement;
  private timerText: HTMLDivElement;
  private board: HTMLDivElement;
  private death: HTMLDivElement;
  private deathTitle: HTMLDivElement;
  private deathSub: HTMLDivElement;
  private confirm: HTMLDivElement;
  private protect: HTMLDivElement;
  private status: HTMLDivElement;
  private phoneLine: HTMLDivElement;
  private typoFeed: HTMLDivElement;
  private typoLines: FeedLine[] = [];
  private damageDirs: DamageDir[] = [];
  private feedLines: FeedLine[] = [];
  private hurt = 0;
  private confirmTimer = 0;
  private last = new Map<string, string | number | boolean>();
  boardVisible = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'match-hud', parent);
    this.vignette = el('div', 'dmg-vignette', this.root);
    this.dirs = el('div', 'dmg-dirs', this.root);
    this.healthBox = el('div', 'health', this.root);
    el('div', 'health-label', this.healthBox, UI.hud.health);
    const bar = el('div', 'health-bar', this.healthBox);
    this.healthFill = el('div', 'health-fill', bar);
    this.healthNum = el('div', 'health-num', this.healthBox);
    this.phoneLine = el('div', 'phone-line', this.healthBox);
    this.typoFeed = el('div', 'typofeed', this.root);
    this.feed = el('div', 'killfeed', this.root);
    this.timer = el('div', 'round-timer', this.root);
    this.timerRound = el('div', 'round-n', this.timer);
    this.timerText = el('div', 'round-time', this.timer);
    this.board = el('div', 'scoreboard hidden', this.root);
    this.death = el('div', 'death hidden', this.root);
    this.deathTitle = el('div', 'death-title', this.death);
    this.deathSub = el('div', 'death-sub', this.death);
    this.confirm = el('div', 'kill-confirm', this.root);
    this.protect = el('div', 'spawn-protect hidden', this.root, UI.hud.spawnProtect);
    this.status = el('div', 'net-status hidden', this.root);
  }

  private changed(key: string, v: string | number | boolean): boolean {
    if (this.last.get(key) === v) return false;
    this.last.set(key, v);
    return true;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  health(hp: number): void {
    const h = Math.max(0, Math.round(hp));
    if (!this.changed('hp', h)) return;
    this.healthFill.style.width = `${h}%`;
    this.healthNum.textContent = String(h);
    this.healthBox.classList.toggle('low', h <= 35);
  }

  /** Damage taken from a world position; the indicator turns with the view. */
  damage(amount: number, fromX: number, fromZ: number): void {
    this.hurt = Math.min(1, this.hurt + amount / 45);
    const node = el('div', 'dmg-dir', this.dirs);
    el('div', 'dmg-arc', node);
    this.damageDirs.push({ x: fromX, z: fromZ, t: 0, strength: Math.min(1, 0.45 + amount / 50), node });
    if (this.damageDirs.length > 6) this.damageDirs.shift()!.node.remove();
  }

  /** Kill feed line; `draft` is what the victim was typing on their phone when they died. */
  kill(killer: PlayerInfo | undefined, victim: PlayerInfo | undefined, weapon: string, head: boolean, myId: number, draft?: string): void {
    const line = el('div', 'feed-line', this.feed);
    if (killer?.id === myId || victim?.id === myId) line.classList.add('mine');
    const name = (p: PlayerInfo | undefined) => {
      const s = el('span', 'feed-name', line, p?.name ?? '?');
      s.style.setProperty('--accent', accentOf(p));
      return s;
    };
    if (killer && killer.id !== victim?.id) {
      name(killer);
      el('span', 'feed-weapon', line, weapon);
      if (head) el('span', 'feed-head', line, UI.hud.headshot);
      name(victim);
    } else {
      name(victim);
      el('span', 'feed-weapon', line, UI.hud.selfKill);
    }
    if (draft) {
      el('span', 'feed-typing', line, ` — ${UI.hud.wasTyping} `);
      el('span', 'feed-draft', line, `‘${draft}’`);
    }
    this.push(line);
  }

  /** Public typo feed: a phone message that wasn't valid, and the varusmestari's answer. */
  typo(from: PlayerInfo | undefined, to: string, text: string, reply: string): void {
    const item = el('div', 'typo', this.typoFeed);
    const l1 = el('div', 'typo-msg', item);
    const n = el('span', 'typo-name', l1, from?.name ?? '?');
    n.style.setProperty('--accent', accentOf(from));
    el('span', 'typo-to', l1, ` → ${to}: `);
    el('span', 'typo-text', l1, text);
    if (reply) {
      const l2 = el('div', 'typo-reply', item);
      el('span', 'typo-name them', l2, `${to}: `);
      el('span', '', l2, reply);
    }
    this.typoLines.push({ node: item, t: 0 });
    while (this.typoLines.length > PHONE.typoLines) this.typoLines.shift()!.node.remove();
  }

  /** Our own phone: connected, offline, or not paired yet. */
  phone(state: 'none' | 'online' | 'offline', out: boolean): void {
    const key = `${state}${out}`;
    if (!this.changed('phone', key)) return;
    this.phoneLine.textContent = state === 'online' ? `📱 ${UI.hud.phoneOnline}` : state === 'offline' ? `📱 ${UI.hud.phoneOffline}` : UI.hud.phoneNone;
    this.phoneLine.dataset.state = state;
    this.phoneLine.classList.toggle('out', out);
  }

  notice(text: string): void {
    this.push(el('div', 'feed-line notice', this.feed, text));
  }

  private push(node: HTMLDivElement): void {
    this.feedLines.push({ node, t: 0 });
    while (this.feedLines.length > 7) this.feedLines.shift()!.node.remove();
  }

  killConfirm(name: string, head: boolean): void {
    this.confirm.textContent = fill(UI.hud.killed, { name }) + (head ? ` · ${UI.hud.headshot}` : '');
    this.confirm.classList.remove('show');
    void this.confirm.offsetWidth;
    this.confirm.classList.add('show');
    this.confirmTimer = 1.6;
  }

  spawnProtect(on: boolean): void {
    if (this.changed('protect', on)) this.protect.classList.toggle('hidden', !on);
  }

  netStatus(text: string): void {
    if (!this.changed('net', text)) return;
    this.status.textContent = text;
    this.status.classList.toggle('hidden', text.length === 0);
  }

  roundTimer(round: RoundInfo | null, serverNow: number): void {
    if (!round) return;
    const left = Math.max(0, Math.ceil((round.endsAt - serverNow) / 1000));
    const text = round.state === 'playing' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : fill(UI.hud.nextRound, { s: left });
    if (this.changed('timer', text)) this.timerText.textContent = text;
    const rn = fill(UI.hud.round, { n: round.n });
    if (this.changed('roundN', rn)) this.timerRound.textContent = rn;
    const urgent = round.state === 'playing' && left <= 30;
    if (this.changed('urgent', urgent)) this.timer.classList.toggle('urgent', urgent);
  }

  showDeath(title: string, sub: string): void {
    if (this.changed('deathT', title)) this.deathTitle.textContent = title;
    if (this.changed('deathS', sub)) this.deathSub.textContent = sub;
    if (this.changed('death', true)) this.death.classList.remove('hidden');
  }

  hideDeath(): void {
    if (this.changed('death', false)) this.death.classList.add('hidden');
  }

  /** Scoreboard (Tab, and automatically between rounds). */
  scoreboard(show: boolean, players: PlayerInfo[], myId: number, round: RoundInfo | null, serverNow: number): void {
    this.boardVisible = show;
    this.board.classList.toggle('hidden', !show);
    if (!show) return;
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
    const ended = round?.state === 'ended';
    const key = JSON.stringify([sorted.map((p) => [p.id, p.name, p.kills, p.deaths, p.ping, p.connected, p.phone]), ended, round?.n, ended ? Math.ceil(((round?.endsAt ?? 0) - serverNow) / 1000) : 0]);
    if (!this.changed('board', key)) return;
    this.board.innerHTML = '';
    const head = el('div', 'sb-head', this.board);
    el('div', 'sb-title', head, ended ? UI.hud.roundOver : UI.scoreboard.title);
    if (round) el('div', 'sb-round', head, ended ? fill(UI.hud.nextRound, { s: Math.max(0, Math.ceil((round.endsAt - serverNow) / 1000)) }) : fill(UI.hud.round, { n: round.n }));
    if (ended && sorted[0]) el('div', 'sb-winner', this.board, fill(UI.hud.roundWinner, { name: sorted[0].name }));
    const table = el('div', 'sb-table', this.board);
    const row = (cls: string) => el('div', `sb-row ${cls}`, table);
    const h = row('sb-cols');
    el('div', 'sb-rank', h, '#');
    el('div', 'sb-name', h, UI.scoreboard.name);
    el('div', 'sb-num', h, UI.scoreboard.kills);
    el('div', 'sb-num', h, UI.scoreboard.deaths);
    el('div', 'sb-num', h, UI.scoreboard.ping);
    sorted.forEach((p, i) => {
      const r = row(p.id === myId ? 'me' : '');
      if (!p.connected && !p.bot) r.classList.add('away');
      el('div', 'sb-rank', r, String(i + 1));
      const n = el('div', 'sb-name', r);
      const chip = el('span', 'sb-chip', n);
      chip.style.background = accentOf(p);
      el('span', '', n, p.name);
      if (!p.bot && p.phone !== 'none') {
        const ph = el('span', `sb-phone ${p.phone}`, n, '📱');
        ph.title = p.phone === 'online' ? UI.scoreboard.phoneOnline : UI.scoreboard.phoneOffline;
      }
      if (p.bot) el('span', 'sb-tag', n, UI.scoreboard.bot);
      if (p.id === myId) el('span', 'sb-tag you', n, UI.scoreboard.you);
      if (!p.connected && !p.bot) el('span', 'sb-tag', n, UI.scoreboard.away);
      el('div', 'sb-num', r, String(p.kills));
      el('div', 'sb-num', r, String(p.deaths));
      el('div', 'sb-num dim', r, p.bot ? '–' : String(p.ping));
    });
  }

  /** Per frame: fades, and turns the damage indicators with the camera. */
  update(dt: number, eyeX: number, eyeZ: number, camYaw: number): void {
    this.hurt = Math.max(0, this.hurt - dt * 0.9);
    const v = Math.round(this.hurt * 100) / 100;
    if (this.changed('hurt', v)) this.vignette.style.opacity = String(v);
    for (const d of this.damageDirs) {
      d.t += dt;
      const dirYaw = Math.atan2(-(d.x - eyeX), -(d.z - eyeZ));
      const rel = wrapAngle(dirYaw - camYaw);
      d.node.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      d.node.style.opacity = String(Math.max(0, d.strength * (1 - d.t / 1.6)));
    }
    while (this.damageDirs.length && this.damageDirs[0]!.t > 1.6) this.damageDirs.shift()!.node.remove();
    for (const f of this.feedLines) {
      f.t += dt;
      if (f.t > 7) f.node.classList.add('fade');
    }
    while (this.feedLines.length && this.feedLines[0]!.t > 7.6) this.feedLines.shift()!.node.remove();
    for (const f of this.typoLines) {
      f.t += dt;
      if (f.t > PHONE.typoFade) f.node.classList.add('fade');
    }
    while (this.typoLines.length && this.typoLines[0]!.t > PHONE.typoFade + 0.6) this.typoLines.shift()!.node.remove();
    if (this.confirmTimer > 0) {
      this.confirmTimer -= dt;
      if (this.confirmTimer <= 0) this.confirm.classList.remove('show');
    }
  }

  reset(): void {
    for (const d of this.damageDirs) d.node.remove();
    this.damageDirs = [];
    this.hurt = 0;
    this.hideDeath();
  }
}
