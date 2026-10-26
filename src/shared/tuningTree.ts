export type TuningValue = number | boolean;
export type TuningNode = { [key: string]: TuningValue | TuningNode };

export interface TuningLeaf {
  path: string[];
  value: TuningValue;
}

export function flattenTuning(tree: TuningNode, prefix: string[] = []): TuningLeaf[] {
  const out: TuningLeaf[] = [];
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'number' || typeof v === 'boolean') out.push({ path: [...prefix, k], value: v });
    else if (v && typeof v === 'object') out.push(...flattenTuning(v as TuningNode, [...prefix, k]));
  }
  return out;
}

export function getTuning(tree: TuningNode, path: string[]): TuningValue | undefined {
  let cur: TuningValue | TuningNode | undefined = tree;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as TuningNode)[p];
  }
  return typeof cur === 'number' || typeof cur === 'boolean' ? cur : undefined;
}

export function setTuning(tree: TuningNode, path: string[], value: TuningValue): boolean {
  let cur: TuningNode = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]!];
    if (!next || typeof next !== 'object') return false;
    cur = next as TuningNode;
  }
  const key = path[path.length - 1]!;
  if (typeof cur[key] !== typeof value) return false;
  cur[key] = value;
  return true;
}

/** Copies values from `src` into `target` for keys that exist in both with the same type. */
export function mergeTuning(target: TuningNode, src: unknown): number {
  let n = 0;
  if (!src || typeof src !== 'object') return 0;
  for (const leaf of flattenTuning(src as TuningNode)) if (setTuning(target, leaf.path, leaf.value)) n++;
  return n;
}

export function cloneTuning<T extends object>(tree: T): T {
  return JSON.parse(JSON.stringify(tree)) as T;
}
