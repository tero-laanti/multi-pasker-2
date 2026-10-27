import type { WeaponId } from './config';
import type { HitZone } from './hitbox';
import type { UpgradeId, Upgrades } from './upgrades';

/**
 * Network protocol. The two high-rate messages (client movement state, server snapshots) are
 * binary; everything else is JSON. Times are server milliseconds since the server started.
 */

export const PROTOCOL_VERSION = 2;

export const BIN = { STATE: 1, SNAPSHOT: 2 } as const;

/** Player flags shared by client state and snapshots. */
export const PF = {
  ALIVE: 1,
  CROUCH: 2,
  SPRINT: 4,
  ADS: 8,
  GROUND: 16,
  RELOAD: 32,
  PROTECTED: 64,
  PHONE: 128,
  INSPECT: 256,
  THROW: 512,
  BOT: 1024,
} as const;

export const WEAPON_IDS: WeaponId[] = ['pistol', 'rifle'];

export interface ClientState {
  seq: number;
  /** Client's estimate of the current server time (ms). */
  time: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
}

export interface PlayerSnap {
  id: number;
  flags: number;
  /** How old the position is (ms before the snapshot time): when that client sent it. */
  age: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  weapon: number;
  hp: number;
}

export interface Snapshot {
  time: number;
  players: PlayerSnap[];
}

const YAW_Q = 32767 / Math.PI;
const PITCH_Q = 32767 / (Math.PI / 2);

function wrap(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

const qYaw = (a: number) => Math.round(wrap(a) * YAW_Q);
const qPitch = (a: number) => Math.round(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, a)) * PITCH_Q);

export function encodeState(s: ClientState): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 2 + 4 + 24 + 4 + 2 + 1);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, BIN.STATE);
  o += 1;
  v.setUint16(o, s.seq & 0xffff);
  o += 2;
  v.setUint32(o, Math.max(0, Math.round(s.time)) >>> 0);
  o += 4;
  for (const n of [s.x, s.y, s.z, s.vx, s.vy, s.vz]) {
    v.setFloat32(o, n);
    o += 4;
  }
  v.setInt16(o, qYaw(s.yaw));
  o += 2;
  v.setInt16(o, qPitch(s.pitch));
  o += 2;
  v.setUint16(o, s.flags);
  o += 2;
  v.setUint8(o, s.weapon);
  return buf;
}

export function decodeState(buf: ArrayBuffer | DataView): ClientState | null {
  const v = buf instanceof DataView ? buf : new DataView(buf);
  if (v.byteLength < 38 || v.getUint8(0) !== BIN.STATE) return null;
  let o = 1;
  const seq = v.getUint16(o);
  o += 2;
  const time = v.getUint32(o);
  o += 4;
  const f: number[] = [];
  for (let i = 0; i < 6; i++) {
    f.push(v.getFloat32(o));
    o += 4;
  }
  const yaw = v.getInt16(o) / YAW_Q;
  o += 2;
  const pitch = v.getInt16(o) / PITCH_Q;
  o += 2;
  const flags = v.getUint16(o);
  o += 2;
  const weapon = v.getUint8(o);
  if (f.some((n) => !Number.isFinite(n))) return null;
  return { seq, time, x: f[0]!, y: f[1]!, z: f[2]!, vx: f[3]!, vy: f[4]!, vz: f[5]!, yaw, pitch, flags, weapon };
}

