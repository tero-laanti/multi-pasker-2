import fs from 'node:fs';
import http from 'node:http';
import type https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { NET, TUNING } from '../shared/config';
import { AudioFolder, fromHostMachine, readBody, safeJoin, sendBuffer, sendFile, sendJson } from './http';
import { isOwnAddress, lanCandidates, pickLanAddress } from './lan';
import { applyTuning, type TuningTree } from './tuningWriter';
import { buildGarrison } from '../shared/map/garrison';
import { Room } from './game/room';
import { mergeTuning, type TuningNode } from '../shared/tuningTree';
import { VoiceNotes } from './voicenotes';
import { Evening } from './game/awards';
import { Connection } from './connection';
import { TickLoop } from './loop';
import { eveningFile, folderVoice } from './storage';
import type { HttpsHost } from './https/host';
import { loadSettings, stateDir } from './https/settings';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const CONFIG_FILE = path.join(ROOT, 'src/shared/config.ts');

interface Args {
  dev: boolean;
  port: number;
  host?: string;
  /** The HTTPS name from `npm run https:setup`: forced on or off; by default on in `npm start` once set up. */
  https?: boolean;
  httpsPort?: number;
  /** Test HTTPS on this computer only, at https://localhost:8443 with a self-signed certificate. */
  localHttps: boolean;
  /** Let's Encrypt's staging service, for practice: browsers don't trust its certificates. */
  staging: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dev: false, port: Number(process.env.PASKER_PORT) || NET.defaultPort, host: process.env.PASKER_HOST, localHttps: false, staging: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dev') args.dev = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) args.port = Number(a.slice(7));
    else if (a === '--host') args.host = argv[++i];
    else if (a.startsWith('--host=')) args.host = a.slice(7);
    else if (a === '--https') args.https = true;
    else if (a === '--no-https') args.https = false;
    else if (a === '--https-port') args.httpsPort = Number(argv[++i]);
    else if (a.startsWith('--https-port=')) args.httpsPort = Number(a.slice(13));
    else if (a === '--local-https') args.localHttps = true;
    else if (a === '--staging') args.staging = true;
  }
  for (const port of [args.port, args.httpsPort ?? 443]) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid port: ${port}`);
  }
  return args;
}

const sfx = new AudioFolder(path.join(ROOT, 'assets/sfx'), path.join(ROOT, 'assets/sfx/_base'));
const voice = new AudioFolder(path.join(ROOT, 'assets/voice'), path.join(ROOT, 'assets/voice/_placeholder'));
const voiceNotes = new VoiceNotes(folderVoice(voice));
voiceNotes.warm();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  lan = pickLanAddress(args.host);
  const server = http.createServer();

  let viteMiddleware: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | null = null;
  if (args.dev) {
    const { createServer } = await import('vite');
    // Vite answers only the host names it knows; the HTTPS name is one.
    const name = httpsWanted(args) && !args.localHttps ? loadSettings(stateDir())?.domain : undefined;
    const vite = await createServer({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server }, ...(name ? { allowedHosts: [name] } : {}) },
      appType: 'mpa',
    });
    viteMiddleware = vite.middlewares;
  } else if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('No client build found. Run "npm start" (builds and starts) or "npm run build".');
    process.exit(1);
  }

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1 << 20 });
  // Heartbeat: a phone that drops off the Wi-Fi without closing its socket would otherwise look
  // connected for minutes. Browsers answer protocol pings by themselves.
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  });
  setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 5000).unref();
  /** The game on a server: the plain one, and the HTTPS one once there is a name. */
  const attach = (s: http.Server | https.Server) => {
    s.on('request', (req, res) => {
      handleRequest(req, res, args, viteMiddleware).catch((err) => {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: String(err) });
        else res.end();
      });
    });
    s.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/ws') {
        // Vite's HMR socket handles its own upgrades in dev, on the plain server.
        if (s !== server) server.emit('upgrade', req, socket, head);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
        onConnection(ws, req);
      });
    });
  };
  attach(server);

  // The evening scoreboard lives in data/ (not in git) and survives restarts. A server on another
  // port (a second instance for testing) keeps its own.
  const evening = new Evening(eveningFile(path.join(ROOT, 'data', args.port === NET.defaultPort ? 'evening.json' : `evening-${args.port}.json`)));
  room = new Room(buildGarrison(), { dev: args.dev, publicUrl: joinUrl(args), voiceNotes, evening, bots: Number(process.env.PASKER_BOTS ?? 0) });

  loop = new TickLoop(room);

  await new Promise<void>((resolve) => server.listen(args.port, '0.0.0.0', resolve));
  secure = await startSecure(args, attach);
  printBanner(args);

  const shutdown = () => {
    console.log('\nShutting down…');
    for (const c of wss.clients) c.close(1001, 'server shutdown');
    secure?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  args: Args,
  vite: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | null,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = url.pathname;
  // The phone app lives at /phone.
  if (p === '/phone' || p === '/phone/') {
    p = '/phone.html';
    req.url = p + url.search;
  }

  if (p === '/api/info') {
    sendJson(res, 200, { lan, port: args.port, dev: args.dev, joinUrl: joinUrl(args) ?? null, https: secure?.url ?? null });
    return;
  }
  if (p === '/sfx/manifest.json') {
    sendJson(res, 200, sfx.manifest());
    return;
  }
  if (p.startsWith('/sfx/') || p.startsWith('/voice/')) {
    const folder = p.startsWith('/sfx/') ? sfx : voice;
    const name = p.slice(p.indexOf('/', 1) + 1);
    const file = folder.resolve(name);
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    sendFile(req, res, file, 'no-cache');
    return;
  }
  // Spliced phonetic-alphabet voice notes.
  const note = /^\/voicenote\/([0-9a-f]{16})\.wav$/.exec(p);
  if (note) {
    const wav = voiceNotes.build(note[1]!);
    if (!wav) {
      res.writeHead(404);
      res.end();
      return;
    }
    // A note's id is its contents: the phone may keep it (it replays from its cache).
    sendBuffer(req, res, wav, 'audio/wav', 'private, max-age=3600');
    return;
  }
  if (p === '/dev/tuning' && req.method === 'POST') {
    if (!fromHostMachine(req)) {
      sendJson(res, 403, { error: 'Saving only works on the server machine.' });
      return;
    }
    const body = JSON.parse(await readBody(req)) as TuningTree;
    const source = fs.readFileSync(CONFIG_FILE, 'utf8');
    const { text, changed } = applyTuning(source, body);
    if (changed.length > 0) fs.writeFileSync(CONFIG_FILE, text);
    mergeTuning(TUNING as unknown as TuningNode, body);
    sendJson(res, 200, { changed });
    return;
  }

  if (vite) {
    vite(req, res, () => {
      res.writeHead(404);
      res.end();
    });
    return;
  }

  // Built client.
  let rel = p;
  if (rel.endsWith('/')) rel += 'index.html';
  const file = safeJoin(DIST, rel);
  if (!file) {
    res.writeHead(400);
    res.end();
    return;
  }
  const hashed = rel.startsWith('/assets/');
  sendFile(req, res, file, hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
}

let room: Room;
let loop: TickLoop;
let nextClientId = 1;
/** This computer's address on the network (null: none found). */
let lan: string | null = null;
let secure: HttpsHost | null = null;
/** The HTTPS name's address once its check passed. */
let httpsUrl: string | null = null;

/** Where players and phones go: the HTTPS name once it works, else the plain address. */
function joinUrl(args: Args): string | undefined {
  return httpsUrl ?? (lan ? `http://${lan}:${args.port}/` : undefined);
}

