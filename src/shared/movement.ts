import { MASK } from './collision/brush';
import { CollisionWorld, TraceResult } from './collision/world';
import { TUNING } from './config';
import { damp } from './math';

/**
 * Player movement, run at a fixed step on the client (local player) and the server (bots).
 * Structure follows Quake III's bg_pmove (the ancestor of Call of Duty movement): friction,
 * acceleration towards a wish velocity, slide move against brush traces, step-up, plus a
 * ground snap so walking down stairs and slopes stays glued to the floor.
 */

export type MoveTuning = typeof TUNING.move;

export interface MoveCmd {
  /** -1..1, W is +1. */
  forward: number;
  /** -1..1, D is +1. */
  right: number;
  /** Radians; 0 looks down -Z. */
  yaw: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  ads: boolean;
  /** Weapon movement multiplier. */
  speedMul: number;
}

export interface MoveState {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  gnx: number;
  gny: number;
  gnz: number;
  groundSurface: number;
  crouched: boolean;
  /** Current eye height above the feet. */
  eye: number;
  jumpHeld: boolean;
  jumpTimer: number;
  sprinting: boolean;
  airTime: number;
}

export interface MoveEvents {
  jumped: boolean;
  /** Downward speed at touchdown when the player landed this step, else 0. */
  landed: number;
  /** Height change from stepping up (+) or snapping down (-), for camera smoothing. */
  stepped: number;
}

export const MIN_WALK_NORMAL = 0.7;
const OVERCLIP = 1.001;
const MAX_CLIP_PLANES = 5;
const GROUND_PROBE = 0.03;
const MAX_SPEED = 60;

export function newMoveState(x = 0, y = 0, z = 0, T: MoveTuning = TUNING.move): MoveState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: false,
    gnx: 0,
    gny: 1,
    gnz: 0,
    groundSurface: 0,
    crouched: false,
    eye: T.standEye,
    jumpHeld: false,
    jumpTimer: 0,
    sprinting: false,
    airTime: 0,
  };
}

export function emptyCmd(): MoveCmd {
  return { forward: 0, right: 0, yaw: 0, jump: false, crouch: false, sprint: false, ads: false, speedMul: 1 };
}

interface V {
  x: number;
  y: number;
  z: number;
}

function clipVelocity(v: V, nx: number, ny: number, nz: number, overbounce: number): void {
  let backoff = v.x * nx + v.y * ny + v.z * nz;
  if (backoff < 0) backoff *= overbounce;
  else backoff /= overbounce;
  v.x -= nx * backoff;
  v.y -= ny * backoff;
  v.z -= nz * backoff;
}

export class Mover {
  private tr = new TraceResult();
  private planes: V[] = Array.from({ length: MAX_CLIP_PLANES }, () => ({ x: 0, y: 0, z: 0 }));
  private vel: V = { x: 0, y: 0, z: 0 };
  private endVel: V = { x: 0, y: 0, z: 0 };
  private clipVel: V = { x: 0, y: 0, z: 0 };
  private endClipVel: V = { x: 0, y: 0, z: 0 };
  private groundPlane = false;
  private walking = false;

  constructor(readonly world: CollisionWorld) {}

  hullHeight(st: MoveState, T: MoveTuning): number {
    return st.crouched ? T.crouchHeight : T.standHeight;
  }

  /** Traces the player hull (feet origin) and returns the shared result object. */
  traceHull(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    height: number,
    T: MoveTuning,
  ): TraceResult {
    const hy = height / 2;
    const tr = this.world.trace(this.tr, x0, y0 + hy, z0, x1, y1 + hy, z1, T.radius, hy, T.radius, MASK.MOVE);
    tr.y -= hy;
    return tr;
  }

  hullBlocked(x: number, y: number, z: number, height: number, T: MoveTuning): boolean {
    const hy = height / 2;
    return this.world.testBox(x, y + hy, z, T.radius, hy - 0.001, T.radius, MASK.MOVE);
  }

