import { NET } from '../shared/config';
import { BIN, decodeSnapshot, type ClientMsg, type ServerMsg, type Snapshot } from '../shared/protocol';

export interface NetStats {
  connected: boolean;
  rtt: number;
  jitter: number;
  serverTickMs: number;
  serverTickMaxMs: number;
  serverTickHz: number;
  snapshotRate: number;
  snapshotJitter: number;
}

/**
 * WebSocket link to the game server: reconnects, keeps an estimate of the server clock from
 * pings, and can add artificial latency and jitter for testing (dev network conditioner).
 */
export class Net {
  ws: WebSocket | null = null;
  stats: NetStats = { connected: false, rtt: NaN, jitter: NaN, serverTickMs: NaN, serverTickMaxMs: NaN, serverTickHz: NaN, snapshotRate: NaN, snapshotJitter: NaN };
  /** Added one-way delay (ms) and its random variation, applied to both directions. */
  lagMs = 0;
  jitterMs = 0;
  onMessage: (msg: ServerMsg) => void = () => {};
  onSnapshot: (s: Snapshot, arrivedAt: number) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  private pingId = 0;
  private sent = new Map<number, number>();
  private rttSamples: number[] = [];
  private offsets: number[] = [];
  private offset = NaN;
  private pingTimer = 0;
  private retry = 0;
  private snapTimes: number[] = [];
  private arrivalDev: number[] = [];
  /** Delivery time of the last delayed message per direction: delays never reorder (like TCP). */
  private lastDue = { in: 0, out: 0 };

  connect(): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.stats.connected = true;
      this.retry = 0;
      this.pingTimer = window.setInterval(() => this.ping(), NET.pingInterval * 1000);
      this.ping();
      this.onOpen();
    };
    ws.onclose = () => {
      const was = this.stats.connected;
      this.stats.connected = false;
      if (was) this.onClose();
      window.clearInterval(this.pingTimer);
      this.sent.clear();
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
    ws.onmessage = (ev) => this.delayed('in', () => this.receive(ev.data));
  }

  /** Server clock estimate (ms), from the median of recent ping offsets. */
  serverNow(): number {
    return performance.now() + (Number.isFinite(this.offset) ? this.offset : 0);
  }

  get synced(): boolean {
    return Number.isFinite(this.offset);
  }

  private delayed(dir: 'in' | 'out', fn: () => void): void {
    if (this.lagMs <= 0 && this.jitterMs <= 0) {
      fn();
      return;
    }
    const now = performance.now();
    const due = Math.max(this.lastDue[dir], now + Math.max(0, this.lagMs + (Math.random() * 2 - 1) * this.jitterMs));
    this.lastDue[dir] = due;
    window.setTimeout(fn, due - now);
  }

  private receive(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const v = new DataView(data);
      if (v.getUint8(0) === BIN.SNAPSHOT) {
        const s = decodeSnapshot(v);
        if (s) {
          this.noteSnapshot(s.time);
          this.onSnapshot(s, performance.now());
        }
      }
      return;
    }
    let msg: ServerMsg;
    try {
      msg = JSON.parse(String(data)) as ServerMsg;
    } catch {
      return;
    }
    if (msg.t === 'pong') this.onPong(msg.id, msg.st);
    else if (msg.t === 'stats') {
      this.stats.serverTickMs = msg.tickMs;
      this.stats.serverTickMaxMs = msg.tickMaxMs;
      this.stats.serverTickHz = msg.tickHz;
    } else if (msg.t === 'welcome') {
      // A first clock estimate before the pings settle.
      if (!this.synced) this.offset = msg.serverTime - performance.now();
    }
    this.onMessage(msg);
  }

  private noteSnapshot(serverTime: number): void {
    const now = performance.now();
    this.snapTimes.push(now);
    while (this.snapTimes.length > 0 && now - this.snapTimes[0]! > 1000) this.snapTimes.shift();
    this.stats.snapshotRate = this.snapTimes.length;
    // Arrival jitter: spread of (arrival - server time) over recent snapshots.
    this.arrivalDev.push(now - serverTime);
    if (this.arrivalDev.length > 60) this.arrivalDev.shift();
    const mean = this.arrivalDev.reduce((a, b) => a + b, 0) / this.arrivalDev.length;
    const varc = this.arrivalDev.reduce((a, b) => a + (b - mean) ** 2, 0) / this.arrivalDev.length;
    this.stats.snapshotJitter = Math.sqrt(varc);
  }

  send(msg: ClientMsg): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(msg);
    this.delayed('out', () => ws.readyState === WebSocket.OPEN && ws.send(data));
  }

  sendBinary(buf: ArrayBuffer): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this.delayed('out', () => ws.readyState === WebSocket.OPEN && ws.send(buf));
  }

  private ping(): void {
    const id = ++this.pingId;
    this.sent.set(id, performance.now());
    this.send({ t: 'ping', id, rtt: Number.isFinite(this.stats.rtt) ? Math.round(this.stats.rtt) : undefined });
  }

  private onPong(id: number, st: number): void {
    const t0 = this.sent.get(id);
    if (t0 === undefined) return;
    this.sent.delete(id);
    const now = performance.now();
    const rtt = now - t0;
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > 20) this.rttSamples.shift();
    const mean = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
    this.stats.rtt = rtt;
    this.stats.jitter = this.rttSamples.reduce((a, b) => a + Math.abs(b - mean), 0) / this.rttSamples.length;
    this.offsets.push(st - (t0 + rtt / 2));
    if (this.offsets.length > 15) this.offsets.shift();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    this.offset = sorted[Math.floor(sorted.length / 2)]!;
  }
}
