import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isOwnAddress } from './lan';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json']!, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

/** An in-memory body, with byte ranges (iOS Safari needs them to play audio). */
export function sendBuffer(req: IncomingMessage, res: ServerResponse, buf: Buffer, type: string): void {
  const range = req.headers.range;
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), buf.length - 1) : buf.length - 1;
    if (start > end || start >= buf.length) {
      res.writeHead(416, { 'content-range': `bytes */${buf.length}` });
      res.end();
      return;
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
    res.end(buf.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cache: string): void {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': cache });
      res.end();
      return;
    }
    // Byte ranges matter for <audio>/<video> on iOS Safari.
    const range = req.headers.range;
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'content-range': `bytes */${st.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes',
        'cache-control': cache,
        etag,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': cache, etag });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

/** Resolves a URL path inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const full = path.normalize(path.join(root, decoded));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

const AUDIO_EXT = ['.ogg', '.opus', '.m4a', '.mp3', '.wav', '.webm'];

/**
 * Sound and voice files: a file dropped into the top folder (any audio extension) replaces
 * the generated one in its fallback subfolder with the same base name.
 */
export class AudioFolder {
  constructor(
    readonly dir: string,
    readonly fallbackDir: string,
  ) {}

  resolve(name: string): string | null {
    if (!/^[a-z0-9_\-]+$/i.test(name)) return null;
    for (const d of [this.dir, this.fallbackDir]) {
      for (const ext of AUDIO_EXT) {
        const f = path.join(d, name + ext);
        if (fs.existsSync(f)) return f;
      }
    }
    return null;
  }

  /** A WAV for `name`: the recording if it is a WAV, otherwise the placeholder (for splicing). */
  resolveWav(name: string): string | null {
    if (!/^[a-z0-9_\-]+$/i.test(name)) return null;
    for (const d of [this.dir, this.fallbackDir]) {
      const f = path.join(d, `${name}.wav`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  /** All available base names, with whether each is an override or generated. */
  manifest(): Record<string, 'user' | 'generated'> {
    const out: Record<string, 'user' | 'generated'> = {};
    for (const [d, kind] of [
      [this.fallbackDir, 'generated'],
      [this.dir, 'user'],
    ] as const) {
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        const ext = path.extname(f).toLowerCase();
        if (!AUDIO_EXT.includes(ext)) continue;
        out[path.basename(f, ext)] = kind;
      }
    }
    return out;
  }
}

export function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** True when the request comes from the server machine itself (see isOwnAddress). */
export function fromHostMachine(req: IncomingMessage): boolean {
  return isOwnAddress(req.socket.remoteAddress ?? '');
}
