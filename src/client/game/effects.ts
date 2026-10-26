import * as THREE from 'three';
import { EFFECTS } from '../../shared/config';
import { SURFACE } from '../../shared/map/types';
import { makeRng } from '../../shared/math';

function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = makeRng(3);
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(10,10,10,1)');
  grad.addColorStop(0.22, 'rgba(20,18,16,0.95)');
  grad.addColorStop(0.38, 'rgba(60,55,50,0.6)');
  grad.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(25,22,20,0.55)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    g.lineTo(32 + Math.cos(a) * (12 + r() * 14), 32 + Math.sin(a) * (12 + r() * 14));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  gravity: number;
  drag: number;
}

/** One draw call per blend mode: soft dust/smoke (normal blending) and sparks (additive). */
class ParticleLayer {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo = new THREE.BufferGeometry();

  constructor(
    private max: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture() }, scale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.01) discard;
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  set viewportScale(px: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = px;
  }

  emit(p: Omit<Particle, 'life'>): void {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push({ ...p, life: 0 });
  }

  update(dt: number): void {
    let n = 0;
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * (1 - k) * Math.min(1, p.life * 30);
      this.size[n] = p.size * (1 + p.grow * k);
      keep.push(p);
      n++;
    }
    this.parts = keep;
    this.geo.setDrawRange(0, n);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }
}

const SURFACE_STYLE: Record<number, { dust: [number, number, number]; chips: number; sparks: number; decal: [number, number, number] }> = {
  [SURFACE.concrete]: { dust: [0.78, 0.76, 0.72], chips: 6, sparks: 0, decal: [0.75, 0.75, 0.75] },
  [SURFACE.dirt]: { dust: [0.5, 0.42, 0.32], chips: 5, sparks: 0, decal: [0.55, 0.5, 0.45] },
  [SURFACE.grass]: { dust: [0.45, 0.42, 0.3], chips: 4, sparks: 0, decal: [0.4, 0.4, 0.35] },
  [SURFACE.gravel]: { dust: [0.62, 0.6, 0.55], chips: 7, sparks: 0, decal: [0.6, 0.6, 0.6] },
  [SURFACE.wood]: { dust: [0.62, 0.5, 0.36], chips: 6, sparks: 0, decal: [0.65, 0.55, 0.45] },
  [SURFACE.metal]: { dust: [0.6, 0.6, 0.6], chips: 0, sparks: 8, decal: [1.2, 1.2, 1.2] },
  [SURFACE.sand]: { dust: [0.72, 0.64, 0.5], chips: 6, sparks: 0, decal: [0.6, 0.55, 0.45] },
  [SURFACE.canvas]: { dust: [0.5, 0.52, 0.4], chips: 2, sparks: 0, decal: [0.4, 0.4, 0.35] },
};

