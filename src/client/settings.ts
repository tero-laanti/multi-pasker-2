import { VIEW } from '../shared/config';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  fov: number;
  invertY: boolean;
  crouchToggle: boolean;
  rawInput: boolean;
  masterVolume: number;
  effectsVolume: number;
  quality: Quality;
  renderScale: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: VIEW.defaultSensitivity,
  adsSensitivity: 1,
  fov: VIEW.defaultFov,
  invertY: false,
  crouchToggle: true,
  rawInput: true,
  masterVolume: 0.8,
  effectsVolume: 1,
  quality: 'high',
  renderScale: 1,
};

const KEY = 'pasker.settings.v1';

/** Per-viewer settings in localStorage; always falls back to defaults when storage is unavailable. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage blocked: defaults.
  }
  return { ...DEFAULT_SETTINGS };
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
