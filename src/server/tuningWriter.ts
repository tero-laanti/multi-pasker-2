/**
 * Rewrites numeric and boolean values inside the TUNING-BEGIN/END region of config.ts,
 * keeping layout and comments. Only keys that already exist are touched.
 */

const OPEN_ROOT = /^\s*export const TUNING\s*=\s*\{\s*$/;
const OPEN_OBJ = /^\s*([A-Za-z_$][\w$]*)\s*:\s*\{\s*$/;
const CLOSE = /^\s*\}\s*[,;]?\s*$/;
const VALUE = /^(\s*)([A-Za-z_$][\w$]*)(\s*:\s*)(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false)(\s*,?)(.*)$/;

export type TuningTree = { [key: string]: number | boolean | TuningTree };

function getPath(tree: TuningTree, path: string[]): unknown {
  let cur: unknown = tree;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toFixed(6)));
}

export function applyTuning(source: string, values: TuningTree): { text: string; changed: string[] } {
  const lines = source.split('\n');
  const stack: string[] = [];
  const changed: string[] = [];
  let inRegion = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes('// TUNING-BEGIN')) {
      inRegion = true;
      continue;
    }
    if (line.includes('// TUNING-END')) break;
    if (!inRegion) continue;
    if (OPEN_ROOT.test(line)) {
      stack.length = 0;
      continue;
    }
    let m = OPEN_OBJ.exec(line);
    if (m) {
      stack.push(m[1]!);
      continue;
    }
    if (CLOSE.test(line)) {
      stack.pop();
      continue;
    }
    m = VALUE.exec(line);
    if (!m) continue;
    const path = [...stack, m[2]!];
    const v = getPath(values, path);
    let text: string | null = null;
    if (typeof v === 'number' && Number.isFinite(v)) text = formatNumber(v);
    else if (typeof v === 'boolean') text = String(v);
    if (text === null || text === m[4]) continue;
    lines[i] = m[1]! + m[2]! + m[3]! + text + m[5]! + m[6]!;
    changed.push(path.join('.'));
  }
  return { text: lines.join('\n'), changed };
}
