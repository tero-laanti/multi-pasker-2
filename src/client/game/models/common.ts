import * as THREE from 'three';
import { makeRng } from '../../../shared/math';

/**
 * Modelling helpers for first-person weapons. Model space: X right, Y up, muzzle towards -Z,
 * units in metres. Side profiles are written as (z, y) pairs and extruded across X.
 */

export function extrudeSide(points: [number, number][], halfWidth: number, bevel = 0.0012, curveSegments = 6): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  const depth = Math.max(0.0002, halfWidth * 2 - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Side profile with rounded corners (shared with the hand-posing distance field). */
export { roundedProfile } from './weaponShapes';

/** Cylinder along Z from z0 to z1 (z0 > z1 is fine). */
export function cylZ(r0: number, r1: number, z0: number, z1: number, y = 0, x = 0, seg = 20): THREE.BufferGeometry {
  const len = Math.abs(z1 - z0);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

export function boxAt(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D) => void, srgb = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Normal map from a height function drawn into a canvas. */
export function normalFromHeight(size: number, height: (x: number, y: number) => number, strength: number): THREE.CanvasTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  return canvasTex(size, (g) => {
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = h[y * size + ((x - 1 + size) % size)]!;
        const r = h[y * size + ((x + 1) % size)]!;
        const u = h[((y - 1 + size) % size) * size + x]!;
        const d = h[((y + 1) % size) * size + x]!;
        let nx = (l - r) * strength;
        let ny = (u - d) * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * size + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

let cache: WeaponMaterials | null = null;

export interface WeaponMaterials {
  blued: THREE.MeshStandardMaterial;
  bluedWorn: THREE.MeshStandardMaterial;
  parkerized: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  bore: THREE.MeshStandardMaterial;
  gripChecker: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  sightDot: THREE.MeshStandardMaterial;
}

/** Shared weapon materials; created once. */
export function weaponMaterials(): WeaponMaterials {
  if (cache) return cache;
  const rng = makeRng(77);
  const speck = Array.from({ length: 900 }, () => [rng(), rng(), rng()] as const);
  const roughMap = canvasTex(256, (g) => {
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, 256, 256);
    for (const [x, y, k] of speck) {
      g.fillStyle = `rgba(${k > 0.5 ? 210 : 60},${k > 0.5 ? 210 : 60},${k > 0.5 ? 210 : 60},0.25)`;
      g.fillRect(x * 256, y * 256, 1 + k * 3, 1 + k * 2);
    }
  });
  const checker = normalFromHeight(
    256,
    (u, v) => {
      const a = Math.abs(((u * 24 + v * 24) % 1) - 0.5);
      const b = Math.abs(((u * 24 - v * 24 + 100) % 1) - 0.5);
      return Math.min(a, b) * 2;
    },
    2.2,
  );
  const grain = canvasTex(
    256,
    (g) => {
      const r = makeRng(5);
      g.fillStyle = '#6a3f22';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 220; i++) {
        g.strokeStyle = `rgba(${40 + r() * 30},${22 + r() * 15},${10 + r() * 8},${0.25 + r() * 0.35})`;
        g.lineWidth = 0.5 + r() * 2;
        g.beginPath();
        const y = r() * 256;
        g.moveTo(0, y);
        for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 6 + (r() - 0.5) * 2);
        g.stroke();
      }
    },
    true,
  );
  cache = {
    blued: new THREE.MeshStandardMaterial({ color: 0x33363a, metalness: 0.78, roughness: 0.44, roughnessMap: roughMap }),
    bluedWorn: new THREE.MeshStandardMaterial({ color: 0x464b50, metalness: 0.88, roughness: 0.32, roughnessMap: roughMap }),
    parkerized: new THREE.MeshStandardMaterial({ color: 0x2f3330, metalness: 0.7, roughness: 0.62, roughnessMap: roughMap }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.5 }),
    bore: new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.2, roughness: 0.9 }),
    gripChecker: new THREE.MeshStandardMaterial({ color: 0x3b2618, metalness: 0, roughness: 0.62, normalMap: checker, normalScale: new THREE.Vector2(0.9, 0.9) }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: grain, metalness: 0, roughness: 0.55 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x2a2b2b, metalness: 0, roughness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x3a342c, metalness: 0, roughness: 0.82, envMapIntensity: 0.35 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x55603f, metalness: 0, roughness: 0.95, envMapIntensity: 0.35 }),
    sightDot: new THREE.MeshStandardMaterial({ color: 0xf2f0e6, emissive: 0x403c30, roughness: 0.6 }),
  };
  return cache;
}

/** Engraved marking texture (for SA stamps and serial numbers): returns colour + bump-like normal. */
export function markingTexture(lines: string[], w = 512, h = 128): THREE.CanvasTexture {
  return canvasTex(
    w,
    (g) => {
      g.canvas.width = w;
      g.canvas.height = h;
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(220,220,210,0.92)';
      g.textBaseline = 'middle';
      const lh = h / lines.length;
      lines.forEach((l, i) => {
        g.font = `700 ${lh * 0.78}px "Barlow Condensed", "Arial Narrow", monospace`;
        g.fillText(l, 8, lh * (i + 0.5));
      });
    },
    true,
  );
}
