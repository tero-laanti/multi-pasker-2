import type { GlovePose, HandKey } from './hands';

/**
 * Where each hand sits on its weapon (weapon model space: X right, Y up, muzzle towards -Z,
 * metres) or on the phone (phone space: X right, Y along the long side, Z out of the screen).
 * Curls and thumb angles are radians; the thumb's directions and the forearm are in the holder's space.
 */

// One-handed pistol grip: the web of the hand high on the back of the grip, the palm on its
// right side, fingers round the front, the index finger on the trigger, the thumb along the
// left of the frame.
const pistolRight: GlovePose = {
  wrist: [0.0343, -0.0572, 0.0668],
  along: [0, -0.12, -0.993],
  back: [0.989, 0.148, -0.018],
  forearm: [0.45, -0.32, 0.83],
  index: { spread: 0.08, mcp: 0.1, pip: 1.15, dip: 0.35 },
  middle: { mcp: 0.89, pip: 1.6, dip: 0.59 },
  ring: { mcp: 0.83, pip: 1.5, dip: 0.56 },
  pinky: { spread: -0.03, mcp: 0.71, pip: 1.24, dip: 0.48 },
  thumb: { dir: [0, 0.2, -0.98], knuckle: [-1, 0.15, 0], lift: 1.1, mcp: 0.95, ip: 0.1 },
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
  thumb: { dir: [0, 1, -0.45], knuckle: [-1, 0, 0], lift: 0.6, mcp: 0.8, ip: 0.7 },
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
  thumb: { dir: [0.4, -0.25, -0.88], knuckle: [-0.3, 1, 0], lift: 0.6, mcp: 0.25, ip: 0.1 },
};

// Rifle: right hand on the pistol grip, index finger on the trigger, thumb round the left.
const rifleRight: GlovePose = {
  wrist: [0.0363, -0.0729, 0.0811],
  along: [0, -0.04, -0.999],
  back: [0.989, 0.15, -0.006],
  forearm: [0.4, -0.38, 0.83],
  index: { spread: 0.2, mcp: 0.05, pip: 0.9, dip: 0.3 },
  middle: { mcp: 0.31, pip: 1.53, dip: 0.72 },
  ring: { spread: -0.03, mcp: 0.31, pip: 1.47, dip: 0.69 },
  pinky: { spread: -0.1, mcp: 0.3, pip: 1.26, dip: 0.61 },
  thumb: { dir: [0, -0.25, -0.97], knuckle: [-1, 0.3, 0], lift: 0.9, mcp: 0.45, ip: 0.05 },
};

// Left hand under the handguard, as you'd hold a stick: the handguard runs diagonally across
// the palm from its heel into the web of the thumb, the wrist just below it, the thumb along its
// left side, the fingers curled up round its right side.
const rifleLeft: GlovePose = {
  left: true,
  wrist: [-0.029, -0.0565, -0.2976],
  along: [0.701, 0.221, -0.678],
  back: [0.301, -0.954, 0],
  forearm: [-0.35, -0.6, 0.72],
  index: { mcp: 0.41, pip: 1.24, dip: 0.55 },
  middle: { mcp: 0.54, pip: 1.61, dip: 0.72 },
  ring: { mcp: 0.57, pip: 1.7, dip: 0.76 },
  pinky: { mcp: 0.5, pip: 1.45, dip: 0.65 },
  thumb: { dir: [0, 0.45, -0.9], knuckle: [-1, 0, 0], lift: 0.6, mcp: 0.7, ip: 0.6 },
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
  thumb: { dir: [0.86, 0.51, 0], knuckle: [0, 0, 1], lift: 0.76, mcp: 0.74, ip: 0.12 },
};

export const HAND_POSES: Record<HandKey, GlovePose> = {
  'pistol.right': pistolRight,
  'pistol.left': pistolLeft,
  'pistol.leftRack': pistolLeftRack,
  'rifle.right': rifleRight,
  'rifle.left': rifleLeft,
  'phone.left': phoneLeft,
};
