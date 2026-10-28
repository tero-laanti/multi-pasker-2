/**
 * Makes clearly marked placeholder voice lines with an offline TTS and writes the recording
 * booth's list of lines (into tools/recorder/index.html).
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
import { voiceLines, writeRecorderLines, type Line } from './lib/voiceLines';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/voice/_placeholder');
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

console.log(`Wrote ${writeRecorderLines(ROOT, lines)}`);