  step(st: MoveState, cmd: MoveCmd, dt: number, T: MoveTuning = TUNING.move): MoveEvents {
    const ev: MoveEvents = { jumped: false, landed: 0, stepped: 0 };
    this.unstick(st, T);
    this.updateCrouch(st, cmd, T);

    const wasOnGround = st.onGround;
    this.groundTrace(st, T);

    // Sprint needs forward input and no crouch or aim; it survives a jump.
    const wantsSprint = cmd.sprint && cmd.forward >= T.sprintMinForward && !st.crouched && !cmd.ads;
    st.sprinting = wantsSprint && (st.onGround || st.sprinting);

    if (st.jumpTimer > 0) st.jumpTimer = Math.max(0, st.jumpTimer - dt);
    const jumpPressed = cmd.jump && !st.jumpHeld;
    st.jumpHeld = cmd.jump;
    if (jumpPressed && this.walking && st.jumpTimer <= 0) {
      if (st.crouched) {
        if (!this.hullBlocked(st.x, st.y, st.z, T.standHeight, T)) st.crouched = false;
      } else {
        st.vy = T.jumpVelocity;
        st.onGround = false;
        this.walking = false;
        this.groundPlane = false;
        ev.jumped = true;
      }
    }

    // Wish direction and speed.
    const sy = Math.sin(cmd.yaw);
    const cy = Math.cos(cmd.yaw);
    const fm = cmd.forward;
    const sm = cmd.right;
    let wx = -sy * fm + cy * sm;
    let wz = -cy * fm - sy * sm;
    const wlen = Math.hypot(wx, wz);
    let wishSpeed = 0;
    if (wlen > 1e-6) {
      wx /= wlen;
      wz /= wlen;
      const mag = Math.min(1, Math.hypot(fm, sm));
      const nf = fm / Math.hypot(fm, sm);
      const ns = sm / Math.hypot(fm, sm);
      const dirMul = nf * nf * (nf >= 0 ? 1 : T.backSpeedMul) + ns * ns * T.strafeSpeedMul;
      let base = st.crouched ? T.crouchSpeed : st.sprinting ? T.sprintSpeed : T.walkSpeed;
      if (cmd.ads && !st.sprinting) base *= T.adsSpeedMul;
      wishSpeed = base * dirMul * mag * cmd.speedMul;
    }

    if (this.walking) this.walkMove(st, wx, wz, wishSpeed, dt, T, ev);
    else this.airMove(st, wx, wz, wishSpeed, dt, T);

    const vyBefore = st.vy;
    this.groundTrace(st, T);
    if (this.walking && !wasOnGround) {
      ev.landed = Math.max(0, -vyBefore);
      if (ev.landed > 1) st.jumpTimer = T.jumpCooldown;
      if (ev.landed > 4) {
        const k = 1 - T.landSlowdown * Math.min(1, (ev.landed - 4) / 6);
        st.vx *= k;
        st.vz *= k;
      }
      if (st.vy < 0) st.vy = 0;
    }
    st.onGround = this.walking;
    st.airTime = st.onGround ? 0 : st.airTime + dt;

    const target = st.crouched ? T.crouchEye : T.standEye;
    st.eye = damp(st.eye, target, T.eyeRate, dt);
    if (Math.abs(st.eye - target) < 0.001) st.eye = target;

    const sp = Math.hypot(st.vx, st.vy, st.vz);
    if (sp > MAX_SPEED) {
      const k = MAX_SPEED / sp;
      st.vx *= k;
      st.vy *= k;
      st.vz *= k;
    }
    return ev;
  }

  /** Lifts the player out if the hull starts inside or exactly on a surface (spawns, teleports). */
  private unstick(st: MoveState, T: MoveTuning): void {
    const h = this.hullHeight(st, T);
    if (!this.traceHull(st.x, st.y, st.z, st.x, st.y, st.z, h, T).startSolid) return;
    for (let i = 1; i <= 30; i++) {
      const up = i * 0.02;
      if (!this.traceHull(st.x, st.y + up, st.z, st.x, st.y + up, st.z, h, T).startSolid) {
        st.y += up;
        return;
      }
    }
  }

  private updateCrouch(st: MoveState, cmd: MoveCmd, T: MoveTuning): void {
    if (cmd.crouch && !st.crouched) {
      st.crouched = true;
    } else if (!cmd.crouch && st.crouched) {
      if (!this.hullBlocked(st.x, st.y, st.z, T.standHeight, T)) st.crouched = false;
    }
  }

