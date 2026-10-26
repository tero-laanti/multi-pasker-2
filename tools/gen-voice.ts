/**
 * Makes clearly marked placeholder voice lines with an offline TTS and writes docs/RECORDING.md.
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
import { FI } from '../src/shared/fi';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/voice/_placeholder');
const DOC = path.join(ROOT, 'docs/RECORDING.md');
fs.mkdirSync(OUT, { recursive: true });

interface Line {
  file: string;
  text: string;
  speaker: string;
  lang: 'fi' | 'sv';
  note: string;
}

const V = FI.voice;
const lines: Line[] = [
  ...V.range.map(([file, text]) => ({ file, text, speaker: 'ammunnanjohtaja', lang: 'fi' as const, note: 'Ampumaradan ratakäsky' })),
  { file: V.codeWord[0], text: V.codeWord[1], speaker: 'huoltopaallikko', lang: 'fi', note: 'Ennen kirjaimia: "Tunnus:"' },
  ...V.alphabet.map(([letter, word, file]) => ({ file, text: word, speaker: 'huoltopaallikko', lang: 'fi' as const, note: `Kirjain ${letter}. Yksi sana, selkeästi, lyhyt tauko perään` })),
  ...V.intros.map(([file, text]) => ({ file, text, speaker: 'huoltopaallikko', lang: 'fi' as const, note: 'Ääniviestin alku' })),
  ...V.outros.map(([file, text]) => ({ file, text, speaker: 'huoltopaallikko', lang: 'fi' as const, note: 'Ääniviestin loppu' })),
  ...V.swedish.map(([file, code, text]) => ({ file, text, speaker: 'nylands', lang: 'sv' as const, note: `Vastaus: ${code}` })),
];

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
console.log(`\n${lines.length} paikkamerkkiä → ${OUT}`);

const bySpeaker = new Map<string, Line[]>();
for (const l of lines) bySpeaker.set(l.speaker, [...(bySpeaker.get(l.speaker) ?? []), l]);
let md = `# Äänitykset

Kaikki pelin äänirepliikit. Nyt kaikista on koneäänellä tehty paikkamerkki kansiossa
\`assets/voice/_placeholder/\`. Kun äänität repliikin, tallenna se kansioon \`assets/voice/\`
täsmälleen alla olevalla tiedostonimellä (pääte saa olla .wav, .mp3, .m4a tai .ogg). Oma äänitys
korvaa paikkamerkin heti seuraavalla sivun latauksella, koodia ei tarvitse muuttaa.

Vinkit:

- Mono, 44,1 tai 48 kHz. Leikkaa hiljaisuus alusta ja lopusta (jätä noin 50 ms).
- Kirjainsanat ovat yksittäisiä tiedostoja, joista peli liittää ääniviestit yhteen
  (esim. KETTU = Kalle, Eemeli, Tyyne, Tyyne, Urho). Lausu jokainen sana samalla tavalla ja
  samalla voimakkuudella, niin liitokset kuulostavat luontevilta.
- Ruotsinkieliset viestit lausutaan suomenruotsiksi, kuin Nylands brigadin päivystäjä.
- Teksti ja tiedostonimet tulevat tiedostosta \`src/shared/fi.ts\` (kohta \`voice\`).
  Tämä dokumentti ja paikkamerkit tehdään uudelleen komennolla \`npm run gen:voice\`.

`;
for (const [speaker, list] of bySpeaker) {
  md += `## ${FI.voice.speakers[speaker] ?? speaker}\n\n| Tiedosto | Repliikki | Huomio |\n|---|---|---|\n`;
  for (const l of list) md += `| \`${l.file}\` | ${l.text} | ${l.note} |\n`;
  md += '\n';
}
md += `Yhteensä ${lines.length} repliikkiä.\n`;
fs.writeFileSync(DOC, md);
console.log(`Kirjoitettu ${DOC}`);
