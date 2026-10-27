import { PHONE } from '../shared/config';
import type { PhoneClientMsg, PhoneServerMsg } from '../shared/protocol';

type Hello = Omit<Extract<PhoneClientMsg, { t: 'phoneHello' }>, 't' | 'v'>;

/**
 * In the browser version the virtual phone is a frame of the game page, whose bot match runs the
 * server in the page: the phone connects to that.
 */
function localServer(): { connect(): WebSocket } | null {
  try {
    return window.parent !== window ? ((window.parent as unknown as { __paskerLocal?: { connect(): WebSocket } }).__paskerLocal ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The phone's connection. Phones drop the socket when the screen locks, so it reconnects at
 * once when the page is visible again. Sends wait in an outbox until the server confirms them
 * and are resent with the same request id after a reconnect; the server never acts twice.
 */
export class PhoneNet {
  ws: WebSocket | null = null;
  connected = false;
  onMessage: (m: PhoneServerMsg) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  /** What to say when (re)connecting; set before connect(). */
  hello: () => Hello | null = () => null;
  private outbox = new Map<string, Extract<PhoneClientMsg, { t: 'send' }>>();
  private retry = 0;
  private timer = 0;
  private lastTouch = 0;
  private draftTimer = 0;
  private draftPending: { conv: string; text: string } | null = null;
  private lastDraft = 0;
  private pingTimer = 0;
  private lastHeard = 0;
  /** Whether a chat is open (the phone is in the player's hand); resent after reconnects. */
  private outState = false;

  constructor(private version: number) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.connected) this.connect(true);
    });
    window.addEventListener('online', () => this.connect(true));
  }

  connect(now = false): void {
    window.clearTimeout(this.timer);
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (!now && this.retry > 0) {
      this.timer = window.setTimeout(() => this.open(), Math.min(2000, 150 * 2 ** this.retry));
      return;
    }
    this.open();
  }

  private open(): void {
    const local = localServer();
    const ws = local ? local.connect() : new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    // Closing the virtual phone removes its frame; the in-page server must hear it went.
    if (local) window.addEventListener('pagehide', () => ws.close(), { once: true });
    this.ws = ws;
    ws.onopen = () => {
      const h = this.hello();
      if (h) ws.send(JSON.stringify({ t: 'phoneHello', v: this.version, ...h }));
      window.clearInterval(this.pingTimer);
      this.lastHeard = performance.now();
      this.pingTimer = window.setInterval(() => {
        // Nothing heard for a while: the connection is dead even if the socket says open.
        if (performance.now() - this.lastHeard > 15000) ws.close();
        else this.raw({ t: 'ping', id: 0 });
      }, 5000);
    };
    ws.onmessage = (ev) => {
      this.lastHeard = performance.now();
      let m: PhoneServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as PhoneServerMsg;
      } catch {
        return;
      }
      if (m.t === 'phoneWelcome') {
        this.connected = true;
        this.retry = 0;
        this.onStatus(true);
        // Anything still unconfirmed goes again; the server knows the request ids.
        for (const s of this.outbox.values()) this.raw(s);
        if (this.outState) this.raw({ t: 'out', on: true });
      }
      if (m.t === 'msg' && m.m.from === 'me') this.outbox.delete(m.m.id);
      this.onMessage(m);
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      if (was) this.onStatus(false);
      this.retry++;
      this.connect();
    };
  }

  /** Stops reconnecting (this phone was replaced or unpaired). */
  stop(): void {
    window.clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    ws?.close();
  }

  private raw(m: PhoneClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  send(m: Extract<PhoneClientMsg, { t: 'send' }>): void {
    this.outbox.set(m.rid, m);
    if (this.connected) this.raw(m);
  }

  /** A chat is open: the character holds the phone (and shoots one-handed). */
  out(on: boolean): void {
    if (on === this.outState) return;
    this.outState = on;
    this.raw({ t: 'out', on });
  }

  /** The Sotku App's Buy; the request id makes a resend after a reconnect harmless. */
  buy(rid: string, id: string): void {
    this.raw({ t: 'buy', rid, id });
  }

  /** Unconfirmed sends. */
  pending(rid: string): boolean {
    return this.outbox.has(rid);
  }

  openConversation(conv: string): void {
    this.raw({ t: 'open', conv });
  }

  read(conv: string): void {
    this.raw({ t: 'read', conv });
  }

  /** Any touch: the phone glows in the player's hand for a moment. */
  touch(): void {
    const now = performance.now();
    if (now - this.lastTouch < PHONE.streamInterval * 1000) return;
    this.lastTouch = now;
    this.raw({ t: 'touch' });
  }

  /** The compose field, streamed (throttled) for the kill feed. */
  draft(conv: string, text: string): void {
    this.draftPending = { conv, text };
    const wait = PHONE.streamInterval * 1000 - (performance.now() - this.lastDraft);
    if (wait <= 0) this.flushDraft();
    else if (!this.draftTimer) this.draftTimer = window.setTimeout(() => this.flushDraft(), wait);
  }

  private flushDraft(): void {
    window.clearTimeout(this.draftTimer);
    this.draftTimer = 0;
    const d = this.draftPending;
    if (!d) return;
    this.draftPending = null;
    this.lastDraft = performance.now();
    this.lastTouch = this.lastDraft;
    this.raw({ t: 'draft', conv: d.conv, text: d.text });
  }
}
