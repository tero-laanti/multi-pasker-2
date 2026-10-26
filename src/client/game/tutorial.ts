import * as THREE from 'three';
import type { TraceResult } from '../../shared/collision/world';
import type { WeaponId } from '../../shared/config';
import type { Vec3 } from '../../shared/math';
import type { TargetState } from '../../shared/rangeSim';
import { UI } from '../../shared/ui';
import type { Game, GameMode } from './game';
import type { Explosion } from './grenades';
import { buildPhone, type PhoneModel } from './models/phone';
import type { RangeMode } from './rangeMode';

export type TutorialStep = 'walk' | 'shoot' | 'reload' | 'phone' | 'pair' | 'reply' | 'done';

/** Seconds of "no spare magazine" before the phone step begins. */
const NO_SPARE_PAUSE = 2.2;
/** Seconds the "training complete" panel stays big. */
const SETTLE_TIME = 12;

/** The steps counted on screen (pairing and the reply are one: "the phone"). */
export const TUTORIAL_STEPS: TutorialStep[] = ['walk', 'shoot', 'reload', 'phone', 'reply'];

/** Where things are on the range: lane 3's table and 10 m target, and the duty table at the back. */
export const TUTORIAL = {
  start: { x: -4.5, y: 0.14, z: 5.4, yaw: 0 },
  table: { x: -2.5, y: 0.125, z: 0.45 },
  target: { x: -2.5, z: -10 },
  phone: { x: 5.5, y: 0.94, z: 6.55 },
  /** How close counts as being at the table (m). */
  reach: 0.8,
  /** How close the phone has to be to pick it up (m). */
  pickUp: 1.7,
};

export interface TutorialHooks {
  /** E on the phone: show the pairing screen (or go straight on if a phone is connected). */
  pickedUp(): void;
  /** A chat is open on the player's phone (the server tells players on the range). */
  phoneOut(): boolean;
  /** The phone is paired and connected. */
  phoneOnline(): boolean;
}

/**
 * Ground ring and a bobbing arrow over whatever the player should go to next, and the phone
 * lying on the duty table until it is picked up.
 */
class TutorialView {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private arrow: THREE.Mesh;
  private phone: PhoneModel;
  private time = 0;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8b923, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2), mat);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.32, 4).rotateX(Math.PI), mat);
    this.phone = buildPhone();
    // Face up on the table, the long side along the table.
    this.phone.root.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - 0.25);
    this.phone.root.position.set(TUTORIAL.phone.x, TUTORIAL.phone.y + 0.005, TUTORIAL.phone.z);
    this.phone.root.scale.setScalar(1.15);
    this.group.add(this.ring, this.arrow, this.phone.root);
  }

  /** `ring`: a spot on the ground; `arrow`: the point the arrow hovers over (null hides it). */
  update(dt: number, ring: Vec3 | null, arrow: Vec3 | null, phoneOnTable: boolean): void {
    this.time += dt;
    this.ring.visible = !!ring;
    if (ring) {
      this.ring.position.set(ring.x, ring.y + 0.01, ring.z);
      this.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.06);
    }
    this.arrow.visible = !!arrow;
    if (arrow) {
      this.arrow.position.set(arrow.x, arrow.y + 0.25 + Math.sin(this.time * 3) * 0.08, arrow.z);
      this.arrow.rotation.y = this.time * 1.5;
    }
    this.phone.root.visible = phoneOnTable;
    // A notification light: the screen pulses until it is picked up.
    this.phone.setGlow(0.55 + 0.45 * Math.max(0, Math.sin(this.time * 5)));
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/**
 * The first visit to the range, before the match: walk to a table, shoot a target, find there
 * is no spare magazine, pick up the phone from the duty table, pair it and answer Asevarasto's
 * radio check with YK for full magazines. The range itself (targets, drills) works underneath.
 */
export class TutorialMode implements GameMode {
  readonly alive = true;
  stage: TutorialStep = 'walk';
  /** Skipped the phone: done, but the match will be hard. */
  noPhone = false;
  /** Seconds left of the "no spare magazine" moment before the phone step. */
  private pause = 0;
  private target: TargetState | null;
  private view = new TutorialView();
  /** Called whenever the step changes (the HUD redraws). */
  onStep: (step: TutorialStep) => void = () => {};
  /** R found no spare magazine during the reload lesson. */
  onNoSpare: () => void = () => {};
  /** A while after the training is done: the panel can step aside for the range's own line. */
  onSettled: () => void = () => {};
  private doneTime = 0;

  constructor(
    private game: Game,
    private range: RangeMode,
    private hooks: TutorialHooks,
  ) {
    this.target = range.range.targets.find((t) => t.def.kind === 'silhouette' && !t.def.popup && !t.def.rail && Math.abs(t.def.x - TUTORIAL.target.x) < 0.1 && Math.abs(t.def.z - TUTORIAL.target.z) < 0.1) ?? null;
    game.root.add(this.view.group);
  }

  get phoneOut(): boolean {
    return this.hooks.phoneOut();
  }

  get complete(): boolean {
    return this.stage === 'done';
  }

