import * as THREE from 'three';
import { MASK } from '../../shared/collision/brush';
import { TraceResult } from '../../shared/collision/world';
import { meleeTarget } from '../../shared/melee';
import { GEAR, MINIMAP, TUNING, type WeaponId } from '../../shared/config';
import { FI } from '../../shared/fi';
import { benefit } from '../../shared/service';
import { wrapAngle, type Vec3 } from '../../shared/math';
import {
  PF,
  PROTOCOL_VERSION,
  WEAPON_IDS,
  encodeState,
  type AwardInfo,
  type ClientMsg,
  type MatchResult,
  type MatchSettings,
  type GameEvent,
  type KillWeapon,
  type PlayerInfo,
  type RoundInfo,
  type ServerMsg,
  type ShotClaim,
  type Snapshot,
} from '../../shared/protocol';
import { UI } from '../../shared/ui';
import { weaponStats } from '../../shared/upgrades';
import type { Net } from '../net';
import { accentOf, INVENTORY_URGENT, type MatchHud } from '../ui/matchHud';
import type { MinimapMark } from '../ui/minimap';
import type { PairInfo } from '../ui/pair';
import type { Game, GameMode } from './game';
import { Remotes } from './remotes';
import { withKeys } from '../controls';

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}

interface Death {
  x: number;
  y: number;
  z: number;
  floor: number;
  yaw: number;
  pitch: number;
  t: number;
  killer: number;
  weapon: KillWeapon;
}

/** What still matters while we are on the range rather than in the match. */
const RANGE_EVENTS = new Set<GameEvent['k']>(['training', 'phoneOut', 'paired', 'round', 'upgrades', 'ladder', 'serials']);

/** Distance beyond which remote gunshots use the distant layer. */
const FAR_SHOT = 38;

/**
 * Free-for-all match against the server: sends our movement, claims hits on remote players as
 * drawn (the server validates with rewind), and plays everything the server reports.
 */
export class MatchMode implements GameMode {
  myId = 0;
  alive = false;
  hp = 100;
  protected = false;
  /** Our own phone has a chat open (from our entry in the snapshots). */
  phoneOut = false;
  joined = false;
  players = new Map<number, PlayerInfo>();
  round: RoundInfo | null = null;
  /** The match's awards (after its last round) and who won each match tonight. */
  awards: AwardInfo[] = [];
  evening: MatchResult[] = [];
  /** The host's match settings (shown to the host in the pause menu). */
  settings: MatchSettings | null = null;
  /** How to pair a phone with us; null until the server says. */
  pairInfo: PairInfo | null = null;
  dev = false;
  /** The server takes our dev commands. */
  devAllowed = false;
  /** Still on the range: the match's sounds and feeds stay quiet. */
  training = false;
  /** An inventory check to answer by this server time (0: none). */
  inventoryUntil = 0;
  /** The inventory check's whole seconds left when last heard (0: none), for its sounds. */
  private inventorySec = 0;
  /** Paperwork open on the phone, and how many wait behind it, as last told: a new one chimes. */
  private paperwork = { open: false, queued: 0 };
  /** Our recon drone shows every enemy until this server time. */
  droneUntil = 0;
  /** Mortar rounds on their way (server times): each whistles as it comes in. */
  private mortars: { x: number; y: number; z: number; at: number; whistled: boolean }[] = [];
  /** Chats on our phone with unread messages. */
  unreadFrom: string[] = [];
  onPairInfo: (info: PairInfo) => void = () => {};
  /** Asevarasto's answers on the range (the radio check, LATAA, KRANAATTI). */
  onTraining: (what: 'radioCheck' | 'ammo' | 'grenade') => void = () => {};
  readonly remotes: Remotes;
  private stateSeq = 0;
  private fireSeq = 0;
  private pendingShots: { seq: number; w: WeaponId; at: number }[] = [];
  private claims: { victim: number; at: number }[] = [];
  private stepCount = 0;
  private death: Death | null = null;
  private respawnAt = 0;
  private ownGrenades: number[] = [];
  private gate = false;
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor(
    private game: Game,
    private net: Net,
    private hud: MatchHud,
    private identity: { name: string; token?: string; train?: boolean },
  ) {
    this.remotes = new Remotes(game.world, game.deps.audio, () => this.myId);
    game.root.add(this.remotes.group);
    game.grenades.serverFuse = true;
    game.keepRunning = true;
    game.devDirectReload = false;
    this.setGate(false);
    hud.minimap.setMap(game.map);
  }

