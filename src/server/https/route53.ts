/**
 * The game's DNS records in a Route 53 zone: the A record that points the name at this computer,
 * and the TXT record that proves control of the name to Let's Encrypt.
 */
import { isIPv4 } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { ChangeResourceRecordSetsCommand, GetChangeCommand, Route53Client, type ChangeInfo } from '@aws-sdk/client-route-53';

/** Short, so players' machines follow this computer to a new address within a minute. */
export const TTL = 60;

/** A record name lowercased and without its trailing dot, the form IAM conditions compare. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

/** A hosted zone ID as the console or the API shows it. */
export function cleanZoneId(id: string): string {
  return id.trim().replace(/^\/hostedzone\//, '');
}

/**
 * The IAM policy the access key needs: changes to exactly the game's two records in one zone,
 * and reading whether a change has reached every Route 53 server (that one can't be limited to a zone).
 */
export function policy(zoneId: string, domain: string): string {
  const name = normalizeName(domain);
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ChangeOnlyTheGameRecords',
          Effect: 'Allow',
          Action: 'route53:ChangeResourceRecordSets',
          Resource: `arn:aws:route53:::hostedzone/${cleanZoneId(zoneId)}`,
          Condition: {
            'ForAllValues:StringEquals': {
              'route53:ChangeResourceRecordSetsNormalizedRecordNames': [name, `_acme-challenge.${name}`],
              'route53:ChangeResourceRecordSetsRecordTypes': ['A', 'TXT'],
              'route53:ChangeResourceRecordSetsActions': ['UPSERT', 'DELETE'],
            },
          },
        },
        { Sid: 'WaitForChangesToReachRoute53Servers', Effect: 'Allow', Action: 'route53:GetChange', Resource: 'arn:aws:route53:::change/*' },
      ],
    },
    null,
    2,
  );
}

export interface RecordsOptions {
  zoneId: string;
  /** Without a key the AWS SDK looks in the environment and ~/.aws. */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** A stand-in for Route 53 (tests). */
  endpoint?: string;
  /** How often a change's status is checked (ms). */
  pollMs?: number;
}

/** Changes records in one hosted zone. */
export class Records {
  private client: Route53Client;
  private zoneId: string;
  private pollMs: number;

  constructor(o: RecordsOptions) {
    this.zoneId = cleanZoneId(o.zoneId);
    this.pollMs = o.pollMs ?? 5000;
    // Route 53 is a global service, signed in us-east-1.
    this.client = new Route53Client({
      region: 'us-east-1',
      maxAttempts: 3,
      ...(o.accessKeyId ? { credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey ?? '' } } : {}),
      ...(o.endpoint ? { endpoint: o.endpoint } : {}),
    });
  }

  /** Points name at an IPv4 address and waits until every Route 53 server answers with it. */
  async setA(name: string, address: string, signal?: AbortSignal): Promise<void> {
    if (!isIPv4(address)) throw new Error(`${address} is not an IPv4 address`);
    await this.change('UPSERT', name, 'A', address, true, signal);
  }

  /** Sets name's only TXT value and waits until every Route 53 server answers with it. */
  async setTxt(name: string, value: string, signal?: AbortSignal): Promise<void> {
    await this.change('UPSERT', name, 'TXT', `"${value}"`, true, signal);
  }

  /** Removes the TXT record setTxt made. */
  async deleteTxt(name: string, value: string, signal?: AbortSignal): Promise<void> {
    await this.change('DELETE', name, 'TXT', `"${value}"`, false, signal);
  }

  private async change(action: 'UPSERT' | 'DELETE', name: string, type: 'A' | 'TXT', value: string, wait: boolean, signal?: AbortSignal): Promise<void> {
    let info: ChangeInfo | undefined;
    try {
      const out = await this.client.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: this.zoneId,
          ChangeBatch: {
            Comment: 'MULTI-PASKER 2 server',
            Changes: [{ Action: action, ResourceRecordSet: { Name: normalizeName(name), Type: type, TTL, ResourceRecords: [{ Value: value }] } }],
          },
        }),
        { abortSignal: signal },
      );
      info = out.ChangeInfo;
    } catch (err) {
      throw explain(err, `${action === 'UPSERT' ? 'Setting' : 'Removing'} the ${type} record ${name}`);
    }
    while (wait && info?.Status !== 'INSYNC') {
      await sleep(this.pollMs, undefined, { signal });
      try {
        info = (await this.client.send(new GetChangeCommand({ Id: info?.Id }), { abortSignal: signal })).ChangeInfo;
      } catch (err) {
        throw explain(err, `Checking Route 53 change ${info?.Id}`);
      }
    }
  }
}

/** Adds the likely fix to the errors a wrong setup or key gives. */
export function explain(err: unknown, what: string): Error {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  let hint = '';
  if (e?.name === 'CredentialsProviderError') hint = ' (no AWS key: run `npm run https:setup`)';
  else if (e?.name === 'AbortError') hint = ' (gave up waiting)';
  else if (!e?.$metadata?.httpStatusCode) hint = ' (is this computer online?)';
  else if (e.name === 'AccessDenied' || e.name === 'AccessDeniedException')
    hint = " (the key may not change this record: check the hosted zone ID with `npm run https:setup` and the key's IAM policy with `npm run https:policy`)";
  else if (e.name === 'NoSuchHostedZone') hint = ' (the hosted zone ID is wrong: run `npm run https:setup`)';
  else if (e.name === 'InvalidClientTokenId' || e.name === 'SignatureDoesNotMatch' || e.name === 'UnrecognizedClientException')
    hint = ' (the access key ID or secret is wrong: run `npm run https:setup`)';
  return new Error(`${what}: ${e?.message ?? String(err)}${hint}`, { cause: err });
}
