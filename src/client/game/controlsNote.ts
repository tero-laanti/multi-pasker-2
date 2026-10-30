import * as THREE from 'three';
import { UI } from '../../shared/ui';
import { key, onDevice, type Control } from '../controls';

/**
 * The CONTROLS note pinned to the range's back wall, right behind where the training starts
 * (metres; it faces the firing point). `reach`: how close E reads it.
 */
export const CONTROLS_NOTE = { x: -4.5, y: 1.55, z: 7.19, yaw: Math.PI, width: 0.72, height: 0.96, reach: 2.4 };

const FONT = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const INK = '#1f241b';

/** A sheet of paper: the big title, then every key (or button) and what it does, as in the menu. */
function drawNote(c: HTMLCanvasElement): void {
  const W = c.width;
  const H = c.height;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece6d4';
  g.fillRect(0, 0, W, H);
  // A little weathering towards the bottom.
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(90, 70, 30, 0)');
  shade.addColorStop(1, 'rgba(90, 70, 30, 0.12)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  g.fillStyle = INK;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
  g.font = `700 150px ${FONT}`;
  g.fillText(UI.range.controlsTitle, W / 2, 178);
  g.fillRect(56, 208, W - 112, 8);
  const rows = UI.menu.controls.map(([ctl, what]) => [key(ctl as Control), what] as const);
  const top = 240;
  const step = Math.min(64, (H - 84 - top) / rows.length);
  const split = 268;
  rows.forEach(([key, what], i) => {
    const y = top + i * step + step * 0.74;
    g.textAlign = 'right';
    g.font = `700 ${Math.round(step * 0.78)}px ${FONT}`;
    g.fillText(key, split, y);
    // The longer explanations get a smaller size rather than running off the sheet.
    g.textAlign = 'left';
    let size = Math.round(step * 0.74);
    g.font = `500 ${size}px ${FONT}`;
    while (g.measureText(what).width > W - split - 56 && size > 20) {
      size -= 2;
      g.font = `500 ${size}px ${FONT}`;
    }
    g.fillText(what, split + 22, y);
  });
  g.textAlign = 'center';
  g.fillStyle = '#5c5d4d';
  g.font = `500 30px ${FONT}`;
  g.fillText(UI.menu.footer, W / 2, H - 36);
}

/** The note's texture, drawn again whenever the player switches between keys and a controller. */
function noteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 1024;
  drawNote(c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  onDevice(() => {
    drawNote(c);
    t.needsUpdate = true;
  });
  return t;
}

/** The note on the wall, with two drawing pins. */
export class ControlsNote {
  readonly object = new THREE.Group();

  constructor() {
    const N = CONTROLS_NOTE;
    // A little light of its own: paper under the roof's shade still reads as white.
    const map = noteTexture();
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(N.width, N.height), new THREE.MeshStandardMaterial({ map, roughness: 0.92, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.3 }));
    paper.receiveShadow = true;
    this.object.add(paper);
    const pin = new THREE.SphereGeometry(0.014, 10, 8);
    const red = new THREE.MeshStandardMaterial({ color: 0xc23a2b, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pin, red);
      p.position.set(side * (N.width / 2 - 0.05), N.height / 2 - 0.05, 0.008);
      this.object.add(p);
    }
    this.object.position.set(N.x, N.y, N.z);
    this.object.rotation.y = N.yaw;
  }

  /** Within reach and looking its way. */
  near(eye: THREE.Vector3, yaw: number): boolean {
    const dx = CONTROLS_NOTE.x - eye.x;
    const dz = CONTROLS_NOTE.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d > CONTROLS_NOTE.reach) return false;
    return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d > Math.cos((50 * Math.PI) / 180);
  }

  /** Still close enough to keep reading (walking off closes it). */
  inReach(eye: THREE.Vector3): boolean {
    return Math.hypot(CONTROLS_NOTE.x - eye.x, CONTROLS_NOTE.z - eye.z) < CONTROLS_NOTE.reach + 0.6;
  }
}
