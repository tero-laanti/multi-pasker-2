/**
 * Every voice line in the game, from the `voice` section of src/shared/fi.ts: the placeholders
 * (tools/gen-voice.ts) and the recording booth (tools/recorder/) use this list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FI } from '../../src/shared/fi';

export interface Line {
  file: string;
  text: string;
  speaker: string;
  lang: 'fi' | 'sv';
  note: string;
}

export const SPEAKERS: Record<string, string> = {
  ammunnanjohtaja: 'Range officer (range commands and the match rounds)',
  huoltopaallikko: 'Huoltopäällikkö (voice notes, Finnish)',
  nylands: 'Nylands brigad (voice note, Swedish)',
};

export function voiceLines(): Line[] {
  const V = FI.voice;
  return [
    ...V.range.map(([file, text]) => ({
      file,
      text,
      speaker: 'ammunnanjohtaja',
      lang: 'fi' as const,
      note: file === V.roundEnd ? 'Range command; also as each round of a match ends' : file === V.roundStart ? 'Range command; also as each round of a match starts' : 'Range command',
    })),
    { file: V.codeWord[0], text: V.codeWord[1], speaker: 'huoltopaallikko', lang: 'fi', note: 'Said before the letters' },
    ...V.alphabet.map(([letter, word, file]) => ({ file, text: word, speaker: 'huoltopaallikko', lang: 'fi' as const, note: `Letter ${letter}. One word, clearly, short pause after` })),
    ...V.intros.map(([file, text]) => ({ file, text, speaker: 'huoltopaallikko', lang: 'fi' as const, note: 'Voice-note intro' })),
    ...V.outros.map(([file, text]) => ({ file, text, speaker: 'huoltopaallikko', lang: 'fi' as const, note: 'Voice-note outro' })),
    ...V.swedish.map(([file, code, text]) => ({ file, text, speaker: 'nylands', lang: 'sv' as const, note: `Answer: ${code}` })),
  ];
}

/**
 * The recording booth's list, written into tools/recorder/index.html itself: one file that opens
 * from the disk (or wherever it is sent) with nothing else next to it.
 */
export function writeRecorderLines(root: string, lines: Line[]): string {
  const file = path.join(root, 'tools/recorder/index.html');
  const data = { speakers: SPEAKERS, lines: lines.map(({ file, text, speaker, note }) => ({ file, text, speaker, note })) };
  const html = fs.readFileSync(file, 'utf8');
  const block = /(<!-- lines:[^>]*-->\n)[\s\S]*?(<!-- \/lines -->)/;
  if (!block.test(html)) throw new Error(`No lines block in ${file}`);
  fs.writeFileSync(file, html.replace(block, (_, open: string, close: string) => `${open}<script>window.VOICE = ${JSON.stringify(data)};</script>\n${close}`));
  return file;
}
