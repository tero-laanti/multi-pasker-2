import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Acme } from '../src/server/https/acme';
import { startHttps } from '../src/server/https/host';
import { Records } from '../src/server/https/route53';
import { saveSettings } from '../src/server/https/settings';
import { fakeRoute53 } from './fakeRoute53';

/**
 * Certificates from Pebble, Let's Encrypt's test authority, which validates the DNS challenge
 * against pebble-challtestsrv's DNS. tools/test-acme.sh starts both; without them these skip.
 */
const PEBBLE = { directory: process.env.PEBBLE_DIRECTORY, challtestsrv: process.env.CHALLTESTSRV, management: process.env.PEBBLE_MANAGEMENT };
const DOMAIN = 'play-mp2.test';
const cleanups: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasker-acme-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
}

/** Route 53 whose TXT records challtestsrv answers, as the authority finds them in DNS. */
async function route53() {
  const fake = await fakeRoute53({
    pendingPolls: 1,
    onChange: async (c) => {
      if (c.type !== 'TXT') return;
      if (c.action === 'DELETE') await post(`${PEBBLE.challtestsrv}/clear-txt`, { host: `${c.name}.` });
      else await post(`${PEBBLE.challtestsrv}/set-txt`, { host: `${c.name}.`, value: c.values[0]!.replace(/^"|"$/g, '') });
    },
  });
  cleanups.push(() => fake.close());
  return fake;
}

/** The root Pebble signs with; it changes every time Pebble starts. */
async function pebbleRoot(): Promise<string> {
  return (await fetch(`${PEBBLE.management}/roots/0`)).text();
}

function certificates(pem: string): X509Certificate[] {
  return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((c) => new X509Certificate(c));
}

describe.skipIf(!PEBBLE.directory)('certificates from an ACME authority', () => {
  it('come by publishing the challenge in Route 53, and the record goes after', async () => {
    const fake = await route53();
    const dir = tempDir();
    const records = new Records({ zoneId: 'ZTEST', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret', endpoint: fake.endpoint, pollMs: 5 });
    const log: string[] = [];
    const acme = new Acme({ directoryUrl: PEBBLE.directory!, accountKeyFile: path.join(dir, 'account.key'), dns: records, log: (l) => log.push(l) });

    const pair = await acme.issue(DOMAIN);
    const [leaf, intermediate] = certificates(pair.cert);
    const root = new X509Certificate(await pebbleRoot());
    expect(leaf!.checkHost(DOMAIN)).toBe(DOMAIN);
    expect(leaf!.verify(intermediate!.publicKey)).toBe(true);
    expect(intermediate!.verify(root.publicKey)).toBe(true);
    expect(fake.changes.map((c) => [c.action, c.type, c.name])).toEqual([
      ['UPSERT', 'TXT', `_acme-challenge.${DOMAIN}`],
      ['DELETE', 'TXT', `_acme-challenge.${DOMAIN}`],
    ]);
    expect(log).toEqual(['Publishing the certificate challenge in DNS; Route 53 takes up to a minute']);

    // The next one uses the same account.
    const key = fs.readFileSync(path.join(dir, 'account.key'), 'utf8');
    await acme.issue(DOMAIN);
    expect(fs.readFileSync(path.join(dir, 'account.key'), 'utf8')).toBe(key);
  });

  it('serve the name on the first start, and from the store on the next', async () => {
    const fake = await route53();
    const dir = tempDir();
    saveSettings(dir, { domain: DOMAIN, hostedZoneId: 'ZTEST', awsAccessKeyId: 'AKIDTEST', awsSecretAccessKey: 'secret' });
    const root = await pebbleRoot();
    const run = async () => {
      const log: string[] = [];
      const joins: Array<string | null> = [];
      const host = await startHttps({
        port: 0,
        httpPort: 8088,
        address: '127.0.0.1',
        follow: false,
        staging: false,
        local: false,
        stateDir: dir,
        log: (l) => log.push(l),
        attach: (s) => s.on('request', (_req, res) => res.end('game')),
        onJoinUrl: (url) => joins.push(url),
        onAddress: () => undefined,
        acmeDirectory: PEBBLE.directory,
        route53Endpoint: fake.endpoint,
        route53PollMs: 5,
        lookup: async () => ['127.0.0.1'],
        ca: root,
        checkWaitMs: 10,
      });
      cleanups.push(() => host.close());
      for (let i = 0; i < 3000 && joins.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
      return { host, log, joins };
    };

    const first = await run();
    expect(first.joins).toEqual([first.host.url]);
    expect(first.log).toContain(`Ready: players can open ${first.host.url}`);
    const port = Number(new URL(first.host.url).port);
    const body = await new Promise<string>((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, servername: DOMAIN, path: '/', ca: root, agent: false }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    expect(body).toBe('game');
    first.host.close();

    const challenges = fake.changes.filter((c) => c.type === 'TXT').length;
    const second = await run();
    expect(second.log[0]).toMatch(/^Certificate for play-mp2.test valid until /);
    expect(second.joins).toEqual([second.host.url]);
    expect(fake.changes.filter((c) => c.type === 'TXT')).toHaveLength(challenges);
    expect(fake.changes.filter((c) => c.type === 'A').map((c) => c.values)).toEqual([['127.0.0.1'], ['127.0.0.1']]);
  });
});
