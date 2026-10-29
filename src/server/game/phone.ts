import type { Socket } from '../socket';
import type { MsgState, PhoneConversation, PhoneMessage, PhoneServerMsg, PhoneStatus } from '../../shared/protocol';

interface Scheduled {
  at: number;
  run: () => void;
}

/**
 * One player's phone: its connection, conversations and the server-side state the
 * varusmestari keeps about it. Bots have one too (they "type" for the phone glow and drafts).
 */
export class Phone {
  ws: Socket | null = null;
  /** The paired phone's token; empty until a phone has been paired. */
  token = '';
  /** Secret in the pairing QR link. */
  readonly pairToken = crypto.randomUUID().replace(/-/g, '');
  /** Short code for pairing by hand. */
  pairCode = '';
  sim = false;
  /** The virtual phone on the player's own screen (no phone of their own). */
  virtual = false;
  readonly convs = new Map<string, PhoneConversation>();
  /** What is in the compose field right now, and when it last changed (server ms). */
  draft: { conv: string; text: string; at: number } | null = null;
  /** Last touch on the phone (server ms). */
  activeUntil = 0;
  /** A chat is open on the phone: the character holds it (and shoots one-handed). */
  out = false;
  /** Request ids handled this round: a retried send is acknowledged, never acted on twice. */
  readonly rids = new Set<string>();
  /** Swore at the varusmestari: no service until PUNNERRETTU. */
  locked = false;
  /** Recent messages to the varusmestari, for spam detection. */
  recent: { at: number; text: string }[] = [];
  lastGrenadeAt = -1e9;
  /** When the asevarasto last texted about a kill of someone caught texting, and last quoted a typo back. */
  lastCaughtAt = -1e9;
  lastRoastAt = -1e9;
  private queue: Scheduled[] = [];
  private nextId = 1;
  private lastStatus = '';
  /** Called when a message arrives from the other side (the chirp others can hear). */
  onIncoming: () => void = () => {};
  /** Called whenever which chats have unread messages changes (the desktop's message bar). */
  onUnread: () => void = () => {};
  /** Unasked-for messages per chat that wait until the one before has been read. */
  readonly deferred = new Map<string, { text: string; voice?: { url: string; duration: number } }[]>();
  /** Unasked-for messages per chat on their way (typing). */
  readonly inFlight = new Map<string, number>();

  /** The chat still has an unread or arriving message, so something new would pile up. */
  busy(conv: string): boolean {
    return (this.convs.get(conv)?.unread ?? 0) > 0 || (this.inFlight.get(conv) ?? 0) > 0 || (this.deferred.get(conv)?.length ?? 0) > 0;
  }

  /** Names of the chats with unread messages. */
  unreadFrom(): string[] {
    return [...this.convs.values()].filter((c) => c.unread > 0).map((c) => c.name);
  }

  get paired(): boolean {
    return this.token !== '';
  }

  get online(): boolean {
    return !!this.ws && this.ws.readyState === this.ws.OPEN;
  }

  status(): 'none' | 'online' | 'offline' {
    return !this.paired ? 'none' : this.online ? 'online' : 'offline';
  }

  send(msg: PhoneServerMsg): void {
    if (this.online) this.ws!.send(JSON.stringify(msg));
  }

  /** Sends the phone's game status when it has changed. */
  sendStatus(s: PhoneStatus, force = false): void {
    const key = JSON.stringify(s);
    if (!force && key === this.lastStatus) return;
    this.lastStatus = key;
    this.send({ t: 'status', s });
  }

  newId(): string {
    return `v${this.nextId++}`;
  }

  conv(id: string, name: string): PhoneConversation {
    let c = this.convs.get(id);
    if (!c) {
      c = { id, name, messages: [], unread: 0 };
      this.convs.set(id, c);
      this.send({ t: 'conv', c });
    }
    return c;
  }

  /** Adds a message to a conversation and tells the phone. */
  add(convId: string, m: PhoneMessage): void {
    const c = this.convs.get(convId);
    if (!c) return;
    c.messages.push(m);
    if (c.messages.length > 200) c.messages.splice(0, c.messages.length - 200);
    if (m.from === 'them') {
      c.unread++;
      this.onIncoming();
      this.onUnread();
    }
    this.send({ t: 'msg', conv: convId, m });
  }

  setState(convId: string, id: string, state: MsgState): void {
    const m = this.convs.get(convId)?.messages.find((x) => x.id === id);
    if (!m) return;
    m.state = state;
    this.send({ t: 'state', conv: convId, id, state });
  }

  schedule(at: number, run: () => void): void {
    this.queue.push({ at, run });
  }

  /** Runs what is due (typing indicators, read receipts, replies). */
  tick(now: number): void {
    if (this.queue.length === 0) return;
    const due = this.queue.filter((s) => s.at <= now).sort((a, b) => a.at - b.at);
    if (due.length === 0) return;
    this.queue = this.queue.filter((s) => s.at > now);
    for (const s of due) s.run();
  }

  /** Busy until this time: the varusmestari answers one message at a time. */
  busyUntil = 0;

  /**
   * New round: requests and locks from the old round no longer apply. Texts held back behind an
   * unread one stay, because the service's paperwork goes on into the next round.
   */
  resetRound(): void {
    this.rids.clear();
    this.locked = false;
    this.recent = [];
    this.lastGrenadeAt = -1e9;
    this.draft = null;
  }
}
