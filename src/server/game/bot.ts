import { MASK } from '../../shared/collision/brush';
import { TraceResult } from '../../shared/collision/world';
import { TUNING, type WeaponId } from '../../shared/config';
import { FI } from '../../shared/fi';
import { rayPlayer } from '../../shared/hitbox';
import { DEG, clamp, wrapAngle } from '../../shared/math';
import { Mover, emptyCmd, newMoveState, type MoveState } from '../../shared/movement';
import { findPath, nearestNode } from '../../shared/nav';
import { PF } from '../../shared/protocol';
import type { ServerPlayer } from './player';
import type { Room } from './room';

/** Bot skill: reaction time, aim error and turn speed. 0.5 is a casual player. */
export const BOT_SKILL = 0.5;

const ASEVARASTO = FI.varusmestari.number;
/** What bots type when they want more ammo: mostly right, sometimes not. */
const RELOAD_TEXTS = ['Lataa', 'lataa', 'LATAA', 'Lataa!', 'lataa', 'Lataa', 'lataaa', 'ltaa', 'lata', 'lataa nyt', 'laataa'];

/** A thumb slip: one letter dropped or doubled. */
function slip(code: string): string {
  const i = Math.floor(Math.random() * code.length);
  return Math.random() < 0.5 ? code.slice(0, i) + code.slice(i + 1) : code.slice(0, i) + code[i] + code.slice(i);
}

/**
 * A server-side player that walks the nav graph, notices enemies in its field of view,
 * turns and aims with human-like error and fires through the same validation as humans.
 */
export class Bot {
  readonly move: MoveState;
  private mover: Mover;
  private tr = new TraceResult();
  private path: number[] = [];
  private pathIdx = 0;
  private target: ServerPlayer | null = null;
  private seenSince = 0;
  private lastSeen = -1e9;
  private lastSeenPos = { x: 0, y: 0, z: 0 };
  private perceiveAt = 0;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private strafeDir = 1;
  private strafeUntil = 0;
  private crouchUntil = 0;
  private nextShotAt = 0;
  private burst = 0;
  private stuckCheckAt = 0;
  private stuckPos = { x: 0, z: 0 };
  private jumpUntil = 0;
  private wasAlive = false;
  private lastHurtBy = 0;
  /** Texting: the phone is out and the draft grows letter by letter. */
  private typing: { text: string; shown: number; nextAt: number; conv: string } | null = null;
  private phoneDownAt = 0;
  private retypeAt = 0;
  /** TJ ladder: when to answer the open task, and when to pick an upgrade. */
  private task: object | null = null;
  private taskAt = 0;
  private choiceAt = 0;
  /** When the bot answers the pending inventory check, and reports its push-ups. */
  private countAt = 0;
  private unlockAt = 0;

  constructor(
    readonly p: ServerPlayer,
    private room: Room,
  ) {
    this.mover = new Mover(room.world);
    this.move = newMoveState(p.x, p.y, p.z);
  }

  /** Called by the room when this bot is damaged, so it turns towards the attacker. */
  hurtBy(attacker: number): void {
    this.lastHurtBy = attacker;
  }

