import * as THREE from 'three';
import { FI } from '../../../shared/fi';
import { PHONE } from './weaponShapes';

/**
 * The phone in the first-person view: a dark slab with a lit screen showing a miniature of the
 * Kenttäposti chat with the armourer. Same size as the slab the phone hand was posed around;
 * origin at its centre, the screen facing +Z.
 */

const [W, H, D] = PHONE.size;

function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 528;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ecebe3';
  g.fillRect(0, 0, 256, 528);
  // Header.
  g.fillStyle = '#2b3423';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#8a7a3a';
  g.beginPath();
  g.arc(38, 34, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f3f1e6';
  g.font = 'bold 22px -apple-system, Roboto, Arial, sans-serif';
  g.fillText(FI.varusmestari.name, 62, 32);
  g.font = '15px -apple-system, Roboto, Arial, sans-serif';
  g.fillStyle = 'rgba(243,241,230,0.7)';
  g.fillText(FI.varusmestari.number, 62, 52);
  // Bubbles.
  const bubble = (x: number, y: number, w: number, h: number, mine: boolean) => {
    g.fillStyle = mine ? '#4d5d33' : '#ffffff';
    g.beginPath();
    g.roundRect(x, y, w, h, 14);
    g.fill();
    g.fillStyle = mine ? 'rgba(255,255,255,0.85)' : 'rgba(29,31,26,0.55)';
    for (let ly = y + 12; ly < y + h - 8; ly += 14) g.fillRect(x + 12, ly, w - 24 - ((ly * 7) % 30), 6);
  };
  bubble(12, 82, 190, 82, false);
  bubble(120, 178, 122, 30, true);
  bubble(12, 220, 150, 44, false);
  bubble(150, 276, 92, 30, true);
  // Compose field and keyboard.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(10, 330, 190, 34, 17);
  g.fill();
  g.fillStyle = '#4d5d33';
  g.beginPath();
  g.arc(225, 347, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d3d1c7';
  g.fillRect(0, 376, 256, 152);
  g.fillStyle = '#fbfaf5';
  for (let row = 0; row < 4; row++) {
    const n = row === 3 ? 3 : row === 2 ? 9 : 11;
    const kw = row === 3 ? 60 : 20;
    const total = n * kw + (n - 1) * 3;
    for (let i = 0; i < n; i++) g.fillRect((256 - total) / 2 + i * (kw + 3), 386 + row * 34, kw, 28);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface PhoneModel {
  root: THREE.Group;
  /** Brightness of the screen, 0..1 (fades with the raise). */
  setGlow(k: number): void;
}

export function buildPhone(): PhoneModel {
  const root = new THREE.Group();
  root.name = 'phone';
  // Exactly the slab the hand was fitted to: 8 mm corners, square edges.
  const r = PHONE.corner;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2 + r, -H / 2);
  shape.lineTo(W / 2 - r, -H / 2);
  shape.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
  shape.lineTo(W / 2, H / 2 - r);
  shape.quadraticCurveTo(W / 2, H / 2, W / 2 - r, H / 2);
  shape.lineTo(-W / 2 + r, H / 2);
  shape.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - r);
  shape.lineTo(-W / 2, -H / 2 + r);
  shape.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
  const slab = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -D / 2);
  const body = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.35, metalness: 0.4 }));
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false, transparent: true });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.006, H - 0.012), screenMat);
  screen.position.z = D / 2 + 0.0004;
  root.add(body, screen);
  return {
    root,
    setGlow(k: number) {
      screenMat.color.setScalar(0.35 + 0.55 * k);
    },
  };
}
