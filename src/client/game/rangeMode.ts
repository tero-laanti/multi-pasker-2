import type * as THREE from 'three';
import type { TraceResult } from '../../shared/collision/world';
import { TUNING, type WeaponId } from '../../shared/config';
import { FI } from '../../shared/fi';
import { blastReaches, explosionDamage } from '../../shared/grenade';
import type { Vec3 } from '../../shared/math';
import { RangeSim, type RangeEvent } from '../../shared/rangeSim';
import { UI } from '../../shared/ui';
import { damageFor } from '../../shared/weapons';
import type { Game, GameMode } from './game';
import type { Explosion } from './grenades';
import { RangeView } from './rangeView';

const BEST_KEY = 'pasker.rangeBest';

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Ampumarata: targets, drills and range commands; everything is simulated locally. */
export class RangeMode implements GameMode {
  readonly alive = true;
  /** The drill line at the top of the screen (hidden while the training explains things). */
  showDrill = true;
  readonly range: RangeSim;
  private view: RangeView;
  private best = loadBest();

  constructor(private game: Game) {
    this.range = new RangeSim(game.map.targets);
    this.view = new RangeView(this.range);
    game.root.add(this.view.group);
    game.newSerials();
    game.weapons.endlessSpare = true;
  }

  reload(): void {
    this.game.weapons.startReload();
  }

  giveGrenade(): void {
    const w = this.game.weapons;
    if (w.grenades < w.maxGrenades) w.grenades++;
  }

  give(id: WeaponId): void {
    this.game.weapons.give(id);
    this.game.weapons.switchTo(id);
  }

  step(dt: number): void {
    this.range.update(dt);
    for (const e of this.range.events) this.onRangeEvent(e);
    this.range.events.length = 0;
  }

  grenadeReleased(o: [number, number, number], v: [number, number, number]): void {
    this.game.grenades.spawn(o[0], o[1], o[2], v, TUNING.grenade.fuse, 0);
  }

  exploded(e: Explosion): void {
    const { audio, hud } = this.game.deps;
    const dist = Math.hypot(e.x - this.game.eye.x, e.y - this.game.eye.y, e.z - this.game.eye.z);
    let hits = 0;
    let downs = 0;
    for (const t of this.range.targets) {
      if (t.up < 0.5) continue;
      const cy = t.def.kind === 'silhouette' ? t.y + 1.1 : t.y;
      const d = Math.hypot(t.x - e.x, cy - e.y, t.z - e.z);
      const dmg = explosionDamage(d);
      if (dmg <= 0 || !blastReaches(this.game.world, e.x, e.y, e.z, t.x, cy, t.z)) continue;
      hits++;
      if (this.range.applyHit({ target: t, zone: 'body', t: d, x: t.x, y: cy, z: t.z }, dmg, true)) downs++;
    }
    if (hits > 0) {
      hud.hitMarker(downs > 0 ? 'kill' : 'body');
      audio.play(downs > 0 ? 'hit_kill' : 'hit_body', { bus: 'ui', volume: 0.8, delay: dist / 343 });
    }
  }

  shot(weapon: WeaponId, eye: THREE.Vector3, dir: Vec3, tr: TraceResult): boolean {
    const { audio, hud } = this.game.deps;
    const effects = this.game.effects;
    const wallDist = tr.fraction * TUNING[weapon].range;
    const hit = this.range.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, wallDist);
    this.range.noteShot();
    if (!hit) return false;
    const t = hit.target;
    const zone = hit.zone;
    if (t.def.kind === 'silhouette') {
      const dmg = damageFor(weapon, zone, hit.t, this.game.killSpeed);
      const down = this.range.applyHit(hit, dmg);
      this.view.mark(t, hit.x, hit.y, hit.z);
      effects.hitPuff(hit.x, hit.y, hit.z, -dir.x, -dir.y, -dir.z, false);
      audio.playAt('impact_wood', hit.x, hit.y, hit.z, { volume: 0.8 });
      hud.hitMarker(down ? 'kill' : zone === 'head' ? 'head' : 'body');
      audio.play(down ? 'hit_kill' : zone === 'head' ? 'hit_head' : 'hit_body', { bus: 'ui', volume: down ? 0.9 : 0.7, delay: 0.01 });
    } else {
      this.range.applyHit(hit, 0);
      const gong = t.def.kind === 'gong';
      audio.playAt(gong ? 'steel_gong' : 'steel_plate', hit.x, hit.y, hit.z, { volume: 1, refDistance: 6, rolloff: 0.6, maxDistance: 300 });
      effects.impact(hit.x, hit.y, hit.z, -dir.x, -dir.y, -dir.z, 6);
      hud.hitMarker('body');
      audio.play('hit_body', { bus: 'ui', volume: 0.5 });
    }
    return true;
  }

  private onRangeEvent(e: RangeEvent): void {
    const { hud, audio } = this.game.deps;
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

  render(): void {
    this.view.update();
    if (this.showDrill) this.game.deps.hud.drillStatus(this.range.drillPhase, this.range.drillTime, this.range.drill.score);
    else this.game.deps.hud.hideDrill();
  }
}
