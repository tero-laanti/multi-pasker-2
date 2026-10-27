import type { Brush } from '../collision/brush';

/** Surface types decide footstep and impact sounds and effects. */
export const SURFACE = {
  default: 0,
  concrete: 1,
  dirt: 2,
  grass: 3,
  gravel: 4,
  wood: 5,
  metal: 6,
  sand: 7,
  canvas: 8,
  flesh: 9,
} as const;
export type SurfaceName = keyof typeof SURFACE;
export const SURFACE_NAMES = Object.keys(SURFACE) as SurfaceName[];

/** Render materials and the surface each one makes. */
export const MATERIALS = {
  grass: 'grass',
  dirt: 'dirt',
  gravel: 'gravel',
  sand: 'sand',
  berm: 'dirt',
  concrete: 'concrete',
  concreteDark: 'concrete',
  asphalt: 'concrete',
  brick: 'concrete',
  plaster: 'concrete',
  white: 'concrete',
  red: 'concrete',
  ochre: 'concrete',
  wood: 'wood',
  plywood: 'wood',
  planks: 'wood',
  redwood: 'wood',
  logs: 'wood',
  metal: 'metal',
  metalYellow: 'metal',
  steelTarget: 'metal',
  roofTin: 'metal',
  roofFelt: 'wood',
  sandbag: 'sand',
  canvas: 'canvas',
  rubber: 'dirt',
  clip: 'default',
} as const satisfies Record<string, SurfaceName>;
export type MaterialId = keyof typeof MATERIALS;

export function surfaceOf(mat: MaterialId): number {
  return SURFACE[MATERIALS[mat]];
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** In the outer ring: only used while the gate is open. */
  outer?: boolean;
}

/** Render-only decoration; any collision it needs is a separate brush. */
export interface PropDef {
  kind: 'spruce' | 'birch' | 'pine' | 'bush' | 'rock' | 'flagpole' | 'sign' | 'lamp' | 'barrel' | 'wire' | 'tire' | 'boom' | 'chimney';
  x: number;
  y: number;
  z: number;
  yaw?: number;
  scale?: number;
  /** Sign text (Finnish) or other per-kind parameter. */
  text?: string;
  /** Extra numeric parameter (e.g. wire length). */
  size?: number;
  /** Has a collision brush: always drawn, whatever the quality preset's tree density. */
  solid?: boolean;
}

export type TargetKind = 'silhouette' | 'plate' | 'gong' | 'start';

export interface TargetDef {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  z: number;
  /** Facing direction in radians (0 faces +Z, towards the firing line). */
  yaw: number;
  /** Moving target: slides between x0 and x1 at `speed` m/s. */
  rail?: { x0: number; x1: number; speed: number };
  /** Pop-up target used by drills: stays down until a drill raises it. */
  popup?: boolean;
  /** Plate radius for plates and gongs. */
  radius?: number;
}

export interface MapData {
  id: string;
  brushes: Brush[];
  props: PropDef[];
  spawns: SpawnPoint[];
  targets: TargetDef[];
  /** Horizontal play area, used by the shadow camera and the minimap-free bounds checks. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Direction towards the sun (normalised in the renderer). */
  sunDir: [number, number, number];
  /** Bot navigation points (ground level); links are found automatically. */
  nav?: { x: number; y: number; z: number }[];
  /** Brushes that block the outer-ring gate while it is closed. */
  gateBrushes?: number[];
}
