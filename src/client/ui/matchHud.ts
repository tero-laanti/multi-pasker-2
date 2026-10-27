import { PHONE, SERVICE } from '../../shared/config';
import { FI } from '../../shared/fi';
import { ACCENTS, type AwardInfo, type MatchResult, type PlayerInfo, type RoundInfo } from '../../shared/protocol';
import { UI } from '../../shared/ui';
import { wrapAngle } from '../../shared/math';
import { Minimap } from './minimap';

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

/** Match HUD: health, damage direction, kill feed, round timer, minimap, scoreboard and death screen. */
export class MatchHud {
  readonly root: HTMLDivElement;
  readonly minimap: Minimap;
  private healthBox: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private healthNum: HTMLDivElement;
  private vignette: HTMLDivElement;
  private dirs: HTMLDivElement;
  private feed: HTMLDivElement;
  private timer: HTMLDivElement;
  private timerRound: HTMLDivElement;
  private timerText: HTMLDivElement;
  private ladderLine: HTMLDivElement;
  private inventoryLine: HTMLDivElement;
  private taskLine: HTMLDivElement;
  private kills = 0;
  private lastLadder: [number, number, boolean, number] = [0, SERVICE.days, false, 0];

  /** Our kills this round (the score) next to rank and TJ. */
  score(kills: number): void {
    if (kills === this.kills) return;
    const [r, tj, open, queued] = this.lastLadder;
    this.ladder(r, tj, open, queued, kills);
  }
  private board: HTMLDivElement;
  private death: HTMLDivElement;
  private deathTitle: HTMLDivElement;
  private deathSub: HTMLDivElement;
  private confirm: HTMLDivElement;
  private confirmName: HTMLDivElement;
  private confirmPay: HTMLDivElement;
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
  /** The board's round line: between rounds its countdown ticks without rebuilding the board. */
  private boardRound: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'match-hud', parent);
    this.vignette = el('div', 'dmg-vignette', this.root);
    this.dirs = el('div', 'dmg-dirs', this.root);
    this.minimap = new Minimap(this.root);
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
    this.ladderLine = el('div', 'ladder-line', this.root);
    this.taskLine = el('div', 'task-line', this.ladderLine);
    this.inventoryLine = el('div', 'inventory-line hidden', this.root);
    this.board = el('div', 'scoreboard hidden', this.root);
    this.death = el('div', 'death hidden', this.root);
    this.deathTitle = el('div', 'death-title', this.death);
    this.deathSub = el('div', 'death-sub', this.death);
    this.confirm = el('div', 'kill-confirm', this.root);
    this.confirmName = el('div', 'kill-name', this.confirm);
    this.confirmPay = el('div', 'kill-pay', this.confirm);
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
      el('span', 'feed-rank', line, `${p?.star ? '★ ' : ''}${FI.rankAbbr[p?.rank ?? 0] ?? ''} `);
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

  /** Rank and TJ under the round timer, and whether paperwork waits on the phone. */
  ladder(rank: number, tj: number, open: boolean, queued: number, kills = this.kills): void {
    this.lastLadder = [rank, tj, open, queued];
    this.kills = kills;
    const r = FI.ranks[rank] ?? FI.ranks[0]!;
    const head = `${r[0]!.toUpperCase()}${r.slice(1)} · TJ ${tj} · ${fill(kills === 1 ? UI.hud.kill1 : UI.hud.kills, { n: kills })}`;
    const task = open ? UI.hud.taskOpen + (queued > 0 ? ` · ${fill(UI.hud.taskQueued, { n: queued })}` : '') : '';
    if (this.changed('ladder', head + task)) {
      this.ladderLine.textContent = head;
      this.taskLine.textContent = task;
      this.ladderLine.appendChild(this.taskLine);
      this.taskLine.classList.toggle('hidden', !task);
    }
  }

  /**
   * The phone bar under the round timer: an inventory check counting down (seconds left, 0:
   * none), otherwise who has written and not been read yet.
   */
  phoneBar(left: number, unread: string[]): void {
    const s = Math.ceil(left);
    const text =
      s > 0
        ? fill(UI.hud.inventory, { from: FI.inventory.name, s })
        : unread.length
          ? fill(unread.length === 1 ? UI.hud.newMessage : UI.hud.newMessages, { from: unread.join(', ') })
          : '';
    if (!this.changed('phoneBar', text + (s > 0 && s <= 5))) return;
    this.inventoryLine.textContent = text;
    this.inventoryLine.classList.toggle('hidden', !text);
    this.inventoryLine.classList.toggle('urgent', s > 0 && s <= 5);
    this.inventoryLine.classList.toggle('calm', s <= 0);
  }

  /** Our own phone: connected, offline, or not paired yet. */
  phone(state: 'none' | 'online' | 'offline', out: boolean, virtual = false): void {
    const key = `${state}${out}${virtual}`;
    if (!this.changed('phone', key)) return;
    this.phoneLine.textContent = state === 'online' ? `📱 ${virtual ? UI.hud.phoneVirtual : UI.hud.phoneOnline}` : state === 'offline' ? `📱 ${UI.hud.phoneOffline}` : UI.hud.phoneNone;
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
    this.confirmName.textContent = fill(UI.hud.killed, { name }) + (head ? ` · ${UI.hud.headshot}` : '');
    this.confirmPay.textContent = '';
    this.confirm.classList.remove('show');
    void this.confirm.offsetWidth;
    this.confirm.classList.add('show');
    this.confirmTimer = 1.6;
  }

  /** What the kill paid, in small text under the confirmation (the total is only on the phone). */
  killPay(text: string): void {
    this.confirmPay.textContent = text;
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
    const text = round.state === 'playing' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : fill(round.matchOver ? UI.hud.nextMatch : UI.hud.nextRound, { s: left });
    if (this.changed('timer', text)) this.timerText.textContent = text;
    const rn = round.state === 'ended' && round.matchOver ? UI.hud.matchOver : fill(UI.hud.round, { n: round.round, of: round.of });
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

  /**
   * Scoreboard (Tab, and automatically between rounds). Kills and deaths count over the match;
   * after its last round come the match's winner, its awards and who won each match tonight.
   */
  scoreboard(show: boolean, players: PlayerInfo[], myId: number, round: RoundInfo | null, serverNow: number, awards: AwardInfo[] = [], evening: MatchResult[] = []): void {
    this.boardVisible = show;
    this.board.classList.toggle('hidden', !show);
    if (!show) return;
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
    const ended = round?.state === 'ended';
    const results = ended && !!round?.matchOver;
    const key = JSON.stringify([
      sorted.map((p) => [p.id, p.name, p.kills, p.deaths, p.ping, p.connected, p.phone, p.rank, p.training, p.star]),
      ended,
      round?.n,
      round?.of,
      results ? awards : 0,
      results ? evening : 0,
    ]);
    const roundLine = round ? (ended ? fill(results ? UI.hud.nextMatch : UI.hud.nextRound, { s: Math.max(0, Math.ceil((round.endsAt - serverNow) / 1000)) }) : fill(UI.hud.round, { n: round.round, of: round.of })) : '';
    if (!this.changed('board', key)) {
      if (this.boardRound && this.boardRound.textContent !== roundLine) this.boardRound.textContent = roundLine;
      return;
    }
    this.board.innerHTML = '';
    this.boardRound = null;
    this.board.classList.toggle('wide', results);
    const main = results ? el('div', 'sb-col', this.board) : this.board;
    const head = el('div', 'sb-head', main);
    el('div', 'sb-title', head, results ? UI.hud.matchOver : ended && round ? fill(UI.hud.roundOver, { n: round.round, of: round.of }) : UI.scoreboard.title);
    if (round) this.boardRound = el('div', 'sb-round', head, roundLine);
    // The match's winner is the server's (its awards); between rounds, whoever leads now.
    const winner = results ? awards.find((a) => a.id === 'winner')?.playerName : sorted[0] && sorted[0].kills > 0 ? sorted[0].name : undefined;
    if (ended && winner) el('div', 'sb-winner', main, fill(results ? UI.hud.matchWinner : UI.hud.leading, { name: winner }));
    const table = el('div', 'sb-table', main);
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
      el('span', 'sb-rank-abbr', n, `${p.star ? '★ ' : ''}${FI.rankAbbr[p.rank] ?? ''}`);
      el('span', '', n, p.name);
      if (!p.bot && p.phone !== 'none') {
        const ph = el('span', `sb-phone ${p.phone}`, n, '📱');
        ph.title = p.phone === 'online' ? UI.scoreboard.phoneOnline : UI.scoreboard.phoneOffline;
      }
      if (p.bot) el('span', 'sb-tag', n, UI.scoreboard.bot);
      if (p.id === myId) el('span', 'sb-tag you', n, UI.scoreboard.you);
      if (!p.connected && !p.bot) el('span', 'sb-tag', n, UI.scoreboard.away);
      else if (p.training) el('span', 'sb-tag', n, UI.scoreboard.training);
      el('div', 'sb-num', r, String(p.kills));
      el('div', 'sb-num', r, String(p.deaths));
      el('div', 'sb-num dim', r, p.bot ? '–' : String(p.ping));
    });
    if (!results) return;
    const side = el('div', 'sb-col side', this.board);
    if (awards.length) {
      el('div', 'sb-sub', side, UI.awards.title);
      const byId = new Map(players.map((p) => [p.id, p]));
      for (const a of awards) {
        const row = el('div', 'award', side);
        el('div', 'award-name', row, a.name);
        const who = el('div', 'award-who', row);
        const chip = el('span', 'sb-chip', who);
        chip.style.background = accentOf(byId.get(a.player));
        el('span', '', who, a.playerName);
        const text = (a.value === '1' && UI.awards[`${a.id}1`]) || UI.awards[a.id] || '';
        el('div', 'award-what', row, fill(text, { v: a.value }));
      }
    }
    if (evening.length) {
      el('div', 'sb-sub', side, UI.evening.title);
      const t = el('div', 'ev-table', side);
      const E = UI.evening;
      for (const m of evening.slice(-10)) {
        const row = el('div', 'ev-row', t);
        el('div', 'ev-match', row, fill(E.match, { n: m.match }));
        el('div', 'ev-name', row, m.bot ? `${m.winner} (${UI.scoreboard.bot})` : m.winner);
        el('div', 'sb-num', row, fill(m.kills === 1 ? E.kill1 : E.kills, { n: m.kills }));
      }
    }
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
