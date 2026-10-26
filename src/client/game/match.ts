import * as THREE from 'three';
import { MASK } from '../../shared/collision/brush';
import type { TraceResult } from '../../shared/collision/world';
import { TUNING, type WeaponId } from '../../shared/config';
import { wrapAngle, type Vec3 } from '../../shared/math';
import {
  PF,
  PROTOCOL_VERSION,
  WEAPON_IDS,
  encodeState,
  type ClientMsg,
  type GameEvent,
  type PlayerInfo,
  type RoundInfo,
  type ServerMsg,
  type ShotClaim,
  type Snapshot,
} from '../../shared/protocol';
import { UI } from '../../shared/ui';
import type { Net } from '../net';
import type { MatchHud } from '../ui/matchHud';
import type { Game, GameMode } from './game';
import { Remotes } from './remotes';

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
  weapon: WeaponId | 'grenade';
}

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
  joined = false;
  players = new Map<number, PlayerInfo>();
  round: RoundInfo | null = null;
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
    private identity: { name: string; token?: string },
  ) {
    this.remotes = new Remotes(game.world, game.deps.audio, () => this.myId);
    game.root.add(this.remotes.group);
    game.grenades.serverFuse = true;
    game.keepRunning = true;
    game.devDirectReload = false;
    this.setGate(false);
  }

  get firing(): boolean {
    return this.round?.state !== 'ended';
  }

  /** Joins (or rejoins with the token) over the current connection. */
  hello(): void {
    this.net.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.identity.name, token: this.identity.token });
  }

  /** The connection dropped: we are out until the server welcomes us again. */
  connectionLost(): void {
    this.joined = false;
    this.alive = false;
  }

  leave(): void {
    this.net.send({ t: 'leave' });
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
        break;
      case 'players':
        this.setPlayers(msg.players);
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
      if (this.alive) this.hp = me.hp;
    }
  }

  private setPlayers(list: PlayerInfo[]): void {
    this.players = new Map(list.map((p) => [p.id, p]));
    this.remotes.syncPlayers(list);
  }

  private setRound(r: RoundInfo): void {
    const prev = this.round;
    this.round = r;
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
    switch (e.k) {
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
        this.hud.kill(e.a === e.v ? undefined : killer, victim, weapon, e.head, this.myId);
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
          g.weapons.resetLife(e.weapons, e.ammo);
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
        break;
      }
      case 'reload':
        g.weapons.serverReload(e.w, e.empty, e.dur);
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
        g.explosionFx(e.x, e.y, e.z);
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
        g.setSerials({ pistol: e.pistol, rifle: e.rifle });
        break;
      case 'note':
        hud.note(e.text, 3);
        break;
    }
  }

  /** Muzzle flash, tracer, gunshot, impact and near-miss crack of someone else's shot. */
  private remoteShot(e: Extract<GameEvent, { k: 'shot' }>): void {
    const g = this.game;
    const audio = g.deps.audio;
    const m = this.remotes.muzzle(e.p, this.v) ?? this.v.set(e.o[0], e.o[1], e.o[2]);
    this.remotes.players.get(e.p)?.char.muzzleFlash();
    g.effects.tracer(m.x, m.y, m.z, e.e[0], e.e[1], e.e[2]);
    const dist = m.distanceTo(g.eye);
    if (dist < FAR_SHOT) {
      audio.playAt(`${e.w}_shot`, m.x, m.y, m.z, { volume: 0.95, refDistance: 5, rolloff: 1, maxDistance: 300, gunshot: true });
      if (dist < 18) audio.playAt(`${e.w}_tail`, m.x, m.y, m.z, { volume: 0.35, refDistance: 6, rolloff: 1 });
    } else {
      audio.playAt(`${e.w}_far`, m.x, m.y, m.z, { volume: 0.9, refDistance: 28, rolloff: 0.6, maxDistance: 600, gunshot: true });
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

  private die(killer: number, weapon: WeaponId | 'grenade'): void {
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
    if (w.state === 'throwing') flags |= PF.THROW;
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

  grenadeReleased(o: [number, number, number], v: [number, number, number]): void {
    this.net.send({ t: 'grenade', o, v });
    this.ownGrenades.push(this.game.grenades.spawn(o[0], o[1], o[2], v, TUNING.grenade.fuse, this.myId));
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
    this.hud.spawnProtect(this.alive && this.protected);
    this.hud.roundTimer(this.round, serverNow);
    const showBoard = g.deps.input.keys.has('Tab') || this.round?.state === 'ended';
    this.hud.scoreboard(showBoard, [...this.players.values()], this.myId, this.round, serverNow);
    this.hud.update(dt, g.eye.x, g.eye.z, g.yaw);
    this.hud.netStatus(this.net.stats.connected ? '' : UI.menu.reconnecting);
  }

  dispose(): void {
    this.remotes.dispose();
    this.game.root.remove(this.remotes.group);
  }
}