  /** From the start: at the back of the firing point with a pistol, one magazine, no spare. */
  start(): void {
    const g = this.game;
    const w = g.weapons;
    g.teleport(TUTORIAL.start.x, TUTORIAL.start.y, TUTORIAL.start.z, TUTORIAL.start.yaw);
    w.owned = ['pistol'];
    w.endlessSpare = false;
    w.resetLife(['pistol'], { pistol: w.stats('pistol').magazine, rifle: w.stats('rifle').magazine }, { pistol: 0, rifle: 0 });
    w.grenades = 0;
    this.noPhone = false;
    this.set('walk');
  }

  private set(step: TutorialStep): void {
    if (this.stage === step && step !== 'walk') return;
    this.stage = step;
    this.onStep(step);
  }

  /** Phone paired on the pairing screen: now the radio check. */
  paired(): void {
    if (this.stage === 'pair' || this.stage === 'phone') this.set('reply');
  }

  /** Played on without a phone: the range officer hands over rounds, the match won't. */
  skipPhone(): void {
    if (this.stage === 'done') return;
    this.noPhone = true;
    this.game.weapons.endlessSpare = true;
    this.game.weapons.refillAll();
    this.set('done');
  }

  /** Asevarasto on the range: the radio check answered, or LATAA / KRANAATTI from the phone. */
  supply(what: 'radioCheck' | 'ammo' | 'grenade'): void {
    const w = this.game.weapons;
    if (what === 'grenade') {
      w.grenades = Math.min(w.maxGrenades, w.grenades + 1);
      return;
    }
    w.refillAll();
    if (what === 'radioCheck' && this.stage !== 'done') {
      this.noPhone = false;
      w.endlessSpare = false;
      this.set('done');
    }
  }

  reload(): void {
    this.range.reload();
  }

  /** R with nothing to put in: in the reload step that is the point of the lesson. */
  noSpare(): void {
    if (this.stage !== 'reload' || this.pause > 0) return;
    this.pause = NO_SPARE_PAUSE;
    this.onNoSpare();
  }

  /** Until the training is done its own panel does the explaining. */
  outOfAmmo(): string {
    if (this.stage === 'done') return this.noPhone ? UI.hud.outOfAmmoNoPhone : UI.hud.outOfAmmo;
    return '';
  }

  step(dt: number): void {
    this.range.step(dt);
    const g = this.game;
    const m = g.move;
    switch (this.stage) {
      case 'walk':
        if (Math.hypot(m.x - TUTORIAL.table.x, m.z - TUTORIAL.table.z) < TUTORIAL.reach) this.set('shoot');
        break;
      case 'shoot': {
        // Down, or out of rounds trying.
        const t = this.target;
        if ((t && t.upTarget === 0) || g.weapons.ammo[g.weapons.current] === 0) this.set('reload');
        break;
      }
      case 'reload':
        if (this.pause > 0) {
          this.pause -= dt;
          if (this.pause <= 0) this.set('phone');
        }
        break;
      case 'done':
        if (this.doneTime < SETTLE_TIME && (this.doneTime += dt) >= SETTLE_TIME) this.onSettled();
        break;
      case 'phone':
        if (!g.paused && this.nearPhone() && g.deps.input.consumePress('KeyE')) {
          this.set('pair');
          this.hooks.pickedUp();
          if (this.hooks.phoneOnline()) this.set('reply');
        }
        break;
      default:
        break;
    }
  }

  /** Close enough to the phone, and looking its way. */
  nearPhone(): boolean {
    if (this.stage !== 'phone') return false;
    const g = this.game;
    const dx = TUTORIAL.phone.x - g.eye.x;
    const dz = TUTORIAL.phone.z - g.eye.z;
    const d = Math.hypot(dx, dz);
    if (d > TUTORIAL.pickUp) return false;
    const fx = -Math.sin(g.yaw);
    const fz = -Math.cos(g.yaw);
    return d < 0.5 || (fx * dx + fz * dz) / d > Math.cos((50 * Math.PI) / 180);
  }

  shot(weapon: WeaponId, eye: THREE.Vector3, dir: Vec3, tr: TraceResult): boolean {
    return this.range.shot(weapon, eye, dir, tr);
  }

  grenadeReleased(o: [number, number, number], v: [number, number, number]): void {
    this.range.grenadeReleased(o, v);
  }

  exploded(e: Explosion): void {
    this.range.exploded(e);
  }

  render(dt: number): void {
    this.range.render();
    const T = TUTORIAL;
    const t = this.target;
    let ring: Vec3 | null = null;
    let arrow: Vec3 | null = null;
    if (this.stage === 'walk') {
      ring = T.table;
      arrow = { x: T.table.x, y: 1.9, z: T.table.z };
    } else if (this.stage === 'shoot' && t) arrow = { x: t.x, y: t.y + 2.0, z: t.z };
    else if (this.stage === 'phone') {
      ring = { x: T.phone.x, y: 0.125, z: T.phone.z - 0.95 };
      arrow = { x: T.phone.x, y: T.phone.y + 0.35, z: T.phone.z };
    }
    this.view.update(dt, ring, arrow, this.stage === 'walk' || this.stage === 'shoot' || this.stage === 'reload' || this.stage === 'phone');
    this.game.deps.hud.setPrompt('E', this.nearPhone() ? UI.tutorial.pickUp : '');
  }

  dispose(): void {
    this.view.dispose();
    this.game.deps.hud.setPrompt('', '');
  }
}

/** The tutorial is done once per browser; after that, joining goes straight to the match. */
const DONE_KEY = 'pasker.trained';

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // Not remembered: the next join starts on the range again.
  }
}

