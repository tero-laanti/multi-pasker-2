/**
 * Certificates from an ACME authority (Let's Encrypt) by the DNS-01 challenge: the proof goes
 * into a TXT record, so nothing on the internet needs to reach this computer.
 */
import fs from 'node:fs';
import { Client, crypto as acmeCrypto } from 'acme-client';
import type { KeyPair } from './certs';
import { writePrivate } from './settings';

export const LETS_ENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory';
export const LETS_ENCRYPT_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';

/** Publishes challenge values; setTxt returns once every authoritative server has the record. */
export interface TxtRecords {
  setTxt(name: string, value: string, signal?: AbortSignal): Promise<void>;
  deleteTxt(name: string, value: string, signal?: AbortSignal): Promise<void>;
}

export interface AcmeOptions {
  directoryUrl: string;
  /** Created on first use. */
  accountKeyFile: string;
  dns: TxtRecords;
  log: (line: string) => void;
}

export class Acme {
  constructor(private o: AcmeOptions) {}

  /** A certificate for one name: its PEM chain and key. */
  async issue(domain: string, signal?: AbortSignal): Promise<KeyPair> {
    const client = new Client({ directoryUrl: this.o.directoryUrl, accountKey: await this.accountKey() });
    // The stored key's account, else a new one, which agrees to the authority's terms. (Registering
    // an existing key again would send it an empty update, which authorities may refuse.)
    await client.createAccount({ onlyReturnExisting: true }).catch(() => client.createAccount({ termsOfServiceAgreed: true }));
    const order = await client.createOrder({ identifiers: [{ type: 'dns', value: domain }] });
    for (const authz of await client.getAuthorizations(order)) {
      if (authz.status === 'valid') continue;
      const challenge = authz.challenges.find((c) => c.type === 'dns-01');
      if (!challenge) throw new Error(`The authority offered no DNS challenge for ${authz.identifier.value}`);
      // For dns-01 this is already the record's value, a digest of the key authorization.
      const value = await client.getChallengeKeyAuthorization(challenge);
      const name = `_acme-challenge.${authz.identifier.value}`;
      this.o.log('Publishing the certificate challenge in DNS; Route 53 takes up to a minute');
      await this.o.dns.setTxt(name, value, signal);
      try {
        await client.completeChallenge(challenge);
        await client.waitForValidStatus(challenge);
      } finally {
        await this.o.dns.deleteTxt(name, value).catch((err: Error) => this.o.log(`Could not remove the challenge record ${name}: ${err.message}`));
      }
    }
    const [key, csr] = await acmeCrypto.createCsr({ altNames: [domain] }, await acmeCrypto.createPrivateEcdsaKey());
    const cert = await client.getCertificate(await client.finalizeOrder(order, csr));
    return { cert, key: key.toString() };
  }

  private async accountKey(): Promise<Buffer> {
    try {
      return fs.readFileSync(this.o.accountKeyFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const key = await acmeCrypto.createPrivateEcdsaKey();
    writePrivate(this.o.accountKeyFile, key);
    return key;
  }
}
