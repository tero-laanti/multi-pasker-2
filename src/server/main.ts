import fs from 'node:fs';
import http from 'node:http';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const CONFIG_FILE = path.join(ROOT, 'src/shared/config.ts');

interface Args {
  dev: boolean;
  port: number;
  host?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dev: false, port: Number(process.env.PASKER_PORT) || NET.defaultPort, host: process.env.PASKER_HOST };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dev') args.dev = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) args.port = Number(a.slice(7));
    else if (a === '--host') args.host = argv[++i];
    else if (a.startsWith('--host=')) args.host = a.slice(7);
  }
  if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) throw new Error(`Invalid port: ${args.port}`);
  return args;
}

const sfx = new AudioFolder(path.join(ROOT, 'assets/sfx'), path.join(ROOT, 'assets/sfx/_base'));
const voice = new AudioFolder(path.join(ROOT, 'assets/voice'), path.join(ROOT, 'assets/voice/_placeholder'));
const voiceNotes = new VoiceNotes(folderVoice(voice));
voiceNotes.warm();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const lan = pickLanAddress(args.host);
  const server = http.createServer();

  let viteMiddleware: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | null = null;
  if (args.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'mpa',
    });
    viteMiddleware = vite.middlewares;
  } else if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('No client build found. Run "npm start" (builds and starts) or "npm run build".');
    process.exit(1);
  }

  server.on('request', (req, res) => {
    handleRequest(req, res, args, lan, viteMiddleware).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: String(err) });
      else res.end();
    });
  });

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
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') return; // Vite's HMR socket handles its own upgrades in dev.
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      onConnection(ws, req);
    });
  });

  // The evening scoreboard lives in data/ (not in git) and survives restarts. A server on another
  // port (a second instance for testing) keeps its own.
  const evening = new Evening(eveningFile(path.join(ROOT, 'data', args.port === NET.defaultPort ? 'evening.json' : `evening-${args.port}.json`)));
  room = new Room(buildGarrison(), { dev: args.dev, publicUrl: lan ? `http://${lan}:${args.port}/` : undefined, voiceNotes, evening, bots: Number(process.env.PASKER_BOTS ?? 0) });

  loop = new TickLoop(room);

  server.listen(args.port, '0.0.0.0', () => {
    printBanner(args, lan);
  });

  const shutdown = () => {
    console.log('\nShutting down…');
    for (const c of wss.clients) c.close(1001, 'server shutdown');
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
  lan: string | null,
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
    sendJson(res, 200, { lan, port: args.port, dev: args.dev, joinUrl: lan ? `http://${lan}:${args.port}/` : null });
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

function printBanner(args: Args, lan: string | null): void {
  const line = '─'.repeat(56);
  console.log(line);
  console.log(` MULTI-PASKER 2 ${args.dev ? '(development)' : ''}`);
  console.log(line);
  if (lan) {
    console.log(` Players: open  http://${lan}:${args.port}/  in Chrome or Edge`);
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
