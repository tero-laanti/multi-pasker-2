import { PHONE } from '../../shared/config';
import { FI } from '../../shared/fi';
import type { AwardInfo, MatchResult, MatchSettings } from '../../shared/protocol';
import type { ServerPlayer } from './player';
import type { ServiceRecord } from './service';

/** The scoreboard's order: kills, then fewer deaths, then the name. */
const byScore = (a: ServerPlayer, b: ServerPlayer) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name);

/** A pair's (or a lone player's) names, the better scorer first: "Aapo & Bertta". */
export function teamName(members: ServerPlayer[]): string {
  return [...members]
    .sort(byScore)
    .map((p) => p.name)
    .join(' & ');
}

/**
 * The end-of-match awards, from the match's counters. Ties go to whoever got there first. In
 * team mode the match is won by a pair, with their kills together.
 */
export function matchAwards(players: ServerPlayer[], teams = false): AwardInfo[] {
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
  if (teams) {
    const sides = new Map<number, ServerPlayer[]>();
    for (const p of players) if (p.team >= 0) sides.set(p.team, [...(sides.get(p.team) ?? []), p]);
    const top = [...sides.values()]
      .map((m) => ({ m: [...m].sort(byScore), name: teamName(m), kills: m.reduce((n, p) => n + p.kills, 0), deaths: m.reduce((n, p) => n + p.deaths, 0) }))
      .filter((t) => t.kills > 0)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))[0];
    if (top) out.push({ id: 'winner', name: A.winner, player: top.m[0]!.id, playerName: top.name, value: String(top.kills) });
  } else {
    const winner = [...players].filter((p) => p.kills > 0).sort(byScore)[0] ?? null;
    add('winner', winner, String(winner?.kills ?? 0));
  }
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

/** A typo the asevarasto remembers (`at`: wall-clock ms, so it lasts through a restart). */
export interface Typo {
  text: string;
  at: number;
}

/** What the evening keeps: who won each match, the current match's services and the host's settings. */
export interface EveningData {
  matches: MatchResult[];
  /** Everyone's service in the match under way (TJ, wallet, gear), by name. */
  services: Record<string, ServiceRecord>;
  /** The asevarasto's memory: everyone's latest typos tonight, oldest first, by name. */
  typos: Record<string, Typo[]>;
  settings?: MatchSettings;
}

/** Where the evening is kept: a small JSON file on the server, the browser's storage in the browser version. */
export interface EveningStore {
  load(): Partial<EveningData> | null;
  save(data: EveningData): void;
}

/**
 * The evening: who won each match, the services of the match under way (so a server restart
 * doesn't lose them), the typos the asevarasto remembers and the host's match settings.
 * Everything else lasts one match.
 */
export class Evening {
  private data: EveningData;

  constructor(private store: EveningStore | null) {
    const d = store?.load() ?? null;
    const matches = Array.isArray(d?.matches) ? d.matches.filter((m) => m && typeof m.winner === 'string') : [];
    const services = d?.services && typeof d.services === 'object' && !Array.isArray(d.services) ? d.services : {};
    const typos: Record<string, Typo[]> = {};
    if (d?.typos && typeof d.typos === 'object' && !Array.isArray(d.typos)) {
      for (const [name, list] of Object.entries(d.typos)) {
        const kept = (Array.isArray(list) ? list : []).filter((t) => typeof t?.text === 'string' && t.text.length <= PHONE.roastLength && Number.isFinite(t.at));
        if (kept.length) typos[name] = kept.slice(-PHONE.roastKeep).map((t) => ({ text: t.text, at: t.at }));
      }
    }
    this.data = { matches, services, typos, settings: d?.settings };
  }

  /** The asevarasto remembers a typo of this name's (the latest few of the evening). */
  addTypo(name: string, text: string, at = Date.now()): void {
    const list = (this.data.typos[name] ??= []);
    list.push({ text, at });
    if (list.length > PHONE.roastKeep) list.shift();
    this.save();
  }

  /** The latest typo of this name's from before `before` (wall-clock ms), taken: each is quoted once. */
  takeTypo(name: string, before: number): string | null {
    const list = this.data.typos[name];
    if (!list) return null;
    let i = list.length - 1;
    while (i >= 0 && list[i]!.at > before) i--;
    if (i < 0) return null;
    const [t] = list.splice(i, 1);
    if (!list.length) delete this.data.typos[name];
    this.save();
    return t!.text;
  }

  /** What is remembered of this name's typos (oldest first). */
  typos(name: string): readonly Typo[] {
    return this.data.typos[name] ?? [];
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

  /** A new evening: no winners yet, no services and no typos remembered; the host's settings stay. */
  reset(): void {
    this.data.matches = [];
    this.data.services = {};
    this.data.typos = {};
    this.save();
  }

  private save(): void {
    this.store?.save(this.data);
  }
}
