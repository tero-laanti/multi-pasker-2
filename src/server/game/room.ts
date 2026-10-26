import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { MASK } from '../../shared/collision/brush';
import { CollisionWorld, TraceResult } from '../../shared/collision/world';
import { NET, PHONE, TUNING, type KillSpeedPreset, type WeaponId } from '../../shared/config';
import { blastReaches, explosionDamage, GRENADE_RADIUS, stepGrenade, type Grenade } from '../../shared/grenade';
import { rayPlayer, type HitZone } from '../../shared/hitbox';
import type { MapData, SpawnPoint } from '../../shared/map/types';
import { buildNavGraph, type NavNode } from '../../shared/nav';
import {
  ACCENTS,
  BIN,
  PF,
  PROTOCOL_VERSION,
  WEAPON_IDS,
  cleanName,
  decodeState,
  encodeSnapshot,
  type ClientMsg,
  type GameEvent,
  type PhoneClientMsg,
  type PlayerSnap,
  type RoundInfo,
} from '../../shared/protocol';
import { damageFor } from '../../shared/weapons';
import { Bot } from './bot';
import { ServerPlayer } from './player';
import { Varusmestari } from './varusmestari';
import { LadderService } from './ladder';
import { VoiceNotes } from '../voicenotes';
import { UPGRADES, maxGrenades, type UpgradeId } from '../../shared/upgrades';
import type { UpgradeOffer } from '../../shared/protocol';
import { FI } from '../../shared/fi';

const FI_NUMBER = FI.varusmestari.number;

export const ROUND_TIME = 240_000;
export const INTERMISSION = 12_000;
/** More players than this open the outer-ring gate. */
export const GATE_PLAYERS = 8;
const BOT_NAMES = ['Virtanen', 'Korhonen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Lehtinen', 'Saarinen', 'Salminen', 'Heinonen'];

export interface RoomOptions {
  dev: boolean;
  now?: () => number;
  /** Address phones use to reach the server, e.g. http://192.168.1.23:8088/ (never localhost). */
  publicUrl?: string;
  /** Spliced phonetic-alphabet voice notes (tests run without). */
  voiceNotes?: VoiceNotes;
}

interface TypoCandidate {
  p: number;
  to: string;
  text: string;
  reply: string;
  at: number;
}

/** The match: players, bots, rounds, shots and damage. Ticked at NET.tickHz by the server. */
export class Room {
  readonly world: CollisionWorld;
  readonly nav: NavNode[];
  readonly players = new Map<number, ServerPlayer>();
  readonly bots: Bot[] = [];
  round: RoundInfo;
  killSpeed: KillSpeedPreset = 'cod';
  /** Dev: R reloads directly instead of messaging the varusmestari. */
  directReload: boolean;
  tickMs = 0;
  readonly varusmestari = new Varusmestari(this);
  readonly ladder = new LadderService(this);
  readonly voiceNotes: VoiceNotes;
  private typos: TypoCandidate[] = [];
  private lastTypoAt = -1e9;
  private events: GameEvent[] = [];
  private grenades: (Grenade & { owner: number })[] = [];
  private nextGrenadeId = 1;
  private tr = new TraceResult();
  private tickCount = 0;
  readonly now: () => number;

  constructor(
    readonly map: MapData,
    readonly opts: RoomOptions,
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.directReload = opts.dev;
    this.voiceNotes = opts.voiceNotes ?? new VoiceNotes(null);
    this.world = new CollisionWorld(map.brushes);
    this.nav = buildNavGraph(this.world, map.nav ?? []);
    this.round = { n: 1, state: 'playing', endsAt: this.now() + ROUND_TIME, gateOpen: false };
    this.setGate(false);
  }

  // ---- membership ----

  private freeId(): number {
    for (let id = 1; id < 250; id++) if (!this.players.has(id)) return id;
    throw new Error('room full');
  }

