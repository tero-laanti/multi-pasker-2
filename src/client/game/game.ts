import * as THREE from 'three';
import { MASK } from '../../shared/collision/brush';
import { CollisionWorld, TraceResult } from '../../shared/collision/world';
import { SIM_DT, TUNING, VIEW, type KillSpeedPreset, type WeaponId } from '../../shared/config';
import { FI } from '../../shared/fi';
import type { MapData } from '../../shared/map/types';
import { SURFACE_NAMES } from '../../shared/map/types';
import { DEG, clamp, damp, lerp, viewDir } from '../../shared/math';
import { Mover, newMoveState, type MoveCmd, type MoveState } from '../../shared/movement';
import { RangeSim, type RangeEvent } from '../../shared/rangeSim';
import { damageFor } from '../../shared/weapons';
import type { AudioEngine } from '../audio/engine';
import type { Input } from '../input';
import type { Renderer } from '../render/renderer';
import { buildMapMeshes } from '../render/mapMesh';
import { buildProps, type PropsView } from '../render/props';
import { createMapMaterials } from '../render/textures';
import type { Settings } from '../settings';
import type { Hud } from '../ui/hud';
import { Effects } from './effects';
import { RangeView } from './rangeView';
import { ViewModel } from './viewmodel';
import { WeaponController } from './weapons';

