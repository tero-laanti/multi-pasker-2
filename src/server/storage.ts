import fs from 'node:fs';
import path from 'node:path';
import type { EveningRow } from '../shared/protocol';
import type { EveningStore } from './game/awards';
import type { ServiceRecord } from './game/service';
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

interface EveningData {
  rows: EveningRow[];
  services: Record<string, ServiceRecord>;
}

/** The evening (scoreboard and services) in a small JSON file, so a server restart doesn't lose it. */
export function eveningFile(file: string): EveningStore {
  let data: EveningData = { rows: [], services: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<EveningData>;
    data = { rows: raw.rows ?? [], services: raw.services ?? {} };
  } catch {
    // No evening yet.
  }
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ saved: new Date().toISOString(), ...data }, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[evening] could not save', err);
    }
  };
  return {
    load: () => data.rows,
    save: (rows) => {
      data.rows = rows;
      write();
    },
    loadServices: () => data.services,
    saveServices: (services) => {
      data.services = services;
      write();
    },
  };
}
