import * as THREE from 'three';
import { TUNING, type WeaponId } from '../../shared/config';
import { DEG, clamp, damp, lerp, smoothstep } from '../../shared/math';
import { buildKnife } from './models/knife';
import { buildPhone, type PhoneModel } from './models/phone';
import { buildPistol, type WeaponModel } from './models/pistol';
import { buildRifle } from './models/rifle';
import { THROW_RELEASE, type WeaponController } from './weapons';
import type { Upgrades } from '../../shared/upgrades';
import { grenadeMesh } from './grenades';

/** The trigger finger's tap: seconds to pull and to let go, how far it curls (rad) and the trigger moves (m). */
const TRIGGER = { pull: 0.03, release: 0.07, angle: 0.2, travel: 0.0025 };

/** Piecewise curve through [time, value] keys with smoothstep easing between them. */
function curve(t: number, keys: [number, number][]): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]!;
      const k = smoothstep(0, 1, (t - t0) / Math.max(1e-6, t1 - t0));
      return v0 + (v1 - v0) * k;
    }
  }
  return keys[keys.length - 1]![1];
}

interface Pose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
}

const zeroPose = (): Pose => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 });

class Spring {
  v = 0;
  x = 0;
  step(dt: number, k: number, c: number): void {
    // Semi-implicit Euler in small sub-steps for stability at any frame rate.
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-k * this.x - c * this.v) * h;
      this.x += this.v * h;
    }
  }
}

function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,248,225,1)');
  grad.addColorStop(0.12, 'rgba(255,220,140,0.9)');
  grad.addColorStop(0.35, 'rgba(255,150,50,0.35)');
  grad.addColorStop(1, 'rgba(255,90,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5;
    const len = 26 + (i % 2) * 12;
    const petal = g.createRadialGradient(64, 64, 2, 64, 64, len);
    petal.addColorStop(0, 'rgba(255,215,130,0.6)');
    petal.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = petal;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a - 0.22) * len * 0.6, 64 + Math.sin(a - 0.22) * len * 0.6);
    g.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    g.lineTo(64 + Math.cos(a + 0.22) * len * 0.6, 64 + Math.sin(a + 0.22) * len * 0.6);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flameTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,245,210,1)');
  grad.addColorStop(0.35, 'rgba(255,180,70,0.8)');
  grad.addColorStop(1, 'rgba(255,90,10,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 0);
  g.quadraticCurveTo(62, 70, 34, 128);
  g.lineTo(30, 128);
  g.quadraticCurveTo(2, 70, 32, 0);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  played: boolean;
}

export interface ViewmodelMotion {
  /** Horizontal speed (m/s). */
  speed: number;
  onGround: boolean;
  crouched: boolean;
  sprinting: boolean;
  /** Mouse counts moved this frame (for sway). */
  lookX: number;
  lookY: number;
}

/**
 * First-person weapon presentation. Everything here is visual: the gameplay state comes from
 * the WeaponController each frame.
 */
