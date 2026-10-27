/**
 * What the game needs of a connection: the parts of a WebSocket it uses. On the server it is a
 * `ws` socket; in the browser version's bot match, one end of an in-page pair.
 */
export interface Socket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}
