import fs from 'node:fs';
import path from 'node:path';
import type { EveningData, EveningStore } from './game/awards';
import type { AudioFolder } from './http';
import type { VoiceSource } from './voicenotes';

/** Voice notes' clips from the voice folder; notes are served at /voicenote/<id>.wav. */
export function folderVoice(folder: AudioFolder): VoiceSource {
  return {
    wav: (name) => {
      const file = folder.resolveWav(name);
      if (!file) return null;
      try {
        return fs.readFileSync(file);
      } catch {
        return null;
      }
    },
    lineUrl: (name) => `/voice/${name}`,
    noteUrl: (id) => `/voicenote/${id}.wav`,
  };
}

/** The evening (match winners, the current match's services, the host's settings) in a small JSON file, so a server restart doesn't lose it. */
export function eveningFile(file: string): EveningStore {
  return {
    load: () => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<EveningData>;
      } catch {
        return null; // No evening yet.
      }
    },
    save: (data) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ saved: new Date().toISOString(), ...data }, null, 2));
        fs.renameSync(tmp, file);
      } catch (err) {
        console.error('[evening] could not save', err);
      }
    },
  };
}
