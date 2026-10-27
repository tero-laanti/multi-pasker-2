import type { Socket } from '../../server/socket';

type Data = string | ArrayBuffer;

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** Binary data is copied on the way, so neither end sees the other reuse its buffer. */
function copy(data: string | ArrayBuffer | ArrayBufferView): Data {
  if (typeof data === 'string') return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return data.slice(0);
}

/** The in-page server's end of a connection: what the room sends to and closes. */
export class ServerEnd implements Socket {
  readonly OPEN = OPEN;
  readyState = OPEN;
  onMessage: (data: Data) => void = () => {};
  onClose: () => void = () => {};

  constructor(private peer: ClientEnd) {}

  send(data: string | ArrayBuffer): void {
    if (this.readyState === OPEN) this.peer.receive(copy(data));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState !== OPEN) return;
    this.readyState = CLOSED;
    this.peer.closedByPeer(code, reason);
    queueMicrotask(() => this.onClose());
  }
}

/**
 * The game's (or the virtual phone's) end: looks like a browser WebSocket to its user.
 * Messages arrive asynchronously and in order, as over a network.
 */
export class ClientEnd {
  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSING = 2;
  readonly CLOSED = CLOSED;
  readyState = CONNECTING;
  binaryType = 'arraybuffer';
  onopen: ((e: object) => void) | null = null;
  onmessage: ((e: { data: Data }) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((e: object) => void) | null = null;
  readonly server = new ServerEnd(this);

  constructor() {
    queueMicrotask(() => {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.onopen?.({ type: 'open' });
    });
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== OPEN) return;
    const d = copy(data);
    queueMicrotask(() => {
      if (this.server.readyState === OPEN) this.server.onMessage(d);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    const server = this.server;
    queueMicrotask(() => {
      if (server.readyState === OPEN) {
        server.readyState = CLOSED;
        server.onClose();
      }
      this.onclose?.({ code, reason, wasClean: true });
    });
  }

  /** From the server. A frame that has gone away (the virtual phone closed) just stops listening. */
  receive(data: Data): void {
    queueMicrotask(() => {
      if (this.readyState !== OPEN) return;
      try {
        this.onmessage?.({ data });
      } catch (err) {
        console.error(err);
      }
    });
  }

  closedByPeer(code: number, reason: string): void {
    queueMicrotask(() => {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this.onclose?.({ code, reason, wasClean: true });
    });
  }
}
