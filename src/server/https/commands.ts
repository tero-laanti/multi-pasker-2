/**
 * The HTTPS name's commands (docs/HOSTING.md):
 *
 *   npm run https:setup    store the name, the Route 53 zone and the access key
 *   npm run https:policy   print the IAM policy the key needs
 */
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { cleanZoneId, policy } from './route53';
import { DEFAULT_DOMAIN, loadSettings, saveSettings, stateDir, type HttpsSettings } from './settings';

/** laanti.fi for play-mp2.laanti.fi: the zone the name's records live in. */
function parentZone(domain: string): string {
  const parts = domain.split('.');
  return parts.length > 2 ? parts.slice(1).join('.') : domain;
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function setup(): Promise<void> {
  const dir = stateDir();
  const stored = loadSettings(dir);
  // Typing goes through this, so the secret can go unechoed.
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  // Lines are queued, so piped answers that arrive at once all count.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, current: string, secret = false): Promise<string> => {
    const shown = secret && current ? 'keep the stored one' : current;
    const prompt = `${question}${shown ? ` [${shown}]` : ''}: `;
    if (secret) {
      process.stdout.write(prompt);
      rl.setPrompt('');
      muted = true;
    } else {
      rl.setPrompt(prompt);
      rl.prompt();
    }
    try {
      const line = await lines.next();
      if (line.done) throw new Error('Setup cancelled; nothing was saved.');
      return line.value.trim() || current;
    } finally {
      if (secret) {
        muted = false;
        if (process.stdin.isTTY) process.stdout.write('\n');
      }
    }
  };
  try {
    console.log(`The HTTPS name: players open https://<name>, which points at this computer (see docs/HOSTING.md).`);
    const domain = (await ask('Name players open', stored?.domain ?? DEFAULT_DOMAIN)).toLowerCase();
    const hostedZoneId = cleanZoneId(await ask(`Route 53 hosted zone ID of ${parentZone(domain)} (Z…)`, stored?.hostedZoneId ?? ''));
    const awsAccessKeyId = await ask('AWS access key ID', stored?.awsAccessKeyId ?? '');
    const awsSecretAccessKey = await ask('AWS secret access key (typing is hidden)', stored?.awsSecretAccessKey ?? '', true);
    if (!hostedZoneId) throw new Error('The hosted zone ID is needed.');
    if (!awsAccessKeyId !== !awsSecretAccessKey) throw new Error("Give both the access key ID and its secret, or neither to use the AWS SDK's own credentials.");
    const settings: HttpsSettings = { domain, hostedZoneId, ...(awsAccessKeyId ? { awsAccessKeyId, awsSecretAccessKey } : {}) };
    console.log(`Saved ${saveSettings(dir, settings)}`);
    console.log(
      awsAccessKeyId
        ? 'The key needs the policy `npm run https:policy` prints. `npm start` now serves the name too.'
        : "Without a key the AWS SDK's own credentials are used (environment or ~/.aws); they need the policy `npm run https:policy` prints.",
    );
  } finally {
    rl.close();
  }
}

function printPolicy(args: string[]): void {
  const stored = loadSettings(stateDir());
  const zone = option(args, '--zone') ?? stored?.hostedZoneId ?? 'YOUR_ZONE_ID';
  const domain = option(args, '--domain') ?? stored?.domain ?? DEFAULT_DOMAIN;
  console.log(policy(zone || 'YOUR_ZONE_ID', domain));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'setup') {
  setup().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
} else if (command === 'policy') {
  printPolicy(rest);
} else {
  console.error('Commands: setup, policy');
  process.exit(1);
}