  get firing(): boolean {
    return this.round?.state !== 'ended';
  }

  /** Joins (or rejoins with the token) over the current connection. */
  hello(): void {
    this.net.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.identity.name, token: this.identity.token, train: this.identity.train });
  }

  /** The connection dropped: we are out until the server welcomes us again. */
  connectionLost(): void {
    this.joined = false;
    this.alive = false;
  }

  leave(): void {
    this.net.send({ t: 'leave' });
  }

  /** Off the range and into the match (and so on reconnects too). */
  deploy(): void {
    this.identity.train = false;
    this.training = false;
    this.net.send({ t: 'deploy' });
  }

  send(msg: ClientMsg): void {
    this.net.send(msg);
  }

  onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.id;
        this.joined = true;
        this.identity.token = msg.token;
        this.setPlayers(msg.players);
        this.setRound(msg.round);
        this.game.devDirectReload = msg.dev;
        this.dev = msg.dev;
        this.devAllowed = msg.host;
        this.training = msg.training;
        this.settings = msg.settings;
        break;
      case 'evening':
        this.evening = msg.matches;
        break;
      case 'settings':
        this.settings = msg.s;
        break;
      case 'pairInfo':
        this.pairInfo = { url: msg.url, token: msg.token, code: msg.code, phone: msg.phone, virtual: msg.virtual };
        this.onPairInfo(this.pairInfo);
        break;
      case 'players':
        this.setPlayers(msg.players);
        break;
      case 'pings':
        for (const [id, ping] of msg.p) {
          const p = this.players.get(id);
          if (p) p.ping = ping;
        }
        break;
      case 'events':
        for (const e of msg.e) this.onEvent(e);
        break;
      default:
        break;
    }
  }

  onSnapshot(s: Snapshot, arrival: number): void {
    this.remotes.onSnapshot(s, arrival);
    const me = s.players.find((p) => p.id === this.myId);
    if (me) {
      this.protected = (me.flags & PF.PROTECTED) !== 0;
      this.phoneOut = (me.flags & PF.PHONE) !== 0;
      if (this.alive) this.hp = me.hp;
    }
  }

  /** The soundtrack for the round's state: a clip over a break or the results, else silence. */
  syncMusic(): void {
    const r = this.round;
    if (this.training || !r) return;
    const music = this.game.deps.audio.music;
    if (r.state === 'ended') music.clip((r.endsAt - this.net.serverNow()) / 1000, r.matchOver);
    else music.off();
  }

  private setPlayers(list: PlayerInfo[]): void {
    this.players = new Map(list.map((p) => [p.id, p]));
    this.remotes.syncPlayers(list);
    // Team mode: who we are paired with, beside the round timer.
    const me = this.players.get(this.myId);
    const mates = me && me.team >= 0 && !this.training ? list.filter((p) => p.team === me.team && p.id !== me.id) : null;
    this.hud.team(mates && me ? { color: accentOf(me), names: mates.map((p) => p.name) } : null);
  }

  private setRound(r: RoundInfo): void {
    const prev = this.round;
    this.round = r;
    if (!prev || prev.n !== r.n || prev.state !== r.state) this.syncMusic();
    // The range officer calls the rounds: Tulitauko! as one ends, Tuli vapaa! as the next one starts.
    if (prev && !this.training) {
      if (prev.state === 'playing' && r.state === 'ended') this.game.deps.audio.playVoice(FI.voice.roundEnd);
      else if (prev.state === 'ended' && r.state === 'playing') this.game.deps.audio.playVoice(FI.voice.roundStart);
    }
    if (r.gateOpen !== this.gate) {
      this.setGate(r.gateOpen);
      if (r.gateOpen && prev) this.hud.notice(UI.hud.gateOpen);
    }
    if (prev && r.n !== prev.n) {
      this.game.grenades.clear();
      this.ownGrenades = [];
    }
  }

  /** The outer-ring gate: its blocking brushes and the boom's position follow the server. */
  private setGate(open: boolean): void {
    this.gate = open;
    for (const i of this.game.map.gateBrushes ?? []) {
      const b = this.game.world.brushes[i];
      if (b) b.flags = open ? 0 : MASK.MOVE | MASK.GRENADE;
    }
    this.game.props.setGate?.(open);
  }

  private name(id: number): string {
    return this.players.get(id)?.name ?? '?';
  }

  private onEvent(e: GameEvent): void {
    const g = this.game;
    const { audio, hud } = g.deps;
    if (this.training && !RANGE_EVENTS.has(e.k)) return;
    switch (e.k) {
      case 'training':
        this.onTraining(e.what);
        break;
      case 'phoneOut':
        this.phoneOut = e.on;
        break;
      case 'inventory':
        this.inventoryUntil = e.until;
        break;
      case 'unread':
        this.unreadFrom = e.from;
        break;
      case 'shot':
        if (e.p !== this.myId) this.remoteShot(e);
        break;
      case 'hit': {
        const rp = this.remotes.players.get(e.v);
        if (rp) rp.hitFrom = e.from;
        if (e.v === this.myId) {
          this.hp = e.hp;
          this.hud.damage(e.dmg, e.from[0], e.from[2]);
          audio.play('player_hurt', { bus: 'ui', volume: 0.75 });
        } else if (e.a === this.myId) {
          // Hits we did not predict (grenades): confirm them now.
          const now = performance.now();
          if (!this.claims.some((c) => c.victim === e.v && now - c.at < 400)) {
            hud.hitMarker(e.z === 'head' ? 'head' : 'body');
            audio.play('hit_body', { bus: 'ui', volume: 0.6 });
          }
        }
        break;
      }
      case 'kill': {
        const killer = this.players.get(e.a);
        const victim = this.players.get(e.v);
        const weapon = e.w === 'grenade' ? UI.hud.grenadeWeapon : (UI.hud.weapons[e.w] ?? e.w);
        this.hud.kill(e.a === e.v ? undefined : killer, victim, weapon, e.head, this.myId, e.draft, e.phone);
        if (e.v === this.myId) this.die(e.a, e.w);
        else if (e.a === this.myId) {
          hud.hitMarker('kill');
          audio.play('hit_kill', { bus: 'ui', volume: 0.9 });
          this.hud.killConfirm(victim?.name ?? '?', e.head);
        }
        break;
      }
      case 'spawn':
        if (e.p === this.myId) {
          g.teleport(e.x, e.y, e.z, e.yaw);
          g.weapons.resetLife(e.weapons, e.ammo, e.reserve);
          this.alive = true;
          this.hp = TUNING.player.health;
          this.death = null;
          g.camOverride = null;
          this.pendingShots = [];
          this.hud.reset();
        }
        break;
      case 'ammo': {
        // Shots we fired after the server's count still come off it.
        const after = e.seq === undefined ? 0 : this.pendingShots.filter((s) => s.w === e.w && s.seq > e.seq!).length;
        g.weapons.ammo[e.w] = Math.max(0, e.n - after);
        g.weapons.reserve[e.w] = e.r;
        break;
      }
      case 'reload':
        g.weapons.serverReload(e.w, e.empty, e.dur, e.full);
        break;
      case 'grenades':
        g.weapons.grenades = e.n;
        g.weapons.maxGrenades = e.max;
        break;
      case 'nade': {
        if (e.p === this.myId) {
          const local = this.ownGrenades.shift();
          if (local !== undefined && g.grenades.adopt(local, e.id)) break;
        }
        if (!g.grenades.has(e.id)) g.grenades.spawn(e.o[0], e.o[1], e.o[2], e.v, e.fuse, e.p, e.id);
        break;
      }
      case 'boom':
        g.grenades.remove(e.id);
        g.explosionFx(e.x, e.y, e.z, e.r);
        break;
      case 'join':
        if (e.p !== this.myId) this.hud.notice(fill(UI.hud.joined, { name: e.name }));
        break;
      case 'leave':
        if (e.p !== this.myId) this.hud.notice(fill(UI.hud.left, { name: e.name }));
        break;
      case 'round':
        this.setRound(e.round);
        break;
      case 'give':
        g.weapons.give(e.w);
        g.weapons.switchTo(e.w);
        break;
      case 'serials':
        g.setSerials({ pistol: e.pistol, rifle: e.rifle, sniper: e.sniper });
        break;
      case 'note':
        hud.note(e.text, 3);
        break;
      case 'typo':
        this.hud.typo(this.players.get(e.p), e.to, e.text, e.reply);
        break;
      case 'paired':
        hud.note(e.replaced ? UI.hud.phoneReplaced : UI.hud.phonePaired, 3);
        break;
      case 'ladder':
        // New paperwork on the phone (the first, or the next after one is done): the phone's chime here too.
        if (e.open && (!this.paperwork.open || e.queued < this.paperwork.queued)) audio.play('phone_chime', { bus: 'ui', volume: 0.9 });
        this.paperwork = { open: e.open, queued: e.queued };
        this.hud.ladder(e.rank, e.tj, e.open, e.queued);
        break;
      case 'pay':
        this.hud.killPay([fill(UI.hud.pay, { eur: e.eur }), ...(e.senior ? [UI.hud.paySenior] : []), ...(e.caught ? [UI.hud.payCaught] : [])].join(' · '));
        break;
      case 'drone':
        this.droneUntil = e.until;
        hud.note(UI.hud.drone, 3);
        break;
      case 'mortar':
        this.mortars.push({ x: e.x, y: e.y, z: e.z, at: e.at, whistled: false });
        break;
      case 'awards':
        this.awards = e.list;
        break;
      case 'chirp': {
        // Someone's phone pings: audible a few metres away, not across the map.
        if (e.p === this.myId) break;
        const rp = this.remotes.players.get(e.p);
        if (rp?.present && rp.alive) g.deps.audio.playAt('phone_in', rp.s.x, rp.s.y + 1.2, rp.s.z, { volume: 0.55, refDistance: 1.5, rolloff: 1.6, maxDistance: 16 });
        break;
      }
      case 'upgrades': {
        g.weapons.upgrades = { ...e.u };
        if (e.id) {
          hud.note(fill(UI.hud.upgradeTaken, { name: FI.items[e.id] ?? e.id, benefit: benefit(e.id) }), 3.5);
          g.deps.audio.play('hit_kill', { bus: 'ui', volume: 0.35, rate: 1.4 });
        }
        break;
      }
    }
  }

  /** Muzzle flash, tracer, gunshot, impact and near-miss crack of someone else's shot. */
  private remoteShot(e: Extract<GameEvent, { k: 'shot' }>): void {
    const g = this.game;
    const audio = g.deps.audio;
    const m = this.remotes.muzzle(e.p, this.v) ?? this.v.set(e.o[0], e.o[1], e.o[2]);
    const dist = m.distanceTo(g.eye);
    // Suppressed: no flash or tracer, a dull thump heard only nearby.
    const silenced = weaponStats(e.w, this.players.get(e.p)?.upgrades ?? {}).silenced;
    if (silenced) {
      audio.playAt(`${e.w}_suppressed`, m.x, m.y, m.z, { volume: audio.gun(0.9), refDistance: 2.5, rolloff: 1.4, maxDistance: 40, gunshot: true });
    } else {
      this.remotes.players.get(e.p)?.char.muzzleFlash();
      g.effects.tracer(m.x, m.y, m.z, e.e[0], e.e[1], e.e[2]);
      // A loud shot gives the shooter away on everyone's minimap (our partner's we know about).
      if (!this.remotes.players.get(e.p)?.mate) this.hud.minimap.shot(e.p, m.x, m.z);
    }
    if (silenced) {
      // No loud report.
    } else if (dist < FAR_SHOT) {
      audio.playAt(`${e.w}_shot`, m.x, m.y, m.z, { volume: audio.gun(0.95), refDistance: 5, rolloff: 1, maxDistance: 300, gunshot: true });
      if (dist < 18) audio.playAt(`${e.w}_tail`, m.x, m.y, m.z, { volume: audio.gun(0.35), refDistance: 6, rolloff: 1 });
    } else {
      audio.playAt(`${e.w}_far`, m.x, m.y, m.z, { volume: audio.gun(0.9), refDistance: 28, rolloff: 0.6, maxDistance: 600, gunshot: true });
    }
    if (e.hp !== undefined) {
      if (e.hp !== this.myId) {
        g.effects.hitPuff(e.e[0], e.e[1], e.e[2], e.o[0] - e.e[0], e.o[1] - e.e[1], e.o[2] - e.e[2], true);
        audio.playAt('impact_flesh', e.e[0], e.e[1], e.e[2], { volume: 0.8, refDistance: 3 });
      }
    } else if (e.n) {
      g.wallImpact(e.e[0], e.e[1], e.e[2], e.n[0], e.n[1], e.n[2], e.s ?? 0);
    }
    // A bullet passing close to our head cracks before the gunshot arrives.
    if (e.hp !== this.myId && this.alive) {
      const ex = this.v2.set(e.e[0] - e.o[0], e.e[1] - e.o[1], e.e[2] - e.o[2]);
      const len = ex.length();
      if (len > 4) {
        ex.divideScalar(len);
        const eye = g.eye;
        const t = Math.max(0, Math.min(len, (eye.x - e.o[0]) * ex.x + (eye.y - e.o[1]) * ex.y + (eye.z - e.o[2]) * ex.z));
        const px = e.o[0] + ex.x * t;
        const py = e.o[1] + ex.y * t;
        const pz = e.o[2] + ex.z * t;
        const miss = Math.hypot(px - eye.x, py - eye.y, pz - eye.z);
        if (miss < 2.2 && t > 4) audio.playAt('bullet_by', px, py, pz, { volume: 0.9 * (1 - miss / 2.6), refDistance: 1, soundDelay: false });
      }
    }
  }

  /**
   * The inventory check out loud: the vääpeli's whistle when it starts and again as its last
   * seconds begin, and a tick for each of them.
   */
  private inventoryCue(left: number): void {
    const s = Math.ceil(left);
    if (s === this.inventorySec) return;
    const audio = this.game.deps.audio;
    if (s > 0 && (this.inventorySec === 0 || s === INVENTORY_URGENT)) audio.play('whistle', { bus: 'ui', volume: 1 });
    else if (s > 0 && s < INVENTORY_URGENT) audio.play('ui_click', { bus: 'ui', volume: 1, rate: 0.7, exactRate: true });
    this.inventorySec = s;
  }

  private die(killer: number, weapon: KillWeapon): void {
    const g = this.game;
    this.alive = false;
    this.hp = 0;
    this.death = { x: g.eye.x, y: g.eye.y, z: g.eye.z, floor: g.move.y, yaw: g.yaw, pitch: g.pitch, t: 0, killer, weapon };
    this.respawnAt = performance.now() + TUNING.player.respawnTime * 1000;
    g.deps.audio.play('player_death', { bus: 'ui', volume: 0.8 });
  }

  step(): void {
    this.stepCount++;
    // Movement goes out at 60 Hz (every other simulation step).
    if (this.stepCount % 2 === 0 && this.alive && this.joined) this.sendState();
    const now = performance.now();
    while (this.pendingShots.length && now - this.pendingShots[0]!.at > 3000) this.pendingShots.shift();
    while (this.claims.length && now - this.claims[0]!.at > 1000) this.claims.shift();
  }

  private sendState(): void {
    const g = this.game;
    const m = g.move;
    const w = g.weapons;
    let flags = PF.ALIVE;
    if (m.crouched) flags |= PF.CROUCH;
    if (m.sprinting) flags |= PF.SPRINT;
    if (w.ads > 0.5) flags |= PF.ADS;
    if (m.onGround) flags |= PF.GROUND;
    if (w.state === 'inspecting') flags |= PF.INSPECT;
    if (w.grenadeBusy) flags |= PF.THROW;
    if (w.state === 'stabbing') flags |= PF.MELEE;
    this.net.sendBinary(
      encodeState({
        seq: ++this.stateSeq,
        time: this.net.serverNow(),
        x: m.x,
        y: m.y,
        z: m.z,
        vx: m.vx,
        vy: m.vy,
        vz: m.vz,
        yaw: g.yaw,
        pitch: g.pitch,
        flags,
        weapon: WEAPON_IDS.indexOf(w.current),
      }),
    );
  }

  shot(weapon: WeaponId, eye: THREE.Vector3, dir: Vec3, tr: TraceResult): boolean {
    const g = this.game;
    const { audio, hud } = g.deps;
    const wallDist = tr.fraction * TUNING[weapon].range;
    const hit = this.remotes.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, wallDist);
    const seq = ++this.fireSeq;
    let claim: ShotClaim | undefined;
    if (hit) claim = { p: hit.id, z: hit.zone, at: [eye.x + dir.x * hit.t, eye.y + dir.y * hit.t, eye.z + dir.z * hit.t] };
    this.net.send({ t: 'fire', seq, w: weapon, rt: this.remotes.clock.renderTime, o: [eye.x, eye.y, eye.z], d: [dir.x, dir.y, dir.z], hit: claim });
    this.pendingShots.push({ seq, w: weapon, at: performance.now() });
    if (!hit || !claim) return false;
    // Predicted feedback: blood and hit marker now; the kill marker waits for the server.
    const [hx, hy, hz] = claim.at;
    g.effects.hitPuff(hx, hy, hz, -dir.x, -dir.y, -dir.z, true);
    audio.playAt('impact_flesh', hx, hy, hz, { volume: 0.7, refDistance: 3 });
    hud.hitMarker(hit.zone === 'head' ? 'head' : 'body');
    audio.play(hit.zone === 'head' ? 'hit_head' : 'hit_body', { bus: 'ui', volume: 0.7, delay: 0.01 });
    this.claims.push({ victim: hit.id, at: performance.now() });
    return true;
  }

  grenadePinned(): void {
    this.net.send({ t: 'pin' });
  }

  private meleeTr = new TraceResult();

  /** The knife lands: the nearest player drawn within reach, with no wall in between (the server checks again). */
  melee(eye: THREE.Vector3, dir: Vec3): void {
    const g = this.game;
    const { audio, hud } = g.deps;
    const o: [number, number, number] = [eye.x, eye.y, eye.z];
    const d: [number, number, number] = [dir.x, dir.y, dir.z];
    const tr = this.meleeTr;
    const inSight = [...this.remotes.bodies()].filter((b) => {
      const cy = b.y + (b.crouched ? 0.6 : 1.0);
      g.world.trace(tr, eye.x, eye.y, eye.z, b.x, cy, b.z, 0, 0, 0, MASK.SHOT);
      return tr.fraction >= 1 || tr.fraction * Math.hypot(b.x - eye.x, cy - eye.y, b.z - eye.z) > Math.hypot(b.x - eye.x, cy - eye.y, b.z - eye.z) - 0.45;
    });
    const t = meleeTarget(o, d, inSight);
    this.net.send({ t: 'melee', rt: this.remotes.clock.renderTime, o, d, hit: t?.id });
    if (!t) return;
    // Predicted feedback, as for a shot: blood, the blade going in and a hit marker.
    const hy = t.y + (t.crouched ? 0.7 : 1.15);
    g.effects.hitPuff(t.x, hy, t.z, -dir.x, -dir.y, -dir.z, true);
    audio.playAt('impact_flesh', t.x, hy, t.z, { volume: 0.95, refDistance: 3 });
    hud.hitMarker('body');
    audio.play('hit_body', { bus: 'ui', volume: 0.7, delay: 0.01 });
  }

  grenadeReleased(o: [number, number, number], v: [number, number, number], fuse: number): void {
    this.net.send({ t: 'grenade', o, v });
    this.ownGrenades.push(this.game.grenades.spawn(o[0], o[1], o[2], v, fuse, this.myId));
  }

  outOfAmmo(): string {
    return (this.pairInfo?.phone ?? 'none') === 'none' ? withKeys(UI.hud.outOfAmmoNoPhone) : UI.hud.outOfAmmo;
  }

  reload(): void {
    this.net.send({ t: 'reload' });
  }

  render(dt: number): void {
    const g = this.game;
    const now = performance.now();
    const serverNow = this.net.serverNow();
    this.remotes.update(dt, now, g.eye);

    // Death camera: drop to the floor with a tilt, turning towards the killer.
    const d = this.death;
    if (d) {
      d.t += dt;
      const k = Math.min(1, d.t / 0.7);
      const e = 1 - (1 - k) ** 3;
      if (d.killer !== this.myId && d.killer !== 0) {
        const p = this.remotes.eyeOf(d.killer, this.v);
        if (p) d.yaw += wrapAngle(Math.atan2(-(p.x - d.x), -(p.z - d.z)) - d.yaw) * Math.min(1, dt * 2.2);
      }
      const floor = d.floor + 0.35;
      g.camOverride = { x: d.x, y: d.y + (floor - d.y) * e, z: d.z, yaw: d.yaw, pitch: d.pitch * (1 - e) - 0.15 * e, roll: 0.42 * e };
      const self = d.killer === this.myId || d.killer === 0;
      const title = self ? (d.weapon === 'grenade' ? UI.hud.killedSelf : UI.hud.died) : fill(UI.hud.killedBy, { name: this.name(d.killer) });
      const left = Math.max(0, (this.respawnAt - now) / 1000);
      const sub = this.round?.state === 'ended' ? UI.hud.waitRound : fill(UI.hud.respawnIn, { s: left.toFixed(1) });
      this.hud.showDeath(title, sub);
    } else {
      this.hud.hideDeath();
      if (!this.alive) g.camOverride = null;
    }

    this.hud.health(this.alive ? this.hp : 0);
    this.hud.score(this.players.get(this.myId)?.kills ?? 0);
    this.hud.phone(this.pairInfo?.phone ?? 'none', this.phoneOut, this.pairInfo?.virtual ?? false);
    this.hud.spawnProtect(this.alive && this.protected);
    this.hud.roundTimer(this.round, serverNow);
    const inventoryLeft = this.inventoryUntil > 0 ? Math.max(0, (this.inventoryUntil - serverNow) / 1000) : 0;
    this.inventoryCue(inventoryLeft);
    this.hud.phoneBar(inventoryLeft, this.unreadFrom);
    const showBoard = g.deps.input.keys.has('Tab') || this.round?.state === 'ended';
    this.hud.scoreboard(showBoard, [...this.players.values()], this.myId, this.round, serverNow, this.awards, this.evening);
    this.hud.update(dt, g.eye.x, g.eye.z, g.yaw);
    const s = g.deps.settings;
    // The Sotku's gear on the minimap: a longer reach (Tutka), phones in enemy hands, the drone.
    const u = g.weapons.upgrades;
    this.hud.minimap.setGear(u.tutka ? GEAR.radarRange : MINIMAP.range, MINIMAP.shotShow * (u.tutka ? GEAR.radarShotMul : 1));
    const drone = serverNow < this.droneUntil;
    const marks: MinimapMark[] = [];
    // Team mode: our partner, always.
    for (const rp of this.remotes.players.values()) {
      if (rp.mate && rp.present && rp.alive) marks.push({ x: rp.s.x, z: rp.s.z, kind: 'mate', color: accentOf(rp.info) });
    }
    if (drone || u.kannykka) {
      for (const rp of this.remotes.players.values()) {
        if (!rp.present || !rp.alive || rp.mate || rp.info.id === this.myId) continue;
        const phone = (rp.s.flags & PF.PHONE) !== 0 && !rp.info.upgrades?.tumma;
        if (drone) marks.push({ x: rp.s.x, z: rp.s.z, kind: 'drone' });
        else if (phone) marks.push({ x: rp.s.x, z: rp.s.z, kind: 'phone' });
      }
    }
    this.hud.minimap.draw(dt, g.eye.x, g.eye.z, g.yaw, s.fov, this.gate, s.minimap, marks);
    // Mortar rounds whistle down for the last second and a half.
    for (const m of this.mortars) {
      if (m.whistled || serverNow < m.at - 1500) continue;
      m.whistled = true;
      g.deps.audio.playAt('mortar_whistle', m.x, m.y + 6, m.z, { volume: 0.9, refDistance: 10, rolloff: 0.8, maxDistance: 250 });
    }
    this.mortars = this.mortars.filter((m) => serverNow < m.at + 500);
    this.hud.netStatus(this.net.stats.connected ? '' : UI.menu.reconnecting);
  }

  dispose(): void {
    this.remotes.dispose();
    this.game.root.remove(this.remotes.group);
  }
}
