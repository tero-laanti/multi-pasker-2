import { VIEW } from '../shared/config';
import { DEFAULT_BINDINGS, mergeBindings, type Bindings } from './bindings';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  fov: number;
  invertY: boolean;
  crouchToggle: boolean;
  /** A right click toggles aiming down sights (off: held, as by default). */
  adsToggle: boolean;
  rawInput: boolean;
  /** A controller's right stick: its turn rates (PAD) times this. */
  padSensitivity: number;
  minimap: boolean;
  masterVolume: number;
  effectsVolume: number;
  /** Gunshots relative to their default level (AUDIO.gunVolume). */
  gunVolume: number;
  /** The soundtrack (its levels per place are AUDIO.music). */
  musicVolume: number;
  quality: Quality;
  renderScale: number;
  /** What each key, mouse button and controller button does (Settings → Controls). */
  bindings: Bindings;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: VIEW.defaultSensitivity,
  adsSensitivity: 1,
  fov: VIEW.defaultFov,
  invertY: false,
  crouchToggle: true,
  adsToggle: false,
  rawInput: true,
  padSensitivity: 1,
  minimap: true,
  masterVolume: 0.8,
  effectsVolume: 1,
  gunVolume: 1,
  musicVolume: 0.8,
  quality: 'high',
  renderScale: 1,
  bindings: DEFAULT_BINDINGS,
};

const KEY = 'pasker.settings.v1';

/**
 * Per-viewer settings in localStorage; always falls back to defaults when storage is unavailable.
 * A first-timer's quality comes from their graphics chip.
 */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...stored, bindings: mergeBindings(stored.bindings) };
    }
  } catch {
    // Storage blocked: defaults.
  }
  return { ...DEFAULT_SETTINGS, quality: defaultQuality() };
}

/** The quality to start with on this machine (see qualityFor); High if the chip can't be told. */
export function defaultQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return qualityFor(name);
  } catch {
    return 'high';
  }
}

/**
 * Quality for a graphics chip, by the name WebGL gives it: software rendering and phone or tablet
 * chips get Low, graphics built into the processor (Intel, AMD's Radeon Graphics, GeForce MX)
 * Medium, and everything else (discrete cards, Apple's M chips) High.
 */
export function qualityFor(gpu: string): Quality {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render|mali|adreno|powervr/.test(g)) return 'low';
  if ((/intel/.test(g) && !/\barc\b/.test(g)) || /radeon(\(tm\))? graphics|radeon vega|vega \d+ graphics|geforce mx/.test(g)) return 'medium';
  return 'high';
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore: settings just won't persist.
  }
}

export interface QualityPreset {
  shadowMapSize: number;
  shadowRange: number;
  antialias: boolean;
  maxPixelRatio: number;
  worldFlashLight: boolean;
  fogFar: number;
  treeDensity: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { shadowMapSize: 1024, shadowRange: 45, antialias: false, maxPixelRatio: 1, worldFlashLight: false, fogFar: 260, treeDensity: 0.5 },
  medium: { shadowMapSize: 2048, shadowRange: 60, antialias: true, maxPixelRatio: 1.25, worldFlashLight: true, fogFar: 360, treeDensity: 0.8 },
  high: { shadowMapSize: 4096, shadowRange: 70, antialias: true, maxPixelRatio: 2, worldFlashLight: true, fogFar: 460, treeDensity: 1 },
};
