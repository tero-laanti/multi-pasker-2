import fs from 'node:fs';
import path from 'node:path';
import type { EveningRow } from '../shared/protocol';
import type { EveningStore } from './game/awards';
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

/** The evening scoreboard in a small JSON file, so a server restart doesn't lose it. */
export function eveningFile(file: string): EveningStore {
  return {
    load: () => {
      try {
        return (JSON.parse(fs.readFileSync(file, 'utf8')) as { rows?: EveningRow[] }).rows ?? [];
      } catch {
        return []; // No evening yet.
      }
    },
    save: (rows) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ saved: new Date().toISOString(), rows }, null, 2));
        fs.renameSync(tmp, file);
      } catch (err) {
        console.error('[evening] could not save', err);
      }
    },
  };
}