const IMPACT_SOUND: Record<string, string> = {
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

const STEP_SOUND: Record<string, string> = {
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

const BEST_KEY = 'pasker.rangeBest';

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export interface GameDeps {
  renderer: Renderer;
  audio: AudioEngine;
  input: Input;
  settings: Settings;
  hud: Hud;
}

/** The shooting range: local player, weapons, targets and effects, at a fixed simulation step. */
export class Game {
  readonly world: CollisionWorld;
  readonly range: RangeSim;
  readonly weapons = new WeaponController();
  readonly move: MoveState;
  yaw = 0;
  pitch = 0;
  killSpeed: KillSpeedPreset = 'cod';
  /** Dev: R reloads directly on the range. */
  devDirectReload = true;
  paused = true;
  /** Fixed camera used behind the main menu instead of the player's eye. */
  attractCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
  simSteps = 0;
  lastFrameSteps = 0;

  private mover: Mover;
  private root = new THREE.Group();
  private props: PropsView;
  private rangeView: RangeView;
  private effects = new Effects();
  readonly viewmodel: ViewModel;
  private acc = 0;
  private prevEye = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private stepOffset = 0;
  private landDip = 0;
  private landVel = 0;
  private stepDist = 0;
  private crouchWanted = false;
  private sprintLock = 0;
  private lookX = 0;
  private lookY = 0;
  private sunShade = 1;
  private shadeTimer = 0;
  private tr = new TraceResult();
  private time = 0;
  private best = loadBest();
  private tailVoice: AudioBufferSourceNode | null = null;
  private forward = new THREE.Vector3();

  constructor(
    private deps: GameDeps,
    map: MapData,
  ) {
    this.world = new CollisionWorld(map.brushes);
    this.mover = new Mover(this.world);
    const r = deps.renderer;
    const mats = createMapMaterials(r.gl.capabilities.getMaxAnisotropy());
    this.root.add(buildMapMeshes(this.world, mats));
    this.props = buildProps(map.props, r.preset.treeDensity);
    this.root.add(this.props.group);
    this.range = new RangeSim(map.targets);
    this.rangeView = new RangeView(this.range);
    this.root.add(this.rangeView.group);
    this.root.add(this.effects.group);
    r.scene.add(this.root);
    this.viewmodel = new ViewModel(r.vmScene);
    this.viewmodel.onCasingLand = () => {
      if (this.move.onGround) this.deps.audio.play('casing', { volume: 0.22, delay: Math.random() * 0.05 });
    };
    const sp = map.spawns[0]!;
    this.move = newMoveState(sp.x, sp.y + 0.02, sp.z);
    this.yaw = sp.yaw;
    this.pitch = 0;
    this.updateEye(this.eye);
    this.prevEye.copy(this.eye);
    this.weapons.sounds.length = 0;
  }

  dispose(): void {
    this.deps.renderer.scene.remove(this.root);
  }

  /** Mouse look, applied immediately from the input event. */
  onLook(dx: number, dy: number): void {
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

  reload(): void {
    const r = this.weapons.startReload();
    if (r === 'full') this.deps.hud.note('Lipas on täynnä.', 1.2);
  }

  give(id: WeaponId): void {
    this.weapons.give(id);
    this.weapons.switchTo(id);
  }

  frame(dt: number): void {
    const { input, hud } = this.deps;
    this.time += dt;
    let steps = 0;
    if (!this.paused) {
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= SIM_DT && steps < 40) {
        this.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
    } else {
      input.clearPresses();
    }
    this.lastFrameSteps = steps;
    const alpha = this.paused ? 1 : this.acc / SIM_DT;
    this.renderFrame(dt, alpha);
    hud.update(dt);
  }

  private step(dt: number): void {
    const { input, audio, hud } = this.deps;
    this.simSteps++;
    const k = input.keys;

    if (input.consumePress('KeyC')) this.crouchWanted = this.deps.settings.crouchToggle ? !this.crouchWanted : true;
    if (!this.deps.settings.crouchToggle) this.crouchWanted = k.has('KeyC');
    if (input.consumePress('Digit1')) this.weapons.switchTo('rifle');
    if (input.consumePress('Digit2')) this.weapons.switchTo('pistol');
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.weapons.cycleWeapon(wheel);
    if (input.consumePress('KeyI')) this.weapons.inspect();
    if (input.consumePress('KeyR')) {
      if (this.devDirectReload) this.reload();
      else hud.note(FI.hud.reloadHint, 3);
    }

    const firePressed = input.consumeLeftPress();
    input.consumeRightPress();
    const forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const right = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const adsHeld = input.mouseRight;
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    // Firing while sprinting drops the sprint so the gun comes up and the shot goes out.
    if ((firePressed || (input.mouseLeft && this.weapons.current === 'rifle')) && this.move.sprinting) this.sprintLock = 0.35;
    if (this.sprintLock > 0) this.sprintLock -= dt;
    const sprint = shift && forward > 0 && !adsHeld && this.sprintLock <= 0;
    if (sprint && this.crouchWanted) this.crouchWanted = false;

    const cmd: MoveCmd = {
      forward,
      right,
      yaw: this.yaw,
      jump: k.has('Space'),
      crouch: this.crouchWanted,
      sprint,
      ads: this.weapons.ads > 0.5,
      speedMul: TUNING[this.weapons.current].moveSpeedMul,
    };
    const wasGround = this.move.onGround;
    this.prevEye.copy(this.eye);
    const ev = this.mover.step(this.move, cmd, dt);
    this.updateEye(this.eye);
    if (ev.stepped !== 0) this.stepOffset -= ev.stepped;
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

    const maxSpeed = TUNING.move.walkSpeed;
    const aim = { yaw: this.yaw, pitch: this.pitch };
    this.weapons.step(
      dt,
      {
        fireHeld: input.mouseLeft,
        firePressed,
        adsHeld,
        sprinting: this.move.sprinting,
        speed: hs,
        maxSpeed,
        airborne: !this.move.onGround,
        crouched: this.move.crouched,
      },
      aim,
    );
    this.yaw = aim.yaw;
    this.pitch = aim.pitch;
    for (const shot of this.weapons.shots) this.resolveShot(shot.weapon, shot.dir);
    this.weapons.shots.length = 0;
    for (const s of this.weapons.sounds) audio.play(s.name, { volume: s.volume ?? 1 });
    this.weapons.sounds.length = 0;

    this.range.update(dt);
    for (const e of this.range.events) this.onRangeEvent(e);
    this.range.events.length = 0;
  }

  private footstep(volume: number): void {
    const surf = SURFACE_NAMES[this.move.groundSurface] ?? 'default';
    this.deps.audio.play(STEP_SOUND[surf] ?? 'step_concrete', { volume });
  }

  private resolveShot(weapon: WeaponId, dir: { x: number; y: number; z: number }): void {
    const { audio, hud } = this.deps;
    const e = this.eye;
    const T = TUNING[weapon];
    const maxD = T.range;
    this.world.trace(this.tr, e.x, e.y, e.z, e.x + dir.x * maxD, e.y + dir.y * maxD, e.z + dir.z * maxD, 0, 0, 0, MASK.SHOT);
    const wallDist = this.tr.fraction * maxD;
    const hit = this.range.raycast(e.x, e.y, e.z, dir.x, dir.y, dir.z, wallDist);
    this.range.noteShot();

    // Own gunshot: close layer every shot, one tail voice that the next shot replaces.
    audio.play(`${weapon}_shot`, { volume: 0.95, gunshot: true });
    if (this.tailVoice) {
      try {
        this.tailVoice.stop(audio.ctx.currentTime + 0.03);
      } catch {
        // Already finished.
      }
    }
    this.tailVoice = audio.play(`${weapon}_tail`, { volume: 0.75 });

    const fwd = viewDir({ x: 0, y: 0, z: 0 }, this.yaw, this.pitch);
    this.effects.muzzleSmoke(e.x + fwd.x * 0.45, e.y + fwd.y * 0.45 - 0.08, e.z + fwd.z * 0.45, fwd.x, fwd.y, fwd.z);

    if (hit) {
      const t = hit.target;
      const zone = hit.zone;
      if (t.def.kind === 'silhouette') {
        const dmg = damageFor(weapon, zone, hit.t, this.killSpeed);
        const down = this.range.applyHit(hit, dmg);
        this.rangeView.mark(t, hit.x, hit.y, hit.z);
        this.effects.hitPuff(hit.x, hit.y, hit.z, -dir.x, -dir.y, -dir.z, false);
        audio.playAt('impact_wood', hit.x, hit.y, hit.z, { volume: 0.8 });
        hud.hitMarker(down ? 'kill' : zone === 'head' ? 'head' : 'body');
        audio.play(down ? 'hit_kill' : zone === 'head' ? 'hit_head' : 'hit_body', { bus: 'ui', volume: down ? 0.9 : 0.7, delay: 0.01 });
      } else {
        this.range.applyHit(hit, 0);
        const gong = t.def.kind === 'gong';
        audio.playAt(gong ? 'steel_gong' : 'steel_plate', hit.x, hit.y, hit.z, { volume: 1, refDistance: 6, rolloff: 0.6, maxDistance: 300 });
        this.effects.impact(hit.x, hit.y, hit.z, -dir.x, -dir.y, -dir.z, 6);
        hud.hitMarker('body');
        audio.play('hit_body', { bus: 'ui', volume: 0.5 });
      }
      return;
    }
    if (this.tr.fraction < 1) {
      const surf = this.tr.surface;
      this.effects.decal(this.tr.x, this.tr.y, this.tr.z, this.tr.nx, this.tr.ny, this.tr.nz, 0.07, surf);
      this.effects.impact(this.tr.x, this.tr.y, this.tr.z, this.tr.nx, this.tr.ny, this.tr.nz, surf);
      const name = IMPACT_SOUND[SURFACE_NAMES[surf] ?? 'default'] ?? 'impact_concrete';
      audio.playAt(name, this.tr.x, this.tr.y, this.tr.z, { volume: 0.9, refDistance: 3 });
    }
  }

  private onRangeEvent(e: RangeEvent): void {
    const { hud, audio } = this.deps;
    switch (e.type) {
      case 'command': {
        hud.showBanner(FI.range.commands[e.key], e.key === 'positions' ? 2 : 1.6);
        if (e.key === 'fire' || e.key === 'cease') audio.play('whistle', { bus: 'ui', volume: 0.55 });
        audio.playVoice(`rata_${e.key}`);
        break;
      }
      case 'targetDown':
        audio.playAt('impact_wood', e.target.x, e.target.y + 0.2, e.target.z, { volume: 0.5, rate: 0.7 });
        break;
      case 'targetUp':
        break;
      case 'drillEnd': {
        const isBest = e.result.score > this.best;
        if (isBest) {
          this.best = e.result.score;
          try {
            localStorage.setItem(BEST_KEY, String(this.best));
          } catch {
            // Not persisted.
          }
        }
        hud.showResults(e.result, this.best, isBest);
        window.setTimeout(() => {
          hud.showBanner(FI.range.commands.ended, 2.2);
          audio.playVoice('rata_ended');
        }, 2200);
        break;
      }
    }
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
    if (this.attractCam) {
      const a = this.attractCam;
      cam.position.set(a.x, a.y, a.z);
      cam.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
    } else {
      cam.position.lerpVectors(this.prevEye, this.eye, alpha);
      cam.position.y += this.stepOffset + this.landDip * 0.05;
      cam.rotation.set(this.pitch + punchP * DEG, this.yaw - punchY * DEG, 0, 'YXZ');
    }
    this.viewmodel.holder.visible = !this.attractCam;
    cam.updateMatrixWorld();

    const ads = lerp(w.adsPrev, w.ads, alpha);
    const adsE = ads * ads * (3 - 2 * ads);
    renderer.zoom = 1 + (TUNING[w.current].adsZoom - 1) * adsE;
    renderer.vmZoom = 1 + 0.04 * adsE;

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
    renderer.vmFlash.intensity = this.viewmodel.flash * 2.2;

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

    this.rangeView.update();
    this.effects.update(dt);
    this.effects.setViewportHeight(renderer.gl.domElement.height, cam.fov);
    this.props.update(this.time);

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.forward.x, this.forward.y, this.forward.z, up.x, up.y, up.z);

    // HUD.
    const T = TUNING[w.current];
    const spreadDeg = this.currentSpread();
    const vfov = cam.fov * DEG;
    const gap = (Math.tan(spreadDeg * DEG) / Math.tan(vfov / 2)) * (renderer.gl.domElement.clientHeight / 2);
    hud.crosshair(Math.max(4, gap), ads < 0.5 && this.weapons.sprintPose < 0.5 && w.state !== 'inspecting');
    hud.weapon(FI.hud.weapons[w.current] ?? w.current, w.ammo[w.current], T.magazine, w.state === 'reloading' && w.progress < T.reloadRefill);
    if (w.refilledAt >= 0) {
      hud.refillFlash();
      w.refilledAt = -1;
    }
    const hint = w.ammo[w.current] === 0 && w.state !== 'reloading' ? (this.devDirectReload ? FI.hud.reloadHintDev : FI.hud.reloadHint) : w.reminder > 0 ? FI.hud.reloadHint : '';
    hud.setHint(hint);
    hud.drillStatus(this.range.drillPhase, this.range.drillTime, this.range.drill.score);

    renderer.render(this.sunShade);
  }

  private shadeTarget = 1;

  private currentSpread(): number {
    const w = this.weapons;
    const T = TUNING[w.current];
    const hs = Math.hypot(this.move.vx, this.move.vz);
    const moveK = clamp(hs / TUNING.move.walkSpeed, 0, 1);
    let s = T.spreadHip + T.spreadMove * moveK + w.bloom;
    if (!this.move.onGround) s += T.spreadAir;
    if (this.move.crouched) s *= T.spreadCrouchMul;
    return Math.min(s, T.spreadMax + (this.move.onGround ? 0 : T.spreadAir));
  }
}
