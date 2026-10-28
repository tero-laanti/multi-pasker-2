/**
 * The HTTPS certificate: the stored one is used while it is valid, and a new one is fetched once
 * the current one is in the last third of its life, while the current one keeps serving.
 */
import { X509Certificate, createPrivateKey, randomBytes, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import * as x509 from '@peculiar/x509';
import { writePrivate } from './settings';

/** A PEM certificate chain (the server's own certificate first) and its private key. */
export interface KeyPair {
  cert: string;
  key: string;
}

export interface Issuer {
  issue(domain: string): Promise<KeyPair>;
}

export interface CertOptions {
  domain: string;
  certFile: string;
  keyFile: string;
  issuer: Issuer;
  log: (line: string) => void;
  /** A certificate came into use. */
  onChange?: (pair: KeyPair) => void;
  now?: () => number;
}

interface InUse extends KeyPair {
  notBefore: Date;
  notAfter: Date;
}

/** A date for the log, in local time. */
export function when(d: Date): string {
  return d.toLocaleString('sv-SE').slice(0, 16);
}

/** Holds the certificate for one name. */
export class CertManager {
  private inUse: InUse | null = null;

  constructor(private o: CertOptions) {}

  get current(): InUse | null {
    return this.inUse;
  }

  /** Puts the stored certificate in use, if there is one; true when a valid certificate is now in use. */
  load(): boolean {
    if (!this.inUse) {
      try {
        this.use({ cert: fs.readFileSync(this.o.certFile, 'utf8'), key: fs.readFileSync(this.o.keyFile, 'utf8') });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.o.log(`Ignoring the stored certificate: ${(err as Error).message}`);
      }
    }
    return this.valid();
  }

  /**
   * Makes sure a valid certificate is in use: fetches one when there is none or the current one is
   * in the last third of its life. When fetching fails, a current one that is still valid stays.
   */
  async ensure(): Promise<void> {
    this.load();
    if (!this.due()) return;
    try {
      const pair = await this.o.issuer.issue(this.o.domain);
      this.use(pair);
      writePrivate(this.o.keyFile, pair.key);
      writePrivate(this.o.certFile, pair.cert);
      this.o.log(`New certificate for ${this.o.domain}, valid until ${when(this.inUse!.notAfter)}`);
    } catch (err) {
      const why = (err as Error).message;
      if (this.valid()) {
        this.o.log(`Could not renew the certificate, keeping the current one until ${when(this.inUse!.notAfter)}: ${why}`);
        return;
      }
      throw new Error(`No valid certificate for ${this.o.domain}: ${why}`, { cause: err });
    }
  }

  /** Checks every interval whether the certificate is due; returns a function that stops it. */
  maintain(intervalMs: number): () => void {
    const t = setInterval(() => {
      this.ensure().catch((err: Error) => this.o.log(err.message));
    }, intervalMs);
    t.unref();
    return () => clearInterval(t);
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private valid(): boolean {
    return this.inUse !== null && this.now() < this.inUse.notAfter.getTime();
  }

  private due(): boolean {
    const c = this.inUse;
    if (!c) return true;
    const life = c.notAfter.getTime() - c.notBefore.getTime();
    return this.now() > c.notAfter.getTime() - life / 3;
  }

  private use(pair: KeyPair): void {
    const leaf = new X509Certificate(pair.cert);
    if (!leaf.checkHost(this.o.domain)) throw new Error(`the certificate is for ${leaf.subjectAltName ?? leaf.subject}, not ${this.o.domain}`);
    if (!leaf.checkPrivateKey(createPrivateKey(pair.key))) throw new Error('the certificate and its key do not match');
    this.inUse = { ...pair, notBefore: leaf.validFromDate, notAfter: leaf.validToDate };
    this.o.onChange?.(pair);
  }
}

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

/** A certificate for testing on this computer, which browsers warn about; valid for a day by default. */
export async function selfSigned(hosts: string[], notBefore = new Date(Date.now() - 3_600_000), notAfter = new Date(Date.now() + 86_400_000)): Promise<KeyPair> {
  const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = (await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as unknown as CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(8).toString('hex'),
    name: 'CN=MULTI-PASKER 2 local test',
    notBefore,
    notAfter,
    signingAlgorithm: alg,
    keys,
    extensions: [
      new x509.SubjectAlternativeNameExtension(hosts.map((h) => ({ type: isIP(h) ? ('ip' as const) : ('dns' as const), value: h }))),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature),
    ],
  });
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey as unknown as webcrypto.CryptoKey);
  return { cert: cert.toString('pem'), key: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY') };
}
