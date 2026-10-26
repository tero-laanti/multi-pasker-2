import { NET } from '../shared/config';

export interface NetStats {
  connected: boolean;
  rtt: number;
  jitter: number;
  serverTickMs: number;
  serverTickHz: number;
}

/** WebSocket link to the game server with reconnect and RTT/jitter tracking. */
export class Net {
  ws: WebSocket | null = null;
  stats: NetStats = { connected: false, rtt: NaN, jitter: NaN, serverTickMs: NaN, serverTickHz: NaN };
  private pingId = 0;
  private sent = new Map<number, number>();
  private rttSamples: number[] = [];
  private pingTimer = 0;
  private retry = 0;
  handlers = new Set<(msg: { t: string; [k: string]: unknown }) => void>();

  connect(): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.stats.connected = true;
      this.retry = 0;
      this.pingTimer = window.setInterval(() => this.ping(), NET.pingInterval * 1000);
      this.ping();
    };
    ws.onclose = () => {
      this.stats.connected = false;
      window.clearInterval(this.pingTimer);
      this.sent.clear();
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: { t: string; [k: string]: unknown };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') this.onPong(msg.id as number);
      else if (msg.t === 'stats') {
        this.stats.serverTickMs = msg.tickMs as number;
        this.stats.serverTickHz = msg.tickHz as number;
      }
      for (const h of this.handlers) h(msg);
    };
  }

  send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private ping(): void {
    const id = ++this.pingId;
    this.sent.set(id, performance.now());
    this.send({ t: 'ping', id });
  }

  private onPong(id: number): void {
    const t0 = this.sent.get(id);
    if (t0 === undefined) return;
    this.sent.delete(id);
    const rtt = performance.now() - t0;
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > 20) this.rttSamples.shift();
    const mean = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
    const dev = this.rttSamples.reduce((a, b) => a + Math.abs(b - mean), 0) / this.rttSamples.length;
    this.stats.rtt = rtt;
    this.stats.jitter = dev;
  }
}
