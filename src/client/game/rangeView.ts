import * as THREE from 'three';
import { SILHOUETTE } from '../../shared/hitbox';
import type { RangeSim, TargetState } from '../../shared/rangeSim';

const MARKS = 24;

function silhouetteShape(): THREE.Shape {
  const S = SILHOUETTE;
  const s = new THREE.Shape();
  // Where the head circle meets the top of the torso: that is the neck.
  const dy = S.torsoTop - S.headV;
  const neck = Math.sqrt(Math.max(0, S.headR * S.headR - dy * dy));
  s.moveTo(-S.legHalf, S.bottom);
  s.lineTo(-S.legHalf, S.waistV);
  s.lineTo(-S.torsoHalf, S.waistV);
  s.lineTo(-S.torsoHalf, S.shoulderV);
  s.quadraticCurveTo(-S.torsoHalf, S.torsoTop, -neck - 0.04, S.torsoTop);
  s.lineTo(-neck, S.torsoTop);
  // Head: clockwise arc from the left of the neck over the top to the right.
  s.absarc(0, S.headV, S.headR, Math.atan2(dy, -neck), Math.atan2(dy, neck), true);
  s.lineTo(neck + 0.04, S.torsoTop);
  s.quadraticCurveTo(S.torsoHalf, S.torsoTop, S.torsoHalf, S.shoulderV);
  s.lineTo(S.torsoHalf, S.waistV);
  s.lineTo(S.legHalf, S.waistV);
  s.lineTo(S.legHalf, S.bottom);
  s.closePath();
  return s;
}

function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 768;
  const g = c.getContext('2d')!;
  const S = SILHOUETTE;
  g.fillStyle = '#cdb27a';
  g.fillRect(0, 0, 256, 768);
  // Board space u in [-0.3, 0.3] → x, v in [0, 1.8] → y (flipped).
  const X = (u: number) => ((u + 0.3) / 0.6) * 256;
  const Y = (v: number) => 768 - (v / 1.8) * 768;
  g.strokeStyle = 'rgba(70,58,35,0.55)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(X(0), Y(S.headV), (S.headR * 0.62 * 256) / 0.6, 0, Math.PI * 2);
  g.stroke();
  g.strokeRect(X(-0.14), Y(1.38), X(0.14) - X(-0.14), Y(1.0) - Y(1.38));
  g.fillStyle = 'rgba(90,70,40,0.25)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 256, Math.random() * 768, 2, 20 + Math.random() * 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / 0.6, 1 / 1.8);
  t.offset.set(0.5, 0);
  t.anisotropy = 8;
  return t;
}

interface TargetView {
  state: TargetState;
  group: THREE.Group;
  pivot: THREE.Group;
  marks?: THREE.InstancedMesh;
  markCount: number;
  plateMat?: THREE.MeshStandardMaterial;
  wasUp: boolean;
}

/** Meshes for the range targets, driven by RangeSim state every frame. */
export class RangeView {
  readonly group = new THREE.Group();
  private views: TargetView[] = [];
  private m = new THREE.Matrix4();

  constructor(sim: RangeSim) {
    const shape = silhouetteShape();
    const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false, curveSegments: 16 });
    boardGeo.translate(0, 0, -0.009);
    const boardMat = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.9 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x4d5550, roughness: 0.5, metalness: 0.6 });
    const markGeo = new THREE.CircleGeometry(0.009, 8);
    const markMat = new THREE.MeshBasicMaterial({ color: 0x1a1410 });

    for (const st of sim.targets) {
      const d = st.def;
      const group = new THREE.Group();
      group.position.set(st.x, st.y, st.z);
      group.rotation.y = d.yaw;
      const pivot = new THREE.Group();
      group.add(pivot);
      const view: TargetView = { state: st, group, pivot, markCount: 0, wasUp: st.up > 0.5 };
      if (d.kind === 'silhouette') {
        const board = new THREE.Mesh(boardGeo, boardMat);
        board.castShadow = true;
        board.receiveShadow = true;
        pivot.add(board);
        const marks = new THREE.InstancedMesh(markGeo, markMat, MARKS);
        marks.count = 0;
        marks.frustumCulled = false;
        pivot.add(marks);
        view.marks = marks;
        // Stand: hinge bar and two stakes behind the board.
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.06), woodMat);
        bar.position.set(0, 0.03, -0.04);
        bar.castShadow = true;
        group.add(bar);
        if (d.rail) {
          const cart = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.36), steelMat);
          cart.position.set(0, 0.0, 0);
          cart.castShadow = true;
          group.add(cart);
        }
      } else {
        const r = d.radius ?? 0.2;
        const isStart = d.kind === 'start';
        const color = isStart ? 0xe2b21f : d.kind === 'gong' ? 0xdcd6c6 : 0xf0ece2;
        const plateMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, emissive: 0xffffff, emissiveIntensity: 0 });
        view.plateMat = plateMat;
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.014, 28), plateMat);
        plate.rotation.x = Math.PI / 2;
        plate.castShadow = true;
        // Swing about a hinge at the top edge.
        pivot.position.y = r + 0.03;
        plate.position.y = -(r + 0.03);
        pivot.add(plate);
        const postH = st.y + r + 0.1;
        if (d.kind === 'gong') {
          for (const sx of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, postH, 0.07), woodMat);
            post.position.set(sx * (r + 0.12), -st.y + postH / 2, -0.05);
            post.castShadow = true;
            group.add(post);
          }
          const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * r + 0.34, 0.07, 0.07), woodMat);
          beam.position.set(0, r + 0.1, -0.05);
          beam.castShadow = true;
          group.add(beam);
          for (const sx of [-0.5, 0.5]) {
            const chain = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.09, 0.01), steelMat);
            chain.position.set(sx * r, -0.04, 0);
            pivot.add(chain);
          }
        } else {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, postH, 0.06), isStart ? steelMat : woodMat);
          post.position.set(0, -st.y + postH / 2, -0.06);
          post.castShadow = true;
          group.add(post);
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.08), steelMat);
          arm.position.set(0, r + 0.03, -0.03);
          group.add(arm);
        }
        group.position.y = st.y;
      }
      this.group.add(group);
      this.views.push(view);
    }
  }

  /** Records a bullet hole on a silhouette at a world-space point. */
  mark(target: TargetState, x: number, y: number, z: number): void {
    const v = this.views.find((w) => w.state === target);
    if (!v || !v.marks) return;
    const p = v.pivot.worldToLocal(new THREE.Vector3(x, y, z));
    p.z = 0.0095;
    this.m.makeTranslation(p.x, p.y, p.z);
    v.marks.setMatrixAt(v.markCount % MARKS, this.m);
    v.markCount++;
    v.marks.count = Math.min(MARKS, v.markCount);
    v.marks.instanceMatrix.needsUpdate = true;
  }

  update(): void {
    for (const v of this.views) {
      const st = v.state;
      v.group.position.x = st.x;
      if (st.def.kind === 'silhouette') {
        v.pivot.rotation.x = -(1 - st.up) * (Math.PI / 2) * 0.97;
        const up = st.upTarget === 1;
        if (up && !v.wasUp && v.marks) {
          v.markCount = 0;
          v.marks.count = 0;
        }
        v.wasUp = up;
      } else {
        v.pivot.rotation.x = st.swing;
        if (v.plateMat) v.plateMat.emissiveIntensity = st.hitFlash * 0.35;
      }
    }
  }
}