const SNAP_PLAYER = 1 + 2 + 12 + 4 + 1 + 1 + 1;

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 4 + 1 + s.players.length * SNAP_PLAYER);
  const v = new DataView(buf);
  v.setUint8(0, BIN.SNAPSHOT);
  v.setUint32(1, Math.max(0, Math.round(s.time)) >>> 0);
  v.setUint8(5, s.players.length);
  let o = 6;
  for (const p of s.players) {
    v.setUint8(o, p.id);
    v.setUint16(o + 1, p.flags);
    v.setFloat32(o + 3, p.x);
    v.setFloat32(o + 7, p.y);
    v.setFloat32(o + 11, p.z);
    v.setInt16(o + 15, qYaw(p.yaw));
    v.setInt16(o + 17, qPitch(p.pitch));
    v.setUint8(o + 19, p.weapon);
    v.setUint8(o + 20, Math.max(0, Math.min(255, Math.round(p.hp))));
    v.setUint8(o + 21, Math.max(0, Math.min(255, Math.round(p.age))));
    o += SNAP_PLAYER;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer | DataView): Snapshot | null {
  const v = buf instanceof DataView ? buf : new DataView(buf);
  if (v.byteLength < 6 || v.getUint8(0) !== BIN.SNAPSHOT) return null;
  const time = v.getUint32(1);
  const n = v.getUint8(5);
  if (v.byteLength < 6 + n * SNAP_PLAYER) return null;
  const players: PlayerSnap[] = [];
  let o = 6;
  for (let i = 0; i < n; i++) {
    players.push({
      id: v.getUint8(o),
      flags: v.getUint16(o + 1),
      x: v.getFloat32(o + 3),
      y: v.getFloat32(o + 7),
      z: v.getFloat32(o + 11),
      yaw: v.getInt16(o + 15) / YAW_Q,
      pitch: v.getInt16(o + 17) / PITCH_Q,
      weapon: v.getUint8(o + 19),
      hp: v.getUint8(o + 20),
      age: v.getUint8(o + 21),
    });
    o += SNAP_PLAYER;
  }
  return { time, players };
}

// ---- JSON messages ----

export interface PlayerInfo {
  id: number;
  name: string;
  /** Accent colour index into the palette. */
  color: number;
  bot: boolean;
  kills: number;
  deaths: number;
  connected: boolean;
  /** Round-trip time the player's client measured (ms). */
  ping: number;
  /** Their phone: never paired, connected, or paired but disconnected. */
  phone: 'none' | 'online' | 'offline';
  /** Ladder stages completed: rank index (alokas 0 … vääpeli 6). */
  rank: number;
  /** Upgrade levels: everyone needs them (suppressors, drum magazines, dark mode). */
  upgrades: Upgrades;
  /** Still on the shooting range (the tutorial), not in the match yet. */
  training: boolean;
}

export interface ShotClaim {
  /** Player id that the shooter's client saw being hit. */
  p: number;
  z: HitZone;
  /** Hit point in world space. */
  at: [number, number, number];
}

export type ClientMsg =
  /** `train`: start on the shooting range (the tutorial) instead of in the match. */
  | { t: 'hello'; v: number; token?: string; name: string; train?: boolean }
  | { t: 'ping'; id: number; rtt?: number }
  | { t: 'leave' }
  /** Off the range and into the match. */
  | { t: 'deploy' }
  /** The tutorial's phone was picked up: Asevarasto sends the radio check once a phone is paired. */
  | { t: 'radioCheck' }
  | { t: 'fire'; seq: number; w: WeaponId; rt: number; o: [number, number, number]; d: [number, number, number]; hit?: ShotClaim; wall?: [number, number, number, number, number, number, number] }
  | { t: 'reload' }
  | { t: 'switch'; w: WeaponId }
  /** G pressed: the pin is out and the fuse is burning (the throw comes with 'grenade'). */
  | { t: 'pin' }
  | { t: 'grenade'; o: [number, number, number]; v: [number, number, number] }
  | { t: 'dev'; cmd: string; arg?: unknown };