  private groundTrace(st: MoveState, T: MoveTuning): void {
    const h = this.hullHeight(st, T);
    const tr = this.traceHull(st.x, st.y, st.z, st.x, st.y - GROUND_PROBE, st.z, h, T);
    if (tr.fraction === 1) {
      this.groundPlane = false;
      this.walking = false;
      st.onGround = false;
      return;
    }
    // Moving up and away from the surface (jumping).
    if (st.vy > 0 && st.vx * tr.nx + st.vy * tr.ny + st.vz * tr.nz > 0.25) {
      this.groundPlane = false;
      this.walking = false;
      st.onGround = false;
      return;
    }
    st.gnx = tr.nx;
    st.gny = tr.ny;
    st.gnz = tr.nz;
    this.groundPlane = true;
    if (tr.ny < MIN_WALK_NORMAL) {
      this.walking = false;
      st.onGround = false;
      return;
    }
    this.walking = true;
    st.onGround = true;
    st.groundSurface = tr.surface;
    // Settle onto the floor so a fall that ends just above it doesn't leave the player hovering.
    if (!tr.startSolid && st.vy <= 0) st.y = tr.y;
  }

  private friction(st: MoveState, T: MoveTuning, dt: number): void {
    const speed = Math.hypot(st.vx, st.vz);
    if (speed < 0.02) {
      st.vx = 0;
      st.vz = 0;
      return;
    }
    const control = speed < T.stopSpeed ? T.stopSpeed : speed;
    const drop = control * T.friction * dt;
    const k = Math.max(0, speed - drop) / speed;
    st.vx *= k;
    st.vy *= k;
    st.vz *= k;
  }

  private accelerate(st: MoveState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
    const current = st.vx * wx + st.vz * wz;
    const add = wishSpeed - current;
    if (add <= 0) return;
    let a = accel * dt * wishSpeed;
    if (a > add) a = add;
    st.vx += a * wx;
    st.vz += a * wz;
  }

  private walkMove(st: MoveState, wx: number, wz: number, wishSpeed: number, dt: number, T: MoveTuning, ev: MoveEvents): void {
    this.friction(st, T, dt);
    this.accelerate(st, wx, wz, wishSpeed, T.groundAccel, dt);
    // Slide along the ground plane without losing speed on slopes.
    const v = this.vel;
    v.x = st.vx;
    v.y = st.vy;
    v.z = st.vz;
    const speed = Math.hypot(v.x, v.y, v.z);
    clipVelocity(v, st.gnx, st.gny, st.gnz, OVERCLIP);
    const l = Math.hypot(v.x, v.y, v.z);
    if (l > 1e-9) {
      v.x = (v.x / l) * speed;
      v.y = (v.y / l) * speed;
      v.z = (v.z / l) * speed;
    }
    st.vx = v.x;
    st.vy = v.y;
    st.vz = v.z;
    if (st.vx === 0 && st.vz === 0) return;
    this.stepSlideMove(st, false, T, ev, dt);
    this.snapToGround(st, T, ev);
  }

  private airMove(st: MoveState, wx: number, wz: number, wishSpeed: number, dt: number, T: MoveTuning): void {
    this.accelerate(st, wx, wz, wishSpeed, T.airAccel, dt);
    if (this.groundPlane) {
      const v = this.vel;
      v.x = st.vx;
      v.y = st.vy;
      v.z = st.vz;
      clipVelocity(v, st.gnx, st.gny, st.gnz, OVERCLIP);
      st.vx = v.x;
      st.vy = v.y;
      st.vz = v.z;
    }
    this.stepSlideMove(st, true, T, null, dt);
  }

  private snapToGround(st: MoveState, T: MoveTuning, ev: MoveEvents): void {
    if (st.vy > 0.01) return;
    const h = this.hullHeight(st, T);
    const tr = this.traceHull(st.x, st.y, st.z, st.x, st.y - T.groundSnap, st.z, h, T);
    if (tr.startSolid || tr.fraction === 1 || tr.ny < MIN_WALK_NORMAL) return;
    const dy = tr.y - st.y;
    if (dy < -0.02) ev.stepped = dy;
    st.y = tr.y;
    const v = this.vel;
    v.x = st.vx;
    v.y = st.vy;
    v.z = st.vz;
    clipVelocity(v, tr.nx, tr.ny, tr.nz, OVERCLIP);
    st.vx = v.x;
    st.vy = v.y;
    st.vz = v.z;
  }

