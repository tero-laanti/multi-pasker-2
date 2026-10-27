import { FI } from '../../shared/fi';
import { buildGarrison } from '../../shared/map/garrison';
import type { EveningRow } from '../../shared/protocol';
import { Evening, type EveningStore } from '../../server/game/awards';
import type { ServiceRecord } from '../../server/game/service';
import { Room } from '../../server/game/room';
import { Connection } from '../../server/connection';
import { TickLoop } from '../../server/loop';
import { VoiceNotes, type VoiceSource } from '../../server/voicenotes';
import { ClientEnd } from './socket';

const EVENING_KEY = 'pasker.evening';
const SERVICE_KEY = 'pasker.service';

function read<T>(key: string, empty: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? empty;
  } catch {
    return empty;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the evening lasts as long as the page.
  }
}

/** The evening (scoreboard and the player's service) in this browser's storage. */
const eveningStore: EveningStore = {
  load: () => read<EveningRow[]>(EVENING_KEY, []),
  save: (rows) => write(EVENING_KEY, rows),
  loadServices: () => read<Record<string, ServiceRecord>>(SERVICE_KEY, {}),
  saveServices: (services) => write(SERVICE_KEY, services),
};

/**
 * The voice notes' clips, fetched from the site in the background when the bot match starts
 * (the first voice note comes several ladder stages later). Notes and lines play from blob URLs.
 */
class FetchedVoice implements VoiceSource {
  private wavs = new Map<string, Uint8Array>();
  private urls = new Map<string, string>();

  constructor() {
    const V = FI.voice;
    const names = [...V.alphabet.map((a) => a[2]), V.codeWord[0], ...V.intros.map((c) => c[0]), ...V.outros.map((c) => c[0]), ...V.swedish.map((c) => c[0])];
    for (const name of names) {
      fetch(`/voice/${name}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => b && this.wavs.set(name, new Uint8Array(b)))
        .catch(() => undefined);
    }
  }

  wav(name: string): Uint8Array | null {
    return this.wavs.get(name) ?? null;
  }

  lineUrl(name: string): string {
    const wav = this.wavs.get(name);
    return wav ? this.blob(`line:${name}`, wav) : `/voice/${name}`;
  }

  noteUrl(id: string, wav: Uint8Array): string {
    return this.blob(id, wav);
  }

  private blob(key: string, wav: Uint8Array): string {
    let url = this.urls.get(key);
    if (!url) {
      url = URL.createObjectURL(new Blob([wav.slice()], { type: 'audio/wav' }));
      this.urls.set(key, url);
    }
    return url;
  }
}

/**
 * The browser version's bot match: the game server running in this page, with bots. The game
 * connects to it as it would to the real one, and so does the virtual phone from its frame.
 */
export class LocalServer {
  readonly room: Room;
  private loop: TickLoop;

  constructor(bots: number) {
    this.room = new Room(buildGarrison(), { dev: false, voiceNotes: new VoiceNotes(new FetchedVoice()), evening: new Evening(eveningStore) });
    for (let i = 0; i < bots; i++) this.room.addBot();
    this.loop = new TickLoop(this.room);
  }

  /** A new connection, the game's or the virtual phone's. The player here is the host. */
  connect(): WebSocket {
    const client = new ClientEnd();
    const c = new Connection(this.room, client.server, true, this.loop);
    client.server.onMessage = (data) => (typeof data === 'string' ? c.text(data) : c.binary(data));
    client.server.onClose = () => c.closed();
    return client as unknown as WebSocket;
  }
}