export type ServerMsg =
  /** `host`: this client may use dev commands (a dev server, or a browser on the server machine). */
  | { t: 'welcome'; id: number; token: string; map: string; players: PlayerInfo[]; round: RoundInfo; serverTime: number; snapshotHz: number; dev: boolean; host: boolean; training: boolean }
  | { t: 'pong'; id: number; st: number }
  | { t: 'stats'; tickMs: number; tickMaxMs: number; tickHz: number }
  | { t: 'players'; players: PlayerInfo[] }
  /** `st`: server time the events happened. */
  | { t: 'events'; e: GameEvent[]; st: number }
  /** The evening scoreboard (after each round, and on joining). */
  | { t: 'evening'; rows: EveningRow[] }
  /** How to pair a phone to this player: QR link and the short code for typing in. */
  | { t: 'pairInfo'; url: string; token: string; code: string; phone: 'none' | 'online' | 'offline'; virtual: boolean };

export interface RoundInfo {
  /** Round number this evening. */
  n: number;
  state: 'playing' | 'ended';
  /** Server time the current phase ends. */
  endsAt: number;
  gateOpen: boolean;
}

export type GameEvent =
  | { k: 'shot'; p: number; w: WeaponId; o: [number, number, number]; e: [number, number, number]; n?: [number, number, number]; s?: number; hp?: number }
  | { k: 'hit'; a: number; v: number; dmg: number; hp: number; z: HitZone; from: [number, number, number] }
  | { k: 'kill'; a: number; v: number; w: WeaponId | 'grenade'; head: boolean; draft?: string }
  | { k: 'spawn'; p: number; x: number; y: number; z: number; yaw: number; ammo: Record<WeaponId, number>; reserve: Record<WeaponId, number>; weapons: WeaponId[] }
  /** Authoritative magazine count after the shooter's fire message `seq` (if any). */
  /** `n`: rounds in the magazine, `r`: spare rounds. */
  | { k: 'ammo'; w: WeaponId; n: number; r: number; seq?: number }
  /** `full`: the armourer's reload (magazine and spare filled), else one from the spare. */
  | { k: 'reload'; w: WeaponId; empty: boolean; dur: number; full: boolean }
  | { k: 'grenades'; n: number; max: number }
  | { k: 'nade'; id: number; p: number; o: [number, number, number]; v: [number, number, number]; fuse: number }
  | { k: 'boom'; id: number; x: number; y: number; z: number }
  | { k: 'join'; p: number; name: string }
  | { k: 'leave'; p: number; name: string }
  | { k: 'round'; round: RoundInfo }
  | { k: 'give'; w: WeaponId }
  | { k: 'serials'; pistol: string; rifle: string }
  | { k: 'note'; text: string }
  /** A phone message that wasn't valid where it was sent, with the reply: shown to everyone. */
  | { k: 'typo'; p: number; to: string; text: string; reply: string }
  /** Our phone was paired (`replaced`: it took over from another phone). */
  | { k: 'paired'; replaced: boolean }
  /** Our upgrades changed (`id`: the one just taken, for the HUD). */
  | { k: 'upgrades'; u: Upgrades; id?: UpgradeId }
  /** Our place on the TJ ladder, for the HUD. */
  | { k: 'ladder'; rank: number; tj: number; open: boolean; queued: number; choice: boolean }
  /** End of round: the awards. */
  | { k: 'awards'; list: AwardInfo[] }
  /** A message arrived on this player's phone: anyone close by hears it chirp. */
  | { k: 'chirp'; p: number }
  /** On the range: the radio check answered (YK), or a LATAA / KRANAATTI for the range's guns. */
  | { k: 'training'; what: 'radioCheck' | 'ammo' | 'grenade' }
  /** On the range (no snapshots of ourselves there): a chat opened or closed on our phone. */
  | { k: 'phoneOut'; on: boolean }
  /** The armourer's inventory check: answer by this server time (0: over). */
  | { k: 'inventory'; until: number };

export type AwardId = 'winner' | 'deathsTyping' | 'longestDraft' | 'typos' | 'phoneTime' | 'pushups' | 'swedish';

export interface AwardInfo {
  id: AwardId;
  /** Finnish name of the award. */
  name: string;
  player: number;
  playerName: string;
  /** What won it: a count, seconds, or the unsent draft. */
  value: string;
}

