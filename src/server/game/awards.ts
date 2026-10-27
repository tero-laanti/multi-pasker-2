import { FI } from '../../shared/fi';
import type { AwardInfo, MatchResult, MatchSettings } from '../../shared/protocol';
import type { ServerPlayer } from './player';
import type { ServiceRecord } from './service';

/** The end-of-match awards, from the match's counters. Ties go to whoever got there first. */
export function matchAwards(players: ServerPlayer[]): AwardInfo[] {
  const A = FI.awards;
  const out: AwardInfo[] = [];
  const best = (score: (p: ServerPlayer) => number, min = 1) => {
    let top: ServerPlayer | null = null;
    for (const p of players) if (score(p) >= min && (!top || score(p) > score(top))) top = p;
    return top;
  };
  const add = (id: AwardInfo['id'], p: ServerPlayer | null, value: string) => {
    if (p) out.push({ id, name: A[id], player: p.id, playerName: p.name, value });
  };
  // The same order as the scoreboard: kills, then fewer deaths, then the name.
  const winner = [...players].filter((p) => p.kills > 0).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))[0] ?? null;
  add('winner', winner, String(winner?.kills ?? 0));
  const typing = best((p) => p.stats.deathsTyping);
  add('deathsTyping', typing, String(typing?.stats.deathsTyping ?? 0));
  const draft = best((p) => p.stats.deathDraft.length);
  add('longestDraft', draft, draft?.stats.deathDraft ?? '');
  const typos = best((p) => p.stats.typos);
  add('typos', typos, String(typos?.stats.typos ?? 0));
  const phone = best((p) => p.stats.phoneMs, 5000);
  add('phoneTime', phone, String(Math.round((phone?.stats.phoneMs ?? 0) / 1000)));
  const pushups = best((p) => p.stats.pushups);
  add('pushups', pushups, String((pushups?.stats.pushups ?? 0) * 10));
  const swedish = players.filter((p) => p.stats.swedishAt > 0).sort((a, b) => a.stats.swedishAt - b.stats.swedishAt)[0] ?? null;
  add('swedish', swedish, '');
  return out;
}

/** What the evening keeps: who won each match, the current match's services and the host's settings. */
export interface EveningData {
  matches: MatchResult[];
  /** Everyone's service in the match under way (TJ, wallet, gear), by name. */
  services: Record<string, ServiceRecord>;
  settings?: MatchSettings;
}

/** Where the evening is kept: a small JSON file on the server, the browser's storage in the browser version. */
export interface EveningStore {
  load(): Partial<EveningData> | null;
  save(data: EveningData): void;
}

/**
 * The evening: who won each match, the services of the match under way (so a server restart
 * doesn't lose them) and the host's match settings. Everything else lasts one match.
 */
export class Evening {
  private data: EveningData;

  constructor(private store: EveningStore | null) {
    const d = store?.load() ?? null;
    const matches = Array.isArray(d?.matches) ? d.matches.filter((m) => m && typeof m.winner === 'string') : [];
    const services = d?.services && typeof d.services === 'object' && !Array.isArray(d.services) ? d.services : {};
    this.data = { matches, services, settings: d?.settings };
  }

  /** The service kept for this name in the match under way, if any. */
  service(name: string): ServiceRecord | undefined {
    return this.data.services[name];
  }

  /** Keeps these players' changed services and writes them to the store. */
  keepServices(players: ServerPlayer[]): void {
    let changed = false;
    for (const p of players) {
      if (p.bot || !p.service.dirty) continue;
      p.service.dirty = false;
      this.data.services[p.name] = p.service.record();
      changed = true;
    }
    if (changed) this.save();
  }

  /** A new match: everyone's service starts again. */
  clearServices(): void {
    this.data.services = {};
    this.save();
  }

  /** A match is over: its winner goes on tonight's list. */
  addMatch(result: MatchResult): void {
    this.data.matches.push(result);
    this.save();
  }

  matches(): MatchResult[] {
    return [...this.data.matches];
  }

  get settings(): MatchSettings | undefined {
    return this.data.settings;
  }

  set settings(s: MatchSettings | undefined) {
    this.data.settings = s;
    this.save();
  }

  /** A new evening: no winners yet and no services; the host's settings stay. */
  reset(): void {
    this.data.matches = [];
    this.data.services = {};
    this.save();
  }

  private save(): void {
    this.store?.save(this.data);
  }
}
