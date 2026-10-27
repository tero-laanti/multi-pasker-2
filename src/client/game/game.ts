import * as THREE from 'three';
import { MASK } from '../../shared/collision/brush';
import { CollisionWorld, TraceResult } from '../../shared/collision/world';
import { SIM_DT, TUNING, VIEW, type KillSpeedPreset, type WeaponId } from '../../shared/config';
import { throwVelocity } from '../../shared/grenade';
import { UI } from '../../shared/ui';
import type { MapData } from '../../shared/map/types';
import { SURFACE_NAMES } from '../../shared/map/types';
import { DEG, clamp, damp, lerp, viewDir, type Vec3 } from '../../shared/math';
import { spreadFor } from '../../shared/weapons';
import { Mover, newMoveState, type MoveCmd, type MoveState } from '../../shared/movement';
import type { AudioEngine } from '../audio/engine';
import type { Input } from '../input';
import type { Renderer } from '../render/renderer';
import { buildMapMeshes } from '../render/mapMesh';
import { buildProps, type PropsView } from '../render/props';
import { createMapMaterials } from '../render/textures';
import type { Settings } from '../settings';
import type { Hud } from '../ui/hud';
import { Effects } from './effects';
import { Grenades, type Explosion } from './grenades';
import type { ViewModel } from './viewmodel';
import { WeaponController } from './weapons';

export const IMPACT_SOUND: Record<string, string> = {
  concrete: 'impact_concrete',
  dirt: 'impact_dirt',
  grass: 'impact_dirt',
  gravel: 'impact_concrete',
  wood: 'impact_wood',
  metal: 'impact_metal',
  sand: 'impact_sand',
  canvas: 'impact_canvas',
  flesh: 'impact_flesh',
  default: 'impact_concrete',
};

export const STEP_SOUND: Record<string, string> = {
  concrete: 'step_concrete',
  dirt: 'step_dirt',
  grass: 'step_grass',
  gravel: 'step_gravel',
  wood: 'step_wood',
  metal: 'step_metal',
  sand: 'step_sand',
  canvas: 'step_canvas',
  default: 'step_concrete',
};

export interface GameDeps {
  renderer: Renderer;
  audio: AudioEngine;
  input: Input;
  settings: Settings;
  hud: Hud;
  viewmodel: ViewModel;
}

/** A camera that replaces the player's eye (menu backdrop, death camera). */
export interface CamOverride {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll?: number;
}

/** What differs between the shooting range and a match. */
export interface GameMode {
  /** False while the local player is dead: no movement or weapons. */
  readonly alive: boolean;
  /** False when shooting is not allowed (between rounds). */
  readonly firing?: boolean;
  /** A chat is open on the player's phone: the phone is in the off hand. */
  readonly phoneOut?: boolean;
  /** Fixed-step update after the local player and weapons have stepped. */
  step(dt: number): void;
  /**
   * A hitscan shot left the eye; `tr` holds the world trace (fraction 1: nothing hit).
   * Returns true when the shot hit a target or player (no wall impact is drawn then).
   */
  shot(weapon: WeaponId, eye: THREE.Vector3, dir: Vec3, tr: TraceResult): boolean;
  /** The local grenade left the hand with `fuse` seconds left (thrown, or dropped with no speed). */
  grenadeReleased(o: [number, number, number], v: [number, number, number], fuse: number): void;
  /** G pressed: the pin is out (matches tell the server, whose fuse starts now). */
  grenadePinned?(): void;
  /** The fuse ran out in the hand. */
  cookedOff?(): void;
  /** The knife (V) lands now: find who it reached. */
  melee?(eye: THREE.Vector3, dir: Vec3): void;
  /** A locally simulated grenade exploded (the range; match explosions come from the server). */
  exploded?(e: Explosion): void;
  /** R (or the trigger on an empty gun) with a spare magazine to put in. */
  reload(): void;
  /** What the HUD says when there is nothing left to load. */
  outOfAmmo?(): string;
  /** R was pressed with no spare magazine to put in. */
  noSpare?(): void;
  /** Render-rate update before the scene is drawn. */
  render(dt: number, alpha: number): void;
  dispose?(): void;
}

/**
 * The first-person core shared by the range and matches: map, local player movement at a
 * fixed simulation step, weapons, viewmodel, effects, grenades and the camera.
 */