/** Pooled impact effects: decals, dust and debris, sparks. */
export class Effects {
  readonly group = new THREE.Group();
  private decals: THREE.InstancedMesh;
  private decalIndex = 0;
  private decalCount = 0;
  private dust = new ParticleLayer(EFFECTS.maxParticles, false);
  private sparks = new ParticleLayer(Math.floor(EFFECTS.maxParticles / 3), true);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 0, 1);
  private c = new THREE.Color();

  constructor() {
    const mat = new THREE.MeshStandardMaterial({
      map: holeTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 1,
    });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, EFFECTS.maxDecals);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.decals.renderOrder = 2;
    this.group.add(this.decals, this.dust.points, this.sparks.points);
  }

  setViewportHeight(px: number, fovDeg: number): void {
    const scale = px / (2 * Math.tan(((fovDeg * Math.PI) / 180) / 2));
    this.dust.viewportScale = scale;
    this.sparks.viewportScale = scale;
  }

  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, surface: number): void {
    const st = SURFACE_STYLE[surface] ?? SURFACE_STYLE[SURFACE.concrete]!;
    this.v.set(nx, ny, nz);
    this.q.setFromUnitVectors(this.up, this.v);
    const spin = new THREE.Quaternion().setFromAxisAngle(this.up, Math.random() * Math.PI * 2);
    this.q.multiply(spin);
    this.s.setScalar(size * (0.8 + Math.random() * 0.4));
    this.m.compose(this.v.set(x + nx * 0.003, y + ny * 0.003, z + nz * 0.003), this.q, this.s);
    const i = this.decalIndex;
    this.decals.setMatrixAt(i, this.m);
    this.decals.setColorAt(i, this.c.setRGB(...st.decal));
    this.decalIndex = (this.decalIndex + 1) % EFFECTS.maxDecals;
    this.decalCount = Math.min(EFFECTS.maxDecals, this.decalCount + 1);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: number): void {
    const st = SURFACE_STYLE[surface] ?? SURFACE_STYLE[SURFACE.concrete]!;
    const rnd = () => Math.random() * 2 - 1;
    // Dust puff along the normal.
    for (let i = 0; i < 4; i++) {
      const sp = 0.6 + Math.random() * 1.2;
      this.dust.emit({
        x,
        y,
        z,
        vx: nx * sp + rnd() * 0.3,
        vy: ny * sp + rnd() * 0.3 + 0.2,
        vz: nz * sp + rnd() * 0.3,
        max: 0.6 + Math.random() * 0.5,
        size: 0.07 + Math.random() * 0.05,
        grow: 2.5,
        r: st.dust[0],
        g: st.dust[1],
        b: st.dust[2],
        a: 0.55,
        gravity: -0.15,
        drag: 3.5,
      });
    }
    for (let i = 0; i < st.chips; i++) {
      const sp = 2 + Math.random() * 3;
      this.dust.emit({
        x,
        y,
        z,
        vx: nx * sp + rnd() * 1.5,
        vy: ny * sp + rnd() * 1.5 + 1,
        vz: nz * sp + rnd() * 1.5,
        max: 0.5 + Math.random() * 0.3,
        size: 0.012 + Math.random() * 0.012,
        grow: 0,
        r: st.dust[0] * 0.6,
        g: st.dust[1] * 0.6,
        b: st.dust[2] * 0.6,
        a: 1,
        gravity: 9.8,
        drag: 0.5,
      });
    }
    for (let i = 0; i < st.sparks; i++) {
      const sp = 3 + Math.random() * 5;
      this.sparks.emit({
        x,
        y,
        z,
        vx: nx * sp + rnd() * 2.5,
        vy: ny * sp + rnd() * 2.5 + 0.5,
        vz: nz * sp + rnd() * 2.5,
        max: 0.12 + Math.random() * 0.18,
        size: 0.012 + Math.random() * 0.01,
        grow: -0.5,
        r: 1.0,
        g: 0.75,
        b: 0.35,
        a: 1,
        gravity: 9.8,
        drag: 1.5,
      });
    }
  }

  /** Puff for hits on targets and players (red tint for players, wood chips for boards). */
  hitPuff(x: number, y: number, z: number, nx: number, ny: number, nz: number, player: boolean): void {
    const rnd = () => Math.random() * 2 - 1;
    for (let i = 0; i < (player ? 6 : 5); i++) {
      const sp = 0.8 + Math.random() * 1.6;
      this.dust.emit({
        x,
        y,
        z,
        vx: nx * sp + rnd() * 0.5,
        vy: ny * sp + rnd() * 0.5,
        vz: nz * sp + rnd() * 0.5,
        max: 0.35 + Math.random() * 0.25,
        size: player ? 0.06 : 0.05,
        grow: 1.5,
        r: player ? 0.75 : 0.72,
        g: player ? 0.08 : 0.6,
        b: player ? 0.06 : 0.42,
        a: 0.8,
        gravity: 1.5,
        drag: 3,
      });
    }
  }

  /** Grenade blast: flash core, dust ring, smoke column, sparks, debris and a scorch mark. */
  explosion(x: number, y: number, z: number): void {
    const rnd = () => Math.random() * 2 - 1;
    for (let i = 0; i < 14; i++) {
      this.sparks.emit({ x, y: y + 0.2, z, vx: rnd() * 2, vy: Math.random() * 2, vz: rnd() * 2, max: 0.12 + Math.random() * 0.08, size: 0.5 + Math.random() * 0.4, grow: 1.5, r: 1, g: 0.75, b: 0.4, a: 0.9, gravity: 0, drag: 6 });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      this.dust.emit({ x, y: y + 0.15, z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 1.2, vz: Math.sin(a) * sp, max: 1.4 + Math.random() * 0.8, size: 0.5 + Math.random() * 0.4, grow: 3, r: 0.55, g: 0.5, b: 0.42, a: 0.6, gravity: -0.1, drag: 2.6 });
    }
    for (let i = 0; i < 16; i++) {
      this.dust.emit({ x: x + rnd() * 0.4, y: y + 0.3, z: z + rnd() * 0.4, vx: rnd() * 0.6, vy: 2 + Math.random() * 3, vz: rnd() * 0.6, max: 2.2 + Math.random() * 1.2, size: 0.6 + Math.random() * 0.5, grow: 3.5, r: 0.32, g: 0.31, b: 0.3, a: 0.55, gravity: -0.4, drag: 1.4 });
    }
    for (let i = 0; i < 30; i++) {
      const sp = 5 + Math.random() * 9;
      this.sparks.emit({ x, y: y + 0.1, z, vx: rnd() * sp, vy: Math.random() * sp * 0.8, vz: rnd() * sp, max: 0.3 + Math.random() * 0.4, size: 0.02 + Math.random() * 0.02, grow: -0.5, r: 1, g: 0.7, b: 0.3, a: 1, gravity: 9.8, drag: 1 });
    }
    for (let i = 0; i < 20; i++) {
      const sp = 3 + Math.random() * 7;
      this.dust.emit({ x, y: y + 0.1, z, vx: rnd() * sp, vy: 2 + Math.random() * sp, vz: rnd() * sp, max: 0.9 + Math.random() * 0.5, size: 0.03 + Math.random() * 0.03, grow: 0, r: 0.2, g: 0.18, b: 0.15, a: 1, gravity: 9.8, drag: 0.4 });
    }
    this.decal(x, y + 0.002, z, 0, 1, 0, 2.2, 1);
  }

  muzzleSmoke(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    for (let i = 0; i < 2; i++) {
      this.dust.emit({
        x: x + dx * 0.05,
        y: y + dy * 0.05,
        z: z + dz * 0.05,
        vx: dx * 0.6 + (Math.random() - 0.5) * 0.2,
        vy: dy * 0.6 + 0.25,
        vz: dz * 0.6 + (Math.random() - 0.5) * 0.2,
        max: 0.6 + Math.random() * 0.4,
        size: 0.05,
        grow: 4,
        r: 0.82,
        g: 0.82,
        b: 0.8,
        a: 0.16,
        gravity: -0.3,
        drag: 2,
      });
    }
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
  }
}
