import type { Socket } from '../socket';
import { MASK } from '../../shared/collision/brush';
import { CollisionWorld, TraceResult } from '../../shared/collision/world';
import { GEAR, INVENTORY, MATCH, NET, PHONE, SERVICE, TUNING, type KillSpeedPreset, type WeaponId } from '../../shared/config';
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
  cleanSettings,
  defaultSettings,
  decodeState,
  encodeSnapshot,
  type ClientMsg,
  type GameEvent,
  type KillWeapon,
  type MatchSettings,
  type PhoneClientMsg,
  type PlayerSnap,
  type RoundInfo,
} from '../../shared/protocol';
import { meleeReaches } from '../../shared/melee';
import { damageFor } from '../../shared/weapons';
import { Bot } from './bot';
import { ServerPlayer, type InventoryKind } from './player';
import { Varusmestari } from './varusmestari';
import { ServiceDesk } from './service';
import { VoiceNotes } from '../voicenotes';
import { Evening, matchAwards } from './awards';
import { level, maxGrenades } from '../../shared/upgrades';
import { FI } from '../../shared/fi';
import { plain } from '../../shared/markup';

/** A coordinate rounded to the millimetre, for events that only draw something. */
const mm = (v: number): number => Math.round(v * 1000) / 1000;

const FI_NUMBER = FI.varusmestari.number;

