import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CertManager, selfSigned, type KeyPair } from '../src/server/https/certs';
import { startHttps, type HttpsHost, type HttpsOptions } from '../src/server/https/host';
import { cleanZoneId, normalizeName, policy, Records } from '../src/server/https/route53';
import { DEFAULT_DOMAIN, loadSettings, saveSettings, stateDir } from '../src/server/https/settings';
import { fakeRoute53, type FakeRoute53 } from './fakeRoute53';

const DOMAIN = 'play-mp2.test';
const DAY = 86_400_000;
const cleanups: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasker-https-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function route53(o: Parameters<typeof fakeRoute53>[0] = {}): Promise<FakeRoute53> {
  const fake = await fakeRoute53(o);
  cleanups.push(() => fake.close());
  return fake;
}

const records = (endpoint: string) => new Records({ zoneId: '/hostedzone/ZTEST', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret', endpoint, pollMs: 5 });

const mode = (file: string) => fs.statSync(file).mode & 0o777;

describe('settings', () => {
  it('keep the state outside the repository, per platform', () => {
    expect(stateDir({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Application Support/MultiPasker2');
    expect(stateDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(path.join('C:\\Users\\a\\AppData\\Roaming', 'MultiPasker2'));
    expect(stateDir({}, 'linux', '/home/a')).toBe('/home/a/.config/multi-pasker-2');
    expect(stateDir({ PASKER_STATE: '/tmp/x' }, 'darwin', '/Users/a')).toBe('/tmp/x');
  });

  it('round-trip, readable only by the owner', () => {
    const dir = path.join(tempDir(), 'state');
    expect(loadSettings(dir)).toBeNull();
    const file = saveSettings(dir, { domain: DOMAIN, hostedZoneId: 'ZTEST', awsAccessKeyId: 'AKIDTEST', awsSecretAccessKey: 'secret' });
    expect(loadSettings(dir)).toEqual({ domain: DOMAIN, hostedZoneId: 'ZTEST', awsAccessKeyId: 'AKIDTEST', awsSecretAccessKey: 'secret' });
    if (process.platform !== 'win32') {
      expect(mode(file)).toBe(0o600);
      expect(mode(dir)).toBe(0o700);
    }
    fs.writeFileSync(file, '{"hostedZoneId":"ZTEST"}');
    expect(loadSettings(dir)).toEqual({ domain: DEFAULT_DOMAIN, hostedZoneId: 'ZTEST' });
  });
});

describe('Route 53', () => {
  it('names the IAM policy exactly the two records, in one zone', () => {
    const p = JSON.parse(policy('/hostedzone/ZTEST', 'Play-MP2.Test.'));
    const change = p.Statement[0];
    expect(change.Resource).toBe('arn:aws:route53:::hostedzone/ZTEST');
    expect(change.Condition['ForAllValues:StringEquals']['route53:ChangeResourceRecordSetsNormalizedRecordNames']).toEqual([DOMAIN, `_acme-challenge.${DOMAIN}`]);
    expect(change.Condition['ForAllValues:StringEquals']['route53:ChangeResourceRecordSetsRecordTypes']).toEqual(['A', 'TXT']);
    expect(p.Statement[1].Action).toBe('route53:GetChange');
    expect(normalizeName(' Play-MP2.Test. ')).toBe(DOMAIN);
    expect(cleanZoneId(' /hostedzone/Z123 ')).toBe('Z123');
  });

  it('points the name and waits until every Route 53 server has it', async () => {
    const fake = await route53({ pendingPolls: 2 });
    await records(fake.endpoint).setA('Play-MP2.Test.', '192.168.1.23');
    expect(fake.changes).toEqual([{ zone: 'ZTEST', action: 'UPSERT', name: DOMAIN, type: 'A', ttl: 60, values: ['192.168.1.23'] }]);
    expect(fake.getChanges).toBe(2);
    await expect(records(fake.endpoint).setA(DOMAIN, 'fe80::1')).rejects.toThrow('not an IPv4 address');
  });

  it('quotes the challenge value, and removes it without waiting', async () => {
    const fake = await route53({ pendingPolls: 1 });
    const r = records(fake.endpoint);
    await r.setTxt(`_acme-challenge.${DOMAIN}`, 'abc-123_x');
    await r.deleteTxt(`_acme-challenge.${DOMAIN}`, 'abc-123_x');
    expect(fake.changes.map((c) => [c.action, c.type, c.values])).toEqual([
      ['UPSERT', 'TXT', ['"abc-123_x"']],
      ['DELETE', 'TXT', ['"abc-123_x"']],
    ]);
    expect(fake.getChanges).toBe(1);
  });

  it('says what to fix when the key may not change the record', async () => {
    const fake = await route53({ error: { status: 403, code: 'AccessDenied' } });
    await expect(records(fake.endpoint).setA(DOMAIN, '192.168.1.23')).rejects.toThrow(/Setting the A record play-mp2.test: .*npm run https:policy/);
    const zone = await route53({ error: { status: 404, code: 'NoSuchHostedZone' } });
    await expect(records(zone.endpoint).setA(DOMAIN, '192.168.1.23')).rejects.toThrow('the hosted zone ID is wrong');
    await expect(records('http://127.0.0.1:9').setA(DOMAIN, '192.168.1.23')).rejects.toThrow('is this computer online?');
  });
});

describe('the certificate', () => {
  function manager(dir: string, issue: () => Promise<KeyPair>, now: () => number, log: string[] = []) {
    const changes: KeyPair[] = [];
    const m = new CertManager({ domain: DOMAIN, certFile: path.join(dir, `${DOMAIN}.pem`), keyFile: path.join(dir, `${DOMAIN}.key`), issuer: { issue }, log: (l) => log.push(l), onChange: (p) => changes.push(p), now });
    return { m, changes, log };
  }
  const start = Date.parse('2026-11-01T12:00:00Z');
  const ninety = (from = start) => selfSigned([DOMAIN], new Date(from), new Date(from + 90 * DAY));

  it('is fetched on the first start, stored for the owner only, and used from the store after', async () => {
    const dir = path.join(tempDir(), 'certs');
    let issued = 0;
    const issue = () => (issued++, ninety());
    const first = manager(dir, issue, () => start + DAY);
    expect(first.m.load()).toBe(false);
    await first.m.ensure();
    expect(issued).toBe(1);
    expect(first.changes).toHaveLength(1);
    expect(first.log[0]).toMatch(/^New certificate for play-mp2.test, valid until 2027-01-30/);
    if (process.platform !== 'win32') expect(mode(path.join(dir, `${DOMAIN}.key`))).toBe(0o600);

    const later = manager(dir, issue, () => start + 30 * DAY);
    expect(later.m.load()).toBe(true);
    await later.m.ensure();
    expect(issued).toBe(1);
    expect(later.changes).toHaveLength(1);
  });

  it('is renewed in the last third of its life, and kept while renewing fails', async () => {
    const dir = path.join(tempDir(), 'certs');
    const stored = manager(dir, () => ninety(), () => start);
    await stored.m.ensure();

    let fail = true;
    const renewing = manager(dir, () => (fail ? Promise.reject(new Error('no internet')) : ninety(start + 61 * DAY)), () => start + 61 * DAY);
    await renewing.m.ensure();
    expect(renewing.log.at(-1)).toMatch(/^Could not renew the certificate, keeping the current one until 2027-01-30.*: no internet$/);
    expect(renewing.m.current!.notAfter.getTime()).toBe(start + 90 * DAY);
    fail = false;
    await renewing.m.ensure();
    expect(renewing.m.current!.notAfter.getTime()).toBe(start + 151 * DAY);
  });

  it('fails without a valid one, and ignores a stored one for another name', async () => {
    const dir = path.join(tempDir(), 'certs');
    const expired = manager(dir, () => Promise.reject(new Error('no internet')), () => start);
    await expect(expired.m.ensure()).rejects.toThrow('No valid certificate for play-mp2.test: no internet');

    const other = await selfSigned(['other.test'], new Date(start), new Date(start + 90 * DAY));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${DOMAIN}.pem`), other.cert);
    fs.writeFileSync(path.join(dir, `${DOMAIN}.key`), other.key);
    const fresh = manager(dir, () => ninety(), () => start);
    expect(fresh.m.load()).toBe(false);
    expect(fresh.log[0]).toMatch(/^Ignoring the stored certificate: the certificate is for DNS:other.test/);
    await fresh.m.ensure();
    expect(fresh.m.current).not.toBeNull();
  });
});

describe('the HTTPS server', () => {
  async function start(o: Partial<HttpsOptions> & Pick<HttpsOptions, 'stateDir'>): Promise<{ host: HttpsHost; log: string[]; joins: Array<string | null> }> {
    const log: string[] = [];
    const joins: Array<string | null> = [];
    const host = await startHttps({
      port: 0,
      httpPort: 8088,
      address: '127.0.0.1',
      follow: false,
      staging: false,
      local: false,
      log: (l) => log.push(l),
      attach: (s) =>
        s.on('request', (req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end(`game at ${req.url}`);
        }),
      onJoinUrl: (url) => joins.push(url),
      onAddress: () => undefined,
      checkWaitMs: 10,
      intervalMs: 20,
      route53PollMs: 5,
      ...o,
    });
    cleanups.push(() => host.close());
    return { host, log, joins };
  }

  function get(url: string, o: https.RequestOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      https
        .get(url, { agent: false, ...o }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
  }

  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(ok()).toBe(true);
  };

  it('serves the game on this computer with a self-signed certificate (--local-https)', async () => {
    const { host } = await start({ stateDir: tempDir(), local: true });
    expect(host.url).toMatch(/^https:\/\/localhost:\d+\/$/);
    expect(await get(`${host.url}phone`, { rejectUnauthorized: false })).toBe('game at /phone');
  });

  it('refuses to start before the setup', async () => {
    await expect(start({ stateDir: tempDir() })).rejects.toThrow('not set up yet: run `npm run https:setup`');
  });

  it('points the name at this computer and sends phones to it once the check passes', async () => {
    const dir = tempDir();
    saveSettings(dir, { domain: DOMAIN, hostedZoneId: 'ZTEST', awsAccessKeyId: 'AKIDTEST', awsSecretAccessKey: 'secret' });
    // A stored certificate, so no authority is needed here (tests/acme.test.ts fetches one).
    const pair = await selfSigned([DOMAIN]);
    fs.mkdirSync(path.join(dir, 'certs', 'test-ca'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'certs', 'test-ca', `${DOMAIN}.pem`), pair.cert);
    fs.writeFileSync(path.join(dir, 'certs', 'test-ca', `${DOMAIN}.key`), pair.key);
    const fake = await route53({ pendingPolls: 1 });
    let found: string[] = [];
    const { host, log, joins } = await start({
      stateDir: dir,
      route53Endpoint: fake.endpoint,
      acmeDirectory: 'https://ca.invalid/directory',
      lookup: async () => found,
      ca: pair.cert,
    });
    expect(host.ready()).toBe(true);
    expect(host.url).toMatch(/^https:\/\/play-mp2\.test:\d+\/$/);
    await until(() => log.includes('play-mp2.test points at 127.0.0.1'));
    expect(fake.changes).toEqual([{ zone: 'ZTEST', action: 'UPSERT', name: DOMAIN, type: 'A', ttl: 60, values: ['127.0.0.1'] }]);
    // The name only resolves after a few tries, as when a resolver still remembers the old address.
    setTimeout(() => (found = ['127.0.0.1']), 50);
    await until(() => joins.length > 0);
    expect(joins).toEqual([host.url]);
    expect(log.at(-1)).toBe(`Check passed: ${host.url} reaches this computer with a trusted certificate`);
  });

  it('keeps phones on the address while the name is not found, and moves them once it is', async () => {
    const dir = tempDir();
    saveSettings(dir, { domain: DOMAIN, hostedZoneId: 'ZTEST', awsAccessKeyId: 'AKIDTEST', awsSecretAccessKey: 'secret' });
    const pair = await selfSigned([DOMAIN]);
    fs.mkdirSync(path.join(dir, 'certs', 'test-ca'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'certs', 'test-ca', `${DOMAIN}.pem`), pair.cert);
    fs.writeFileSync(path.join(dir, 'certs', 'test-ca', `${DOMAIN}.key`), pair.key);
    const fake = await route53();
    // As when the network's DNS remembers asking before the name existed, or a router hides it.
    let found: string[] = [];
    const { host, log, joins } = await start({ stateDir: dir, route53Endpoint: fake.endpoint, acmeDirectory: 'https://ca.invalid/directory', lookup: async () => found, ca: pair.cert });
    await until(() => joins.length > 0);
    expect(joins).toEqual([null]);
    expect(log.some((l) => l.startsWith("Check: this computer doesn't find play-mp2.test yet.") && l.endsWith('Until then players open http://127.0.0.1:8088/'))).toBe(true);
    expect(log.at(-1)).toBe('Check passed for the certificate: play-mp2.test answers at 127.0.0.1 with a trusted certificate');
    const quiet = log.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(log).toHaveLength(quiet);
    found = ['127.0.0.1'];
    await until(() => joins.length > 1);
    expect(joins).toEqual([null, host.url]);
    expect(log.slice(quiet)).toEqual([`Check passed: ${host.url} reaches this computer with a trusted certificate`]);
  });
});