export class ViewModel {
  readonly holder = new THREE.Group();
  private models: Partial<Record<WeaponId, WeaponModel>> = {};
  private shown: WeaponId | null = null;
  private lastShot = 0;
  private kick = { x: new Spring(), y: new Spring(), z: new Spring(), pitch: new Spring(), yaw: new Spring(), roll: new Spring() };
  private sway = { x: new Spring(), y: new Spring() };
  private land = new Spring();
  private bobPhase = 0;
  private bobAmt = 0;
  private time = 0;
  private flashFront: THREE.Mesh;
  private flashSide: THREE.Group;
  private flashTime = 1;
  private casings: Casing[] = [];
  private heldGrenade = grenadeMesh();
  private knife = buildKnife();
  private casingIndex = 0;
  onCasingLand: (() => void) | null = null;
  /** World-space muzzle flash strength for lighting (0..1). */
  flash = 0;
  /** Suppressor fitted (Vaimennin): no muzzle flash. */
  silenced = false;
  private attachments: { suppressor: THREE.Mesh; drum?: THREE.Group; mag?: THREE.Object3D[] }[] = [];
  private upgradesKey = '';
  private phone: PhoneModel = buildPhone();
  /** How far the phone is up in view (0..1); it dips while the left hand is busy. */
  private phoneK = 0;
  private phoneAt = new THREE.Vector3();
  private phoneRot = new THREE.Quaternion();
  private phoneEuler = new THREE.Euler();
  private phoneM = new THREE.Matrix4();
  private phoneM2 = new THREE.Matrix4();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(private scene: THREE.Scene) {
    scene.add(this.holder);
    this.models.pistol = buildPistol();
    this.models.rifle = buildRifle();
    for (const m of Object.values(this.models)) {
      this.holder.add(m.root);
      m.root.visible = false;
    }

    // Upgrades you can see: a suppressor on each gun, the rifle's drum magazine.
    const attachMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.5, metalness: 0.6 });
    for (const [id, m] of Object.entries(this.models) as [WeaponId, WeaponModel][]) {
      const r = id === 'rifle' ? 0.019 : 0.016;
      const len = id === 'rifle' ? 0.17 : 0.13;
      const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20).rotateX(Math.PI / 2).translate(0, 0, -len / 2 + 0.004), attachMat);
      suppressor.visible = false;
      m.muzzle.add(suppressor);
      const entry: (typeof this.attachments)[number] = { suppressor };
      if (id === 'rifle') {
        const drum = new THREE.Group();
        // Forward of the trigger guard, so the trigger finger keeps its room.
        drum.add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.04).translate(0, -0.03, -0.012), attachMat));
        drum.add(new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.05, 28).rotateZ(Math.PI / 2).translate(0, -0.095, -0.03), attachMat));
        drum.visible = false;
        m.mag.add(drum);
        entry.drum = drum;
        entry.mag = [...m.mag.children].filter((c) => c !== drum);
      }
      this.attachments.push(entry);
    }

    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.flashFront = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), flashMat);
    this.flashFront.renderOrder = 10;
    const flameMat = new THREE.MeshBasicMaterial({
      map: flameTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.flashSide = new THREE.Group();
    for (const rz of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.08), flameMat);
      p.rotation.set(-Math.PI / 2, 0, rz);
      p.position.z = -0.035;
      p.renderOrder = 10;
      this.flashSide.add(p);
    }
    this.flashFront.visible = false;
    this.flashSide.visible = false;

    this.heldGrenade.visible = false;
    scene.add(this.heldGrenade);
    scene.add(this.knife.root);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
    const geo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 10);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(geo, brass);
      mesh.visible = false;
      scene.add(mesh);
      this.casings.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, played: true });
    }
  }

  /** Shows the upgrades that change the guns' look (suppressor, drum magazine). */
  setUpgrades(u: Upgrades): void {
    const key = JSON.stringify(u);
    if (key === this.upgradesKey) return;
    this.upgradesKey = key;
    this.silenced = (u.vaimennin ?? 0) > 0;
    const drum = (u.rumpu ?? 0) > 0;
    for (const a of this.attachments) {
      a.suppressor.visible = this.silenced;
      if (a.drum) a.drum.visible = drum;
      for (const c of a.mag ?? []) c.visible = !drum;
    }
  }

  /** Muzzle position of the shown weapon in viewmodel (camera) space. */
  muzzlePosition(out: THREE.Vector3): THREE.Vector3 {
    const m = this.shown ? this.models[this.shown] : undefined;
    if (!m) return out.set(0.1, -0.05, -0.5);
    m.muzzle.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(m.muzzle.matrixWorld);
  }

  model(id: WeaponId): WeaponModel | undefined {
    return this.models[id];
  }

  private show(id: WeaponId): WeaponModel {
    const m = this.models[id] ?? this.models.pistol!;
    if (this.shown !== id) {
      for (const [k, mm] of Object.entries(this.models)) mm!.root.visible = k === id;
      m.muzzle.add(this.flashFront, this.flashSide);
      this.shown = id;
    }
    return m;
  }

  update(dt: number, alpha: number, w: WeaponController, mo: ViewmodelMotion): void {
    this.time += dt;
    const id = w.current;
    const m = this.show(id);
    const T = TUNING[id];
    const ads = smoothstep(0, 1, lerp(w.adsPrev, w.ads, alpha));
    const sprint = smoothstep(0, 1, lerp(w.sprintPosePrev, w.sprintPose, alpha));

    // New shots: snap the kick springs and show the flash.
    if (w.shotCounter !== this.lastShot) {
      const n = w.shotCounter - this.lastShot;
      this.lastShot = w.shotCounter;
      for (let i = 0; i < Math.min(n, 2); i++) this.onShot(m, T, w.lastShotAds);
    }
    this.triggerTap(m, dt);
    const k = T.kickStiffness;
    const c = T.kickDamping;
    for (const s of Object.values(this.kick)) s.step(dt, k, c);
    this.sway.x.step(dt, 120, 16);
    this.sway.y.step(dt, 120, 16);
    this.land.step(dt, 90, 12);

    // Look sway: the gun lags behind the view a little.
    const swayK = T.swayLook * (1 - ads * 0.8);
    this.sway.x.v += clamp(-mo.lookX * 0.0009 * swayK, -0.5, 0.5);
    this.sway.y.v += clamp(-mo.lookY * 0.0009 * swayK, -0.5, 0.5);

    // Walk bob in step with the footsteps: half a cycle (one dip) per step.
    const stepLen = mo.sprinting ? 2.4 : mo.crouched ? 1.4 : 1.9;
    this.bobPhase += (mo.speed * dt * Math.PI) / stepLen;
    const targetBob = mo.onGround ? clamp(mo.speed / TUNING.move.walkSpeed, 0, 1.5) : 0;
    this.bobAmt = damp(this.bobAmt, targetBob, 10, dt);
    const bobK = this.bobAmt * T.bob * (1 - ads * 0.88) * (mo.crouched ? 0.6 : 1) * (mo.sprinting ? 1.6 : 1);

    // Base pose: hip → aim-down-sights (rear sight on the view axis).
    const hip: Pose = { x: T.vmHipX, y: T.vmHipY, z: T.vmHipZ, pitch: 0.012, yaw: 0.035, roll: 0 };
    const aimPose: Pose = { x: 0, y: -m.sightY, z: T.vmAdsZ - m.sightZ, pitch: 0, yaw: 0, roll: 0 };
    const p = zeroPose();
    // The gun rises slightly ahead of centring, which reads as lifting it to the eye.
    const adsY = smoothstep(0, 0.85, ads);
    p.x = lerp(hip.x, aimPose.x, ads);
    p.y = lerp(hip.y, aimPose.y, adsY);
    p.z = lerp(hip.z, aimPose.z, ads);
    p.pitch = lerp(hip.pitch, 0, ads);
    p.yaw = lerp(hip.yaw, 0, ads);
    if (mo.crouched) {
      p.y -= 0.004 * (1 - ads);
      p.roll += 0.03 * (1 - ads);
    }

    // Sprint: lowered and turned in.
    p.x -= 0.035 * sprint;
    p.y -= 0.05 * sprint;
    p.z += 0.03 * sprint;
    p.pitch -= 0.3 * sprint;
    p.yaw += 0.45 * sprint;
    p.roll += 0.55 * sprint;

    this.applyTimeline(p, m, w);
    this.phonePose(p, w, dt, alpha);

    // Bob, breathing, sway, landing.
    const ph = this.bobPhase;
    p.x += Math.sin(ph) * 0.005 * bobK;
    p.y -= Math.abs(Math.sin(ph)) * 0.0065 * bobK;
    p.roll += Math.sin(ph) * 0.01 * bobK;
    p.yaw += Math.sin(ph) * 0.005 * bobK;
    const breathe = 1 - ads * 0.75;
    p.y += Math.sin(this.time * 1.7) * 0.0011 * breathe;
    p.pitch += Math.sin(this.time * 1.1) * 0.0022 * breathe;
    p.yaw += this.sway.x.x;
    p.pitch += this.sway.y.x;
    p.x += this.sway.x.x * 0.03;
    p.y += this.sway.y.x * 0.02 + this.land.x;

    // Kick on top.
    p.x += this.kick.x.x;
    p.y += this.kick.y.x;
    p.z += this.kick.z.x;
    p.pitch += this.kick.pitch.x;
    p.yaw += this.kick.yaw.x;
    p.roll += this.kick.roll.x;

    this.holder.position.set(p.x, p.y, p.z);
    this.holder.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    // The rotation pivots at the rear sight so aiming stays aligned under small kicks.
    m.root.position.set(0, 0, 0);
    this.phoneHand(m);

    // Flash fades over a couple of frames.
    this.flashTime += dt;
    const f = this.flashTime < 0.016 ? 1 : Math.max(0, 1 - (this.flashTime - 0.016) / 0.035);
    this.flash = f;
    const visible = f > 0.01;
    this.flashFront.visible = visible;
    this.flashSide.visible = visible;
    (this.flashFront.material as THREE.MeshBasicMaterial).opacity = f;
    for (const ch of this.flashSide.children) ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = f * 0.9;

    this.updateCasings(dt);

    // The grenade in view: up as the pin comes out, held while G is down, flung when it is let go.
    const held = w.state === 'priming' || w.state === 'holding' || (w.state === 'throwing' && w.progress < THROW_RELEASE);
    this.heldGrenade.visible = held;
    if (held) {
      const rise = w.state === 'priming' ? smoothstep(0, 1, w.progress) : 1;
      const fling = w.state === 'throwing' ? w.progress / THROW_RELEASE : 0;
      const sway = w.state === 'holding' ? Math.sin(this.time * 2.1) * 0.004 : 0;
      this.heldGrenade.position.set(-0.2 + 0.06 * rise + 0.08 * fling, -0.3 + 0.16 * rise + 0.08 * fling + sway, -0.42 - 0.02 * rise - 0.25 * fling);
      this.heldGrenade.rotation.set(-0.4 - 1.2 * fling, 0.3, 0.2);
    }

    // The knife: up from below the dipped gun, a straight stab that lands at hitAt, back down.
    const stabbing = w.state === 'stabbing';
    const kr = this.knife.root;
    kr.visible = stabbing && w.progress > 0.03 && w.progress < 0.97;
    if (stabbing) {
      const t = w.progress;
      const hit = TUNING.melee.hitAt;
      const up = smoothstep(0, 0.22, t) * (1 - smoothstep(0.75, 1, t));
      const out = t < hit ? smoothstep(0.12, hit, t) : 1 - smoothstep(hit + 0.1, 0.8, t);
      kr.position.set(0.19 - 0.07 * out, -0.4 + 0.22 * up + 0.07 * out, -0.24 - 0.26 * out);
      kr.rotation.set(0.35 * (1 - up) + 0.05 * out, 0.1 - 0.12 * out, -0.2 + 0.15 * out, 'YXZ');
    }
  }

  /** Seconds since the last shot, for the trigger finger's tap. */
  private triggerTime = 9;

  /** The trigger finger curls in and lets go after each shot; the trigger moves back with it. */
  private triggerTap(m: WeaponModel, dt: number): void {
    this.triggerTime += dt;
    const t = this.triggerTime;
    const pull = t < TRIGGER.pull ? t / TRIGGER.pull : t < TRIGGER.pull + TRIGGER.release ? 1 - (t - TRIGGER.pull) / TRIGGER.release : 0;
    if (m.hands.trigger) m.hands.trigger.rotation.x = -pull * TRIGGER.angle;
    m.trigger.position.z = pull * TRIGGER.travel;
  }

  private onShot(m: WeaponModel, T: (typeof TUNING)['pistol'], ads: number): void {
    this.triggerTime = 0;
    const a = 1 + (T.kickAdsMul - 1) * ads;
    const r = () => Math.random() * 2 - 1;
    // Mostly an instant displacement (sharp), a little velocity (follow-through).
    const snap = (s: Spring, amount: number) => {
      s.x += amount * 0.75;
      s.v += amount * 0.25 * 30;
    };
    snap(this.kick.z, T.kickBack * a);
    snap(this.kick.y, T.kickUp * a);
    snap(this.kick.pitch, T.kickPitch * DEG * a);
    snap(this.kick.yaw, T.kickYaw * DEG * r() * a);
    snap(this.kick.roll, T.kickRoll * DEG * r() * a);
    if (!this.silenced) this.flashTime = 0;
    this.flashFront.rotation.z = Math.random() * Math.PI * 2;
    const s = 0.8 + Math.random() * 0.45;
    this.flashFront.scale.setScalar(s * (1 - ads * 0.35));
    this.flashSide.scale.set(1, 1, 0.8 + Math.random() * 0.5);
    this.spawnCasing(m);
  }

  private spawnCasing(m: WeaponModel): void {
    const c = this.casings[this.casingIndex++ % this.casings.length]!;
    m.eject.updateWorldMatrix(true, false);
    c.mesh.position.setFromMatrixPosition(m.eject.matrixWorld);
    c.mesh.scale.set(...m.casingScale);
    c.vel.set(0.9 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, 0.25 + Math.random() * 0.3);
    c.spin.set(Math.random() * 30, Math.random() * 30, 20 + Math.random() * 20);
    c.mesh.rotation.set(0, 0, Math.PI / 2);
    c.life = 0;
    c.played = false;
    c.mesh.visible = true;
  }

  private updateCasings(dt: number): void {
    for (const c of this.casings) {
      if (!c.mesh.visible) continue;
      c.life += dt;
      c.vel.y -= 9 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life > 0.5) {
        c.mesh.visible = false;
        if (!c.played) {
          c.played = true;
          this.onCasingLand?.();
        }
      }
    }
  }

  /**
   * A chat open on the player's phone: the gun drops to one hand and the phone comes up into the
   * lower left of the view. While the left hand is needed (reloads, throws) the phone dips away.
   */
  private phonePose(p: Pose, w: WeaponController, dt: number, alpha: number): void {
    const busy = w.state === 'reloading' || w.grenadeBusy;
    const goal = busy ? 0 : lerp(w.phonePrev, w.phone, alpha);
    this.phoneK = damp(this.phoneK, goal, busy ? 14 : 10, dt);
    if (Math.abs(this.phoneK - goal) < 0.002) this.phoneK = goal;
    const k = smoothstep(0, 1, this.phoneK);
    if (k <= 0.001) return;
    // One-handed gun: a little lower, out to the right and canted.
    p.x += 0.022 * k;
    p.y -= 0.028 * k;
    p.z += 0.012 * k;
    p.roll -= 0.11 * k;
    p.pitch -= 0.035 * k;
  }

  /** The phone hand, placed in view space once the gun is placed (it is the gun model's child). */
  private phoneHand(m: WeaponModel): void {
    const hand = m.hands.phone;
    const k = smoothstep(0, 1, this.phoneK);
    for (const id of ['pistol', 'rifle'] as WeaponId[]) {
      const other = this.models[id];
      if (other && other !== m) other.hands.phone.visible = false;
    }
    hand.visible = k > 0.01;
    if (!hand.visible) return;
    if (this.phone.root.parent !== m.hands.phoneAnchor) m.hands.phoneAnchor.add(this.phone.root);
    this.phone.setGlow(k);
    // The left hand has left the gun for the phone.
    if (k > 0.5) m.hands.left.visible = false;
    // Lower left, screen turned up and in towards the eye; it rises from below and bobs.
    const bob = Math.sin(this.bobPhase) * 0.004 * this.bobAmt;
    this.phoneAt.set(-0.165 + bob, lerp(-0.4, -0.142, k) + Math.abs(bob) * 0.5, -0.335);
    this.phoneEuler.set(-0.55 + 0.3 * (1 - k), 0.3, -0.1, 'YXZ');
    this.phoneRot.setFromEuler(this.phoneEuler);
    this.phoneM.compose(this.phoneAt, this.phoneRot, this.one);
    this.holder.updateMatrixWorld(true);
    this.phoneM2.copy(hand.parent!.matrixWorld).invert().multiply(this.phoneM);
    this.phoneM2.decompose(hand.position, hand.quaternion, hand.scale);
  }

  /** Reload, inspect and weapon-switch animation layered onto the pose. */
  private applyTimeline(p: Pose, m: WeaponModel, w: WeaponController): void {
    const t = w.progress;
    // At rest the magazine is seated: its group sits at the pivot (only the pistol's is at 0).
    m.mag.position.copy(m.magPivot);
    m.mag.rotation.set(0, 0, 0);
    m.mag.visible = true;
    m.bolt.position.set(0, 0, 0);
    const lh = m.hands.left;
    lh.position.set(0, 0, 0);
    lh.rotation.set(0, 0, 0);
    lh.visible = m.supportHandAtRest;
    const rh = m.hands.leftRack;
    if (rh) {
      rh.position.set(0, 0, 0);
      rh.rotation.set(0, 0, 0);
      rh.visible = false;
    }
    switch (w.state) {
      case 'reloading': {
        const empty = w.reloadEmpty;
        const refill = TUNING[w.current].reloadRefill;
        const end = empty ? 1 : 0.92;
        p.roll += curve(t, [
          [0, 0],
          [0.14, 0.42],
          [refill - 0.02, 0.38],
          [refill + 0.06, empty ? -0.12 : 0.1],
          [0.86, empty ? -0.14 : 0],
          [end, 0],
        ]);
        p.pitch += curve(t, [
          [0, 0],
          [0.14, 0.16],
          [0.35, 0.05],
          [refill, 0.12],
          [refill + 0.05, 0.2],
          [0.9, 0.04],
          [end, 0],
        ]);
        p.yaw += curve(t, [
          [0, 0],
          [0.14, -0.12],
          [refill + 0.08, -0.08],
          [end, 0],
        ]);
        // Long guns lift further and tilt more so the magwell comes into view.
        const lift = curve(t, [
          [0, 0],
          [0.16, 1],
          [refill + 0.08, 1],
          [end, 0],
        ]);
        p.x += m.reloadLift.x * lift;
        p.y += m.reloadLift.y * lift;
        p.z += m.reloadLift.z * lift;
        p.roll += m.reloadLift.roll * lift;
        p.pitch += m.reloadLift.pitch * lift;
        p.yaw += m.reloadLift.yaw * lift;
        // Lift the gun into view and towards the centre so the magazine change is visible.
        p.x += curve(t, [
          [0, 0],
          [0.14, -0.05],
          [refill + 0.1, -0.045],
          [end, 0],
        ]);
        p.y += curve(t, [
          [0, 0],
          [0.14, 0.05],
          [0.38, 0.03],
          [refill - 0.03, 0.045],
          [refill, 0.055],
          [refill + 0.08, 0.045],
          [0.88, 0.03],
          [end, 0],
        ]);
        p.z += curve(t, [
          [0, 0],
          [0.14, 0.03],
          [refill + 0.1, 0.035],
          [end, 0],
        ]);
        // Magazine: rocks out (AK) or drops, a fresh one comes up and seats at the refill moment.
        let d: number;
        if (t < 0.1) d = 0;
        else if (t < 0.32) d = Math.pow((t - 0.1) / 0.22, 2) * 0.24;
        else if (t < 0.4) d = 0.3;
        else if (t < refill - 0.05) d = lerp(0.2, 0.012, smoothstep(0, 1, (t - 0.4) / (refill - 0.05 - 0.4)));
        else if (t < refill) d = lerp(0.012, 0, (t - (refill - 0.05)) / 0.05);
        else d = 0;
        const rock = t < 0.06 ? 0 : t < 0.14 ? (t - 0.06) / 0.08 : t < refill - 0.05 ? 1 : t < refill ? 1 - (t - (refill - 0.05)) / 0.05 : 0;
        m.mag.visible = !(t >= 0.32 && t < 0.4);
        m.mag.position.copy(m.magPivot).addScaledVector(m.magAxis, d);
        m.mag.rotation.x = rock * m.magRock;
        // Support hand: off to the pouch, back holding the fresh magazine, seats it.
        const away = curve(t, [
          [0.06, 0],
          [0.2, 1],
          [0.36, 1],
          [0.44, 0],
        ]);
        const under = curve(t, [
          [0.3, 0],
          [0.42, 1],
          [refill, 1],
          [refill + 0.1, 0],
        ]);
        const rack = empty
          ? curve(t, [
              [refill + 0.06, 0],
              [0.7, 1],
              [0.81, 1],
              [0.92, 0],
            ])
          : 0;
        const b = empty
          ? curve(t, [
              [0.7, 0],
              [0.76, 1],
              [0.81, 1],
              [0.83, 0],
            ])
          : 0;
        m.bolt.position.z = b * m.boltTravel;
        const offU = new THREE.Vector3().copy(m.magHandOffset).addScaledVector(m.magAxis, d);
        const offR = new THREE.Vector3().copy(m.rackOffset);
        offR.z += b * m.boltTravel;
        const offA = new THREE.Vector3(-0.06, -0.24, 0.14);
        if (m.supportHandAtRest) {
          lh.position.copy(offA).multiplyScalar(away).addScaledVector(offU, under).addScaledVector(offR, rack);
          lh.rotation.x = 0.6 * away - 0.5 * rack;
          lh.rotation.z = -0.5 * under;
        } else {
          // One-handed weapon: the left hand comes up from out of view holding the fresh
          // magazine (posed on it, so it rides with it) and, after an empty reload, pinches the
          // bolt (a second pose, swapped halfway as the hand moves between the two).
          const w = Math.max(under, rack);
          const s = under + rack > 1e-6 ? rack / (under + rack) : 0;
          const hand = rh && s > 0.5 ? rh : lh;
          lh.visible = false;
          hand.position.copy(offA).multiplyScalar(1 - w).addScaledVector(offU.lerp(offR, s), w);
          hand.rotation.x = 0.6 * (1 - w);
          hand.visible = w > 0.02;
        }
        break;
      }
      case 'inspecting': {
        const show = curve(t, [
          [0, 0],
          [0.24, 1],
          [0.8, 1],
          [1, 0],
        ]);
        const ip = m.inspectPose;
        p.x += ip.x * show;
        p.y += ip.y * show;
        p.z += ip.z * show;
        p.pitch += ip.pitch * show;
        p.yaw += ip.yaw * show;
        p.roll += ip.roll * show + Math.sin(t * Math.PI * 2) * 0.03 * show;
        // The support hand lets go while the gun is turned over.
        lh.position.set(-0.05 * show, -0.22 * show, 0.12 * show);
        lh.rotation.x = 0.5 * show;
        lh.visible = m.supportHandAtRest && show < 0.98;
        break;
      }
      case 'priming':
      case 'holding':
      case 'throwing': {
        // The gun dips out of the way while the other hand has the grenade.
        const k = w.state === 'priming' ? smoothstep(0, 0.8, t) : w.state === 'holding' ? 1 : 1 - smoothstep(0.45, 1, t);
        p.y -= 0.1 * k;
        p.pitch -= 0.45 * k;
        p.roll += 0.3 * k;
        p.x += 0.03 * k;
        break;
      }
      case 'stabbing': {
        // The gun drops out of the way while the knife does its work.
        const k = smoothstep(0, 0.18, t) * (1 - smoothstep(0.75, 1, t));
        p.y -= 0.2 * k;
        p.pitch -= 0.8 * k;
        p.roll += 0.25 * k;
        p.x += 0.04 * k;
        break;
      }
      case 'holstering': {
        const d = smoothstep(0, 1, t);
        p.y -= 0.22 * d;
        p.pitch -= 0.7 * d;
        p.roll += 0.2 * d;
        break;
      }
      case 'drawing': {
        const d = 1 - smoothstep(0, 1, t);
        p.y -= 0.22 * d;
        p.pitch -= 0.6 * d - Math.sin(t * Math.PI) * 0.05;
        p.roll -= 0.15 * d;
        break;
      }
      case 'ready':
        break;
    }
  }

  landingImpulse(speed: number): void {
    this.land.v -= Math.min(0.5, speed * 0.05);
  }

  jumpImpulse(): void {
    this.land.v += 0.12;
    this.kick.pitch.v -= 0.4;
  }
}
