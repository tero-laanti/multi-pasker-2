/**
 * Makes clearly marked placeholder voice lines with an offline TTS and writes docs/RECORDING.md
 * and the recording booth's list (tools/recorder/lines.js).
 *
 *   npm run gen:voice
 *
 * Uses macOS `say` when available (Finnish and Swedish voices), otherwise espeak-ng.
 * Placeholders go to assets/voice/_placeholder/; real recordings dropped into assets/voice/
 * with the same base name (any of .wav .mp3 .m4a .ogg) win without code changes.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SPEAKERS, voiceLines, writeRecorderLines, type Line } from './lib/voiceLines';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/voice/_placeholder');
const DOC = path.join(ROOT, 'docs/RECORDING.md');
fs.mkdirSync(OUT, { recursive: true });

const lines = voiceLines();

const hasSay = os.platform() === 'darwin' && spawnSync('which', ['say']).status === 0;
const VOICES: Record<string, string> = {
  ammunnanjohtaja: 'Reed (Finnish (Finland))',
  huoltopaallikko: 'Grandpa (Finnish (Finland))',
  nylands: 'Alva',
};

function synth(line: Line, wav: string): void {
  const tmp = path.join(os.tmpdir(), `pasker-voice-${process.pid}.aiff`);
  if (hasSay) {
    execFileSync('say', ['-v', VOICES[line.speaker]!, '-o', tmp, line.text]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', tmp, wav]);
    fs.rmSync(tmp, { force: true });
  } else {
    execFileSync('espeak-ng', ['-v', line.lang === 'sv' ? 'sv' : 'fi', '-s', '150', '-w', wav, line.text]);
  }
}

for (const line of lines) {
  const wav = path.join(OUT, `${line.file}.wav`);
  synth(line, wav);
  process.stdout.write('.');
}
console.log(`\n${lines.length} placeholders → ${OUT}`);

const bySpeaker = new Map<string, Line[]>();
for (const l of lines) bySpeaker.set(l.speaker, [...(bySpeaker.get(l.speaker) ?? []), l]);
let md = `# Voice recordings

Every voice line in the game. Each one currently has a machine-voice placeholder in
\`assets/voice/_placeholder/\`. To replace a line, save your recording into \`assets/voice/\`
with exactly the file name below (extension .wav, .mp3, .m4a or .ogg). It replaces the placeholder
on the next page load; no code changes needed.

The easy way is the recording booth: open \`tools/recorder/index.html\` in Chrome (straight from
the disk, no server), choose the \`assets/voice\` folder once, then Record, say the line, Stop.
Each take is trimmed, evened out and saved there as WAV under the right name.

Tips:

- Mono, 44.1 or 48 kHz. Trim silence at both ends (leave about 50 ms).
- The phonetic-alphabet words, *Tunnus:* and the voice-note intros and outros are separate files
  that the server splices into one voice note (e.g. KETTU = intro, Tunnus, Kalle, Eemeli, Tyyne,
  Tyyne, Urho, outro). **Save these as WAV** (any sample rate, 16/24-bit or float, mono or stereo):
  other formats can't be spliced, and the placeholder is used for that word instead. The server
  trims silence and evens out the level, but the joins sound most natural if every word is said
  the same way. Restart the server after adding recordings.
- The Swedish notes are spoken in Finland-Swedish, like a duty officer at Nylands brigad.
- Texts and file names come from \`src/shared/fi.ts\` (the \`voice\` section). This document and
  the placeholders are regenerated with \`npm run gen:voice\`.

`;
for (const [speaker, list] of bySpeaker) {
  md += `## ${SPEAKERS[speaker] ?? speaker}\n\n| File | Line (Finnish/Swedish) | Note |\n|---|---|---|\n`;
  for (const l of list) md += `| \`${l.file}\` | ${l.text} | ${l.note} |\n`;
  md += '\n';
}
md += `${lines.length} lines in total.\n`;
fs.writeFileSync(DOC, md);
console.log(`Wrote ${DOC}`);
console.log(`Wrote ${writeRecorderLines(ROOT, lines)}`);
