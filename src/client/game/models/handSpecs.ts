import type { HandPose } from './handSolve';

/**
 * Hand poses on each weapon, in the weapon's model space (X right, Y up, muzzle towards -Z,
 * metres). The hand is placed by three joints (wrist and the index and little finger
 * knuckles); fingers marked `wrap` close until they touch the weapon, the trigger finger and
 * the thumb are aimed with IK at a pad target. Angles are radians; flexion curls towards
 * the palm, positive spread turns a finger towards the thumb.
 */
export type HandKey = 'pistol.right' | 'pistol.left' | 'pistol.leftRack' | 'rifle.right' | 'rifle.left' | 'phone.left';

// One-handed pistol grip: web high under the bolt, back of the hand round the right side,
// fingers round the front strap, index finger along the frame onto the trigger, thumb
// forward along the left of the frame.
const pistolRight: HandPose = {
  weapon: 'pistol',
  place: { indexMcp: [0.03, -0.04, -0.03], along: [0, -0.12, -0.99], back: [0.99, 0.15, 0] },
  palmPress: 0.006,
  cup: 0.008,
  forearm: [0.25, -0.55, 0.8],
  index: { mcp: { flex: 0.15, abd: 0.05 }, pip: 0.5, dip: 0.3, pad: { at: [0, -0.037, -0.0755], normal: [0, 0, 1] } },
  middle: { mcp: { flex: 0.5, abd: 0 }, pip: 0.3, dip: 0.2, wrap: true },
  ring: { mcp: { flex: 0.5, abd: 0.06 }, pip: 0.3, dip: 0.2, wrap: true },
  pinky: { mcp: { flex: 0.5, abd: 0.14 }, pip: 0.3, dip: 0.2, wrap: true },
  thumb: { aim: { mcp: [-0.018, -0.024, 0.013], ip: [-0.0215, -0.022, -0.018], tip: [-0.0215, -0.021, -0.042], pad: [1, 0, 0] } },
  wrapAxis: { p: [0, -0.03, -0.02], d: [0, -0.906, 0.423] },
  sleeve: { start: 0.05, length: 0.3, radius: 0.036 },
};

// Left hand during pistol reloads, posed on the seated magazine (it rides with the magazine):
// base plate in the palm, fingers curled round its front, thumb up the left of the grip.
const pistolLeft: HandPose = {
  weapon: 'pistol',
  left: true,
  avoid: 'pistol.right',
  place: { indexMcp: [-0.022, -0.136, -0.026], along: [0.15, 0, -1], back: [0, -1, 0] },
  palmPress: 0.004,
  forearm: [-0.35, -0.55, 0.75],
  index: { mcp: { flex: 0.2 }, pip: 0.3, dip: 0.2, wrap: true },
  middle: { mcp: { flex: 0.2 }, pip: 0.3, dip: 0.2, wrap: true },
  ring: { mcp: { flex: 0.2 }, pip: 0.3, dip: 0.2, wrap: true },
  pinky: { mcp: { flex: 0.2 }, pip: 0.3, dip: 0.2, wrap: true },
  thumb: { aim: { mcp: [-0.032, -0.128, 0.022], ip: [-0.027, -0.107, 0.024], tip: [-0.024, -0.093, 0.024], pad: [1, 0, 0] } },
  sleeve: { start: 0.05, length: 0.3, radius: 0.036 },
};

// Left hand racking the pistol: thumb and index finger pinch the cocking piece from behind.
const pistolLeftRack: HandPose = {
  weapon: 'pistol',
  left: true,
  avoid: 'pistol.right',
  place: { indexMcp: [-0.014, 0.03, 0.036], along: [0.45, -0.35, -0.82], back: [-0.3, 0.9, 0.2] },
  palmPress: 0.004,
  forearm: [-0.3, -0.8, 0.52],
  index: { mcp: { flex: 0.5 }, pip: 0.9, dip: 0.4, pad: { at: [0.0095, 0.0095, 0.006], normal: [-0.85, -0.5, 0] } },
  middle: { mcp: { flex: 1.25 }, pip: 1.45, dip: 0.9 },
  ring: { mcp: { flex: 1.35 }, pip: 1.5, dip: 0.9 },
  pinky: { mcp: { flex: 1.45 }, pip: 1.5, dip: 0.9 },
  thumb: { aim: { mcp: [-0.03, 0.02, 0.034], ip: [-0.019, 0.013, 0.014], tip: [-0.0145, 0.0105, 0.0], pad: [0.85, -0.5, 0] } },
  sleeve: { start: 0.05, length: 0.3, radius: 0.036 },
};