  /** Returns true if the move was blocked by anything. */
  private slideMove(st: MoveState, gravity: boolean, T: MoveTuning, dt: number): boolean {
    const planes = this.planes;
    let numPlanes = 0;
    const end = this.endVel;
    const v = this.vel;
    v.x = st.vx;
    v.y = st.vy;
    v.z = st.vz;
    end.x = v.x;
    end.y = v.y;
    end.z = v.z;
    if (gravity) {
      end.y = v.y - T.gravity * dt;
      v.y = (v.y + end.y) * 0.5;
      if (this.groundPlane) clipVelocity(v, st.gnx, st.gny, st.gnz, OVERCLIP);
    }
    let timeLeft = dt;
    if (this.groundPlane) {
      planes[numPlanes]!.x = st.gnx;
      planes[numPlanes]!.y = st.gny;
      planes[numPlanes]!.z = st.gnz;
      numPlanes++;
    }
    // Never turn against the original velocity.
    const vl = Math.hypot(v.x, v.y, v.z);
    if (vl > 1e-9) {
      planes[numPlanes]!.x = v.x / vl;
      planes[numPlanes]!.y = v.y / vl;
      planes[numPlanes]!.z = v.z / vl;
      numPlanes++;
    }
    const h = this.hullHeight(st, T);
    let bump = 0;
    const NUM_BUMPS = 4;
    for (; bump < NUM_BUMPS; bump++) {
      const ex = st.x + v.x * timeLeft;
      const ey = st.y + v.y * timeLeft;
      const ez = st.z + v.z * timeLeft;
      const tr = this.traceHull(st.x, st.y, st.z, ex, ey, ez, h, T);
      if (tr.allSolid) {
        // Trapped in a solid: stop vertical motion and give up this step.
        v.y = 0;
        st.vx = v.x;
        st.vy = 0;
        st.vz = v.z;
        return true;
      }
      if (tr.fraction > 0) {
        st.x = tr.x;
        st.y = tr.y;
        st.z = tr.z;
      }
      if (tr.fraction === 1) break;
      timeLeft -= timeLeft * tr.fraction;
      if (numPlanes >= MAX_CLIP_PLANES) {
        v.x = v.y = v.z = 0;
        st.vx = st.vy = st.vz = 0;
        return true;
      }
      // Same plane as before: nudge out along it.
      let same = false;
      for (let i = 0; i < numPlanes; i++) {
        const p = planes[i]!;
        if (tr.nx * p.x + tr.ny * p.y + tr.nz * p.z > 0.99) {
          v.x += tr.nx * 0.01;
          v.y += tr.ny * 0.01;
          v.z += tr.nz * 0.01;
          same = true;
          break;
        }
      }
      if (same) continue;
      planes[numPlanes]!.x = tr.nx;
      planes[numPlanes]!.y = tr.ny;
      planes[numPlanes]!.z = tr.nz;
      numPlanes++;

      // Clip the velocity so it runs parallel to every touched plane.
      let i = 0;
      for (; i < numPlanes; i++) {
        const pi = planes[i]!;
        const into = v.x * pi.x + v.y * pi.y + v.z * pi.z;
        if (into >= 0.003) continue;
        const cv = this.clipVel;
        const ecv = this.endClipVel;
        cv.x = v.x;
        cv.y = v.y;
        cv.z = v.z;
        ecv.x = end.x;
        ecv.y = end.y;
        ecv.z = end.z;
        clipVelocity(cv, pi.x, pi.y, pi.z, OVERCLIP);
        clipVelocity(ecv, pi.x, pi.y, pi.z, OVERCLIP);
        let stop = false;
        for (let j = 0; j < numPlanes; j++) {
          if (j === i) continue;
          const pj = planes[j]!;
          if (cv.x * pj.x + cv.y * pj.y + cv.z * pj.z >= 0.003) continue;
          clipVelocity(cv, pj.x, pj.y, pj.z, OVERCLIP);
          clipVelocity(ecv, pj.x, pj.y, pj.z, OVERCLIP);
          if (cv.x * pi.x + cv.y * pi.y + cv.z * pi.z >= 0) continue;
          // Slide along the crease between the two planes.
          let dx = pi.y * pj.z - pi.z * pj.y;
          let dy = pi.z * pj.x - pi.x * pj.z;
          let dz = pi.x * pj.y - pi.y * pj.x;
          const dl = Math.hypot(dx, dy, dz);
          if (dl < 1e-9) {
            stop = true;
            break;
          }
          dx /= dl;
          dy /= dl;
          dz /= dl;
          let d = dx * v.x + dy * v.y + dz * v.z;
          cv.x = dx * d;
          cv.y = dy * d;
          cv.z = dz * d;
          d = dx * end.x + dy * end.y + dz * end.z;
          ecv.x = dx * d;
          ecv.y = dy * d;
          ecv.z = dz * d;
          // A third plane: stop dead.
          for (let k = 0; k < numPlanes; k++) {
            if (k === i || k === j) continue;
            const pk = planes[k]!;
            if (cv.x * pk.x + cv.y * pk.y + cv.z * pk.z >= 0.003) continue;
            stop = true;
            break;
          }
          if (stop) break;
        }
        if (stop) {
          v.x = v.y = v.z = 0;
          end.x = end.y = end.z = 0;
          st.vx = st.vy = st.vz = 0;
          return true;
        }
        v.x = cv.x;
        v.y = cv.y;
        v.z = cv.z;
        end.x = ecv.x;
        end.y = ecv.y;
        end.z = ecv.z;
        break;
      }
    }
    if (gravity) {
      st.vx = end.x;
      st.vy = end.y;
      st.vz = end.z;
    } else {
      st.vx = v.x;
      st.vy = v.y;
      st.vz = v.z;
    }
    return bump !== 0;
  }

