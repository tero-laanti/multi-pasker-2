/**
 * HTTPS under a name of your own (docs/HOSTING.md): serves the game at https://<name>, points the
 * name at this computer through Route 53, keeps a Let's Encrypt certificate for it, and checks
 * that the name reaches this computer. Plain http on the address keeps working beside it.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pickLanAddress } from '../lan';
import { Acme, LETS_ENCRYPT, LETS_ENCRYPT_STAGING } from './acme';
import { CertManager, selfSigned, when } from './certs';
import { Records } from './route53';
import { loadSettings } from './settings';

const DNS_TIMEOUT = 3 * 60_000;
const CERT_TIMEOUT = 5 * 60_000;
const RENEW_INTERVAL = 12 * 3_600_000;
const ADDRESS_INTERVAL = 30_000;
const CHECK_ATTEMPTS = 12;
const CHECK_WAIT = 10_000;

export interface HttpsOptions {
  /** 443 lets players open the bare name. */
  port: number;
  /** The plain-http port, for the address the messages offer instead. */
  httpPort: number;
  /** This computer's address on the network, and whether to follow it when it changes. */
  address: string;
  follow: boolean;
  /** Let's Encrypt's staging service, whose certificates browsers don't trust. */
  staging: boolean;
  /** Test on this computer only: https://localhost with a self-signed certificate, no Route 53 or Let's Encrypt. */
  local: boolean;
  stateDir: string;
  log: (line: string) => void;
  /** Gives the server the game's request and websocket handlers. */
  attach: (server: https.Server) => void;
  /** The name works (its URL) or doesn't yet (null): where phones are sent. */
  onJoinUrl: (url: string | null) => void;
  /** This computer's address changed. */
  onAddress: (address: string) => void;
  // Stand-ins for tests.
  acmeDirectory?: string;
  route53Endpoint?: string;
  route53PollMs?: number;
  lookup?: (host: string) => Promise<string[]>;
  /** Roots the check trusts instead of the usual ones. */
  ca?: string;
  checkWaitMs?: number;
  intervalMs?: number;
}

export interface HttpsHost {
  domain: string;
  /** https://<name>/, with the port unless it is 443. */
  url: string;
  local: boolean;
  /** A certificate is in use (on the first start one comes about a minute later). */
  ready(): boolean;
  close(): void;
}

export async function startHttps(o: HttpsOptions): Promise<HttpsHost> {
  // Binding first stops a second server here before it touches the running one's records.
  const server = https.createServer({ minVersion: 'TLSv1.2' });
  await listen(server, o.port);
  const port = (server.address() as AddressInfo).port;
  const abort = new AbortController();
  const close = () => {
    abort.abort();
    server.close();
  };
  try {
    if (o.local) {
      server.setSecureContext(await selfSigned(['localhost', '127.0.0.1', '::1']));
      o.attach(server);
      return { domain: 'localhost', url: origin('localhost', port), local: true, ready: () => true, close };
    }
    const settings = loadSettings(o.stateDir);
    if (!settings?.hostedZoneId) throw new Error('not set up yet: run `npm run https:setup`');
    const domain = settings.domain.toLowerCase();
    const url = origin(domain, port);
    const records = new Records({
      zoneId: settings.hostedZoneId,
      accessKeyId: settings.awsAccessKeyId,
      secretAccessKey: settings.awsSecretAccessKey,
      endpoint: o.route53Endpoint,
      pollMs: o.route53PollMs,
    });
    const [directoryUrl, label] = o.acmeDirectory ? [o.acmeDirectory, 'test-ca'] : o.staging ? [LETS_ENCRYPT_STAGING, 'letsencrypt-staging'] : [LETS_ENCRYPT, 'letsencrypt'];
    const folder = path.join(o.stateDir, 'certs', label);
    const acme = new Acme({ directoryUrl, accountKeyFile: path.join(folder, 'account.key'), dns: records, log: o.log });
    const certs = new CertManager({
      domain,
      certFile: path.join(folder, `${domain}.pem`),
      keyFile: path.join(folder, `${domain}.key`),
      issuer: { issue: (d) => acme.issue(d, AbortSignal.any([abort.signal, AbortSignal.timeout(CERT_TIMEOUT)])) },
      log: o.log,
      onChange: (pair) => server.setSecureContext(pair),
    });
    o.attach(server);

    const stored = certs.load();
    if (stored) o.log(`Certificate for ${domain} valid until ${when(certs.current!.notAfter)}`);
    else o.log(`Getting a certificate for ${domain} from Let's Encrypt${o.staging ? ' (staging)' : ''}; the first time takes about a minute`);
    // Renews a stored one that is due, too.
    const certified = certs.ensure().then(
      () => {
        if (!stored) o.log(`Ready: players can open ${url}`);
        return true;
      },
      (err: Error) => {
        o.log(`${err.message}. Until there is one, players open http://${o.address}:${o.httpPort}/`);
        return false;
      },
    );
    const stopRenewing = certs.maintain(RENEW_INTERVAL);
    abort.signal.addEventListener('abort', stopRenewing);
    if (port === 443 && o.httpPort !== 80) redirectPlainHttp(url, abort.signal, o.log);
    void keepName(o, records, domain, url, port, certified, abort.signal);
    return { domain, url, local: false, ready: () => certs.current !== null, close };
  } catch (err) {
    close();
    throw err;
  }
}

