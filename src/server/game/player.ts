import type { WebSocket } from 'ws';
import { TUNING, type WeaponId } from '../../shared/config';
import { PositionHistory } from '../../shared/history';
import type { GameEvent, PlayerInfo, PhoneStatus } from '../../shared/protocol';
import { Phone } from './phone';
import { Ladder } from './ladder';
import { maxGrenades, weaponStats } from '../../shared/upgrades';

export interface Reload {
  w: WeaponId;
  start: number;
  refillAt: number;
  end: number;
  refilled: boolean;
}

/** Everything the server knows about one player (human or bot). */
export class ServerPlayer {
  ws: WebSocket | null = null;
  connected = true;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  /** PF flags reported by the client (crouch, sprint, ADS, ...). */
  flags = 0;
  weapon: WeaponId = 'pistol';
  alive = false;
  hp: number = TUNING.player.health;
  lastDamageAt = -1e9;
  respawnAt = 0;
  protectedUntil = 0;
  owned: WeaponId[] = ['pistol'];
  ammo: Record<WeaponId, number> = { pistol: TUNING.pistol.magazine, rifle: TUNING.rifle.magazine };
  lastShotAt: Record<WeaponId, number> = { pistol: -1e9, rifle: -1e9 };
  reload: Reload | null = null;
  grenades = 0;
  maxGrenades = 1;
  lastGrenadeAt = -1e9;
  kills = 0;
  deaths = 0;
  serials: Record<WeaponId, string> = { pistol: '000000', rifle: '000000' };
  readonly history = new PositionHistory();
  lastStateAt = 0;
  /** When the position was true: the client's send time (server clock), or the tick for bots. */
  stateTime = 0;
  /** Events only this player should receive, sent at the end of the tick. */
  outbox: GameEvent[] = [];
  leftAt = 0;
  /** Connected from the server machine itself: allowed to use dev commands. */
  isHost = false;
  /** Round-trip time reported by the client (ms). */
  rtt = 0;
  /** Sequence number of the last fire message received. */
  lastFireSeq = 0;
  readonly phone = new Phone();
  readonly ladder = new Ladder();
  /** Increases with every respawn; phone requests from an earlier life have no effect. */
  life = 0;
  /** Index into FI.ranks: alokas (0) to vääpeli (6). */
  rank = 0;
  /** Counters for the end-of-round awards. */
  stats = { pushups: 0, reloads: 0, typos: 0, deathsTyping: 0, longestDraft: '', phoneMs: 0 };

  constructor(
    readonly id: number,
    readonly token: string,
    public name: string,
    readonly color: number,
    readonly bot: boolean,
  ) {}

  get crouched(): boolean {
    return (this.flags & 2) !== 0;
  }

  eyeY(): number {
    return this.y + (this.crouched ? TUNING.move.crouchEye : TUNING.move.standEye);
  }

  info(): PlayerInfo {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      bot: this.bot,
      kills: this.kills,
      deaths: this.deaths,
      connected: this.connected,
      ping: Math.round(this.rtt),
      phone: this.phone.status(),
      rank: this.rank,
      upgrades: { ...this.ladder.upgrades },
    };
  }

  /** Magazine size and fire rate with this player's upgrades. */
  gun(w: WeaponId) {
    return weaponStats(w, this.ladder.upgrades);
  }

  phoneStatus(round: number): PhoneStatus {
    const l = this.ladder;
    return {
      name: this.name,
      alive: this.alive,
      life: this.life,
      round,
      grenades: this.grenades,
      maxGrenades: this.maxGrenades,
      rank: this.rank,
      tj: l.tj,
      challenge: !!l.open,
      queued: l.queued,
      desktop: this.connected,
    };
  }

  send(msg: object): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.send(buf);
  }

  newSerials(): void {
    for (const w of ['pistol', 'rifle'] as WeaponId[]) this.serials[w] = String(100000 + Math.floor(Math.random() * 900000));
  }

  /** Fresh life: full magazines in every owned weapon, no grenades, no reload in progress. */
  resetLife(): void {
    this.hp = TUNING.player.health;
    for (const w of this.owned) this.ammo[w] = this.gun(w).magazine;
    this.maxGrenades = maxGrenades(this.ladder.upgrades);
    this.reload = null;
    this.grenades = 0;
    this.lastDamageAt = -1e9;
  }
}
