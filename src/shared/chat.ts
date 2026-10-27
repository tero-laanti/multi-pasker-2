/**
 * Reading what players type to the varusmestari. Matching ignores case, extra whitespace and
 * punctuation and is otherwise exact; near misses are recognised so the reply can point at
 * the right command without ever acting on a guess.
 */

export type CommandId = 'LATAA' | 'KRANAATTI' | 'PUNNERRETTU' | 'LENNOKKI' | 'TULI';

export type Classified =
  | { kind: 'command'; cmd: CommandId }
  | { kind: 'nearMiss'; cmd: CommandId }
  | { kind: 'swear' }
  | { kind: 'question' }
  | { kind: 'help' }
  | { kind: 'english' }
  | { kind: 'swedish' }
  | { kind: 'greeting' }
  | { kind: 'thanks' }
  | { kind: 'numbers' }
  | { kind: 'empty' }
  | { kind: 'other' };

/** Upper case, punctuation removed, whitespace collapsed. */
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleUpperCase('fi-FI')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const COMMANDS: CommandId[] = ['LATAA', 'KRANAATTI', 'PUNNERRETTU'];

/** Word stems that count as swearing (Finnish and the usual English). */
const SWEARS = ['VITT', 'VITU', 'PERKEL', 'SAATANA', 'HELVET', 'PASKA', 'PASKO', 'JUMALAUT', 'PERSE', 'KUSIP', 'KYRP', 'MULKK', 'HUORA', 'RUNKK', 'FUCK', 'SHIT', 'BITCH'];

const ENGLISH = new Set(['RELOAD', 'GRENADE', 'GRENADES', 'AMMO', 'PLEASE', 'HELLO', 'HI', 'HEY', 'THANKS', 'THANK', 'YOU', 'WHAT', 'WHERE', 'WHY', 'HOW', 'GIVE', 'ME', 'THE', 'IS', 'ARE', 'NEED', 'WANT', 'GUN', 'SORRY', 'YES', 'NO', 'MAGAZINE', 'BULLETS']);
const SWEDISH = new Set(['HEJ', 'TACK', 'JAG', 'VAD', 'DET', 'OCH', 'INTE', 'GÖR', 'HUR', 'MYCKET', 'GRANAT', 'LADDA', 'SNÄLLA', 'GOD', 'MORGON', 'SVARA', 'SVENSKA']);
const GREETINGS = new Set(['MOI', 'MOIKKA', 'MOIKKU', 'HEI', 'HEIPPA', 'HEIPS', 'TERVE', 'TERVEHDYS', 'TERVEPPÄ', 'PÄIVÄÄ', 'HYVÄÄ', 'HUOMENTA', 'ILTAA', 'MORO', 'MOROO', 'MORJENS', 'MORJESTA', 'MORJES', 'TSAU', 'TERVETULOA']);
const THANKS = new Set(['KIITOS', 'KIITTI', 'KITOS', 'KIITOKSIA', 'KIITOKSET', 'KIITÄN', 'KIITETÄÄN', 'KIITOKSIAPALJON']);

function nearCommand(s: string, commands: CommandId[]): CommandId | null {
  for (const cmd of commands) {
    const d = levenshtein(s, cmd);
    if (d > 0 && d <= (cmd.length >= 8 ? 3 : 2)) return cmd;
  }
  return null;
}

/**
 * What kind of message this is. `shortcuts` (Pikavalinta) makes `L` and `K` work as LATAA and
 * KRANAATTI; `abilities` are the Sotku's once-a-round commands this player has (LENNOKKI, TULI).
 */
export function classify(raw: string, shortcuts = false, abilities: CommandId[] = []): Classified {
  const s = normalize(raw);
  if (!s) return raw.includes('?') ? { kind: 'question' } : { kind: 'empty' };
  const words = s.split(' ');
  if (words.some((w) => SWEARS.some((stem) => w.startsWith(stem)))) return { kind: 'swear' };
  const commands = abilities.length ? [...COMMANDS, ...abilities] : COMMANDS;
  if ((commands as string[]).includes(s)) return { kind: 'command', cmd: s as CommandId };
  if (shortcuts && s === 'L') return { kind: 'command', cmd: 'LATAA' };
  if (shortcuts && s === 'K') return { kind: 'command', cmd: 'KRANAATTI' };
  // Near misses: the whole message, or one word of it, is (almost) a command.
  const near = nearCommand(s, commands) ?? words.map((w) => ((commands as string[]).includes(w) ? (w as CommandId) : nearCommand(w, commands))).find((c) => c) ?? null;
  if (near) return { kind: 'nearMiss', cmd: near };
  if (words.some((w) => w === 'APUA' || w === 'HELP' || w === 'HJÄLP')) return { kind: 'help' };
  if (/^[\d\s]+$/.test(s)) return { kind: 'numbers' };
  if (raw.includes('?') && words.length <= 2 && !words.some((w) => ENGLISH.has(w) || SWEDISH.has(w))) return { kind: 'question' };
  const english = words.filter((w) => ENGLISH.has(w)).length;
  const swedish = words.filter((w) => SWEDISH.has(w)).length;
  if (swedish > 0 && swedish >= english) return { kind: 'swedish' };
  if (english > 0) return { kind: 'english' };
  if (words.some((w) => GREETINGS.has(w))) return { kind: 'greeting' };
  if (words.some((w) => THANKS.has(w))) return { kind: 'thanks' };
  if (raw.includes('?')) return { kind: 'question' };
  return { kind: 'other' };
}
