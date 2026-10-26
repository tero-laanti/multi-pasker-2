/**
 * Every tuning value in the game lives in this module.
 *
 * TUNING (between the TUNING-BEGIN/END markers) holds the gun and movement values that the
 * live tuning panel (F4) edits. Its "Tallenna config.ts" button rewrites the numbers in place,
 * so keep one `key: value,` per line there; comments on their own line or after a value are kept.
 *
 * Units: metres, seconds, degrees, rounds per minute.
 */

// TUNING-BEGIN
export const TUNING = {
  move: {
    walkSpeed: 5.2,
    sprintSpeed: 7.6,
    crouchSpeed: 2.6,
    // Speed multiplier while aiming down sights.
    adsSpeedMul: 0.6,
    backSpeedMul: 0.85,
    strafeSpeedMul: 0.92,
    groundAccel: 14,
    airAccel: 2.5,
    friction: 8,
    // Below this speed friction acts as if moving at stopSpeed, for crisp stops.
    stopSpeed: 3,
    gravity: 18.5,
    jumpVelocity: 6,
    jumpCooldown: 0.22,
    // Fraction of horizontal speed lost on a hard landing.
    landSlowdown: 0.25,
    stepHeight: 0.45,
    // Extra step-up while airborne: lets a jump clear a ledge slightly above the jump apex.
    airStepHeight: 0.1,
    groundSnap: 0.45,
    radius: 0.36,
    standHeight: 1.8,
    crouchHeight: 1.2,
    standEye: 1.62,
    crouchEye: 1.02,
    // Eye height change rate when crouching or standing (1/s).
    eyeRate: 14,
    // Forward input needed to keep sprinting (0..1).
    sprintMinForward: 0.5,
  },
  pistol: {
    rpm: 400,
    magazine: 12,
    range: 150,
    falloffStart: 30,
    falloffEnd: 60,
    adsTime: 0.2,
    adsOutTime: 0.16,
    // FOV magnification while aiming.
    adsZoom: 1.22,
    sprintInTime: 0.18,
    sprintToFire: 0.16,
    drawTime: 0.3,
    holsterTime: 0.14,
    reloadTime: 1.2,
    reloadEmptyTime: 1.4,
    // Fraction of the reload at which the magazine counts as refilled.
    reloadRefill: 0.6,
    inspectTime: 1.5,
    // A click this early is remembered and fires as soon as the gun is ready.
    fireBuffer: 0.06,
    spreadHip: 1.1,
    spreadMove: 1.8,
    spreadAir: 4,
    spreadCrouchMul: 0.75,
    spreadAds: 0,
    spreadAdsMove: 0.35,
    spreadPerShot: 0.55,
    spreadMax: 4.5,
    // Spread bloom recovery (degrees per second).
    spreadRecover: 9,
    // Camera kick per shot (degrees): pitch ramps from Start to End over RampShots shots.
    recoilPitchStart: 1.45,
    recoilPitchEnd: 1.45,
    recoilRampShots: 1,
    // Learnable sideways pattern: yaw = bias + amp * sin(2pi * (shot + 0.5) / period).
    recoilYawAmp: 0.22,
    recoilYawPeriod: 2,
    recoilYawBias: 0.05,
    recoilRandPitch: 0.2,
    recoilRandYaw: 0.25,
    // Share of each kick that stays in your aim; the rest springs back.
    recoilAimShare: 0.35,
    // How fast the temporary kick returns (1/s).
    recoilReturn: 11,
    // How fast a kick rises to its peak (1/s); higher is sharper.
    recoilRise: 55,
    recoilAdsMul: 0.8,
    recoilCrouchMul: 0.85,
    // Shot pattern restarts after this long without firing.
    recoilReset: 0.32,
    // Viewmodel kick (visual only).
    kickBack: 0.055,
    kickUp: 0.012,
    kickPitch: 8,
    kickYaw: 1.4,
    kickRoll: 3,
    kickAdsMul: 0.45,
    kickStiffness: 260,
    kickDamping: 21,
    // Viewmodel placement at the hip (metres in camera space) and sight distance when aiming.
    vmHipX: 0.112,
    vmHipY: -0.098,
    vmHipZ: -0.34,
    vmAdsZ: -0.42,
    swayLook: 1,
    bob: 1,
    moveSpeedMul: 1,
  },
  rifle: {
    rpm: 600,
    magazine: 30,
    range: 250,
    falloffStart: 25,
    falloffEnd: 45,
    adsTime: 0.24,
    adsOutTime: 0.18,
    adsZoom: 1.3,
    sprintInTime: 0.2,
    sprintToFire: 0.19,
    drawTime: 0.42,
    holsterTime: 0.18,
    reloadTime: 1.35,
    reloadEmptyTime: 1.5,
    reloadRefill: 0.58,
    inspectTime: 1.5,
    fireBuffer: 0.05,
    spreadHip: 1.9,
    spreadMove: 2.4,
    spreadAir: 5,
    spreadCrouchMul: 0.75,
    spreadAds: 0,
    spreadAdsMove: 0.45,
    spreadPerShot: 0.28,
    spreadMax: 5,
    spreadRecover: 7,
    recoilPitchStart: 0.9,
    recoilPitchEnd: 0.55,
    recoilRampShots: 6,
    recoilYawAmp: 0.32,
    recoilYawPeriod: 14,
    recoilYawBias: 0.06,
    recoilRandPitch: 0.12,
    recoilRandYaw: 0.14,
    recoilAimShare: 0.7,
    recoilReturn: 9,
    recoilRise: 50,
    recoilAdsMul: 0.85,
    recoilCrouchMul: 0.85,
    recoilReset: 0.22,
    kickBack: 0.04,
    kickUp: 0.008,
    kickPitch: 3.5,
    kickYaw: 0.9,
    kickRoll: 1.6,
    kickAdsMul: 0.35,
    kickStiffness: 300,
    kickDamping: 24,
    vmHipX: 0.13,
    vmHipY: -0.135,
    vmHipZ: -0.3,
    vmAdsZ: -0.13,
    swayLook: 1,
    bob: 1,
    moveSpeedMul: 0.96,
  },
  // Damage per hit. "cod" is the fast default; "scramble" gives ~0.75 s body kills.
  killSpeed: {
    cod: {
      pistolBody: 25,
      pistolHead: 50,
      rifleBodyNear: 20,
      rifleBodyFar: 17,
      rifleHead: 30,
    },
    scramble: {
      pistolBody: 17,
      pistolHead: 34,
      rifleBodyNear: 13,
      rifleBodyFar: 11,
      rifleHead: 20,
    },
  },
  player: {
    health: 100,
    regenDelay: 4.5,
    regenRate: 40,
    respawnTime: 2.5,
    spawnProtect: 1,
  },
  grenade: {
    fuse: 2.5,
    throwSpeed: 17,
    throwUp: 0.2,
    restitution: 0.42,
    groundFriction: 0.62,
    damage: 130,
    radius: 6.5,
    innerRadius: 1.2,
    supplyCooldown: 15,
  },
  /** Holding the phone (a chat is open): the gun is in one hand. */
  phoneOut: {
    /** Hip spread is multiplied, then widened by this many degrees. */
    spreadMul: 1.8,
    spreadAdd: 3.5,
    recoilMul: 1.5,
    moveSpeedMul: 0.92,
    /** Seconds to raise or put away the phone. */
    raiseTime: 0.3,
  },
};
// TUNING-END