function origin(domain: string, port: number): string {
  return `https://${domain}${port === 443 ? '' : `:${port}`}/`;
}

function listen(server: http.Server | https.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: NodeJS.ErrnoException) => reject(new Error(explainListen(port, err)));
    server.once('error', fail);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', fail);
      resolve();
    });
  });
}

function explainListen(port: number, err: NodeJS.ErrnoException): string {
  if (err.code === 'EADDRINUSE') return `port ${port} is in use (is another server running?)`;
  if (err.code === 'EACCES') return `port ${port} needs administrator rights here: use --https-port 8443, and players add :8443 to the name`;
  return `port ${port}: ${err.message}`;
}

/** http://<name> goes on to https://<name>, for browsers that don't try https first. */
function redirectPlainHttp(url: string, signal: AbortSignal, log: (line: string) => void): void {
  const redirect = http.createServer((req, res) => {
    res.writeHead(301, { Location: url + (req.url ?? '/').slice(1) });
    res.end();
  });
  listen(redirect, 80).then(
    () => signal.addEventListener('abort', () => redirect.close()),
    (err: Error) => log(`Not sending http:// on to https://: ${err.message}`),
  );
}

/**
 * Points the name at this computer, then checks every ADDRESS_INTERVAL: it moves the name when
 * the address changes (joining another network, say) if it follows the address, and retries a
 * failed update quietly. Once the name points here and a certificate is in use it checks the
 * name, and keeps checking quietly until the check passes.
 */
async function keepName(o: HttpsOptions, records: Records, domain: string, url: string, port: number, certified: Promise<boolean>, signal: AbortSignal): Promise<void> {
  const point = async (address: string, verbose: boolean): Promise<boolean> => {
    if (verbose) o.log(`Pointing ${domain} at ${address} through Route 53`);
    try {
      await records.setA(domain, address, AbortSignal.any([signal, AbortSignal.timeout(DNS_TIMEOUT)]));
      o.log(`${domain} points at ${address}`);
      return true;
    } catch (err) {
      if (verbose && !signal.aborted) o.log(`Could not point ${domain} at ${address}: ${(err as Error).message}`);
      return false;
    }
  };
  let address = o.address;
  let pointed = await point(address, true);
  let checked = false;
  let first = true;
  while (!signal.aborted) {
    if (pointed && !checked && (await certified)) {
      checked = await selfCheck(o, domain, url, address, port, signal, first);
      if (checked || first) o.onJoinUrl(checked ? url : null);
      first = false;
    }
    try {
      await sleep(o.intervalMs ?? ADDRESS_INTERVAL, undefined, { signal });
    } catch {
      return;
    }
    const now = o.follow ? pickLanAddress() : null;
    if (now && now !== address) {
      address = now;
      checked = false;
      first = true;
      o.log(`This computer's address changed to ${address}`);
      o.onAddress(address);
      o.onJoinUrl(null);
      pointed = await point(address, true);
    } else if (!pointed) {
      pointed = await point(address, false);
    }
  }
}

/**
 * Whether the name leads to this computer, with a trusted certificate there. The first check
 * waits for the name a while and logs what to fix; the later ones try once, quietly.
 */
async function selfCheck(o: HttpsOptions, domain: string, url: string, address: string, port: number, signal: AbortSignal, first: boolean): Promise<boolean> {
  const lookup = o.lookup ?? ((host: string) => dns.promises.lookup(host, { all: true, family: 4 }).then((list) => list.map((a) => a.address)));
  let found: string[] = [];
  let resolved = false;
  for (let i = 0; i < (first ? CHECK_ATTEMPTS : 1) && !resolved && !signal.aborted; i++) {
    if (i > 0) await sleep(o.checkWaitMs ?? CHECK_WAIT, undefined, { signal }).catch(() => undefined);
    found = await lookup(domain).catch(() => []);
    resolved = found.includes(address);
  }
  if (signal.aborted) return false;
  const meanwhile = `Until then players open http://${address}:${o.httpPort}/`;
  if (!resolved && first && found.length === 0) {
    o.log(
      `Check: this computer doesn't find ${domain} yet. A name looked up before it pointed here stays unknown for up to 15 minutes; ` +
        `if it lasts longer, the router may block public names that point to local addresses: allow ${domain} in its DNS rebinding settings. ${meanwhile}`,
    );
  } else if (!resolved && first) {
    o.log(`Check: this computer finds ${domain} at ${found.join(', ')}, not ${address}; the old address is remembered for about a minute. ${meanwhile}`);
  }
  try {
    await fetchInfo(address, port, domain, o.ca);
  } catch (err) {
    if (first) o.log(`Check failed: ${domain} does not answer at ${address} with a trusted certificate: ${(err as Error).message}`);
    return false;
  }
  if (resolved) o.log(`Check passed: ${url} reaches this computer with a trusted certificate`);
  else if (first) o.log(`Check passed for the certificate: ${domain} answers at ${address} with a trusted certificate`);
  return resolved;
}

/** GET /api/info from this computer's address, as the name. */
function fetchInfo(address: string, port: number, domain: string, ca?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: address, port, servername: domain, path: '/api/info', headers: { host: domain }, ca, agent: false, timeout: 10_000 }, (res) => {
      res.resume();
      if (res.statusCode === 200) resolve();
      else reject(new Error(`it answered ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error('no answer in 10 seconds')));
    req.on('error', reject);
  });
}
