import { describe, expect, it } from 'vitest';
import { SIM_DT, TUNING } from '../src/shared/config';
import { timeToKill } from '../src/shared/weapons';
import { WeaponController, type WeaponInput } from '../src/client/game/weapons';

const idle: WeaponInput = {
  fireHeld: false,
  firePressed: false,
  adsHeld: false,
  sprinting: false,
  speed: 0,
  maxSpeed: 5,
  airborne: false,
  crouched: false,
  phone: false,
};

function ready(): WeaponController {
  const w = new WeaponController();
  const aim = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) w.step(SIM_DT, idle, aim);
  expect(w.state).toBe('ready');
  return w;
}

function run(w: WeaponController, seconds: number, inp: (i: number) => Partial<WeaponInput>) {
  const aim = { yaw: 0, pitch: 0 };
  let shots = 0;
  const steps = Math.round(seconds / SIM_DT);
  const times: number[] = [];
  for (let i = 0; i < steps; i++) {
    w.step(SIM_DT, { ...idle, ...inp(i) }, aim);
    if (w.shots.length) times.push(i * SIM_DT);
    shots += w.shots.length;
    w.shots.length = 0;
  }
  return { shots, aim, times };
}

describe('pistol', () => {
  it('caps the semi-auto fire rate even when clicking every step', () => {
    const w = ready();
    const r = run(w, 1, () => ({ firePressed: true, fireHeld: true }));
    const cap = TUNING.pistol.rpm / 60;
    expect(r.shots).toBeLessThanOrEqual(Math.ceil(cap) + 1);
    expect(r.shots).toBeGreaterThanOrEqual(Math.floor(cap));
  });

  it('holding the trigger fires once', () => {
    const w = ready();
    const r = run(w, 1, (i) => ({ firePressed: i === 0, fireHeld: true }));
    expect(r.shots).toBe(1);
  });

  it('first shot goes out on the step the trigger is pressed and is perfectly centred when aiming', () => {
    const w = ready();
    run(w, 0.5, () => ({ adsHeld: true }));
    const aim = { yaw: 0, pitch: 0 };
    w.step(SIM_DT, { ...idle, adsHeld: true, firePressed: true, fireHeld: true }, aim);
    expect(w.shots.length).toBe(1);
    const d = w.shots[0]!.dir;
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
  });

  it('a click during a sprint fires once the gun is up (sprint-to-fire)', () => {
    const w = ready();
    run(w, 0.5, () => ({ sprinting: true }));
    const r = run(w, 0.6, (i) => ({ firePressed: i === 0, fireHeld: i < 3 }));
    expect(r.shots).toBe(1);
    expect(r.times[0]!).toBeGreaterThanOrEqual(TUNING.pistol.sprintToFire - 2 * SIM_DT);
    expect(r.times[0]!).toBeLessThan(TUNING.pistol.sprintToFire + 0.05);
  });

  it('reaches full ADS in adsTime', () => {
    const w = ready();
    let t = 0;
    const aim = { yaw: 0, pitch: 0 };
    while (w.ads < 1 && t < 2) {
      w.step(SIM_DT, { ...idle, adsHeld: true }, aim);
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(TUNING.pistol.adsTime - 2 * SIM_DT);
    expect(t).toBeLessThan(TUNING.pistol.adsTime + 2 * SIM_DT);
  });

  it('reload refills at the refill moment and refuses a full magazine', () => {
    const w = ready();
    expect(w.startReload()).toBe('full');
    w.ammo.pistol = 0;
    expect(w.startReload()).toBe('ok');
    const dur = TUNING.pistol.reloadEmptyTime;
    let refillAt = -1;
    const aim = { yaw: 0, pitch: 0 };
    for (let i = 0; i < Math.round((dur + 0.2) / SIM_DT); i++) {
      w.step(SIM_DT, idle, aim);
      if (refillAt < 0 && w.ammo.pistol === TUNING.pistol.magazine) refillAt = (i + 1) * SIM_DT;
    }
    expect(refillAt).toBeCloseTo(dur * TUNING.pistol.reloadRefill, 1);
    expect(w.state).toBe('ready');
    expect(w.sounds.map((s) => s.name)).toEqual(['pistol_mag_out', 'pistol_mag_in', 'pistol_bolt_back', 'pistol_bolt_fwd']);
  });

  it('dry fires once per press when empty and cannot shoot during a reload', () => {
    const w = ready();
    w.ammo.pistol = 0;
    run(w, 0.3, (i) => ({ firePressed: i === 0, fireHeld: true }));
    expect(w.sounds.filter((s) => s.name === 'pistol_dry').length).toBe(1);
    w.ammo.pistol = 3;
    w.startReload();
    const r = run(w, 0.3, () => ({ firePressed: true, fireHeld: true }));
    expect(r.shots).toBe(0);
  });

  it('recoil climbs the aim and the punch returns', () => {
    const w = ready();
    const r = run(w, 0.02, (i) => ({ firePressed: i === 0, fireHeld: i === 0 }));
    expect(r.shots).toBe(1);
    const aim = r.aim;
    for (let i = 0; i < 6; i++) w.step(SIM_DT, idle, aim);
    expect(w.punchP).toBeGreaterThan(0.2);
    for (let i = 0; i < 120; i++) w.step(SIM_DT, idle, aim);
    expect(Math.abs(w.punchP)).toBeLessThan(0.02);
    const kept = (TUNING.pistol.recoilPitchEnd * TUNING.pistol.recoilAimShare * Math.PI) / 180;
    expect(aim.pitch).toBeGreaterThan(kept * 0.6);
    expect(aim.pitch).toBeLessThan(kept * 1.4);
  });
});

describe('rifle', () => {
  it('holds 600 rpm on full auto', () => {
    const w = ready();
    w.give('rifle');
    w.switchTo('rifle');
    run(w, 1, () => ({}));
    expect(w.current).toBe('rifle');
    const r = run(w, 1, () => ({ fireHeld: true, firePressed: false }));
    expect(r.shots).toBeGreaterThanOrEqual(10);
    expect(r.shots).toBeLessThanOrEqual(11);
  });
});

describe('time to kill', () => {
  it('matches the brief for the CoD preset', () => {
    expect(timeToKill('pistol', 'body', 10, 'cod').seconds).toBeCloseTo(0.45, 2);
    expect(timeToKill('pistol', 'head', 10, 'cod').seconds).toBeCloseTo(0.15, 2);
    expect(timeToKill('rifle', 'body', 10, 'cod').seconds).toBeCloseTo(0.4, 2);
    expect(timeToKill('rifle', 'head', 10, 'cod').seconds).toBeCloseTo(0.3, 2);
  });

  it('scramble gives roughly 0.7 to 0.8 s body kills', () => {
    for (const w of ['pistol', 'rifle'] as const) {
      const t = timeToKill(w, 'body', 10, 'scramble').seconds;
      expect(t).toBeGreaterThanOrEqual(0.69);
      expect(t).toBeLessThanOrEqual(0.81);
    }
  });
});

describe('recoil pattern', () => {
  it('pistol alternates left and right, rifle drifts smoothly', async () => {
    const { recoilKick } = await import('../src/shared/weapons');
    const k = { pitch: 0, yaw: 0 };
    const p = TUNING.pistol;
    const y0 = recoilKick(p, 0, 0, 0, k).yaw - p.recoilYawBias;
    const y1 = recoilKick(p, 1, 0, 0, k).yaw - p.recoilYawBias;
    expect(Math.sign(y0)).toBe(-Math.sign(y1));
    expect(Math.abs(y0)).toBeCloseTo(p.recoilYawAmp, 5);
    const r = TUNING.rifle;
    const first = recoilKick(r, 0, 0, 0, k).yaw - r.recoilYawBias;
    expect(Math.abs(first)).toBeLessThan(r.recoilYawAmp * 0.3);
  });
});

describe('holding the phone', () => {
  it('blocks aiming down sights and widens the hip spread', () => {
    const w = ready();
    const aim = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 120; i++) w.step(SIM_DT, { ...idle, adsHeld: true, phone: true }, aim);
    expect(w.ads).toBe(0);
    expect(w.phone).toBe(1);
    const shots: number[] = [];
    for (const phone of [false, true]) {
      const c = ready();
      for (let i = 0; i < 120; i++) c.step(SIM_DT, { ...idle, phone }, aim);
      c.step(SIM_DT, { ...idle, phone, fireHeld: true, firePressed: true }, aim);
      shots.push(c.shots[0]!.spread);
    }
    expect(shots[1]!).toBeGreaterThan(shots[0]! * 1.8 + 3);
  });
});