  private freeColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color));
    for (let c = 0; c < ACCENTS.length; c++) if (!used.has(c)) return c;
    return this.players.size % ACCENTS.length;
  }

  /** A human joins or rejoins with their token. Returns the player. */
  join(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>, isHost = false): ServerPlayer | null {
    if (msg.v !== PROTOCOL_VERSION) return null;
    let p = msg.token ? [...this.players.values()].find((x) => x.token === msg.token && !x.bot) : undefined;
    const name = cleanName(msg.name) || 'Alokas';
    if (p) {
      p.ws = ws;
      p.connected = true;
      p.name = name;
      p.isHost = isHost;
      if (!p.alive && this.round.state === 'playing') this.respawn(p);
      this.emit({ k: 'join', p: p.id, name: p.name });
    } else {
      if (this.humanCount() + this.bots.length >= 16 && this.bots.length > 0) this.removeBot();
      p = new ServerPlayer(this.freeId(), randomUUID(), name, this.freeColor(), false);
      p.ws = ws;
      p.isHost = isHost;
      p.newSerials();
      p.phone.pairCode = this.freePairCode();
      this.players.set(p.id, p);
      this.respawn(p);
      this.updateGate();
      this.emit({ k: 'join', p: p.id, name: p.name });
    }
    p.send({
      t: 'welcome',
      id: p.id,
      token: p.token,
      map: this.map.id,
      players: this.playerList(),
      round: this.round,
      serverTime: this.now(),
      snapshotHz: NET.snapshotHz,
      dev: this.opts.dev,
    });
    this.broadcastPlayers();
    this.sendSpawnState(p);
    this.sendPairInfo(p);
    this.ladder.notify(p);
    p.outbox.push({ k: 'upgrades', u: { ...p.ladder.upgrades } });
    p.phone.sendStatus(p.phoneStatus(this.round.n));
    return p;
  }

  private freePairCode(): string {
    const used = new Set([...this.players.values()].map((p) => p.phone.pairCode));
    for (;;) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!used.has(code)) return code;
    }
  }

  sendPairInfo(p: ServerPlayer): void {
    const base = this.opts.publicUrl ?? '';
    p.send({ t: 'pairInfo', url: base ? `${base}phone#${p.phone.pairToken}` : '', token: p.phone.pairToken, code: p.phone.pairCode, phone: p.phone.status() });
  }

  // ---- phones ----

  /** A phone connects: pairing by QR token or short code, or resuming with its own token. */
  phoneJoin(ws: WebSocket, msg: Extract<PhoneClientMsg, { t: 'phoneHello' }>, isHost: boolean): ServerPlayer | null {
    const fail = (reason: 'code' | 'version' | 'sim' | 'token') => {
      ws.send(JSON.stringify({ t: 'pairFailed', reason }));
      return null;
    };
    if (msg.v !== PROTOCOL_VERSION) return fail('version');
    if (msg.sim && !this.opts.dev && !isHost) return fail('sim');
    const humans = [...this.players.values()].filter((p) => !p.bot);
    let p: ServerPlayer | undefined;
    let pairing = false;
    if (msg.token) p = humans.find((x) => x.phone.paired && x.phone.token === msg.token);
    if (!p && msg.pair) {
      p = humans.find((x) => x.phone.pairToken === msg.pair);
      pairing = !!p;
    }
    if (!p && msg.code) {
      p = humans.find((x) => x.phone.pairCode === msg.code?.trim());
      pairing = !!p;
    }
    if (!p) return fail(msg.token && !msg.pair && !msg.code ? 'token' : 'code');
    const phone = p.phone;
    let replaced = false;
    if (pairing) {
      // One phone per player: a new phone takes over, and the old one is told.
      if (phone.ws && phone.ws !== ws) {
        phone.send({ t: 'replaced' });
        phone.ws.close(4001, 'replaced');
        replaced = true;
      } else if (phone.paired) replaced = true;
      const first = !phone.paired;
      phone.token = randomUUID();
      if (first) this.varusmestari.greet(p);
    } else if (phone.ws && phone.ws !== ws) {
      phone.ws.close(4002, 'resumed elsewhere');
    }
    phone.ws = ws;
    phone.sim = !!msg.sim;
    ws.send(
      JSON.stringify({
        t: 'phoneWelcome',
        token: phone.token,
        player: { id: p.id, name: p.name, color: p.color },
        convs: [...phone.convs.values()],
        status: p.phoneStatus(this.round.n),
        dev: this.opts.dev,
        replaced,
        upgrade: this.upgradeOffer(p),
      }),
    );
    phone.sendStatus(p.phoneStatus(this.round.n), true);
    if (pairing) p.outbox.push({ k: 'paired', replaced });
    this.sendPairInfo(p);
    this.broadcastPlayers();
    return p;
  }

  phoneDisconnect(p: ServerPlayer, ws: WebSocket): void {
    if (p.phone.ws !== ws) return;
    p.phone.ws = null;
    p.phone.out = false;
    this.sendPairInfo(p);
    this.broadcastPlayers();
  }

  onPhoneMessage(p: ServerPlayer, msg: PhoneClientMsg): void {
    const phone = p.phone;
    const now = this.now();
    switch (msg.t) {
      case 'send':
        if (typeof msg.text !== 'string' || typeof msg.rid !== 'string' || typeof msg.conv !== 'string') return;
        this.varusmestari.receive(p, msg);
        break;
      case 'open': {
        const id = String(msg.conv).replace(/[^\d+]/g, '').slice(0, 24);
        if (id && !this.ladder.opened(p, id) && !phone.convs.has(id)) phone.conv(id, id);
        break;
      }
      case 'choose': {
        if (typeof msg.rid !== 'string' || phone.rids.has(msg.rid)) break;
        phone.rids.add(msg.rid);
        if (msg.id in UPGRADES) this.ladder.choose(p, msg.id);
        break;
      }
      case 'read': {
        const c = phone.convs.get(msg.conv);
        if (c) c.unread = 0;
        break;
      }
      case 'draft': {
        const text = String(msg.text ?? '').slice(0, 200);
        phone.draft = { conv: String(msg.conv), text, at: now };
        phone.activeUntil = now + PHONE.activeTime * 1000;
        if (text.length > p.stats.longestDraft.length) p.stats.longestDraft = text;
        break;
      }
      case 'touch':
        phone.activeUntil = now + PHONE.activeTime * 1000;
        break;
      case 'out':
        phone.out = !!msg.on;
        break;
      default:
        break;
    }
  }

  /** The upgrade screen waiting on the player's phone, if any. */
  upgradeOffer(p: ServerPlayer): UpgradeOffer | null {
    const c = p.ladder.choice;
    if (!c) return null;
    return {
      title: FI.ladder.upgradeTitle,
      options: c.options.map((id) => {
        const lv = (p.ladder.upgrades[id] ?? 0) + 1;
        return { id, name: UPGRADES[id].name, level: lv, benefit: UPGRADES[id].benefit(lv) };
      }),
    };
  }

  sendUpgradeChoice(p: ServerPlayer): void {
    p.phone.send({ t: 'upgrade', offer: this.upgradeOffer(p) });
  }

  /** An upgrade was taken: new limits now, a fresh bigger magazine, and everyone is told. */
  applyUpgrades(p: ServerPlayer, id: UpgradeId): void {
    p.maxGrenades = maxGrenades(p.ladder.upgrades);
    if (id === 'lipas' || id === 'rumpu') {
      p.ammo.rifle = p.gun('rifle').magazine;
      p.outbox.push({ k: 'ammo', w: 'rifle', n: p.ammo.rifle, seq: p.lastFireSeq });
    }
    p.outbox.push({ k: 'upgrades', u: { ...p.ladder.upgrades }, id });
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
    p.phone.send({ t: 'upgrade', offer: null });
    this.broadcastPlayers();
  }

  /** Candidate for the public typo feed; the tick picks one line per interval. */
  offerTypo(p: ServerPlayer, to: string, text: string, reply: string): void {
    p.stats.typos++;
    this.typos.push({ p: p.id, to, text, reply, at: this.now() });
    if (this.typos.length > 32) this.typos.shift();
  }

  private flushTypos(now: number): void {
    if (now - this.lastTypoAt < PHONE.typoInterval * 1000) return;
    this.typos = this.typos.filter((t) => now - t.at < 3000);
    if (this.typos.length === 0) return;
    // Longer messages are funnier: they win the slot.
    const best = this.typos.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    this.typos = [];
    this.lastTypoAt = now;
    this.emit({ k: 'typo', p: best.p, to: best.to, text: best.text.slice(0, 120), reply: best.reply });
  }

  /** Socket closed or player left: the player stays (for a rejoin) but is shown as disconnected. */
  disconnect(p: ServerPlayer): void {
    if (!p.connected) return;
    if (p.ws) p.ws = null;
    p.connected = false;
    p.leftAt = this.now();
    // Out of the world until they come back: no ghost targets for bots, spawns or grenades.
    p.alive = false;
    p.flags &= ~PF.ALIVE;
    p.reload = null;
    this.emit({ k: 'leave', p: p.id, name: p.name });
    this.broadcastPlayers();
  }

  /** Players taking part: bots and connected humans (not those who left). */
  activeCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.bot || p.connected) n++;
    return n;
  }

  humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot && p.connected) n++;
    return n;
  }

  addBot(): ServerPlayer | null {
    if (this.activeCount() >= 16) return null;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(`${n}`)) ?? `Botti${this.bots.length + 1}`;
    const p = new ServerPlayer(this.freeId(), randomUUID(), name, this.freeColor(), true);
    p.newSerials();
    this.players.set(p.id, p);
    const bot = new Bot(p, this);
    this.bots.push(bot);
    this.respawn(p);
    this.updateGate();
    this.emit({ k: 'join', p: p.id, name: p.name });
    this.broadcastPlayers();
    return p;
  }

  removeBot(): void {
    const bot = this.bots.pop();
    if (!bot) return;
    this.players.delete(bot.p.id);
    this.emit({ k: 'leave', p: bot.p.id, name: bot.p.name });
    this.broadcastPlayers();
  }

  playerList() {
    return [...this.players.values()].map((p) => p.info());
  }

  broadcastPlayers(): void {
    const msg = { t: 'players', players: this.playerList() };
    for (const p of this.players.values()) p.send(msg);
  }

  // ---- gate and spawning ----

  private setGate(open: boolean): void {
    this.round.gateOpen = open;
    for (const i of this.map.gateBrushes ?? []) {
      const b = this.world.brushes[i];
      if (b) b.flags = open ? 0 : MASK.MOVE | MASK.GRENADE;
    }
  }

  /** The gate opens as soon as there are enough players; it only closes between rounds. */
  private updateGate(): void {
    if (!this.round.gateOpen && this.activeCount() > GATE_PLAYERS) {
      this.setGate(true);
      this.emit({ k: 'round', round: this.round });
    }
  }

  chooseSpawn(p: ServerPlayer): SpawnPoint {
    const spawns = this.map.spawns.filter((s) => this.round.gateOpen || !s.outer);
    const enemies = [...this.players.values()].filter((e) => e !== p && e.alive);
    let best = spawns[0]!;
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minDist = 60;
      let seen = false;
      for (const e of enemies) {
        const d = Math.hypot(e.x - s.x, e.z - s.z);
        minDist = Math.min(minDist, d);
        if (d < 70) {
          this.world.trace(this.tr, e.x, e.eyeY(), e.z, s.x, s.y + 1.6, s.z, 0, 0, 0, MASK.SHOT);
          if (this.tr.fraction >= 0.999) seen = true;
        }
      }
      const score = (seen ? -1000 : 0) + minDist + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  respawn(p: ServerPlayer): void {
    const s = this.chooseSpawn(p);
    p.x = s.x;
    p.y = s.y + 0.02;
    p.z = s.z;
    p.vx = p.vy = p.vz = 0;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.flags = PF.ALIVE;
    p.alive = true;
    p.life++;
    p.resetLife();
    p.weapon = p.owned.includes('rifle') ? 'rifle' : 'pistol';
    p.protectedUntil = this.now() + TUNING.player.spawnProtect * 1000;
    p.history.clear();
    p.stateTime = this.now();
    p.history.push(p.stateTime, p.x, p.y, p.z, false, true);
    this.emit({ k: 'spawn', p: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ammo: { ...p.ammo }, weapons: [...p.owned] });
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
  }

  private sendSpawnState(p: ServerPlayer): void {
    p.outbox.push({ k: 'spawn', p: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ammo: { ...p.ammo }, weapons: [...p.owned] });
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
    p.outbox.push({ k: 'serials', pistol: p.serials.pistol, rifle: p.serials.rifle });
  }

  // ---- messages ----

  onBinary(p: ServerPlayer, data: ArrayBuffer): void {
    const kind = new DataView(data).getUint8(0);
    if (kind !== BIN.STATE) return;
    const s = decodeState(data);
    if (!s || !p.alive) return;
    const now = this.now();
    // Sanity check only (no anti-cheat): flag impossible jumps in the log.
    const dt = Math.max(0.001, (now - p.lastStateAt) / 1000);
    const moved = Math.hypot(s.x - p.x, s.z - p.z);
    if (p.lastStateAt > 0 && moved > 20 * dt + 3) console.warn(`[sanity] ${p.name} moved ${moved.toFixed(1)} m in ${(dt * 1000).toFixed(0)} ms`);
    p.lastStateAt = now;
    // Positions are placed on the sender's timeline (clock-synced send time), so remote
    // players interpolate smoothly and rewinds match what the shooter saw.
    const t = Math.max(p.stateTime + 0.5, Math.min(now, Math.max(now - 300, s.time)));
    p.stateTime = t;
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.vx = s.vx;
    p.vy = s.vy;
    p.vz = s.vz;
    p.yaw = s.yaw;
    p.pitch = s.pitch;
    p.flags = (s.flags & ~(PF.ALIVE | PF.PROTECTED | PF.BOT)) | PF.ALIVE;
    const w = WEAPON_IDS[s.weapon];
    if (w && p.owned.includes(w) && w !== p.weapon) this.switchWeapon(p, w);
    p.history.push(t, p.x, p.y, p.z, p.crouched, true);
  }

  onMessage(p: ServerPlayer, msg: ClientMsg): void {
    switch (msg.t) {
      case 'ping':
        p.send({ t: 'pong', id: msg.id, st: this.now() });
        break;
      case 'fire':
        this.fire(p, msg.w, msg.o, msg.d, msg.rt, msg.hit, msg.seq);
        break;
      case 'leave':
        this.disconnect(p);
        break;
      case 'reload':
        if (this.directReload) this.startReload(p);
        break;
      case 'switch':
        if (p.owned.includes(msg.w)) this.switchWeapon(p, msg.w);
        break;
      case 'grenade':
        this.throwGrenade(p, msg.o, msg.v);
        break;
      case 'dev':
        if (this.opts.dev || p.isHost) this.dev(p, msg.cmd, msg.arg);
        break;
      default:
        break;
    }
  }

  private dev(p: ServerPlayer, cmd: string, arg: unknown): void {
    switch (cmd) {
      case 'addBot':
        this.addBot();
        break;
      case 'removeBot':
        this.removeBot();
        break;
      case 'offer':
        p.ladder.started = true;
        this.ladder.offer(p, 'kill');
        break;
      case 'advance':
        this.ladder.advance(p);
        break;
      case 'killMe':
        if (p.alive) this.kill(p, p, 'grenade', false);
        break;
      case 'fillBots':
        while (this.activeCount() < 16 && this.addBot());
        break;
      case 'restartRound':
        this.startRound();
        break;
      case 'killSpeed':
        if (arg === 'cod' || arg === 'scramble') this.killSpeed = arg;
        break;
      case 'giveRifle':
        for (const q of arg === 'all' ? [...this.players.values()] : [p]) this.giveWeapon(q, 'rifle');
        break;
      case 'giveGrenade':
        this.giveGrenade(p);
        break;
      case 'directReload':
        this.directReload = Boolean(arg);
        break;
      case 'gate':
        this.setGate(Boolean(arg));
        this.emit({ k: 'round', round: this.round });
        break;
      case 'reload':
        this.startReload(p);
        break;
      default:
        break;
    }
  }

  giveWeapon(p: ServerPlayer, w: WeaponId): void {
    if (!p.owned.includes(w)) p.owned.push(w);
    p.ammo[w] = p.gun(w).magazine;
    p.outbox.push({ k: 'give', w });
    p.outbox.push({ k: 'ammo', w, n: p.ammo[w], seq: p.lastFireSeq });
    if (p.bot) p.weapon = w;
  }

  giveGrenade(p: ServerPlayer): boolean {
    if (!p.alive || p.grenades >= p.maxGrenades) return false;
    p.grenades++;
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
    return true;
  }

  switchWeapon(p: ServerPlayer, w: WeaponId): void {
    if (p.weapon === w) return;
    p.weapon = w;
    // Switching away cancels a reload in progress.
    if (p.reload && !p.reload.refilled) p.reload = null;
  }

  /** Reload of the weapon in hand ("Lataa"). Returns a reason when refused. */
  startReload(p: ServerPlayer): 'ok' | 'dead' | 'full' | 'busy' {
    if (!p.alive) return 'dead';
    const w = p.weapon;
    if (p.reload && this.now() < p.reload.end) return 'busy';
    if (p.ammo[w] >= p.gun(w).magazine) return 'full';
    const T = TUNING[w];
    const empty = p.ammo[w] === 0;
    const dur = (empty ? T.reloadEmptyTime : T.reloadTime) * 1000;
    const now = this.now();
    p.reload = { w, start: now, refillAt: now + dur * T.reloadRefill, end: now + dur, refilled: false };
    p.outbox.push({ k: 'reload', w, empty, dur: dur / 1000 });
    return 'ok';
  }

  // ---- combat ----

  /** Validates a shot, applies damage and tells everyone what happened. */
  fire(p: ServerPlayer, w: WeaponId, o: [number, number, number], d: [number, number, number], rt: number, claim?: { p: number; z: HitZone; at: [number, number, number] }, seq?: number): void {
    if (seq !== undefined) p.lastFireSeq = seq;
    if (!p.alive || !p.owned.includes(w)) return;
    const now = this.now();
    const T = TUNING[w];
    const interval = (60 / p.gun(w).rpm) * 1000;
    const reloading = p.reload && p.reload.w === w && now < p.reload.refillAt;
    if (now - p.lastShotAt[w] < interval * 0.7 || p.ammo[w] <= 0 || reloading) {
      p.outbox.push({ k: 'ammo', w, n: p.ammo[w], seq: p.lastFireSeq });
      return;
    }
    p.ammo[w]--;
    p.lastShotAt[w] = now;
    p.protectedUntil = 0;
    // Shots start at the eye: trust the client's origin if it is near where we have them.
    let [ox, oy, oz] = o;
    if (Math.hypot(ox - p.x, oy - p.eyeY(), oz - p.z) > 1.5) {
      ox = p.x;
      oy = p.eyeY();
      oz = p.z;
    }
    let [dx, dy, dz] = d;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    const range = T.range;
    this.world.trace(this.tr, ox, oy, oz, ox + dx * range, oy + dy * range, oz + dz * range, 0, 0, 0, MASK.SHOT);
    const wallDist = this.tr.fraction * range;
    const wall = this.tr.fraction < 1 ? { x: this.tr.x, y: this.tr.y, z: this.tr.z, nx: this.tr.nx, ny: this.tr.ny, nz: this.tr.nz, s: this.tr.surface } : null;
    let victim: ServerPlayer | null = null;
    let zone: HitZone = 'body';
    let dist = wallDist;
    if (claim) {
      const target = this.players.get(claim.p);
      if (target && target !== p && target.alive && now >= target.protectedUntil) {
        const t = Math.max(now - NET.maxRewind * 1000, Math.min(now, rt));
        const h = target.history.at(t);
        if (h && h.alive) {
          // Shooter-favoured: the rewound hitbox (with some tolerance) must be on the ray in
          // front of any wall; a claimed headshot must also touch the rewound head.
          const hit = rayPlayer(ox, oy, oz, dx, dy, dz, h.x, h.y, h.z, h.crouched, wallDist, 0.08);
          if (hit) {
            victim = target;
            dist = hit.t;
            zone = claim.z === 'head' && (hit.zone === 'head' || this.headConfirmed(ox, oy, oz, dx, dy, dz, h, wallDist)) ? 'head' : 'body';
          }
        }
      }
    }
    const end: [number, number, number] = victim ? [ox + dx * dist, oy + dy * dist, oz + dz * dist] : wall ? [wall.x, wall.y, wall.z] : [ox + dx * range, oy + dy * range, oz + dz * range];
    const ev: GameEvent = { k: 'shot', p: p.id, w, o: [ox, oy, oz], e: end };
    if (victim) ev.hp = victim.id;
    else if (wall) {
      ev.n = [wall.nx, wall.ny, wall.nz];
      ev.s = wall.s;
    }
    this.emit(ev);
    if (victim) this.damage(victim, p, damageFor(w, zone, dist, this.killSpeed), zone, w, [ox, oy, oz]);
  }

  private headConfirmed(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, h: { x: number; y: number; z: number; crouched: boolean }, maxT: number): boolean {
    const headY = h.y + (h.crouched ? TUNING.move.crouchEye : TUNING.move.standEye) + 0.02;
    const lx = h.x - ox;
    const ly = headY - oy;
    const lz = h.z - oz;
    const t = lx * dx + ly * dy + lz * dz;
    if (t < 0 || t > maxT) return false;
    const d2 = lx * lx + ly * ly + lz * lz - t * t;
    return d2 <= 0.27 * 0.27;
  }

  damage(v: ServerPlayer, a: ServerPlayer | null, amount: number, zone: HitZone, w: WeaponId | 'grenade', from: [number, number, number]): void {
    if (!v.alive || amount <= 0) return;
    const now = this.now();
    if (now < v.protectedUntil) return;
    v.hp = Math.max(0, v.hp - amount);
    v.lastDamageAt = now;
    if (v.bot && a) this.bots.find((b) => b.p === v)?.hurtBy(a.id);
    const hit: GameEvent = { k: 'hit', a: a?.id ?? 0, v: v.id, dmg: amount, hp: v.hp, z: zone, from };
    v.outbox.push(hit);
    if (a && a !== v) a.outbox.push(hit);
    if (v.hp <= 0) this.kill(v, a, w, zone === 'head');
  }

  kill(v: ServerPlayer, a: ServerPlayer | null, w: WeaponId | 'grenade', head: boolean): void {
    v.alive = false;
    v.flags &= ~PF.ALIVE;
    v.deaths++;
    v.reload = null;
    v.grenades = 0;
    if (a && a !== v) {
      a.kills++;
      // The TJ ladder counts kills and deaths at someone else's hand.
      this.ladder.onKill(a);
      this.ladder.onDeath(v);
    }
    const now = this.now();
    v.respawnAt = now + TUNING.player.respawnTime * 1000;
    // Killed mid-message: the unfinished draft goes into the kill feed.
    const d = v.phone.draft;
    const typing = d && d.text.trim() && (v.phone.out || now - d.at < PHONE.draftRecent * 1000) ? d.text.trim().slice(0, 60) : undefined;
    if (typing) v.stats.deathsTyping++;
    const ev: GameEvent = { k: 'kill', a: a?.id ?? 0, v: v.id, w, head };
    if (typing) ev.draft = typing;
    this.emit(ev);
    this.broadcastPlayers();
  }

  throwGrenade(p: ServerPlayer, o: [number, number, number], v: [number, number, number]): void {
    if (!p.alive || p.grenades <= 0) return;
    p.grenades--;
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
    // Start inside the thrower's reach and never inside a wall.
    let [ox, oy, oz] = o;
    if (Math.hypot(ox - p.x, oy - p.eyeY(), oz - p.z) > 1.5) {
      ox = p.x;
      oy = p.eyeY();
      oz = p.z;
    }
    const r = GRENADE_RADIUS;
    this.world.trace(this.tr, p.x, p.eyeY(), p.z, ox, oy, oz, r, r, r, MASK.GRENADE);
    const vl = Math.hypot(...v);
    const s = vl > 40 ? 40 / vl : 1;
    const g = { id: this.nextGrenadeId++, owner: p.id, x: this.tr.x, y: this.tr.y, z: this.tr.z, vx: v[0] * s, vy: v[1] * s, vz: v[2] * s, fuse: TUNING.grenade.fuse, resting: false };
    this.grenades.push(g);
    this.emit({ k: 'nade', id: g.id, p: p.id, o: [g.x, g.y, g.z], v: [g.vx, g.vy, g.vz], fuse: g.fuse });
  }

  private explode(g: Grenade & { owner: number }): void {
    this.emit({ k: 'boom', id: g.id, x: g.x, y: g.y, z: g.z });
    const owner = this.players.get(g.owner) ?? null;
    for (const v of this.players.values()) {
      if (!v.alive) continue;
      const cy = v.y + 1.0;
      const dist = Math.hypot(v.x - g.x, cy - g.y, v.z - g.z);
      const dmg = explosionDamage(dist);
      if (dmg <= 0 || !blastReaches(this.world, g.x, g.y, g.z, v.x, cy, v.z)) continue;
      this.damage(v, owner, dmg, 'body', 'grenade', [g.x, g.y, g.z]);
    }
  }

  // ---- rounds ----

  startRound(): void {
    // Players who left more than a minute ago are dropped from the new round.
    for (const p of [...this.players.values()]) {
      if (!p.bot && !p.connected && this.now() - p.leftAt > 60_000) this.players.delete(p.id);
    }
    this.round = { n: this.round.n + 1, state: 'playing', endsAt: this.now() + ROUND_TIME, gateOpen: this.activeCount() > GATE_PLAYERS };
    this.ladder.resetRound();
    this.setGate(this.round.gateOpen);
    this.grenades = [];
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.owned = ['pistol'];
      p.maxGrenades = 1;
      p.ladder.reset();
      p.rank = 0;
      this.ladder.notify(p);
      p.outbox.push({ k: 'upgrades', u: {} });
      p.phone.resetRound();
      if (p.phone.paired) {
        p.phone.add(FI_NUMBER, { id: p.phone.newId(), from: 'system', text: `#round ${this.round.n}`, at: Date.now() });
        this.varusmestari.greet(p);
      }
      p.newSerials();
      p.outbox.push({ k: 'serials', pistol: p.serials.pistol, rifle: p.serials.rifle });
      if (p.connected || p.bot) this.respawn(p);
    }
    this.emit({ k: 'round', round: this.round });
    this.broadcastPlayers();
  }

  // ---- tick ----

  tick(dt: number): void {
    const t0 = performance.now();
    const now = this.now();
    this.tickCount++;
    if (this.round.state === 'playing' && now >= this.round.endsAt) {
      this.round = { ...this.round, state: 'ended', endsAt: now + INTERMISSION };
      this.emit({ k: 'round', round: this.round });
    } else if (this.round.state === 'ended' && now >= this.round.endsAt) {
      this.startRound();
    }

    for (const bot of this.bots) bot.update(dt, now);
    for (const p of this.players.values()) p.phone.tick(now);
    if (this.tickCount % 3 === 0) {
      for (const p of this.players.values()) if (p.phone.online) p.phone.sendStatus(p.phoneStatus(this.round.n));
    }
    this.flushTypos(now);

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.round.state === 'playing' && now >= p.respawnAt && (p.connected || p.bot)) this.respawn(p);
        continue;
      }
      if (p.phone.out) p.stats.phoneMs += dt * 1000;
      // Health regeneration after a quiet spell.
      if (p.hp < TUNING.player.health && now - p.lastDamageAt > TUNING.player.regenDelay * 1000) {
        p.hp = Math.min(TUNING.player.health, p.hp + TUNING.player.regenRate * dt);
      }
      const r = p.reload;
      if (r) {
        if (!r.refilled && now >= r.refillAt) {
          r.refilled = true;
          p.ammo[r.w] = p.gun(r.w).magazine;
          p.outbox.push({ k: 'ammo', w: r.w, n: p.ammo[r.w], seq: p.lastFireSeq });
        }
        if (now >= r.end) p.reload = null;
      }
      if (p.bot) {
        p.stateTime = now;
        p.history.push(now, p.x, p.y, p.z, p.crouched, true);
      }
    }

    for (const g of this.grenades) stepGrenade(g, this.world, dt);
    const exploding = this.grenades.filter((g) => g.fuse <= 0);
    if (exploding.length) {
      this.grenades = this.grenades.filter((g) => g.fuse > 0);
      for (const g of exploding) this.explode(g);
    }

    const snapEvery = Math.max(1, Math.round(NET.tickHz / NET.snapshotHz));
    if (this.tickCount % snapEvery === 0) this.sendSnapshot(now);
    // Pings and connection states for the scoreboard.
    if (this.tickCount % (NET.tickHz * 2) === 0) this.broadcastPlayers();
    this.flushEvents(now);
    this.tickMs = performance.now() - t0;
  }

  private snapFlags(p: ServerPlayer, now: number): number {
    let f = p.flags & ~(PF.ALIVE | PF.PROTECTED | PF.RELOAD | PF.BOT);
    if (p.alive) f |= PF.ALIVE;
    if (now < p.protectedUntil) f |= PF.PROTECTED;
    if (p.reload && now < p.reload.end) f |= PF.RELOAD;
    if (p.bot) f |= PF.BOT;
    if (p.alive && p.phone.out && (p.phone.online || p.bot)) f |= PF.PHONE;
    return f;
  }

  sendSnapshot(now: number): void {
    const players: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      if (!p.connected && !p.bot) continue;
      players.push({
        id: p.id,
        flags: this.snapFlags(p, now),
        age: Math.max(0, now - p.stateTime),
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        weapon: WEAPON_IDS.indexOf(p.weapon),
        hp: p.hp,
      });
    }
    const buf = encodeSnapshot({ time: now, players });
    for (const p of this.players.values()) p.sendBinary(buf);
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  private flushEvents(now: number): void {
    const shared = this.events;
    this.events = [];
    for (const p of this.players.values()) {
      if (shared.length === 0 && p.outbox.length === 0) continue;
      const e = p.outbox.length ? [...shared, ...p.outbox] : shared;
      p.outbox = [];
      if (p.ws) p.send({ t: 'events', e, st: now });
    }
  }
}
