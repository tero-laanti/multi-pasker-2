import { FI } from '../../shared/fi';
import type { AwardInfo, EveningRow } from '../../shared/protocol';
import type { ServerPlayer } from './player';
import type { ServiceRecord } from './service';

/** The end-of-round awards, from the round's counters. Ties go to whoever got there first. */
export function roundAwards(players: ServerPlayer[]): AwardInfo[] {
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
  const winner = [...players].filter((p) => p.kills > 0).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0] ?? null;
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

/** Where the evening is kept: a small JSON file on the server, the browser's storage in the browser version. */
export interface EveningStore {
  load(): EveningRow[];
  save(rows: EveningRow[]): void;
  /** Everyone's service (TJ, wallet, gear) by name. */
  loadServices(): Record<string, ServiceRecord>;
  saveServices(services: Record<string, ServiceRecord>): void;
}

/**
 * The evening: the scoreboard (totals over every round tonight) and everyone's service, by player
 * name, kept in a store so a server restart doesn't lose them. Bots don't count.
 */
export class Evening {
  private rows = new Map<string, EveningRow>();
  private services = new Map<string, ServiceRecord>();

  constructor(private store: EveningStore | null) {
    for (const r of store?.load() ?? []) if (r && typeof r.name === 'string') this.rows.set(r.name, r);
    for (const [name, r] of Object.entries(store?.loadServices() ?? {})) if (r && typeof r === 'object') this.services.set(name, r);
  }

  /** The service kept for this name tonight, if any. */
  service(name: string): ServiceRecord | undefined {
    return this.services.get(name);
  }

  /** Keeps these players' changed services and writes them to the store. */
  keepServices(players: ServerPlayer[]): void {
    let changed = false;
    for (const p of players) {
      if (p.bot || !p.service.dirty) continue;
      p.service.dirty = false;
      this.services.set(p.name, p.service.record());
      changed = true;
    }
    if (changed) this.store?.saveServices(Object.fromEntries(this.services));
  }

  /** Adds a finished round. */
  addRound(players: ServerPlayer[], awards: AwardInfo[]): void {
    const winner = awards.find((a) => a.id === 'winner')?.player;
    for (const p of players) {
      if (p.bot) continue;
      const r = this.rows.get(p.name) ?? { name: p.name, rounds: 0, wins: 0, kills: 0, deaths: 0, awards: 0, tj: 0 };
      r.rounds++;
      r.kills += p.kills;
      r.deaths += p.deaths;
      if (p.id === winner) r.wins++;
      r.awards += awards.filter((a) => a.player === p.id).length;
      r.tj = p.service.tj;
      this.rows.set(p.name, r);
    }
    this.save();
  }

  list(): EveningRow[] {
    return [...this.rows.values()].sort((a, b) => b.wins - a.wins || b.kills - a.kills || a.deaths - b.deaths);
  }

  /** A new evening: no totals, and everyone's service starts again. */
  reset(): void {
    this.rows.clear();
    this.services.clear();
    this.save();
    this.store?.saveServices({});
  }

  private save(): void {
    this.store?.save(this.list());
  }
}