/** One line of the evening scoreboard: totals over tonight's rounds. */
export interface EveningRow {
  name: string;
  rounds: number;
  wins: number;
  kills: number;
  deaths: number;
  awards: number;
  /** Rounds in which they reached TJ 0. */
  tj0: number;
}

/** Accent colours for name tags and caps: 8 strong hues, also told apart by the name tag. */
export const ACCENTS = [0xe8b21c, 0xd8453a, 0x3b8fe0, 0x2fb36a, 0xb259d6, 0xf08a2c, 0x29b8b8, 0xe05a9a];

/** Player names: letters (incl. Å, Ä, Ö) and digits, 1..12 characters. */
export function cleanName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[^A-Za-z0-9ÅÄÖåäö]/g, '')
    .slice(0, 12);
}

// ---- Phone ----

export type MsgState = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface PhoneMessage {
  /** Outgoing: the phone's request id; incoming: the server's id. */
  id: string;
  from: 'me' | 'them' | 'system';
  text?: string;
  /** A voice note the phone plays through an <audio> element. */
  voice?: { url: string; duration: number };
  /** Wall-clock time (ms since 1970) for the time stamp. */
  at: number;
  state?: MsgState;
}

export interface PhoneConversation {
  /** The number; also the conversation's id. */
  id: string;
  name: string;
  messages: PhoneMessage[];
  unread: number;
}

/** What the phone needs to know about its player's game state. */
export interface PhoneStatus {
  name: string;
  alive: boolean;
  /** Increases with every respawn; requests from an earlier life have no effect. */
  life: number;
  round: number;
  grenades: number;
  maxGrenades: number;
  rank: number;
  /** Days left (stages to go) on the TJ ladder. */
  tj: number;
  /** A ladder task is open, and how many more wait behind it. */
  challenge: boolean;
  queued: number;
  /** The desktop is connected. */
  desktop: boolean;
}

/** The upgrade screen: three choices with their exact benefit. */
export interface UpgradeOffer {
  title: string;
  options: { id: UpgradeId; name: string; level: number; benefit: string }[];
}

export type PhoneClientMsg =
  /** `virtual`: the phone app on the player's own screen, typed on with the mouse only. */
  | { t: 'phoneHello'; v: number; pair?: string; code?: string; token?: string; sim?: boolean; virtual?: boolean }
  | { t: 'send'; rid: string; conv: string; text: string; life: number; round: number }
  | { t: 'open'; conv: string }
  | { t: 'read'; conv: string }
  | { t: 'draft'; conv: string; text: string }
  | { t: 'touch' }
  /** Picked an upgrade on the upgrade screen. */
  | { t: 'choose'; rid: string; id: UpgradeId }
  /** A chat (or the new-chat number pad) is open: the phone is in the player's hand. */
  | { t: 'out'; on: boolean }
  | { t: 'ping'; id: number; rtt?: number };

export type PhoneServerMsg =
  | {
      t: 'phoneWelcome';
      token: string;
      player: { id: number; name: string; color: number };
      convs: PhoneConversation[];
      status: PhoneStatus;
      dev: boolean;
      replaced: boolean;
      /** An upgrade screen still waiting for a choice. */
      upgrade: UpgradeOffer | null;
    }
  | { t: 'upgrade'; offer: UpgradeOffer | null }
  | { t: 'pairFailed'; reason: 'code' | 'version' | 'sim' | 'token' }
  | { t: 'msg'; conv: string; m: PhoneMessage }
  | { t: 'state'; conv: string; id: string; state: MsgState }
  | { t: 'typing'; conv: string; on: boolean }
  | { t: 'conv'; c: PhoneConversation }
  | { t: 'status'; s: PhoneStatus }
  | { t: 'replaced' }
  | { t: 'pong'; id: number; st: number }
  /** An inventory check: seconds left to answer (0: answered or over). */
  | { t: 'inventory'; left: number };