  private stepSlideMove(st: MoveState, gravity: boolean, T: MoveTuning, ev: MoveEvents | null, dt: number): void {
    const sx = st.x,
      sy = st.y,
      sz = st.z;
    const svx = st.vx,
      svy = st.vy,
      svz = st.vz;
    if (!this.slideMove(st, gravity, T, dt)) return;

    const stepHeight = gravity ? T.airStepHeight : T.stepHeight;
    if (stepHeight <= 0) return;
    const h = this.hullHeight(st, T);
    // Never step up while still moving up, unless there is ground right below.
    if (svy > 0) {
      const down = this.traceHull(sx, sy, sz, sx, sy - stepHeight, sz, h, T);
      if (down.fraction === 1 || down.ny < MIN_WALK_NORMAL) return;
    }
    const plainX = st.x,
      plainY = st.y,
      plainZ = st.z;
    const plainVx = st.vx,
      plainVy = st.vy,
      plainVz = st.vz;

    const up = this.traceHull(sx, sy, sz, sx, sy + stepHeight, sz, h, T);
    if (up.allSolid) return;
    const stepSize = up.y - sy;
    if (stepSize <= 0.001) return;
    st.x = up.x;
    st.y = up.y;
    st.z = up.z;
    st.vx = svx;
    st.vy = svy;
    st.vz = svz;
    this.slideMove(st, gravity, T, dt);
    const down = this.traceHull(st.x, st.y, st.z, st.x, st.y - stepSize, st.z, h, T);
    if (!down.allSolid) {
      st.x = down.x;
      st.y = down.y;
      st.z = down.z;
    }
    const landedOnSteep = down.fraction < 1 && down.ny < MIN_WALK_NORMAL;
    const stepDist = Math.hypot(st.x - sx, st.z - sz);
    const plainDist = Math.hypot(plainX - sx, plainZ - sz);
    if (landedOnSteep || stepDist <= plainDist + 1e-4) {
      st.x = plainX;
      st.y = plainY;
      st.z = plainZ;
      st.vx = plainVx;
      st.vy = plainVy;
      st.vz = plainVz;
      return;
    }
    if (down.fraction < 1) {
      const v = this.vel;
      v.x = st.vx;
      v.y = st.vy;
      v.z = st.vz;
      clipVelocity(v, down.nx, down.ny, down.nz, OVERCLIP);
      st.vx = v.x;
      st.vy = v.y;
      st.vz = v.z;
    }
    const rise = st.y - plainY;
    if (ev && rise > 0.02) ev.stepped = rise;
  }
}