export class Game {
  readonly world: CollisionWorld;
  readonly weapons = new WeaponController();
  readonly move: MoveState;
  readonly map: MapData;
  mode!: GameMode;
  yaw = 0;
  pitch = 0;
  killSpeed: KillSpeedPreset = 'cod';
  /** Dev (matches): R refills everything like the armourer's LATAA. */
  devDirectReload = false;
  /** No input while paused; the simulation keeps running when `keepRunning` (matches). */
  paused = true;
  keepRunning = false;
  /** Camera used instead of the player's eye. */
  camOverride: CamOverride | null = null;
  simSteps = 0;
  lastFrameSteps = 0;
  readonly root = new THREE.Group();
  readonly props: PropsView;
  readonly effects = new Effects();
  readonly grenades: Grenades;
  readonly viewmodel: ViewModel;
  readonly eye = new THREE.Vector3();
  /** Seconds of simulation since the game started. */
  time = 0;

  private mover: Mover;
  private acc = 0;
  private prevEye = new THREE.Vector3();
  private stepOffset = 0;
  private landDip = 0;
  private landVel = 0;
  private stepDist = 0;
  private crouchWanted = false;
  private sprintLock = 0;
  private lookX = 0;
  private lookY = 0;
  private sunShade = 1;
  private shadeTarget = 1;
  private shadeTimer = 0;
  readonly tr = new TraceResult();
  private tailVoice: AudioBufferSourceNode | null = null;
  readonly forward = new THREE.Vector3();
  private blast: { x: number; y: number; z: number; t: number } | null = null;
  /** Tent stove pipes that smoke, and when each puffs next. */
  private chimneys: { x: number; y: number; z: number; next: number }[] = [];
  private shake = 0;
  private up = new THREE.Vector3();

  constructor(
    readonly deps: GameDeps,
    map: MapData,
  ) {
    this.map = map;
    this.world = new CollisionWorld(map.brushes);
    this.mover = new Mover(this.world);
    const r = deps.renderer;
    const mats = createMapMaterials(r.gl.capabilities.getMaxAnisotropy());
    this.root.add(buildMapMeshes(this.world, mats));
    this.props = buildProps(map.props, r.preset.treeDensity);
    this.root.add(this.props.group);
    this.root.add(this.effects.group);
    this.grenades = new Grenades(this.world, deps.audio);
    this.root.add(this.grenades.group);
    this.viewmodel = deps.viewmodel;
    this.chimneys = map.props.filter((pr) => pr.kind === 'chimney').map((c) => ({ x: c.x, y: c.y + 1.8, z: c.z, next: Math.random() }));
    const sp = map.spawns[0]!;
    this.move = newMoveState(sp.x, sp.y + 0.02, sp.z);
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.updateEye(this.eye);
    this.prevEye.copy(this.eye);
  }

  /** Shows this game's world (only one game is in the scene at a time). */
  activate(): void {
    const r = this.deps.renderer;
    if (this.root.parent !== r.scene) r.scene.add(this.root);
    this.viewmodel.onCasingLand = () => {
      if (this.move.onGround) this.deps.audio.play('casing', { volume: 0.22, delay: Math.random() * 0.05 });
    };
    this.applySerials();
  }

  deactivate(): void {
    this.deps.renderer.scene.remove(this.root);
  }

  dispose(): void {
    this.deactivate();
    this.mode?.dispose?.();
  }

  /** Mouse look, applied immediately from the input event. */
  onLook(dx: number, dy: number): void {
    if (this.paused || !this.mode.alive) return;
    const s = this.deps.settings;
    const zoom = this.deps.renderer.zoom;
    const ads = this.weapons.ads;
    const k = s.sensitivity * VIEW.degreesPerCount * DEG * (1 / zoom) * lerp(1, s.adsSensitivity, ads);
    this.yaw -= dx * k;
    this.pitch -= dy * k * (s.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -89 * DEG, 89 * DEG);
    this.lookX += dx;
    this.lookY += dy;
  }