export type Tuning = typeof TUNING;
export type WeaponId = 'pistol' | 'rifle';
export type WeaponTuning = Tuning['pistol'];
export type KillSpeedPreset = keyof Tuning['killSpeed'];

/** Fixed simulation step for movement and weapons, independent of frame rate. */
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

export const VIEW = {
  /** Horizontal field of view in degrees, measured on a 16:9 screen (Hor+ for other shapes). */
  defaultFov: 95,
  viewmodelFov: 58,
  /** Degrees of rotation per raw mouse count at sensitivity 1 (the Source/CS convention). */
  degreesPerCount: 0.022,
  defaultSensitivity: 2,
};

export const NET = {
  defaultPort: 8088,
  tickHz: 60,
  snapshotHz: 30,
  /** Interpolation delay = max(minDelay, snapshot interval * 1.5 + jitter * jitterScale). */
  interpMinDelay: 0.05,
  interpJitterScale: 2.5,
  interpMaxDelay: 0.25,
  /** Shot validation rewinds remote positions at most this far. */
  maxRewind: 0.2,
  pingInterval: 1,
};

export const PHONE = {
  /** Seconds a touch on the phone counts as recent activity. */
  activeTime: 2.5,
  /** A victim counts as typing (kill-feed draft) if their draft changed this recently (s). */
  draftRecent: 6,
  /** Public typo feed: one line per this many seconds, at most this many lines, fade time. */
  typoInterval: 1.5,
  typoLines: 4,
  typoFade: 6,
  /** Spam: this many messages within the window (s), or the same text this many times. */
  spamCount: 5,
  spamWindow: 4,
  spamRepeat: 3,
  /** Varusmestari timing (s): read delay, typing speed (chars/s), typing time limits. */
  readDelay: [0.35, 1.1] as [number, number],
  typingCps: 28,
  typingMin: 0.6,
  typingMax: 2.6,
  /** Drafts and touch activity are streamed at most this often (s). */
  streamInterval: 0.25,
};

export const AUDIO = {
  maxGunshotVoices: 24,
  hearingRange: 120,
};

export const EFFECTS = {
  maxDecals: 160,
  maxParticles: 600,
  decalLife: 40,
};
