/**
 * What the phone and the HUD pick out of a text: codewords to write back, marked **LIKE THIS** in
 * fi.ts and ui.ts and drawn bold, and phone numbers, drawn underlined. A code hidden on purpose
 * (an office's wall of regulations) stays unmarked.
 */

const BOLD = /\*\*(.+?)\*\*/g;

/** The 4-digit numbers and the long +358 ones, standing on their own (not inside a name or a code). */
const NUMBER = /(?<![\p{L}\p{N}+])\+?\d{4,}(?![\p{L}\p{N}])/gu;

/** A text in pieces: the marked codewords bold. */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(BOLD)) {
    if (m.index! > at) parts.push({ text: text.slice(at, m.index), bold: false });
    parts.push({ text: m[1]!, bold: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), bold: false });
  return parts;
}

/** The text without the marks, where it is drawn plain. */
export function plain(text: string): string {
  return text.replace(BOLD, '$1');
}

/** A plain text in pieces: the phone numbers apart. */
export function numberParts(text: string): { text: string; number: boolean }[] {
  const parts: { text: string; number: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(NUMBER)) {
    if (m.index! > at) parts.push({ text: text.slice(at, m.index), number: false });
    parts.push({ text: m[0], number: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), number: false });
  return parts;
}

/** The phone numbers in a text, each once. */
export function numbersIn(text: string | undefined): string[] {
  return [...new Set(text?.match(NUMBER) ?? [])];
}