  private updateEye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.move.x, this.move.y + this.move.eye, this.move.z);
  }

  /** Each weapon has its own 6-digit serial (per player per round in matches). */
  serials: Record<WeaponId, string> = { pistol: '000000', rifle: '000000' };

  setSerials(s: Record<WeaponId, string>): void {
    this.serials = { ...s };
    this.applySerials();
  }

  newSerials(): void {
    for (const id of ['pistol', 'rifle'] as WeaponId[]) this.serials[id] = String(100000 + Math.floor(Math.random() * 900000));
    this.applySerials();
  }

  private applySerials(): void {
    for (const id of ['pistol', 'rifle'] as WeaponId[]) this.viewmodel.model(id)?.setSerial(this.serials[id]);
  }

  /** Moves the local player (spawns), clearing smoothing so nothing interpolates across. */
  teleport(x: number, y: number, z: number, yaw: number): void {
    Object.assign(this.move, newMoveState(x, y, z));
    this.yaw = yaw;
    this.pitch = 0;
    this.updateEye(this.eye);
    this.prevEye.copy(this.eye);
    this.stepOffset = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.crouchWanted = false;
    this.acc = 0;
  }

  frame(dt: number): void {
    const { input, hud } = this.deps;
    this.time += dt;
    let steps = 0;
    if (!this.paused || this.keepRunning) {
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= SIM_DT && steps < 40) {
        this.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
    }
    if (this.paused) input.clearPresses();
    this.lastFrameSteps = steps;
    const alpha = this.paused && !this.keepRunning ? 1 : this.acc / SIM_DT;
    this.renderFrame(dt, alpha);
    hud.update(dt);
  }

  private step(dt: number): void {
    const { input, audio, hud } = this.deps;
    this.simSteps++;
    const controls = !this.paused && this.mode.alive;
    const k = controls ? input.keys : new Set<string>();

    if (controls) {
      if (input.consumePress('KeyC')) this.crouchWanted = this.deps.settings.crouchToggle ? !this.crouchWanted : true;
      if (!this.deps.settings.crouchToggle) this.crouchWanted = k.has('KeyC');
      if (input.consumePress('Digit1')) this.weapons.switchTo('pistol');
      if (input.consumePress('Digit2')) this.weapons.switchTo('rifle');
      const wheel = input.consumeWheel();
      if (wheel !== 0) this.weapons.cycleWeapon(wheel);
      if (input.consumePress('KeyI')) this.weapons.inspect();
      if (input.consumePress('KeyV')) this.weapons.stab();
      if (input.consumePress('KeyG')) {
        if (this.weapons.primeGrenade()) this.mode.grenadePinned?.();
        else if (this.weapons.grenades === 0) hud.note(UI.hud.noGrenade, 2.2);
      }
      if (input.consumePress('KeyR')) this.requestReload();
    } else {
      this.crouchWanted = false;
      // A live grenade can't go back on the belt: paused while holding it, it falls.
      this.weapons.dropGrenade();
    }

    const canFire = controls && this.mode.firing !== false;
    const firePressed = controls && input.consumeLeftPress() && canFire;
    if (controls) input.consumeRightPress();
    const forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const adsHeld = controls && input.mouseRight;
    const fireHeld = canFire && input.mouseLeft;
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    // Firing while sprinting drops the sprint so the gun comes up and the shot goes out.
    if ((firePressed || (fireHeld && this.weapons.current === 'rifle')) && this.move.sprinting) this.sprintLock = 0.35;
    if (this.sprintLock > 0) this.sprintLock -= dt;
    const sprint = shift && forward > 0 && !adsHeld && this.sprintLock <= 0;
    if (sprint && this.crouchWanted) this.crouchWanted = false;

    const phone = this.mode.phoneOut === true;
    if (this.mode.alive) {
      const cmd: MoveCmd = {
        forward,
        right,
        yaw: this.yaw,
        jump: k.has('Space'),
        crouch: this.crouchWanted,
        sprint,
        ads: this.weapons.ads > 0.5,
        speedMul: TUNING[this.weapons.current].moveSpeedMul * lerp(1, TUNING.phoneOut.moveSpeedMul, this.weapons.phone),
      };
      const wasGround = this.move.onGround;
      this.prevEye.copy(this.eye);
      const ev = this.mover.step(this.move, cmd, dt);
      this.updateEye(this.eye);
      if (ev.stepped !== 0) {
        // Smooth the step out over a few frames. Shift the interpolation start too, or the frame
        // between the two sim positions would show the step twice (a one-frame jump).
        this.stepOffset -= ev.stepped;
        this.prevEye.y += ev.stepped;
      }
      if (ev.jumped) this.viewmodel.jumpImpulse();
      if (ev.landed > 2.5 && !wasGround) {
        this.landVel -= Math.min(2.2, ev.landed * 0.22);
        this.viewmodel.landingImpulse(ev.landed);
        audio.play('land', { volume: Math.min(0.9, 0.25 + ev.landed * 0.06) });
        this.footstep(0.9);
      }

      // Footsteps by distance travelled on the ground.
      const hs = Math.hypot(this.move.vx, this.move.vz);
      if (this.move.onGround && hs > 0.5) {
        this.stepDist += hs * dt;
        const stride = this.move.sprinting ? 2.4 : this.move.crouched ? 1.4 : 1.9;
        if (this.stepDist >= stride) {
          this.stepDist = 0;
          this.footstep(this.move.crouched ? 0.12 : this.move.sprinting ? 0.42 : 0.3);
        }
      }

      const aim = { yaw: this.yaw, pitch: this.pitch };
      this.weapons.step(
        dt,
        {
          fireHeld,
          firePressed,
          adsHeld,
          sprinting: this.move.sprinting,
          speed: hs,
          maxSpeed: TUNING.move.walkSpeed,
          airborne: !this.move.onGround,
          crouched: this.move.crouched,
          phone,
          grenadeHeld: k.has('KeyG'),
        },
        aim,
      );
      this.yaw = aim.yaw;
      this.pitch = aim.pitch;
      if (this.weapons.wantReload) {
        this.weapons.wantReload = false;
        this.requestReload();
      }
      for (const shot of this.weapons.shots) this.fireShot(shot.weapon, shot.dir);
      this.weapons.shots.length = 0;
      if (this.weapons.stabNow) {
        this.weapons.stabNow = false;
        this.mode.melee?.(this.eye, viewDir({ x: 0, y: 0, z: 0 }, this.yaw, this.pitch));
      }
      if (this.weapons.releaseGrenade) {
        this.weapons.releaseGrenade = false;
        const fwd = viewDir({ x: 0, y: 0, z: 0 }, this.yaw, this.pitch);
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);
        const e = this.eye;
        const v = throwVelocity(this.yaw, this.pitch, this.move.vx, this.move.vy, this.move.vz);
        // Start just in front of the eye, a little left and low, but never inside a wall.
        this.world.trace(this.tr, e.x, e.y, e.z, e.x + fwd.x * 0.35 - rx * 0.12, e.y + fwd.y * 0.35 - 0.1, e.z + fwd.z * 0.35 - rz * 0.12, 0.045, 0.045, 0.045, MASK.GRENADE);
        this.mode.grenadeReleased([this.tr.x, this.tr.y, this.tr.z], v, Math.max(0.05, this.weapons.fuseLeft ?? TUNING.grenade.fuse));
        this.weapons.clearPin();
      }
      this.handleDroppedGrenade();
      if (this.weapons.cookedOff) {
        this.weapons.cookedOff = false;
        this.mode.cookedOff?.();
      }
      for (const s of this.weapons.sounds) audio.play(s.name, { volume: s.volume ?? 1 });
      this.weapons.sounds.length = 0;
    } else {
      this.prevEye.copy(this.eye);
    }

    for (const ex of this.grenades.step(dt)) {
      this.explosionFx(ex.x, ex.y, ex.z);
      this.mode.exploded?.(ex);
    }
    this.mode.step(dt);
  }

  /** A live grenade that fell from the hand: at the feet, no speed, the fuse it had left. */
  private handleDroppedGrenade(): void {
    const w = this.weapons;
    if (!w.droppedGrenade) return;
    w.droppedGrenade = false;
    const fuse = Math.max(0.05, w.fuseLeft ?? TUNING.grenade.fuse);
    w.clearPin();
    this.mode.grenadeReleased([this.move.x, this.move.y + 0.9, this.move.z], [0, -1, 0], fuse);
  }

  /** R: in goes the spare magazine, or a reminder that there is none. */
  private requestReload(): void {
    const w = this.weapons;
    if (w.state === 'reloading' || w.ammo[w.current] >= w.stats().magazine) return;
    if (!w.canReload && !this.devDirectReload) {
      const text = this.outOfAmmoText();
      if (text) this.deps.hud.note(text, 3);
      w.reminder = 3;
      this.mode.noSpare?.();
      return;
    }
    this.mode.reload();
  }

  private outOfAmmoText(): string {
    return this.mode.outOfAmmo?.() ?? UI.hud.outOfAmmo;
  }

  /** Flash, smoke, sound, light and screen shake of an explosion. */
  explosionFx(x: number, y: number, z: number): void {
    this.effects.explosion(x, y, z);
    const dist = Math.hypot(x - this.eye.x, y - this.eye.y, z - this.eye.z);
    this.deps.audio.playAt(dist < 45 ? 'grenade_explode' : 'grenade_far', x, y + 0.3, z, { volume: 1, refDistance: 8, rolloff: 0.7, maxDistance: 600 });
    this.blast = { x, y, z, t: 0 };
    this.shake = Math.max(this.shake, clamp(1 - dist / 28, 0, 1));
  }

  private footstep(volume: number): void {
    const surf = SURFACE_NAMES[this.move.groundSurface] ?? 'default';
    this.deps.audio.play(STEP_SOUND[surf] ?? 'step_concrete', { volume });
  }

  /** Bullet hole, impact particles and sound on a wall. */
  wallImpact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: number): void {
    this.effects.decal(x, y, z, nx, ny, nz, 0.07, surface);
    this.effects.impact(x, y, z, nx, ny, nz, surface);
    const name = IMPACT_SOUND[SURFACE_NAMES[surface] ?? 'default'] ?? 'impact_concrete';
    this.deps.audio.playAt(name, x, y, z, { volume: 0.9, refDistance: 3 });
  }

  private fireShot(weapon: WeaponId, dir: Vec3): void {
    const { audio } = this.deps;
    const e = this.eye;
    const maxD = TUNING[weapon].range;
    this.world.trace(this.tr, e.x, e.y, e.z, e.x + dir.x * maxD, e.y + dir.y * maxD, e.z + dir.z * maxD, 0, 0, 0, MASK.SHOT);

    // Own gunshot: close layer every shot, one tail voice that the next shot replaces.
    const silenced = this.weapons.stats(weapon).silenced;
    audio.play(silenced ? `${weapon}_suppressed` : `${weapon}_shot`, { volume: audio.gun(0.95), gunshot: true });
    if (this.tailVoice) {
      try {
        this.tailVoice.stop(audio.ctx.currentTime + 0.03);
      } catch {
        // Already finished.
      }
    }
    this.tailVoice = silenced ? null : audio.play(`${weapon}_tail`, { volume: audio.gun(0.6) });

    const fwd = viewDir({ x: 0, y: 0, z: 0 }, this.yaw, this.pitch);
    this.effects.muzzleSmoke(e.x + fwd.x * 0.45, e.y + fwd.y * 0.45 - 0.08, e.z + fwd.z * 0.45, fwd.x, fwd.y, fwd.z);

    const tr = this.tr;
    const hitSomething = this.mode.shot(weapon, e, dir, tr);
    if (!hitSomething && tr.fraction < 1) this.wallImpact(tr.x, tr.y, tr.z, tr.nx, tr.ny, tr.nz, tr.surface);
  }

  private renderFrame(dt: number, alpha: number): void {
    const { renderer, audio, hud } = this.deps;
    const w = this.weapons;
    // Camera: interpolated eye, step smoothing and landing dip; rotation is the latest view + punch.
    this.stepOffset = damp(this.stepOffset, 0, 14, dt);
    if (Math.abs(this.stepOffset) < 0.0005) this.stepOffset = 0;
    this.landVel += (-110 * this.landDip - 14 * this.landVel) * dt;
    this.landDip += this.landVel * dt;
    const cam = renderer.camera;
    const punchP = lerp(w.punchPrevP, w.punchP, alpha);
    const punchY = lerp(w.punchPrevY, w.punchY, alpha);
    this.mode.render(dt, alpha);
    const co = this.camOverride;
    if (co) {
      cam.position.set(co.x, co.y, co.z);
      cam.rotation.set(co.pitch, co.yaw, co.roll ?? 0, 'YXZ');
    } else {
      cam.position.lerpVectors(this.prevEye, this.eye, alpha);
      cam.position.y += this.stepOffset + this.landDip * 0.05;
      // Blast shake is visual only: shots still follow the aim, not the shaken camera.
      const sh = this.shake * this.shake * 0.012;
      cam.rotation.set(this.pitch + punchP * DEG + (Math.random() - 0.5) * sh, this.yaw - punchY * DEG + (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 'YXZ');
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    this.viewmodel.holder.visible = !co;
    cam.updateMatrixWorld();

    const ads = lerp(w.adsPrev, w.ads, alpha);
    const adsE = ads * ads * (3 - 2 * ads);
    renderer.zoom = co ? 1 : 1 + (TUNING[w.current].adsZoom - 1) * adsE;
    renderer.vmZoom = 1 + 0.04 * adsE;

    this.viewmodel.setUpgrades(w.upgrades);
    this.viewmodel.update(dt, alpha, w, {
      speed: Math.hypot(this.move.vx, this.move.vz),
      onGround: this.move.onGround,
      crouched: this.move.crouched,
      sprinting: this.move.sprinting,
      lookX: this.lookX,
      lookY: this.lookY,
    });
    this.lookX = 0;
    this.lookY = 0;

    // World light from the muzzle flash.
    this.forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
    renderer.worldFlash.position.copy(cam.position).addScaledVector(this.forward, 0.6);
    renderer.worldFlash.intensity = this.viewmodel.flash * 7;
    renderer.worldFlash.distance = 9;
    if (this.blast) {
      this.blast.t += dt;
      const k = Math.max(0, 1 - this.blast.t / 0.18);
      if (k > 0) {
        renderer.worldFlash.position.set(this.blast.x, this.blast.y + 0.6, this.blast.z);
        renderer.worldFlash.intensity = 60 * k;
        renderer.worldFlash.distance = 22;
      } else this.blast = null;
    }
    this.grenades.render(alpha, dt);
    this.viewmodel.muzzlePosition(renderer.vmFlash.position);
    renderer.vmFlash.position.z += 0.04;
    renderer.vmFlash.intensity = this.viewmodel.flash * 0.9;

    // Is the player standing in shadow? (dims the viewmodel's sun)
    this.shadeTimer -= dt;
    if (this.shadeTimer <= 0) {
      this.shadeTimer = 0.05;
      const s = renderer.sunDir;
      const p = cam.position;
      this.world.trace(this.tr, p.x, p.y, p.z, p.x + s.x * 150, p.y + s.y * 150, p.z + s.z * 150, 0, 0, 0, MASK.SHOT);
      this.shadeTarget = this.tr.fraction < 1 ? 0.28 : 1;
    }
    this.sunShade = damp(this.sunShade, this.shadeTarget, 8, dt);

    for (const c of this.chimneys) {
      c.next -= dt;
      if (c.next > 0) continue;
      c.next = 0.35 + Math.random() * 0.2;
      if (Math.hypot(c.x - cam.position.x, c.z - cam.position.z) < 90) this.effects.stoveSmoke(c.x, c.y, c.z);
    }
    this.effects.update(dt);
    this.effects.setViewportHeight(renderer.gl.domElement.height, cam.fov);
    this.props.update(this.time);

    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);

    // HUD.
    const T = TUNING[w.current];
    const spreadDeg = this.currentSpread();
    const vfov = cam.fov * DEG;
    const gap = (Math.tan(spreadDeg * DEG) / Math.tan(vfov / 2)) * (renderer.gl.domElement.clientHeight / 2);
    hud.crosshair(Math.max(4, gap), !co && ads < 0.5 && this.weapons.sprintPose < 0.5 && w.state !== 'inspecting');
    hud.weapon(UI.hud.weapons[w.current] ?? w.current, w.ammo[w.current], w.stats().magazine, w.endlessSpare ? null : w.reserve[w.current], w.state === 'reloading' && w.progress < T.reloadRefill);
    if (w.refilledAt >= 0) {
      hud.refillFlash();
      w.refilledAt = -1;
    }
    const empty = w.ammo[w.current] === 0 && w.state !== 'reloading';
    const hint = empty && (w.canReload || this.devDirectReload) ? UI.hud.reloadKey : empty || w.reminder > 0 ? this.outOfAmmoText() : '';
    hud.setHint(co ? '' : hint);
    hud.grenades(w.grenades, w.maxGrenades);
    hud.fuse(w.cooking ? w.fuseLeft : null);

    renderer.render(this.sunShade);
  }

  /** Hip-fire cone for the crosshair. */
  private currentSpread(): number {
    const w = this.weapons;
    return spreadFor(TUNING[w.current], {
      ads: 0,
      speed: Math.hypot(this.move.vx, this.move.vz),
      maxSpeed: TUNING.move.walkSpeed,
      airborne: !this.move.onGround,
      crouched: this.move.crouched,
      bloom: w.bloom,
      phone: w.phone,
    });
  }
}
