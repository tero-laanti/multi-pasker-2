import { NET } from '../shared/config';
import type { ClientMsg, PhoneClientMsg } from '../shared/protocol';
import type { ServerPlayer } from './game/player';
import type { Room } from './game/room';
import type { TickLoop } from './loop';
import type { Socket } from './socket';

/**
 * One connection, a desktop or a phone: hands its messages to the room, and once a second sends
 * the server's tick times (the F3 overlay).
 */
export class Connection {
  private player: ServerPlayer | null = null;
  /** Set when this connection is a phone: the player it belongs to. */
  private phoneOf: ServerPlayer | null = null;
  private stats: ReturnType<typeof setInterval>;

  constructor(
    private room: Room,
    private ws: Socket,
    private isHost: boolean,
    loop: TickLoop,
    private log: (line: string) => void = () => {},
  ) {
    this.stats = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'stats', tickMs: loop.stats.avg, tickMaxMs: loop.stats.max, tickHz: NET.tickHz, ticks: loop.count }));
    }, 1000);
  }

  binary(buf: ArrayBuffer): void {
    if (this.player) this.room.onBinary(this.player, buf);
  }

  text(data: string): void {
    let msg: ClientMsg | PhoneClientMsg;
    try {
      msg = JSON.parse(data) as ClientMsg | PhoneClientMsg;
    } catch {
      return;
    }
    const { room, ws } = this;
    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', id: msg.id, st: room.now() }));
      if (this.player && typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) this.player.rtt = Math.max(0, Math.min(9999, msg.rtt));
      return;
    }
    if (msg.t === 'hello') {
      this.player = room.join(ws, msg, this.isHost);
      if (this.player) this.log(`[room] ${this.player.name} (#${this.player.id}) joined`);
      return;
    }
    if (msg.t === 'phoneHello') {
      this.phoneOf = room.phoneJoin(ws, msg, this.isHost);
      if (this.phoneOf) this.log(`[phone] ${this.phoneOf.name}'s phone connected`);
      return;
    }
    if (this.phoneOf) room.onPhoneMessage(this.phoneOf, msg as PhoneClientMsg);
    else if (this.player) room.onMessage(this.player, msg as ClientMsg);
  }

  closed(): void {
    clearInterval(this.stats);
    if (this.player && this.player.ws === this.ws) this.room.disconnect(this.player);
    if (this.phoneOf) this.room.phoneDisconnect(this.phoneOf, this.ws);
  }
}
