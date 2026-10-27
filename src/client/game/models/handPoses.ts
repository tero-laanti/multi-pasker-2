import type { GlovePose, HandKey } from './hands';

/**
 * Where each hand sits on its weapon (weapon model space: X right, Y up, muzzle towards -Z,
 * metres) or on the phone (phone space: X right, Y along the long side, Z out of the screen).
 * Finger curls are radians; the thumb's joints and the forearm are in the holder's space.
 */

// One-handed pistol grip: the web of the hand high on the back of the grip, the palm on its
// right side, fingers round the front, the index finger on the trigger, the thumb along the
// left of the frame.
const pistolRight: GlovePose = {
  wrist: [0.0343, -0.0572, 0.0668],
  along: [0, -0.12, -0.993],
  back: [0.989, 0.148, -0.018],
  forearm: [0.15, -0.35, 0.92],
  index: { spread: 0.08, mcp: 0.1, pip: 1.15, dip: 0.35 },
  middle: { mcp: 0.89, pip: 1.6, dip: 0.59 },
  ring: { mcp: 0.83, pip: 1.5, dip: 0.56 },
  pinky: { spread: -0.03, mcp: 0.71, pip: 1.24, dip: 0.48 },
  thumb: { mcp: [-0.02, -0.024, 0.013], ip: [-0.0235, -0.022, -0.018], tip: [-0.0235, -0.021, -0.042] },
};

// Left hand during pistol reloads, on the seated magazine (it rides with the magazine):
// base plate in the palm, fingers round its front, thumb up the left of the grip.
const pistolLeft: GlovePose = {
  left: true,
  wrist: [-0.0073, -0.1295, 0.0713],
  along: [0.148, 0, -0.989],
  back: [0, -1, 0],
  forearm: [-0.35, -0.3, 0.9],
  index: { mcp: 0.65, pip: 1.3, dip: 0.78 },
  middle: { mcp: 0.55, pip: 1.1, dip: 0.66 },
  ring: { mcp: 0.56, pip: 1.12, dip: 0.67 },
  pinky: { mcp: 0.65, pip: 1.3, dip: 0.78 },
  thumb: { mcp: [-0.032, -0.128, 0.022], ip: [-0.027, -0.107, 0.024], tip: [-0.024, -0.093, 0.024] },
};

// Left hand racking the pistol: from the left side, palm to the gun, the thumb over the
// cocking piece and the curled index finger under it; the forearm runs back and down.
const pistolLeftRack: GlovePose = {
  left: true,
  wrist: [-0.042, -0.028, 0.122],
  along: [0.15, 0.2, -0.97],
  back: [-1, 0, 0],
  forearm: [-0.4, -0.35, 0.85],
  index: { mcp: 0.6, pip: 1.0, dip: 0.5 },
  middle: { mcp: 1.2, pip: 1.4, dip: 0.8 },
  ring: { mcp: 1.2, pip: 1.4, dip: 0.8 },
  pinky: { mcp: 1.25, pip: 1.4, dip: 0.8 },
  thumb: { mcp: [-0.034, 0.024, 0.034], ip: [-0.022, 0.02, 0.018], tip: [-0.012, 0.016, 0.008] },
};

// Rifle: right hand on the pistol grip, index finger on the trigger, thumb round the left.
const rifleRight: GlovePose = {
  wrist: [0.0363, -0.0729, 0.0811],
  along: [0, -0.04, -0.999],
  back: [0.989, 0.15, -0.006],
  forearm: [0.2, -0.4, 0.9],
  index: { spread: 0.2, mcp: 0.05, pip: 0.9, dip: 0.3 },
  middle: { mcp: 0.31, pip: 1.53, dip: 0.72 },
  ring: { spread: -0.03, mcp: 0.31, pip: 1.47, dip: 0.69 },
  pinky: { spread: -0.1, mcp: 0.3, pip: 1.26, dip: 0.61 },
  thumb: { mcp: [-0.023, -0.042, 0.014], ip: [-0.0295, -0.052, -0.016], tip: [-0.0295, -0.06, -0.034] },
};

// Left hand under the handguard: thumb along its left side, fingers round the right.
const rifleLeft: GlovePose = {
  left: true,
  wrist: [-0.0616, -0.0998, -0.3025],
  along: [0.77, 0.563, -0.299],
  back: [0.59, -0.807, 0],
  forearm: [-0.35, -0.55, 0.75],
  index: { mcp: 0.24, pip: 0.72, dip: 0.32 },
  middle: { mcp: 0.3, pip: 0.91, dip: 0.4 },
  ring: { mcp: 0.3, pip: 0.9, dip: 0.4 },
  pinky: { mcp: 0.27, pip: 0.8, dip: 0.36 },
  thumb: { mcp: [-0.034, -0.03, -0.346], ip: [-0.034, -0.017, -0.378], tip: [-0.0335, -0.01, -0.4] },
};

// Left hand holding the phone (phone space): the left edge in the web of the thumb, fingers
// round the back with their tips at the right edge, the thumb over the screen's left edge.
const phoneLeft: GlovePose = {
  left: true,
  wrist: [-0.084, -0.045, -0.0215],
  along: [0.97, 0.24, 0],
  back: [0, 0, -1],
  forearm: [-0.75, -0.55, 0.35],
  index: { mcp: 0, pip: 1.4, dip: 0.8 },
  middle: { mcp: 0, pip: 1.45, dip: 0.8 },
  ring: { spread: -0.04, mcp: 0, pip: 1.45, dip: 0.8 },
  pinky: { spread: -0.04, mcp: 0.05, pip: 1.4, dip: 0.8 },
  thumb: { mcp: [-0.05, -0.026, -0.006], ip: [-0.032, -0.008, 0.0138], tip: [-0.02, 0.016, 0.0136] },
};

export const HAND_POSES: Record<HandKey, GlovePose> = {
  'pistol.right': pistolRight,
  'pistol.left': pistolLeft,
  'pistol.leftRack': pistolLeftRack,
  'rifle.right': rifleRight,
  'rifle.left': rifleLeft,
  'phone.left': phoneLeft,
};
