import { describe, expect, it } from 'vitest';
import { FI } from '../src/shared/fi';
import { boldParts, numberParts, numbersIn, plain } from '../src/shared/markup';
import { UI } from '../src/shared/ui';

/** Every string in a nested object of texts. */
function strings(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (Array.isArray(o)) return o.flatMap(strings);
  if (o && typeof o === 'object') return Object.values(o).flatMap(strings);
  return [];
}

describe('bold codewords', () => {
  it('splits a text into plain and bold pieces', () => {
    expect(boldParts('Kuittaa: **KUITTAAN**')).toEqual([
      { text: 'Kuittaa: ', bold: false },
      { text: 'KUITTAAN', bold: true },
    ]);
    expect(boldParts('**LATAA** tai **KRANAATTI**.').map((p) => p.bold)).toEqual([true, false, true, false]);
    expect(boldParts('Ei kuulu meille.')).toEqual([{ text: 'Ei kuulu meille.', bold: false }]);
  });

  it('drops the marks for plain text', () => {
    expect(plain('Terve terve. Mitä tarvitaan? **LATAA** vai **KRANAATTI**.')).toBe('Terve terve. Mitä tarvitaan? LATAA vai KRANAATTI.');
  });

  it('has no stray marks in the texts', () => {
    for (const s of [...strings(FI), ...strings(UI)]) expect(plain(s), s).not.toContain('**');
  });

  it('marks the code in the paperwork that says it, but not in the wall of regulations', () => {
    const L = FI.ladder;
    for (const s of [...L.word, ...L.stage1, ...L.stage2, ...L.officePhrase]) expect(s).toContain('**{code}**');
    for (const s of L.officeRules) {
      expect(s).toContain('{code}');
      expect(s).not.toContain('**');
    }
  });
});

describe('phone numbers in a message', () => {
  it('finds the office numbers and the long +358 ones', () => {
    expect(numbersIn('Ei kuulu meille. Ota yhteys: Esikunta, numero 4821.')).toEqual(['4821']);
    expect(numbersIn('Huoltopäällikkö hoitaa loput. Numero +35812345678901234. Kuuntele.')).toEqual(['+35812345678901234']);
  });

  it('leaves short numbers and digits inside words alone', () => {
    expect(numbersIn('TJ 347! Your Päiväraha is now 5 € a day, and a 100 € bonus.')).toEqual([]);
    expect(numbersIn('Kirjoita: **HERRA KERSANTTI ALOKAS PASI2000**')).toEqual([]);
  });

  it('splits a text around its numbers', () => {
    expect(numberParts('Numero 7413, ei 74.')).toEqual([
      { text: 'Numero ', number: false },
      { text: '7413', number: true },
      { text: ', ei 74.', number: false },
    ]);
  });

  it('gives the number in every message that sends the player to a new one', () => {
    const L = FI.ladder;
    for (const s of [...L.stage3, ...L.stage4, ...L.stage5New, ...FI.commander.tj0]) expect(s).toContain('{number}');
  });
});