function randomBetween([a, b]: readonly [number, number]): number {
  return a + Math.random() * (b - a);
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

/** A round and the break after it with the default settings (the host can change the round). */
export const ROUND_TIME = MATCH.roundMinutes * 60_000;
export const INTERMISSION = MATCH.intermission * 1000;
/** More players than this open the outer-ring gate. */
export const GATE_PLAYERS = 8;
const BOT_NAMES = ['Virtanen', 'Korhonen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Lehtinen', 'Saarinen', 'Salminen', 'Heinonen'];

export interface RoomOptions {
  dev: boolean;
  now?: () => number;
  /**
   * Address phones use to reach the server, e.g. http://192.168.1.23:8088/ (never localhost). The
   * server changes it to its HTTPS name once that works.
   */
  publicUrl?: string;
  /** Spliced phonetic-alphabet voice notes (tests run without). */
  voiceNotes?: VoiceNotes;
  /** The evening: match winners, the match under way and the settings (saved to a file by the server). */
  evening?: Evening;
  /** Bots to start with, unless the evening's settings say otherwise. */
  bots?: number;
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
  /** Bot paths with the gates shut, and with them open (the outer ring joined on). */
  private navShut: NavNode[];
  private navOpen: NavNode[];
  readonly players = new Map<number, ServerPlayer>();
  readonly bots: Bot[] = [];
  round: RoundInfo;
  /** The host's settings for matches. */
  settings: MatchSettings;
  killSpeed: KillSpeedPreset;
  /** Dev: R reloads directly instead of messaging the varusmestari. */
  directReload: boolean;
  tickMs = 0;
  readonly varusmestari = new Varusmestari(this);
  readonly service = new ServiceDesk(this);
  readonly voiceNotes: VoiceNotes;
  readonly evening: Evening;
  private typos: TypoCandidate[] = [];
  private lastTypoAt = -1e9;
  private events: GameEvent[] = [];
  /** The last full roster sent, without the pings (see broadcastPlayers). */
  private rosterKey = '';
  private grenades: (Grenade & { owner: number })[] = [];
  private nextGrenadeId = 1;
  private tr = new TraceResult();
  private tickCount = 0;
  private savedAt = 0;
  /** Mortar rounds on their way: where, whose, and when they land (server ms). */
  private mortars: { x: number; y: number; z: number; owner: number; at: number }[] = [];
  readonly now: () => number;

  constructor(
    readonly map: MapData,
    readonly opts: RoomOptions,
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.directReload = opts.dev;
    this.voiceNotes = opts.voiceNotes ?? new VoiceNotes(null);
    this.evening = opts.evening ?? new Evening(null);
    this.world = new CollisionWorld(map.brushes);
    this.settings = cleanSettings(this.evening.settings, defaultSettings(opts.bots ?? 0));
    this.killSpeed = this.settings.killSpeed;
    this.round = { n: 1, match: 1, round: 1, of: this.settings.rounds, state: 'playing', matchOver: false, endsAt: this.now() + this.roundMs, gateOpen: false };
    this.setGate(true);
    this.navOpen = buildNavGraph(this.world, map.nav ?? []);
    this.setGate(false);
    this.navShut = buildNavGraph(this.world, map.nav ?? []);
    this.fitBots();
  }

  /** How long a round is with the host's settings (ms). */
  get roundMs(): number {
    return this.settings.roundMinutes * 60_000;
  }

  /**
   * The host changed the match settings: kill speed, days per kill, bots and team mode apply now
   * (switching to pairs draws them at once), the round length from the next round, and a match
   * with fewer rounds ends after the current one.
   */
  setSettings(raw: Partial<MatchSettings>): void {
    const teams = this.settings.teams;
    this.settings = cleanSettings(raw, this.settings);
    this.killSpeed = this.settings.killSpeed;
    this.round = { ...this.round, of: this.settings.rounds };
    this.fitBots();
    if (this.settings.teams !== teams) this.fitTeams(true);
    this.evening.settings = this.settings;
    this.broadcast({ t: 'settings', s: this.settings });
    this.emit({ k: 'round', round: this.round });
    this.broadcastPlayers();
  }

  /** On the same team (team mode): no friendly fire, and each other's partner on the map. */
  mates(a: ServerPlayer, b: ServerPlayer): boolean {
    return a !== b && a.team >= 0 && a.team === b.team;
  }

  /** In the draw for the pairs: bots, and people not on the range (a dropped connection keeps its place until it is dropped). */
  private inMatch(p: ServerPlayer): boolean {
    return p.bot || !p.training;
  }

  /**
   * Team mode: everyone in the match in a pair, drawn at random (`redraw`: all over again, as for
   * a new match). Whoever is new or has lost their partner goes into the draw, and pairs keep
   * their colour; with an odd number the host plays alone. In free-for-all nobody has a team.
   */
  private fitTeams(redraw = false): void {
    const all = [...this.players.values()];
    const members = this.settings.teams ? all.filter((p) => this.inMatch(p)) : [];
    for (const p of all) if (redraw || !members.includes(p)) p.team = -1;
    if (!members.length) return;
    const size = new Map<number, number>();
    for (const p of members) if (p.team >= 0) size.set(p.team, (size.get(p.team) ?? 0) + 1);
    const pool = members.filter((p) => size.get(p.team) !== 2);
    // The host: someone at the server machine, connected (several only while testing on it).
    const host = members.filter((p) => p.isHost && !p.bot).sort((a, b) => Number(b.connected) - Number(a.connected) || a.id - b.id)[0];
    const alone = members.length % 2 === 1 ? host : undefined;
    if (alone && size.get(alone.team) === 2) {
      // Out of their pair: the partner goes into the draw.
      for (const p of members) if (p.team === alone.team && p !== alone) pool.push(p);
      alone.team = -1;
    }
    const draw = shuffle(pool.filter((p) => p !== alone));
    const taken = new Set(members.filter((p) => !draw.includes(p) && p.team >= 0).map((p) => p.team));
    const free = () => {
      let t = 0;
      while (taken.has(t)) t++;
      return t;
    };
    // Someone already in a team goes first, so their colour stays when they get a partner.
    draw.sort((a, b) => Number(b.team >= 0) - Number(a.team >= 0));
    for (let i = 0; i < draw.length; i += 2) {
      const pair = draw.slice(i, i + 2);
      const t = pair.map((p) => p.team).find((x) => x >= 0 && !taken.has(x)) ?? free();
      taken.add(t);
      for (const p of pair) p.team = t;
    }
    if (alone && alone.team < 0) alone.team = free();
  }

  /** As many bots as the settings ask for, as long as there is room (people come first). */
  private fitBots(): void {
    while (this.bots.length > this.settings.bots) this.removeBot();
    while (this.bots.length < this.settings.bots && this.activeCount() < MATCH.maxPlayers && this.addBot());
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
  join(ws: Socket, msg: Extract<ClientMsg, { t: 'hello' }>, isHost = false): ServerPlayer | null {
    if (msg.v !== PROTOCOL_VERSION) return null;
    let p = msg.token ? [...this.players.values()].find((x) => x.token === msg.token && !x.bot) : undefined;
    const name = cleanName(msg.name) || 'Alokas';
    if (p) {
      p.ws = ws;
      p.connected = true;
      p.name = name;
      p.isHost = isHost;
      if (msg.train) {
        p.training = true;
        p.alive = false;
        p.reload = null;
      } else p.training = false;
      this.settleInventory(p);
      this.fitTeams();
      if (!p.alive && !p.training && this.round.state === 'playing') this.respawn(p);
      this.emit({ k: 'join', p: p.id, name: p.name });
    } else {
      if (this.humanCount() + this.bots.length >= 16 && this.bots.length > 0) this.removeBot();
      p = new ServerPlayer(this.freeId(), crypto.randomUUID(), name, this.freeColor(), false);
      p.ws = ws;
      p.isHost = isHost;
      p.newSerials();
      p.phone.pairCode = this.freePairCode();
      p.training = !!msg.train;
      // Back tonight under the same name: the service goes on where it was.
      const kept = this.evening.service(name);
      if (kept) {
        p.service.restore(kept);
        this.service.resume(p);
      }
      this.equip(p);
      this.settleInventory(p);
      this.chirps(p);
      this.players.set(p.id, p);
      this.fitTeams();
      if (!p.training) this.respawn(p);
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
      settings: this.settings,
      serverTime: this.now(),
      snapshotHz: NET.snapshotHz,
      dev: this.opts.dev,
      host: this.opts.dev || p.isHost,
      training: p.training,
    });
    this.broadcastPlayers();
    this.sendSpawnState(p);
    this.sendPairInfo(p);
    p.send({ t: 'evening', matches: this.evening.matches() });
    this.service.notify(p);
    p.outbox.push({ k: 'upgrades', u: { ...p.service.upgrades } });
    p.phone.sendStatus(p.phoneStatus(this.round.n));
    return p;
  }

  /** Weapons, grenade belt and rank from the player's service (after a restore or a reset). */
  equip(p: ServerPlayer): void {
    const s = p.service;
    p.owned = ['pistol'];
    if (s.owned.has('rifle')) p.owned.push('rifle');
    if (s.owned.has('tkiv')) p.owned.push('sniper');
    p.maxGrenades = maxGrenades(s.upgrades);
    p.rank = s.rank;
  }

  /** A message landing on someone's phone chirps where they stand (alive only). */
  private chirps(p: ServerPlayer): void {
    p.phone.onUnread = () => {
      if (!p.bot) p.outbox.push({ k: 'unread', from: p.phone.unreadFrom() });
    };
    const owner = p;
    p.phone.onIncoming = () => {
      if (owner.alive) this.emit({ k: 'chirp', p: owner.id });
    };
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
    p.send({ t: 'pairInfo', url: base ? `${base}phone#${p.phone.pairToken}` : '', token: p.phone.pairToken, code: p.phone.pairCode, phone: p.phone.status(), virtual: p.phone.virtual });
  }

  // ---- phones ----

  /** A phone connects: pairing by QR token or short code, or resuming with its own token. */
  phoneJoin(ws: Socket, msg: Extract<PhoneClientMsg, { t: 'phoneHello' }>, isHost: boolean): ServerPlayer | null {
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
      phone.token = crypto.randomUUID();
      if (first && p.radioCheck !== 'armed') this.varusmestari.greet(p);
    } else if (phone.ws && phone.ws !== ws) {
      phone.ws.close(4002, 'resumed elsewhere');
    }
    phone.ws = ws;
    phone.sim = !!msg.sim;
    phone.virtual = !!msg.virtual;
    ws.send(
      JSON.stringify({
        t: 'phoneWelcome',
        token: phone.token,
        player: { id: p.id, name: p.name, color: p.color },
        convs: [...phone.convs.values()],
        status: p.phoneStatus(this.round.n),
        dev: this.opts.dev,
        replaced,
        store: this.service.storeState(p),
      }),
    );
    phone.sendStatus(p.phoneStatus(this.round.n), true);
    if (p.radioCheck === 'armed') this.varusmestari.radioCheck(p);
    if (pairing) p.outbox.push({ k: 'paired', replaced });
    this.sendPairInfo(p);
    this.broadcastPlayers();
    return p;
  }

  phoneDisconnect(p: ServerPlayer, ws: Socket): void {
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
        // No phone for the dead (on the range everyone may use theirs).
        if (!p.alive && !p.training) this.varusmestari.bounceDead(p, msg);
        else this.varusmestari.receive(p, msg);
        break;
      case 'open': {
        const id = String(msg.conv).replace(/[^\d+]/g, '').slice(0, 24);
        if (id && !this.service.opened(p, id) && !phone.convs.has(id)) phone.conv(id, id);
        break;
      }
      case 'buy': {
        if (typeof msg.rid !== 'string' || phone.rids.has(msg.rid)) break;
        phone.rids.add(msg.rid);
        // A refused buy (dead, no money, already had) just sends the shop as it is.
        if ((!p.alive && !p.training) || !this.service.buy(p, String(msg.id))) this.service.notify(p);
        break;
      }
      case 'read': {
        const c = phone.convs.get(msg.conv);
        if (c && c.unread > 0) {
          c.unread = 0;
          phone.onUnread();
        }
        this.service.seen(p, String(msg.conv));
        this.varusmestari.flush(p, msg.conv);
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
        if (p.training) p.outbox.push({ k: 'phoneOut', on: phone.out });
        break;
      default:
        break;
    }
  }

  /** Gear was handed over: new limits now, a fresh bigger magazine, and everyone is told. */
  applyUpgrades(p: ServerPlayer, id: string): void {
    p.maxGrenades = maxGrenades(p.service.upgrades);
    const mags: Record<string, WeaponId> = { lipas: 'rifle', lipas2: 'rifle', rumpu: 'rifle', plipas: 'pistol' };
    const w = mags[id];
    if (w && p.owned.includes(w)) {
      p.ammo[w] = p.gun(w).magazine;
      p.reserve[w] = p.spare(w);
      this.sendAmmo(p, w);
    }
    p.outbox.push({ k: 'upgrades', u: { ...p.service.upgrades }, id });
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
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
    // The big screen draws the reply plain: no bold marks.
    this.emit({ k: 'typo', p: best.p, to: best.to, text: best.text.slice(0, 120), reply: plain(best.reply) });
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

  /** Players taking part: bots and connected humans in the match (not those who left or are on the range). */
  activeCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.bot || (p.connected && !p.training)) n++;
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
    const p = new ServerPlayer(this.freeId(), crypto.randomUUID(), name, this.freeColor(), true);
    p.newSerials();
    this.settleInventory(p);
    this.chirps(p);
    this.players.set(p.id, p);
    const bot = new Bot(p, this);
    this.bots.push(bot);
    this.fitTeams();
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
    this.fitTeams();
    this.emit({ k: 'leave', p: bot.p.id, name: bot.p.name });
    this.broadcastPlayers();
  }

  playerList() {
    return [...this.players.values()].map((p) => p.info());
  }

  /** Time's up: a break before the next round, or the match's results after its last one. */
  private endRound(now: number): void {
    const over = this.round.round >= this.settings.rounds;
    this.round = { ...this.round, state: 'ended', matchOver: over, endsAt: now + (over ? MATCH.matchIntermission : MATCH.intermission) * 1000 };
    this.emit({ k: 'round', round: this.round });
    if (over) this.endMatch();
  }

  /** The match is over: awards for the whole match, and its winner goes on the evening's list. */
  private endMatch(): void {
    const players = [...this.players.values()].filter((p) => !p.training);
    const list = matchAwards(players, this.settings.teams);
    this.emit({ k: 'awards', list });
    const winner = list.find((a) => a.id === 'winner');
    if (winner) {
      // A pair's win is a bot's only if both of them were bots.
      const w = this.players.get(winner.player);
      const side = w && w.team >= 0 ? players.filter((p) => p.team === w.team) : w ? [w] : [];
      this.evening.addMatch({ match: this.round.match, winner: winner.playerName, kills: Number(winner.value), bot: side.length > 0 && side.every((p) => p.bot) });
    }
    this.broadcast({ t: 'evening', matches: this.evening.matches() });
  }

  /** The same message to everyone, serialised once. */
  broadcast(msg: object): void {
    const json = JSON.stringify(msg);
    for (const p of this.players.values()) p.sendText(json);
  }

  /**
   * The roster to everyone. Pings change all the time and the rest seldom, so when only the
   * pings differ from the last full roster, just they go out.
   */
  broadcastPlayers(): void {
    const players = this.playerList();
    const key = JSON.stringify(players.map(({ ping: _, ...rest }) => rest));
    if (key === this.rosterKey) this.broadcast({ t: 'pings', p: players.map((p) => [p.id, p.ping]) });
    else this.broadcast({ t: 'players', players });
    this.rosterKey = key;
  }

  // ---- gate and spawning ----

  /** Bot paths as the gates stand now. */
  get nav(): NavNode[] {
    return this.round.gateOpen ? this.navOpen : this.navShut;
  }

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
    const others = [...this.players.values()].filter((e) => e !== p && e.alive);
    const enemies = others.filter((e) => !this.mates(p, e));
    const mate = others.find((e) => this.mates(p, e));
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
      // Team mode: somewhat nearer the partner, if they are up.
      const near = mate ? Math.max(0, 30 - Math.hypot(mate.x - s.x, mate.z - s.z)) * 0.6 : 0;
      const score = (seen ? -1000 : 0) + minDist + near + Math.random() * 6;
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
    this.emit({ k: 'spawn', p: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ammo: { ...p.ammo }, reserve: { ...p.reserve }, weapons: [...p.owned] });
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
  }

  private sendSpawnState(p: ServerPlayer): void {
    p.outbox.push({ k: 'spawn', p: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ammo: { ...p.ammo }, reserve: { ...p.reserve }, weapons: [...p.owned] });
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
    p.outbox.push({ k: 'serials', pistol: p.serials.pistol, rifle: p.serials.rifle, sniper: p.serials.sniper });
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
      case 'settings':
        if ((this.opts.dev || p.isHost) && msg.s && typeof msg.s === 'object') this.setSettings(msg.s);
        break;
      case 'deploy':
        this.deploy(p);
        break;
      case 'radioCheck':
        if (!p.training) break;
        if (p.radioCheck === 'done') p.outbox.push({ k: 'training', what: 'radioCheck' });
        else if (p.radioCheck !== 'waiting') {
          p.radioCheck = 'armed';
          if (p.phone.online) this.varusmestari.radioCheck(p);
        }
        break;
      case 'reload':
        this.startReload(p, this.directReload ? 'armoury' : 'spare');
        break;
      case 'switch':
        if (p.owned.includes(msg.w)) this.switchWeapon(p, msg.w);
        break;
      case 'pin':
        this.pinGrenade(p);
        break;
      case 'grenade':
        this.throwGrenade(p, msg.o, msg.v);
        break;
      case 'melee':
        this.melee(p, msg.o, msg.d, msg.rt, typeof msg.hit === 'number' ? msg.hit : undefined);
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
        this.setSettings({ bots: this.bots.length + 1 });
        break;
      case 'removeBot':
        this.setSettings({ bots: Math.max(0, this.bots.length - 1) });
        break;
      case 'serve':
        if (typeof arg === 'number') this.service.serve(p, arg, 'kill');
        else this.service.skipPkausi(p);
        break;
      case 'money':
        p.service.money += typeof arg === 'number' ? arg : 500;
        p.service.dirty = true;
        this.service.notify(p);
        break;
      case 'advance':
        this.service.advance(p);
        break;
      case 'inventory':
        if (p.inventory) p.inventory.expires = this.now();
        else p.inventoryAt = 0;
        break;
      case 'newEvening':
        this.evening.reset();
        this.round = { ...this.round, match: 0 };
        this.startRound(true);
        this.broadcast({ t: 'evening', matches: this.evening.matches() });
        break;
      case 'newMatch':
        this.startRound(true);
        break;
      case 'endRound':
        this.round = { ...this.round, endsAt: this.now() };
        break;
      case 'killMe':
        if (p.alive) this.kill(p, p, 'grenade', false);
        break;
      case 'fillBots':
        this.setSettings({ bots: MATCH.maxPlayers - 1 });
        break;
      case 'restartRound':
        this.startRound();
        break;
      case 'killSpeed':
        if (arg === 'cod' || arg === 'scramble') this.setSettings({ killSpeed: arg });
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
        this.startReload(p, 'armoury');
        break;
      default:
        break;
    }
  }

  giveWeapon(p: ServerPlayer, w: WeaponId): void {
    if (!p.owned.includes(w)) p.owned.push(w);
    p.ammo[w] = p.gun(w).magazine;
    p.reserve[w] = p.spare(w);
    p.outbox.push({ k: 'give', w });
    this.sendAmmo(p, w);
    if (p.bot) p.weapon = w;
  }

  /** The number an inventory check asks about, as it is right now. */
  inventoryValue(p: ServerPlayer, kind: InventoryKind): number {
    switch (kind) {
      case 'mag':
        return p.ammo[p.weapon];
      case 'spare':
        return p.reserve[p.weapon];
      case 'grenades':
        return p.grenades;
      case 'kills':
        return p.kills;
      case 'deaths':
        return p.deaths;
      case 'players':
        return this.activeCount();
    }
  }

  /** No inventory check before the player has had a minute in the match. */
  private settleInventory(p: ServerPlayer): void {
    p.inventoryAt = Math.max(p.inventoryAt, this.now() + INVENTORY.settle * 1000 + Math.random() * (INVENTORY.interval[1] - INVENTORY.interval[0]) * 500);
  }

  /** The vääpeli's surprise inventory checks: players in the match with a phone (or bots). */
  private inventoryChecks(now: number): void {
    if (this.round.state !== 'playing') return;
    for (const p of this.players.values()) {
      if (p.inventory) {
        if (now >= p.inventory.expires) this.varusmestari.inventoryTimeout(p);
        continue;
      }
      if (now < p.inventoryAt) continue;
      const reachable = p.bot || (p.phone.online && p.connected);
      // Not while something from the vääpeli is still unread (one new message per chat).
      if (!reachable || p.training || !p.alive || p.phone.locked || !p.phone.convs.has(FI_NUMBER) || p.phone.busy(FI.inventory.number)) {
        p.inventoryAt = now + INVENTORY.retry * 1000;
        continue;
      }
      if (p.service.cafe.nakkisuoja > 0) {
        // Nakkisuoja: this check skips them.
        p.service.cafe.nakkisuoja--;
        p.service.dirty = true;
        p.phone.conv(FI.inventory.number, FI.inventory.name);
        this.varusmestari.post(p, FI.inventory.number, FI.abilities.nakkisuoja[Math.floor(Math.random() * FI.abilities.nakkisuoja.length)]!);
        this.service.notify(p);
        p.inventoryAt = now + randomBetween(INVENTORY.interval) * 1000;
        continue;
      }
      this.varusmestari.inventory(p);
      p.inventoryAt = now + randomBetween(INVENTORY.interval) * 1000;
    }
  }

  /** Off the shooting range and into the match (a bot makes room if the server is full). */
  deploy(p: ServerPlayer): void {
    if (!p.training) return;
    p.training = false;
    this.settleInventory(p);
    if (this.activeCount() > 16 && this.bots.length > 0) this.removeBot();
    this.fitTeams();
    if (this.round.state === 'playing') this.respawn(p);
    this.updateGate();
    this.broadcastPlayers();
    p.phone.sendStatus(p.phoneStatus(this.round.n));
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

  sendAmmo(p: ServerPlayer, w: WeaponId): void {
    p.outbox.push({ k: 'ammo', w, n: p.ammo[w], r: p.reserve[w], seq: p.lastFireSeq });
  }

  /**
   * Reload of the weapon in hand. R (`spare`) puts in the spare magazine; the armourer's LATAA
   * (`armoury`) fills every magazine and the spares, the gun in hand with a proper reload.
   * Returns a reason when refused.
   */
  startReload(p: ServerPlayer, from: 'spare' | 'armoury'): 'ok' | 'dead' | 'full' | 'busy' | 'noSpare' {
    if (!p.alive) return 'dead';
    const w = p.weapon;
    const now = this.now();
    const mag = p.gun(w).magazine;
    const r = p.reload && now < p.reload.end ? p.reload : null;
    if (from === 'armoury') {
      if (p.owned.every((o) => p.ammo[o] >= p.gun(o).magazine && p.reserve[o] >= p.spare(o))) return 'full';
      if (r?.full) return 'busy';
      for (const o of p.owned) {
        p.reserve[o] = p.spare(o);
        if (o !== w) p.ammo[o] = p.gun(o).magazine;
        this.sendAmmo(p, o);
      }
      if (r) {
        // A reload is under way: it now fills from the armoury (or already has, so top up).
        r.full = true;
        if (r.refilled) {
          p.ammo[w] = mag;
          this.sendAmmo(p, w);
        }
        return 'ok';
      }
      if (p.ammo[w] < mag) this.beginReload(p, w, true);
      return 'ok';
    }
    if (r) return 'busy';
    if (p.ammo[w] >= mag) return 'full';
    if (p.reserve[w] <= 0) return 'noSpare';
    this.beginReload(p, w, false);
    return 'ok';
  }

  private beginReload(p: ServerPlayer, w: WeaponId, full: boolean): void {
    const T = TUNING[w];
    const empty = p.ammo[w] === 0;
    const dur = (empty ? T.reloadEmptyTime : T.reloadTime) * 1000;
    const now = this.now();
    p.reload = { w, start: now, refillAt: now + dur * T.reloadRefill, end: now + dur, refilled: false, full };
    p.outbox.push({ k: 'reload', w, empty, dur: dur / 1000, full });
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
      this.sendAmmo(p, w);
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
      // A shot passes a partner by (no friendly fire).
      if (target && target !== p && !this.mates(p, target) && target.alive && now >= target.protectedUntil) {
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
    // Tracers and impacts only: millimetres are plenty, and the event about halves in size.
    const ev: GameEvent = { k: 'shot', p: p.id, w, o: [mm(ox), mm(oy), mm(oz)], e: [mm(end[0]), mm(end[1]), mm(end[2])] };
    if (victim) ev.hp = victim.id;
    else if (wall) {
      ev.n = [mm(wall.nx), mm(wall.ny), mm(wall.nz)];
      ev.s = wall.s;
    }
    this.emit(ev);
    if (victim) this.damage(victim, p, damageFor(w, zone, dist, this.killSpeed, p.service.upgrades), zone, w, [ox, oy, oz]);
  }

  /**
   * A knife stab landing: the claimed player, rewound to what the attacker saw, must be within
   * reach and in front, with nothing solid in between. Two stabs kill from full health.
   */
  melee(p: ServerPlayer, o: [number, number, number], d: [number, number, number], rt: number, target?: number): void {
    const now = this.now();
    const M = TUNING.melee;
    // Not with a grenade in hand, and no faster than the stab itself.
    if (!p.alive || p.pinAt || now - p.lastMeleeAt < M.time * 1000 * 0.8) return;
    p.lastMeleeAt = now;
    p.meleeUntil = now + M.time * (1 - M.hitAt) * 1000;
    p.protectedUntil = 0;
    let [ox, oy, oz] = o;
    if (Math.hypot(ox - p.x, oy - p.eyeY(), oz - p.z) > 1.5) {
      ox = p.x;
      oy = p.eyeY();
      oz = p.z;
    }
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const dir: [number, number, number] = [d[0] / dl, d[1] / dl, d[2] / dl];
    const v = target === undefined ? undefined : this.players.get(target);
    if (!v || v === p || this.mates(p, v) || !v.alive || now < v.protectedUntil) return;
    const h = v.history.at(Math.max(now - NET.maxRewind * 1000, Math.min(now, rt)));
    if (!h || !h.alive || !meleeReaches([ox, oy, oz], dir, h, 0.35)) return;
    // Nothing solid between the blade and the body.
    const cy = h.y + (h.crouched ? 0.6 : 1.0);
    this.world.trace(this.tr, ox, oy, oz, h.x, cy, h.z, 0, 0, 0, MASK.SHOT);
    if (this.tr.fraction < 1 && this.tr.fraction * Math.hypot(h.x - ox, cy - oy, h.z - oz) < Math.hypot(h.x - ox, cy - oy, h.z - oz) - 0.45) return;
    // Teroitettu puukko: one stab is enough.
    this.damage(v, p, level(p.service.upgrades, 'puukko') > 0 ? TUNING.player.health : M.damage, 'body', 'knife', [ox, oy, oz]);
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

  damage(v: ServerPlayer, a: ServerPlayer | null, amount: number, zone: HitZone, w: KillWeapon, from: [number, number, number]): void {
    // Between rounds (and over the match's results) nobody gets hurt: the scores stand.
    if (!v.alive || amount <= 0 || this.round.state !== 'playing') return;
    // Team mode: no friendly fire (your own grenade still gets you).
    if (a && this.mates(a, v)) return;
    const now = this.now();
    if (now < v.protectedUntil) return;
    v.hp = Math.max(0, v.hp - amount);
    v.lastDamageAt = now;
    if (v.bot && a) this.bots.find((b) => b.p === v)?.hurtBy(a.id);
    const hit: GameEvent = { k: 'hit', a: a?.id ?? 0, v: v.id, dmg: amount, hp: Math.round(v.hp * 100) / 100, z: zone, from: from && [mm(from[0]), mm(from[1]), mm(from[2])] };
    v.outbox.push(hit);
    if (a && a !== v) a.outbox.push(hit);
    if (v.hp <= 0) this.kill(v, a, w, zone === 'head');
  }

  kill(v: ServerPlayer, a: ServerPlayer | null, w: KillWeapon, head: boolean): void {
    // A grenade with its pin out falls where they fall, still burning.
    if (v.pinAt) this.dropGrenade(v);
    v.alive = false;
    v.flags &= ~PF.ALIVE;
    v.deaths++;
    v.reload = null;
    v.grenades = 0;
    // Killed with a chat open: caught texting, which serves the killer a day more.
    const caught = this.texting(v);
    if (a && a !== v) {
      a.kills++;
      // The service counts kills and deaths at someone else's hand.
      this.service.onKill(a, v, caught);
      this.service.onDeath(v);
    }
    const now = this.now();
    v.respawnAt = now + TUNING.player.respawnTime * 1000;
    // Killed mid-message: the unfinished draft goes into the kill feed.
    const d = v.phone.draft;
    const typing = d && d.text.trim() && (v.phone.out || now - d.at < PHONE.draftRecent * 1000) ? d.text.trim().slice(0, 60) : undefined;
    if (typing) {
      v.stats.deathsTyping++;
      if (typing.length > v.stats.deathDraft.length) v.stats.deathDraft = typing;
    }
    // Killed with the phone out: the phone says so, closes the chat and drops what was typed.
    if (v.phone.out) {
      v.phone.send({ t: 'killed', by: a && a !== v ? a.name : '', w, head, draft: typing ?? '' });
      v.phone.draft = null;
    }
    const ev: GameEvent = { k: 'kill', a: a?.id ?? 0, v: v.id, w, head };
    if (caught) ev.phone = true;
    if (typing) ev.draft = typing;
    this.emit(ev);
    this.broadcastPlayers();
  }

  /** G pressed: the pin is out and the fuse burns from now, thrown or not. */
  pinGrenade(p: ServerPlayer): void {
    if (!p.alive || p.pinAt || p.grenades <= 0) return;
    p.grenades--;
    p.pinAt = this.now();
    p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
  }

  /** Fuse left (s) on the grenade in hand. */
  private fuseLeft(p: ServerPlayer): number {
    return TUNING.grenade.fuse - (this.now() - p.pinAt) / 1000;
  }

  /**
   * The grenade leaves the hand: with what is left of its fuse if the pin came out earlier
   * (the player's G press), else a fresh one (bots throw at once).
   */
  throwGrenade(p: ServerPlayer, o: [number, number, number], v: [number, number, number]): void {
    if (!p.alive) return;
    let fuse = TUNING.grenade.fuse;
    if (p.pinAt) {
      fuse = Math.max(0.05, this.fuseLeft(p));
      p.pinAt = 0;
    } else {
      if (p.grenades <= 0) return;
      p.grenades--;
      p.outbox.push({ k: 'grenades', n: p.grenades, max: p.maxGrenades });
    }
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
    const g = { id: this.nextGrenadeId++, owner: p.id, x: this.tr.x, y: this.tr.y, z: this.tr.z, vx: v[0] * s, vy: v[1] * s, vz: v[2] * s, fuse, resting: false };
    this.grenades.push(g);
    this.emit({ k: 'nade', id: g.id, p: p.id, o: [g.x, g.y, g.z], v: [g.vx, g.vy, g.vz], fuse: g.fuse });
  }

  /** The grenade in hand falls at the player's feet with the fuse it has left. */
  private dropGrenade(p: ServerPlayer): void {
    const fuse = Math.max(0.05, this.fuseLeft(p));
    p.pinAt = 0;
    const g = { id: this.nextGrenadeId++, owner: p.id, x: p.x, y: p.y + 0.9, z: p.z, vx: 0, vy: -1, vz: 0, fuse, resting: false };
    this.grenades.push(g);
    this.emit({ k: 'nade', id: g.id, p: p.id, o: [g.x, g.y, g.z], v: [0, -1, 0], fuse });
  }

  /** A grenade (or a mortar round) goes off: Raskas panos blasts wider, Lisää sirpaleita hits harder. */
  private explode(g: Grenade & { owner: number }, w: 'grenade' | 'mortar' = 'grenade'): void {
    const owner = this.players.get(g.owner) ?? null;
    const u = owner?.service.upgrades ?? {};
    const radius = w === 'mortar' ? GEAR.mortarRadius : TUNING.grenade.radius * (level(u, 'raskas') > 0 ? GEAR.blastRadiusMul : 1);
    const damage = TUNING.grenade.damage * (w === 'grenade' && level(u, 'sirpale') > 0 ? GEAR.grenadeDamageMul : 1);
    const T = { ...TUNING.grenade, radius, damage };
    this.emit(radius !== TUNING.grenade.radius ? { k: 'boom', id: g.id, x: g.x, y: g.y, z: g.z, r: radius } : { k: 'boom', id: g.id, x: g.x, y: g.y, z: g.z });
    for (const v of this.players.values()) {
      if (!v.alive) continue;
      const cy = v.y + 1.0;
      const dist = Math.hypot(v.x - g.x, cy - g.y, v.z - g.z);
      const dmg = explosionDamage(dist, T);
      if (dmg <= 0 || !blastReaches(this.world, g.x, g.y, g.z, v.x, cy, v.z)) continue;
      this.damage(v, owner, dmg, 'body', w, [g.x, g.y, g.z]);
    }
  }

  /** Tiedustelulennokki: every enemy on the player's minimap for a while, once a round. */
  drone(p: ServerPlayer): 'ok' | 'used' {
    if (p.service.used.has('LENNOKKI')) return 'used';
    p.service.used.add('LENNOKKI');
    p.outbox.push({ k: 'drone', until: this.now() + GEAR.droneTime * 1000 });
    return 'ok';
  }

  /**
   * Tulitoimitus: mortar rounds where the player is looking (from the desktop's view, while the
   * phone sends the order), landing a few seconds apart after a delay, once a round.
   */
  mortar(p: ServerPlayer): 'ok' | 'used' | 'noTarget' {
    if (p.service.used.has('TULI')) return 'used';
    const range = 250;
    const cp = Math.cos(p.pitch);
    const dx = -Math.sin(p.yaw) * cp;
    const dy = Math.sin(p.pitch);
    const dz = -Math.cos(p.yaw) * cp;
    const ex = p.x;
    const ey = p.eyeY();
    const ez = p.z;
    this.world.trace(this.tr, ex, ey, ez, ex + dx * range, ey + dy * range, ez + dz * range, 0, 0, 0, MASK.SHOT);
    if (this.tr.fraction >= 1) return 'noTarget';
    const tx = this.tr.x;
    const tz = this.tr.z;
    p.service.used.add('TULI');
    const now = this.now();
    for (let i = 0; i < GEAR.mortarRounds; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * GEAR.mortarSpread;
      const x = tx + Math.cos(a) * r;
      const z = tz + Math.sin(a) * r;
      // Where it lands: the first thing below, from high above.
      this.world.trace(this.tr, x, this.tr.y + 40, z, x, this.tr.y - 40, z, 0, 0, 0, MASK.SHOT);
      const y = this.tr.fraction < 1 ? this.tr.y : 0;
      const at = now + (GEAR.mortarDelay + i * GEAR.mortarGap) * 1000;
      this.mortars.push({ x, y, z, owner: p.id, at });
      this.emit({ k: 'mortar', x, y, z, at });
    }
    return 'ok';
  }

  // ---- rounds ----

  /**
   * The next round, or round 1 of a new match (`newMatch`): then everything starts again, the
   * service (TJ, money, gear), kills, deaths and the awards' counters, and the chats the match
   * started are gone. Within a match only the once-a-round commands come back.
   */
  startRound(newMatch = false): void {
    // Players who left more than a minute ago are dropped from the new round.
    for (const p of [...this.players.values()]) {
      if (!p.bot && !p.connected && this.now() - p.leftAt > 60_000) this.players.delete(p.id);
    }
    const r = this.round;
    this.round = {
      n: r.n + 1,
      match: newMatch ? r.match + 1 : r.match,
      round: newMatch ? 1 : r.round + 1,
      of: this.settings.rounds,
      state: 'playing',
      matchOver: false,
      endsAt: this.now() + this.roundMs,
      gateOpen: this.activeCount() > GATE_PLAYERS,
    };
    if (newMatch) this.evening.clearServices();
    this.fitBots();
    // Pairs are drawn anew for each match; within one, whoever lost a partner gets a new one.
    this.fitTeams(newMatch);
    this.service.resetRound();
    this.setGate(this.round.gateOpen);
    this.grenades = [];
    this.mortars = [];
    for (const p of this.players.values()) {
      if (newMatch) {
        p.kills = 0;
        p.deaths = 0;
        p.stats = ServerPlayer.freshStats();
        p.service.reset();
        this.equip(p);
        p.outbox.push({ k: 'upgrades', u: {} });
        this.dropMatchChats(p);
      }
      p.service.used.clear();
      this.service.notify(p);
      p.phone.resetRound();
      // The vääpeli's held-back questions are about the round that ended.
      p.phone.deferred.delete(FI.inventory.number);
      if (p.inventory) {
        p.outbox.push({ k: 'inventory', until: 0 });
        p.phone.send({ t: 'inventory', left: 0 });
      }
      p.inventory = null;
      p.inventoryAt = 0;
      this.settleInventory(p);
      // A divider in the armoury chat (the services list was sent once, when the phone paired).
      const divider = newMatch ? `#match ${this.round.match}` : `#round ${this.round.round}`;
      if (p.phone.paired && p.phone.convs.has(FI_NUMBER)) p.phone.add(FI_NUMBER, { id: p.phone.newId(), from: 'system', text: divider, at: Date.now() });
      p.newSerials();
      this.service.newSerials(p);
      p.outbox.push({ k: 'serials', pistol: p.serials.pistol, rifle: p.serials.rifle, sniper: p.serials.sniper });
      if ((p.connected && !p.training) || p.bot) this.respawn(p);
    }
    this.emit({ k: 'round', round: this.round });
    this.broadcastPlayers();
  }

  /**
   * A new match: only the asevarasto's and the vääpeli's chats stay; the offices, the commander and
   * the rest go, and so do the texts held back for the old match's service.
   */
  private dropMatchChats(p: ServerPlayer): void {
    const keep = new Set([FI_NUMBER, FI.inventory.number]);
    const phone = p.phone;
    phone.deferred.clear();
    let dropped = false;
    for (const id of [...phone.convs.keys()]) {
      if (keep.has(id)) continue;
      phone.convs.delete(id);
      phone.inFlight.delete(id);
      dropped = true;
    }
    if (dropped) {
      phone.send({ t: 'convs', convs: [...phone.convs.values()] });
      phone.onUnread();
    }
  }

  // ---- tick ----

  tick(dt: number): void {
    const t0 = performance.now();
    const now = this.now();
    this.tickCount++;
    if (this.round.state === 'playing' && now >= this.round.endsAt) this.endRound(now);
    else if (this.round.state === 'ended' && now >= this.round.endsAt) this.startRound(this.round.matchOver);

    for (const bot of this.bots) bot.update(dt, now);
    for (const p of this.players.values()) p.phone.tick(now);
    this.inventoryChecks(now);
    if (this.tickCount % 3 === 0) {
      for (const p of this.players.values()) if (p.phone.online) p.phone.sendStatus(p.phoneStatus(this.round.n));
    }
    this.flushTypos(now);

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.round.state === 'playing' && now >= p.respawnAt && ((p.connected && !p.training) || p.bot)) this.respawn(p);
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
          const mag = p.gun(r.w).magazine;
          if (r.full) p.ammo[r.w] = mag;
          else {
            const take = Math.min(mag - p.ammo[r.w], p.reserve[r.w]);
            p.ammo[r.w] += take;
            p.reserve[r.w] -= take;
          }
          this.sendAmmo(p, r.w);
        }
        if (now >= r.end) p.reload = null;
      }
      if (p.bot) {
        p.stateTime = now;
        p.history.push(now, p.x, p.y, p.z, p.crouched, true);
      }
    }

    // Held too long: it goes off in the hand.
    for (const p of this.players.values()) {
      if (!p.pinAt || this.fuseLeft(p) > 0) continue;
      p.pinAt = 0;
      if (p.alive) this.explode({ id: this.nextGrenadeId++, owner: p.id, x: p.x, y: p.eyeY() - 0.35, z: p.z, vx: 0, vy: 0, vz: 0, fuse: 0, resting: true });
    }
    if (this.mortars.length) {
      const due = this.mortars.filter((m) => now >= m.at);
      if (due.length) {
        this.mortars = this.mortars.filter((m) => now < m.at);
        for (const m of due) this.explode({ id: this.nextGrenadeId++, owner: m.owner, x: m.x, y: m.y + 0.15, z: m.z, vx: 0, vy: 0, vz: 0, fuse: 0, resting: true }, 'mortar');
      }
    }
    for (const g of this.grenades) stepGrenade(g, this.world, dt);
    const exploding = this.grenades.filter((g) => g.fuse <= 0);
    if (exploding.length) {
      this.grenades = this.grenades.filter((g) => g.fuse > 0);
      for (const g of exploding) this.explode(g);
    }

    // Services that changed go into the evening file every few seconds.
    if (now - this.savedAt >= SERVICE.saveEvery * 1000) {
      this.savedAt = now;
      this.evening.keepServices([...this.players.values()]);
    }
    const snapEvery = Math.max(1, Math.round(NET.tickHz / NET.snapshotHz));
    if (this.tickCount % snapEvery === 0) this.sendSnapshot(now);
    // Pings and connection states for the scoreboard.
    if (this.tickCount % (NET.tickHz * 2) === 0) this.broadcastPlayers();
    this.flushEvents(now);
    this.tickMs = performance.now() - t0;
  }

  /** A chat open on a phone that is there (a bot's pretend one counts): the character holds it. */
  private texting(p: ServerPlayer): boolean {
    return p.phone.out && (p.phone.online || p.bot);
  }

  private snapFlags(p: ServerPlayer, now: number): number {
    let f = p.flags & ~(PF.ALIVE | PF.PROTECTED | PF.RELOAD | PF.BOT);
    if (p.alive) f |= PF.ALIVE;
    if (now < p.protectedUntil) f |= PF.PROTECTED;
    if (p.reload && now < p.reload.end) f |= PF.RELOAD;
    if (p.bot) f |= PF.BOT;
    if (p.alive && this.texting(p)) f |= PF.PHONE;
    if (p.alive && now < p.meleeUntil) f |= PF.MELEE;
    return f;
  }

  sendSnapshot(now: number): void {
    const players: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      if ((!p.connected && !p.bot) || p.training) continue;
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
    // Most players get just the shared events: serialised once for all of them.
    let json: string | null = null;
    for (const p of this.players.values()) {
      if (shared.length === 0 && p.outbox.length === 0) continue;
      if (!p.ws) {
        p.outbox = [];
        continue;
      }
      if (p.outbox.length) {
        p.send({ t: 'events', e: [...shared, ...p.outbox], st: now });
        p.outbox = [];
      } else p.sendText((json ??= JSON.stringify({ t: 'events', e: shared, st: now })));
    }
  }
}
