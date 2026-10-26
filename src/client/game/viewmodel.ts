import * as THREE from 'three';
import { TUNING, type WeaponId } from '../../shared/config';
import { DEG, clamp, damp, lerp, smoothstep } from '../../shared/math';
import { buildPistol, type WeaponModel } from './models/pistol';
import type { WeaponController } from './weapons';

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
  private casingIndex = 0;
  onCasingLand: (() => void) | null = null;
  /** World-space muzzle flash strength for lighting (0..1). */
  flash = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.holder);
    this.models.pistol = buildPistol();
    this.holder.add(this.models.pistol.root);
    this.models.pistol.root.visible = false;

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

    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
    const geo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 10);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(geo, brass);
      mesh.visible = false;
      scene.add(mesh);
      this.casings.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, played: true });
    }
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

    // Walk bob in step with stride, scaled by speed.
    const stride = mo.sprinting ? 2.1 : 1.65;
    this.bobPhase += (mo.speed * dt * Math.PI * 2) / stride;
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

    // Bob, breathing, sway, landing.
    const ph = this.bobPhase;
    p.x += Math.sin(ph) * 0.0065 * bobK;
    p.y -= Math.abs(Math.sin(ph)) * 0.0085 * bobK;
    p.roll += Math.sin(ph) * 0.012 * bobK;
    p.yaw += Math.sin(ph) * 0.006 * bobK;
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
  }

  private onShot(m: WeaponModel, T: (typeof TUNING)['pistol'], ads: number): void {
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
    this.flashTime = 0;
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

  /** Reload, inspect and weapon-switch animation layered onto the pose. */
  private applyTimeline(p: Pose, m: WeaponModel, w: WeaponController): void {
    const t = w.progress;
    m.mag.position.set(0, 0, 0);
    m.mag.visible = true;
    m.bolt.position.set(0, 0, 0);
    const lh = m.hands.left;
    lh.position.set(0, 0, 0);
    lh.rotation.set(0, 0, 0);
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
        // Magazine: drops out, a fresh one rises and slams home at the refill moment.
        let d: number;
        if (t < 0.1) d = 0;
        else if (t < 0.32) d = Math.pow((t - 0.1) / 0.22, 2) * 0.22;
        else if (t < 0.4) d = 0.3;
        else if (t < refill - 0.04) d = lerp(0.18, 0.014, smoothstep(0, 1, (t - 0.4) / (refill - 0.04 - 0.4)));
        else if (t < refill) d = lerp(0.014, 0, (t - (refill - 0.04)) / 0.04);
        else d = 0;
        m.mag.visible = !(t >= 0.32 && t < 0.4);
        m.mag.position.copy(m.magAxis).multiplyScalar(d);
        // Support hand: off to the pouch, back under the grip with the fresh magazine, seats it.
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
        lh.position.set(-0.06 * away, -0.24 * away, 0.14 * away);
        lh.rotation.x = 0.6 * away;
        if (under > 0) {
          lh.position.x += 0.024 * under;
          lh.position.y += (-0.06 + m.magAxis.y * d) * under;
          lh.position.z += (0.03 + m.magAxis.z * d) * under;
          lh.rotation.z = -0.5 * under;
        }
        if (empty) {
          const b = curve(t, [
            [0.7, 0],
            [0.76, 0.026],
            [0.81, 0.026],
            [0.83, 0],
          ]);
          m.bolt.position.z = b;
          const rack = curve(t, [
            [refill + 0.06, 0],
            [0.7, 1],
            [0.81, 1],
            [0.92, 0],
          ]);
          lh.position.addScaledVector(m.rackOffset, rack);
          lh.position.z += b * rack;
          lh.rotation.x -= 0.5 * rack;
        }
        break;
      }
      case 'inspecting': {
        const show = curve(t, [
          [0, 0],
          [0.22, 1],
          [0.78, 1],
          [1, 0],
        ]);
        p.yaw -= 0.95 * show;
        p.roll += 0.35 * show + Math.sin(t * Math.PI * 2) * 0.04 * show;
        p.pitch += 0.12 * show;
        p.x -= 0.075 * show;
        p.y += 0.035 * show;
        p.z += 0.06 * show;
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