/** HTTPS is asked for, or the name is set up and this isn't development. */
function httpsWanted(args: Args): boolean {
  return args.localHttps || (args.https ?? (!args.dev && fs.existsSync(path.join(stateDir(), 'config.json'))));
}

/** The HTTPS name beside the plain address, when it is set up (or asked for); null when off or failing. */
async function startSecure(args: Args, attach: (s: https.Server) => void): Promise<HttpsHost | null> {
  const dir = stateDir();
  if (!httpsWanted(args)) return null;
  const log = (line: string) => console.log(`[https] ${line}`);
  if (!args.localHttps && !lan) {
    log('No network address to point the name at; serving plain http only');
    return null;
  }
  const { startHttps } = await import('./https/host');
  try {
    return await startHttps({
      port: args.httpsPort ?? (args.localHttps ? 8443 : 443),
      httpPort: args.port,
      address: lan ?? '127.0.0.1',
      follow: !args.host,
      staging: args.staging,
      local: args.localHttps,
      stateDir: dir,
      log,
      attach,
      onJoinUrl: (url) => {
        httpsUrl = url;
        room.opts.publicUrl = joinUrl(args);
      },
      onAddress: (address) => {
        lan = address;
        room.opts.publicUrl = joinUrl(args);
      },
    });
  } catch (err) {
    log(`${(err as Error).message}; serving plain http only`);
    return null;
  }
}

function onConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const id = nextClientId++;
  const addr = req.socket.remoteAddress ?? '';
  console.log(`[ws] connection #${id} from ${addr}`);
  const c = new Connection(room, ws, isOwnAddress(addr), loop, (line) => console.log(line));
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      c.text(String(data));
      return;
    }
    const buf = data as Buffer;
    c.binary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  });
  ws.on('close', () => {
    c.closed();
    console.log(`[ws] connection #${id} closed`);
  });
}

function printBanner(args: Args): void {
  const line = '─'.repeat(56);
  const plain = lan ? `http://${lan}:${args.port}/` : null;
  console.log(line);
  console.log(` MULTI-PASKER 2 ${args.dev ? '(development)' : ''}`);
  console.log(line);
  if (secure?.local) console.log(` HTTPS test on this computer:  ${secure.url}  (self-signed certificate)`);
  if (secure && !secure.local && secure.ready()) {
    console.log(` Players: open  ${secure.url}  in Chrome or Edge`);
    if (plain) console.log(` If it does not open:  ${plain}`);
  } else if (plain) {
    console.log(` Players: open  ${plain}  in Chrome or Edge`);
    if (secure && !secure.local) console.log(` ${secure.url} comes up once its certificate is ready`);
  } else {
    console.log(' No LAN address found. Set one with: npm start -- --host 192.168.x.y');
  }
  const others = lanCandidates().filter((c) => c.address !== lan);
  if (others.length > 0) {
    console.log(' Other addresses (if the one above does not work):');
    for (const c of others) console.log(`   http://${c.address}:${args.port}/   (${c.name})`);
  }
  console.log(' Stop: Ctrl+C');
  console.log(line);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
