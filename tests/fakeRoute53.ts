import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** One record change as Route 53 received it. */
export interface Change {
  zone: string;
  action: string;
  name: string;
  type: string;
  ttl: number;
  values: string[];
}

export interface FakeRoute53Options {
  /** GetChange calls that still answer PENDING before INSYNC. */
  pendingPolls?: number;
  /** Every call fails with this. */
  error?: { status: number; code: string };
  /** Runs before a change is answered (to hand TXT records to a test DNS server, say). */
  onChange?: (c: Change) => Promise<void> | void;
}

export interface FakeRoute53 {
  endpoint: string;
  changes: Change[];
  getChanges: number;
  close(): Promise<void>;
}

const NS = 'https://route53.amazonaws.com/doc/2013-04-01/';

function unescape(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function values(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => unescape(m[1]!));
}

function xml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/xml', 'x-amzn-requestid': 'fake' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`);
}

function changeInfo(id: string, pending: boolean): string {
  return `<ChangeInfo><Id>/change/${id}</Id><Status>${pending ? 'PENDING' : 'INSYNC'}</Status><SubmittedAt>2026-10-28T12:00:00.000Z</SubmittedAt></ChangeInfo>`;
}

/** A stand-in for Route 53's ChangeResourceRecordSets and GetChange, for the AWS SDK pointed at it. */
export async function fakeRoute53(o: FakeRoute53Options = {}): Promise<FakeRoute53> {
  const fake: FakeRoute53 = { endpoint: '', changes: [], getChanges: 0, close: async () => undefined };
  const left = new Map<string, number>();
  let next = 1;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (o.error) {
      xml(res, o.error.status, `<ErrorResponse xmlns="${NS}"><Error><Type>Sender</Type><Code>${o.error.code}</Code><Message>${o.error.code} (fake)</Message></Error><RequestId>fake</RequestId></ErrorResponse>`);
      return;
    }
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const rrset = /^\/2013-04-01\/hostedzone\/([^/]+)\/rrset\/?$/.exec(path);
    if (req.method === 'POST' && rrset) {
      const change: Change = {
        zone: rrset[1]!,
        action: values(body, 'Action')[0] ?? '',
        name: values(body, 'Name')[0] ?? '',
        type: values(body, 'Type')[0] ?? '',
        ttl: Number(values(body, 'TTL')[0]),
        values: values(body, 'Value'),
      };
      fake.changes.push(change);
      await o.onChange?.(change);
      const id = `C${next++}`;
      left.set(id, o.pendingPolls ?? 0);
      xml(res, 200, `<ChangeResourceRecordSetsResponse xmlns="${NS}">${changeInfo(id, (o.pendingPolls ?? 0) > 0)}</ChangeResourceRecordSetsResponse>`);
      return;
    }
    const get = /^\/2013-04-01\/change\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && get) {
      fake.getChanges++;
      const id = get[1]!;
      const n = (left.get(id) ?? 0) - 1;
      left.set(id, n);
      xml(res, 200, `<GetChangeResponse xmlns="${NS}">${changeInfo(id, n > 0)}</GetChangeResponse>`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
