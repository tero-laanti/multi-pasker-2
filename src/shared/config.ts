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
  /** Tarkkuuskivääri: the Sotku's sniper rifle (key 3), bolt action, scoped. */
  sniper: {
    rpm: 48,
    magazine: 5,
    range: 400,
    falloffStart: 400,
    falloffEnd: 401,
    adsTime: 0.3,
    adsOutTime: 0.2,
    adsZoom: 4,
    sprintInTime: 0.24,
    sprintToFire: 0.24,
    drawTime: 0.55,
    holsterTime: 0.22,
    reloadTime: 2.2,
    reloadEmptyTime: 2.5,
    reloadRefill: 0.6,
    inspectTime: 1.6,
    fireBuffer: 0.05,
    spreadHip: 6,
    spreadMove: 4,
    spreadAir: 8,
    spreadCrouchMul: 0.8,
    spreadAds: 0,
    spreadAdsMove: 1.2,
    spreadPerShot: 0,
    spreadMax: 10,
    spreadRecover: 8,
    recoilPitchStart: 3.2,
    recoilPitchEnd: 3.2,
    recoilRampShots: 1,
    recoilYawAmp: 0.4,
    recoilYawPeriod: 2,
    recoilYawBias: 0.1,
    recoilRandPitch: 0.3,
    recoilRandYaw: 0.3,
    recoilAimShare: 0.2,
    recoilReturn: 6,
    recoilRise: 45,
    recoilAdsMul: 0.9,
    recoilCrouchMul: 0.85,
    recoilReset: 0.5,
    kickBack: 0.09,
    kickUp: 0.02,
    kickPitch: 9,
    kickYaw: 1.2,
    kickRoll: 2.5,
    kickAdsMul: 0.5,
    kickStiffness: 200,
    kickDamping: 18,
    vmHipX: 0.14,
    vmHipY: -0.15,
    vmHipZ: -0.4,
    vmAdsZ: -0.2,
    swayLook: 1.2,
    bob: 1,
    moveSpeedMul: 0.9,
  },
  // Damage per hit. "cod" is the fast default; "scramble" gives ~0.75 s body kills.
  killSpeed: {
    cod: {
      pistolBody: 25,
      pistolHead: 50,
      rifleBodyNear: 20,
      rifleBodyFar: 17,
      rifleHead: 30,
      sniperBody: 90,
      sniperHead: 200,
    },
    scramble: {
      pistolBody: 17,
      pistolHead: 34,
      rifleBodyNear: 13,
      rifleBodyFar: 11,
      rifleHead: 20,
      sniperBody: 75,
      sniperHead: 200,
    },
  },
  /** Spare magazines per gun at spawn; R takes one, the armourer's LATAA fills them again. */
  ammo: {
    spareMagazines: 1,
  },
  player: {
    health: 100,
    regenDelay: 4.5,
    regenRate: 40,
    respawnTime: 2.5,
    spawnProtect: 1,
  },
  /** The knife (V): a stab at arm's length with the gun lowered. Two stabs kill from full health. */
  melee: {
    damage: 55,
    /** Reach from the eye to the target's body (m), and how far off the view it may be (degrees). */
    range: 1.9,
    cone: 30,
    /** The whole stab (s), and when in it (fraction) the blade lands. */
    time: 0.6,
    hitAt: 0.32,
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
export type WeaponId = 'pistol' | 'rifle' | 'sniper';
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

/** The armourer's surprise inventory checks: a question about your own kit, answered by phone. */
export const INVENTORY = {
  /** Seconds between checks for each player (random in this range). */
  interval: [90, 180] as [number, number],
  /** No check in a player's first seconds in the match (after joining, deploying or a new round). */
  settle: 60,
  /** Seconds to answer. A right answer earns a grenade; no right answer in time, push-ups. */
  answerTime: 20,
  /** A check that falls due at a bad moment (dead, phone away) waits this long (s). */
  retry: 8,
};

/**
 * The service: one per player for the whole evening, TJ 347 → 0, kept by name across rounds and
 * server restarts. Every day served pays the päiväraha; the Sotku App opens after P-kausi.
 */
export const SERVICE = {
  /** Days in the service: TJ at the start. */
  days: 347,
  /** Days served for a kill, for being killed by someone else, and extra when the victim outranks the killer. */
  killDays: 3,
  deathDays: 1,
  seniorDays: 2,
  /** Päiväraha in € a day, from the day given on (days count from 1). Each rise is also a promotion. */
  pay: [
    [1, 5],
    [166, 10],
    [256, 15],
  ] as [number, number][],
  /** P-kausi (six weeks): the Sotku App opens after this many days, and alokas becomes sotamies. */
  pkausi: 42,
  /** P-kausi's gear, handed out by text on the day given. */
  gear: [
    [1, 'rifle'],
    [10, 'lipas'],
    [20, 'puukko'],
    [30, 'vyo'],
  ] as [number, string][],
  /** How often (s) a changed service is written to the evening file. */
  saveEvery: 5,
};

/**
 * The Sotku App's shop: four paths of rows I–IV. A node `needs` one of the listed nodes first
 * (bought counts, even before its paperwork is done). Prices in €.
 */
export const SOTKU = {
  items: {
    pveto: { path: 'sp', tier: 1, price: 120 },
    plipas: { path: 'sp', tier: 2, price: 200, needs: ['pveto'] },
    lonkka: { path: 'sp', tier: 2, price: 200, needs: ['pveto'] },
    ontelo: { path: 'sp', tier: 3, price: 350, needs: ['plipas', 'lonkka'] },
    kevyt: { path: 'sp', tier: 3, price: 300, needs: ['plipas', 'lonkka'] },
    sarja: { path: 'sp', tier: 4, price: 600, needs: ['ontelo', 'kevyt'] },
    suujarru: { path: 'ta', tier: 1, price: 120 },
    lipas2: { path: 'ta', tier: 2, price: 200, needs: ['suujarru'] },
    lukko: { path: 'ta', tier: 2, price: 200, needs: ['suujarru'] },
    rumpu: { path: 'ta', tier: 3, price: 350, needs: ['lipas2'] },
    vaimennin: { path: 'ta', tier: 3, price: 350, needs: ['lukko'] },
    tkiv: { path: 'ta', tier: 4, price: 700, needs: ['rumpu', 'vaimennin'] },
    pikavalinta: { path: 'vm', tier: 1, price: 100 },
    autofill: { path: 'vm', tier: 2, price: 200, needs: ['pikavalinta'] },
    tutka: { path: 'vm', tier: 2, price: 200, needs: ['pikavalinta'] },
    tumma: { path: 'vm', tier: 3, price: 300, needs: ['autofill', 'tutka'] },
    kannykka: { path: 'vm', tier: 3, price: 300, needs: ['tutka'] },
    lennokki: { path: 'vm', tier: 4, price: 600, needs: ['tumma', 'kannykka'] },
    tihea: { path: 'pi', tier: 1, price: 100 },
    heitto: { path: 'pi', tier: 2, price: 200, needs: ['tihea'] },
    sytytin: { path: 'pi', tier: 2, price: 200, needs: ['tihea'] },
    kolmas: { path: 'pi', tier: 3, price: 300, needs: ['heitto', 'sytytin'] },
    raskas: { path: 'pi', tier: 3, price: 350, needs: ['heitto', 'sytytin'] },
    tuli: { path: 'pi', tier: 4, price: 650, needs: ['kolmas', 'raskas'] },
  },
  /** The café: consumables, bought as often as you like. */
  cafe: { munkki: 30, nakkisuoja: 40 },
};

/** What the Sotku's gear does: the numbers behind the shop's nodes. */
export const GEAR = {
  /** Pistoolikoulutus: draw and aim times are multiplied by this. */
  pistolDrawMul: 0.5,
  pistolMagazine: 18,
  /** Lonkalta: the pistol's hip spread (also on the move) is multiplied by this. */
  pistolHipMul: 0.5,
  /** Ontelokärjet: pistol body hits. */
  pistolBody: 34,
  /** Kevyt varustus: movement with the pistol out. */
  pistolMoveMul: 1.1,
  /** Sarjatulipistooli. */
  pistolAutoRpm: 1000,
  /** Tutka: minimap range (m) and how much longer shots stay on it. */
  radarRange: 70,
  radarShotMul: 2,
  /** Tiedustelulennokki: every enemy on the minimap for this long (s), once a round. */
  droneTime: 15,
  /** Tiheä huolto: seconds between KRANAATTI deliveries. */
  grenadeCooldown: 5,
  /** Pitkä heitto: throw speed multiplier. */
  throwMul: 1.3,
  /** Lyhyt sytytin: the fuse (s). */
  shortFuse: 1.8,
  /** Raskas panos: blast radius (m). */
  heavyRadius: 8,
  /** Tulitoimitus: mortar rounds, landing this long (s) after TULI, scattered this far (m), once a round. */
  mortarRounds: 3,
  mortarDelay: 10,
  mortarSpread: 5,
  mortarGap: 0.8,
};

/** The minimap in the match HUD: the garrison from above, turned so your view points up. */
export const MINIMAP = {
  /** Metres from your position to the edge of the map circle. */
  range: 45,
  /** How long (s) an enemy's shot shows as a red dot where it was fired. Suppressed shots never show. */
  shotShow: 2.5,
};

/** The browser version (mp2.laanti.fi): no server to join, so its bot match runs one in the page. */
export const WEB_MATCH = {
  /** Bots in the bot match. With the player that makes 8, so the gate stays shut. */
  bots: 7,
};

export const AUDIO = {
  maxGunshotVoices: 24,
  hearingRange: 120,
  /** Every gunshot (yours and others', near and far, tails and suppressed), relative to the other sounds. */
  gunVolume: 0.7,
};

export const EFFECTS = {
  maxDecals: 160,
  maxParticles: 600,
  decalLife: 40,
};