// Rifle: right hand on the pistol grip, index finger on the trigger, thumb round the left
// side of the grip.
const rifleRight: HandPose = {
  weapon: 'rifle',
  place: { indexMcp: [0.032, -0.048, -0.014], along: [0, -0.04, -1], back: [0.99, 0.15, 0] },
  palmPress: 0.006,
  cup: 0.008,
  forearm: [0.3, -0.5, 0.81],
  index: { mcp: { flex: 0.15, abd: 0.05 }, pip: 0.5, dip: 0.3, pad: { at: [0, -0.04, -0.0625], normal: [0, 0, 1] } },
  middle: { mcp: { flex: 0.5, abd: 0 }, pip: 0.3, dip: 0.2, wrap: true },
  ring: { mcp: { flex: 0.5, abd: 0.06 }, pip: 0.3, dip: 0.2, wrap: true },
  pinky: { mcp: { flex: 0.5, abd: 0.14 }, pip: 0.3, dip: 0.2, wrap: true },
  thumb: { aim: { mcp: [-0.02, -0.042, 0.014], ip: [-0.026, -0.052, -0.016], tip: [-0.026, -0.06, -0.034], pad: [1, 0, 0] } },
  wrapAxis: { p: [0, -0.033, -0.016], d: [0, -0.96, 0.28] },
  sleeve: { start: 0.05, length: 0.3, radius: 0.036 },
};

// Left hand under the handguard: thumb along the left, fingers round the right side.
const rifleLeft: HandPose = {
  weapon: 'rifle',
  left: true,
  place: { wrist: [-0.055, -0.095, -0.305], indexMcp: [0.012, -0.046, -0.36], pinkyMcp: [0.012, -0.046, -0.302] },
  forearm: [-0.35, -0.6, 0.72],
  index: { mcp: { flex: 0.4 }, pip: 0.3, dip: 0.2, wrap: true },
  middle: { mcp: { flex: 0.4 }, pip: 0.3, dip: 0.2, wrap: true },
  ring: { mcp: { flex: 0.4 }, pip: 0.3, dip: 0.2, wrap: true },
  pinky: { mcp: { flex: 0.4 }, pip: 0.3, dip: 0.2, wrap: true },
  thumb: { aim: { mcp: [-0.034, -0.03, -0.346], ip: [-0.034, -0.017, -0.378], tip: [-0.0335, -0.01, -0.4], pad: [1, 0, 0] } },
  wrapAxis: { p: [0, -0.01, -0.33], d: [0, 0, 1] },
  sleeve: { start: 0.05, length: 0.3, radius: 0.036 },
};

// Left hand holding the phone (in the phone's frame: X right, Y along the long side, Z out of
// the screen): the left edge sits in the web of the thumb, the fingers wrap the back with their
// tips round the right edge, the thumb lies over the screen's left edge.
const phoneLeft: HandPose = {
  weapon: 'phone',
  left: true,
  // The fingers arch behind the phone and close until their pads meet it near the right edge.
  place: { indexMcp: [-0.029, 0.004, -0.04], along: [0.92, 0.38, 0], back: [0, 0, -1] },
  palmPress: 0.003,
  forearm: [-0.45, -0.75, 0.5],
  index: { mcp: { flex: 0.1, abd: 0.05 }, pip: 0.2, dip: 0.1, wrap: true },
  middle: { mcp: { flex: 0.1 }, pip: 0.2, dip: 0.1, wrap: true },
  ring: { mcp: { flex: 0.1, abd: -0.04 }, pip: 0.2, dip: 0.1, wrap: true },
  pinky: { mcp: { flex: 0.1, abd: -0.1 }, pip: 0.2, dip: 0.1, wrap: true },
  thumb: { aim: { mcp: [-0.05, -0.026, -0.006], ip: [-0.032, -0.008, 0.0138], tip: [-0.02, 0.016, 0.0136], pad: [0, 0, -1] } },
  sleeve: { start: 0.05, length: 0.3, radius: 0.036 },
};

export const HAND_POSES: Record<HandKey, HandPose> = {
  'pistol.right': pistolRight,
  'pistol.left': pistolLeft,
  'pistol.leftRack': pistolLeftRack,
  'rifle.right': rifleRight,
  'rifle.left': rifleLeft,
  'phone.left': phoneLeft,
};