  update(dt: number, now: number): void {
    const p = this.p;
    if (!p.alive) {
      this.wasAlive = false;
      this.typing = null;
      p.phone.out = false;
      p.phone.draft = null;
      return;
    }
    if (!this.wasAlive) {
      // Fresh spawn: take the server's position.
      Object.assign(this.move, newMoveState(p.x, p.y, p.z));
      this.path = [];
      this.target = null;
      this.wasAlive = true;
    }
    const skill = BOT_SKILL;
    if (now >= this.perceiveAt) {
      this.perceiveAt = now + 120 + Math.random() * 80;
      this.perceive(now);
    }

    const cmd = emptyCmd();
    cmd.speedMul = TUNING[p.weapon].moveSpeedMul;
    let wantYaw = p.yaw;
    let wantPitch = 0;
    const eyeY = p.eyeY();
    const t = this.target;
    if (t && t.alive && now - this.lastSeen < 1500) {
      // Combat: face the target, strafe, fire when the aim settles.
      const aim = this.aimPoint(t);
      const dx = aim.x - p.x;
      const dy = aim.y - eyeY;
      const dz = aim.z - p.z;
      const flat = Math.hypot(dx, dz);
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, flat);
      if (now > this.strafeUntil) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = now + 500 + Math.random() * 900;
        if (Math.random() < 0.15) this.crouchUntil = now + 800 + Math.random() * 1000;
      }
      cmd.right = this.strafeDir;
      cmd.forward = flat > 22 ? 0.6 : flat < 6 ? -0.4 : 0;
      cmd.crouch = now < this.crouchUntil;
      cmd.ads = flat > 12;
      this.fire(now, flat, skill);
    } else {
      this.target = null;
      this.followPath(now, cmd);
      wantYaw = this.pathYaw(wantYaw);
      cmd.sprint = this.path.length - this.pathIdx > 1;
    }

    // Turn with limited speed; aim error shrinks while tracking.
    const turn = (220 + skill * 200) * DEG * dt;
    p.yaw = wrapAngle(p.yaw + clamp(wrapAngle(wantYaw + this.aimErrYaw - p.yaw), -turn, turn));
    p.pitch = clamp(p.pitch + clamp(wantPitch + this.aimErrPitch - p.pitch, -turn, turn), -1.4, 1.4);
    const settle = Math.exp(-(1.2 + skill * 2.5) * dt);
    this.aimErrYaw *= settle;
    this.aimErrPitch *= settle;
    cmd.yaw = p.yaw;
    cmd.jump = now < this.jumpUntil;

    this.updatePhone(now);
    if (p.phone.out) cmd.speedMul *= TUNING.phoneOut.moveSpeedMul;
    this.mover.step(this.move, cmd, dt);
    p.x = this.move.x;
    p.y = this.move.y;
    p.z = this.move.z;
    p.vx = this.move.vx;
    p.vy = this.move.vy;
    p.vz = this.move.vz;
    let flags = PF.ALIVE | PF.BOT;
    if (this.move.crouched) flags |= PF.CROUCH;
    if (this.move.sprinting) flags |= PF.SPRINT;
    if (cmd.ads) flags |= PF.ADS;
    if (this.move.onGround) flags |= PF.GROUND;
    p.flags = flags;
    this.manageWeapons(now);
  }

  private aimPoint(t: ServerPlayer): { x: number; y: number; z: number } {
    // Mostly the chest, sometimes the head.
    const head = Math.random() < 0.25;
    return { x: t.x, y: t.y + (head ? (t.crouched ? 1.0 : 1.6) : t.crouched ? 0.7 : 1.15), z: t.z };
  }

  private perceive(now: number): void {
    const p = this.p;
    const eyeY = p.eyeY();
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let best: ServerPlayer | null = null;
    let bestD = Infinity;
    for (const e of this.room.players.values()) {
      if (e === this.p || !e.alive) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 85) continue;
      const inView = (dx * fx + dz * fz) / Math.max(0.01, d) > 0.15 || e.id === this.lastHurtBy || d < 4;
      if (!inView) continue;
      let seen = false;
      for (const h of [1.55, 1.0]) {
        this.room.world.trace(this.tr, p.x, eyeY, p.z, e.x, e.y + (e.crouched ? h * 0.6 : h), e.z, 0, 0, 0, MASK.SHOT);
        if (this.tr.fraction >= 0.999) {
          seen = true;
          break;
        }
      }
      if (seen && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    if (best) {
      if (best !== this.target) {
        // New target: reaction delay and a fresh aim error.
        this.target = best;
        this.seenSince = now;
        const err = (3 + (1 - BOT_SKILL) * 9) * DEG;
        this.aimErrYaw = (Math.random() * 2 - 1) * err;
        this.aimErrPitch = (Math.random() * 2 - 1) * err * 0.5;
        this.nextShotAt = Math.max(this.nextShotAt, now + 260 + (1 - BOT_SKILL) * 380 + Math.random() * 150);
      }
      this.lastSeen = now;
      this.lastSeenPos = { x: best.x, y: best.y, z: best.z };
    } else if (this.target && now - this.lastSeen > 1500) {
      // Lost them: go and look where they were.
      this.goTo(this.lastSeenPos.x, this.lastSeenPos.y, this.lastSeenPos.z);
      this.target = null;
    }
  }

  private fire(now: number, dist: number, skill: number): void {
    const p = this.p;
    if (now < this.nextShotAt) return;
    const w = p.weapon;
    if (p.ammo[w] <= 0 || (p.reload && now < p.reload.refillAt)) return;
    // Only shoot when the remaining aim error is small for the distance.
    const tolerance = clamp(Math.atan2(0.35, dist), 0.6 * DEG, 6 * DEG);
    if (Math.abs(this.aimErrYaw) > tolerance * 2.5) return;
    let spread = (this.move.sprinting ? 3 : 0.4 + (1 - skill) * 1.6) * DEG;
    // One-handed while texting, like everyone else.
    if (p.phone.out) spread = spread * TUNING.phoneOut.spreadMul + TUNING.phoneOut.spreadAdd * DEG;
    const yaw = p.yaw + (Math.random() * 2 - 1) * spread;
    const pitch = p.pitch + (Math.random() * 2 - 1) * spread * 0.6;
    const cp = Math.cos(pitch);
    const d: [number, number, number] = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const o: [number, number, number] = [p.x, p.eyeY(), p.z];
    // Same claim a human client would send: the nearest player on the ray.
    let claim: { p: number; z: 'head' | 'body'; at: [number, number, number] } | undefined;
    let bestT = Infinity;
    for (const e of this.room.players.values()) {
      if (e === p || !e.alive) continue;
      const hit = rayPlayer(o[0], o[1], o[2], d[0], d[1], d[2], e.x, e.y, e.z, e.crouched, TUNING[w].range);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        claim = { p: e.id, z: hit.zone, at: [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t] };
      }
    }
    this.room.fire(p, w, o, d, now, claim);
    const interval = (60 / TUNING[w].rpm) * 1000;
    if (w === 'rifle') {
      this.burst = this.burst > 0 ? this.burst - 1 : 3 + Math.floor(Math.random() * 5);
      this.nextShotAt = now + (this.burst === 0 ? 250 + Math.random() * 350 : interval);
    } else {
      this.nextShotAt = now + Math.max(interval, 220 + Math.random() * 260);
    }
  }

  private manageWeapons(now: number): void {
    const p = this.p;
    if (p.reload && now < p.reload.end) return;
    const w = p.weapon;
    if (p.ammo[w] > 0) return;
    if (p.reserve[w] > 0) {
      // R: in goes the spare magazine.
      this.room.startReload(p, 'spare');
      return;
    }
    const other: WeaponId = w === 'rifle' ? 'pistol' : 'rifle';
    if (p.owned.includes(other) && p.ammo[other] > 0 && this.target) {
      // Running dry mid-fight: switch to the other gun.
      this.room.switchWeapon(p, other);
      this.nextShotAt = now + TUNING[other].drawTime * 1000;
    } else {
      this.textReload(now);
    }
  }

  /** More ammo comes from the varusmestari, for bots too: open the chat and type. */
  private textReload(now: number): void {
    if (this.typing || now < this.retypeAt || (this.p.reload && now < this.p.reload.end)) return;
    const text = RELOAD_TEXTS[Math.floor(Math.random() * RELOAD_TEXTS.length)]!;
    this.typing = { text, shown: 0, nextAt: now + 350 + Math.random() * 450, conv: ASEVARASTO };
    this.p.phone.out = true;
  }

  /**
   * The armourer's inventory check: count (a few seconds), then answer, mostly right. After
   * push-ups (a missed check), report PUNNERRETTU.
   */
  private inventory(now: number): void {
    const p = this.p;
    const inv = p.inventory;
    if (!inv) this.countAt = 0;
    else if (!this.typing) {
      if (!this.countAt) this.countAt = now + 3000 + Math.random() * 13000;
      else if (now >= this.countAt) {
        this.countAt = 0;
        const right = this.room.inventoryValue(p, inv.kind);
        const off = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3));
        const n = Math.random() < 0.8 ? right : Math.max(0, right + off);
        this.typing = { text: String(n), shown: 0, nextAt: now + 300, conv: ASEVARASTO };
        p.phone.out = true;
      }
    }
    if (!p.phone.locked || inv || this.typing) {
      if (!p.phone.locked) this.unlockAt = 0;
      return;
    }
    if (!this.unlockAt) this.unlockAt = now + 5000 + Math.random() * 9000;
    else if (now >= this.unlockAt) {
      this.unlockAt = 0;
      this.typing = { text: Math.random() < 0.3 ? 'punnerrettu' : 'PUNNERRETTU', shown: 0, nextAt: now + 400, conv: ASEVARASTO };
      p.phone.out = true;
    }
  }

  /** The ladder: answer tasks after a while (in quiet moments), and take an upgrade. */
  private ladder(now: number): void {
    const p = this.p;
    const l = p.ladder;
    if (l.choice) {
      if (!this.choiceAt) this.choiceAt = now + 2000 + Math.random() * 4000;
      else if (now >= this.choiceAt) {
        this.choiceAt = 0;
        this.room.ladder.choose(p, l.choice.options[Math.floor(Math.random() * l.choice.options.length)]!);
      }
    }
    if (l.open !== this.task) {
      this.task = l.open;
      this.taskAt = now + 4000 + Math.random() * 14000;
    }
    const c = l.open;
    if (!c || this.typing || this.target || now < this.taskAt) return;
    // Contacts have to be opened by hand, bots included.
    if (c.conv !== ASEVARASTO && !p.phone.convs.has(c.conv)) this.room.onPhoneMessage(p, { t: 'open', conv: c.conv });
    const text = Math.random() < 0.15 ? slip(c.code) : c.code;
    this.typing = { text, shown: 0, nextAt: now + 500 + Math.random() * 600, conv: c.conv };
    p.phone.out = true;
    // If that went wrong, try again a bit later.
    this.taskAt = now + 9000 + Math.random() * 9000;
  }

  private updatePhone(now: number): void {
    const p = this.p;
    // Quiet moment: a part-empty magazine makes way for the spare, and a used spare gets refilled.
    if (!this.typing && !this.target && !(p.reload && now < p.reload.end)) {
      const w = p.weapon;
      if (p.ammo[w] < p.gun(w).magazine * 0.4 && p.reserve[w] > 0 && Math.random() < 0.02) this.room.startReload(p, 'spare');
      else if (p.reserve[w] < p.spare(w) && Math.random() < 0.01) this.textReload(now);
    }
    this.inventory(now);
    this.ladder(now);
    const t = this.typing;
    if (!t) {
      if (p.phone.out && now >= this.phoneDownAt) p.phone.out = false;
      return;
    }
    // An enemy appears: half the time the phone goes away, half the time they keep typing.
    if (this.target && t.shown < t.text.length && Math.random() < 0.004) {
      this.typing = null;
      p.phone.out = false;
      p.phone.draft = null;
      return;
    }
    if (now < t.nextAt) return;
    if (t.shown < t.text.length) {
      t.shown++;
      p.phone.draft = { conv: t.conv, text: t.text.slice(0, t.shown), at: now };
      t.nextAt = now + 110 + Math.random() * 150;
      return;
    }
    const kind = this.room.varusmestari.receive(p, { rid: `bot${p.id}-${now.toFixed(0)}`, conv: t.conv, text: t.text, life: p.life, round: this.room.round.n });
    this.typing = null;
    // The "Sending…" moment, then the phone goes down.
    this.phoneDownAt = now + 650;
    // A typo: read the reply, then try again.
    if (kind !== 'command' && t.conv === ASEVARASTO) this.retypeAt = now + 1800 + Math.random() * 1200;
  }

  private goTo(x: number, y: number, z: number): void {
    const nav = this.room.nav;
    if (nav.length === 0) return;
    const from = nearestNode(nav, this.move.x, this.move.y, this.move.z, this.room.world);
    const to = nearestNode(nav, x, y, z);
    const path = findPath(nav, from, to);
    this.path = path ?? [];
    this.pathIdx = 0;
  }

  private followPath(now: number, cmd: ReturnType<typeof emptyCmd>): void {
    const nav = this.room.nav;
    // A map without a navigation graph: stand and look around.
    if (nav.length === 0) return;
    if (this.pathIdx >= this.path.length) {
      const goal = Math.floor(Math.random() * nav.length);
      this.goTo(nav[goal]!.x, nav[goal]!.y, nav[goal]!.z);
      if (this.path.length === 0) return;
    }
    const node = nav[this.path[this.pathIdx]!]!;
    const dx = node.x - this.move.x;
    const dz = node.z - this.move.z;
    if (Math.hypot(dx, dz) < 1.1) {
      this.pathIdx++;
      return;
    }
    cmd.forward = 1;
    // Stuck: hop and pick a new route.
    if (now > this.stuckCheckAt) {
      const moved = Math.hypot(this.move.x - this.stuckPos.x, this.move.z - this.stuckPos.z);
      if (this.stuckCheckAt > 0 && moved < 0.6) {
        this.jumpUntil = now + 150;
        this.path = [];
        this.pathIdx = 0;
      }
      this.stuckPos = { x: this.move.x, z: this.move.z };
      this.stuckCheckAt = now + 1500;
    }
  }

  private pathYaw(current: number): number {
    const nav = this.room.nav;
    if (this.pathIdx >= this.path.length) return current;
    const node = nav[this.path[this.pathIdx]!]!;
    return Math.atan2(-(node.x - this.move.x), -(node.z - this.move.z));
  }
}
