import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The name players open, unless the setup stores another. */
export const DEFAULT_DOMAIN = 'play-mp2.laanti.fi';

/** config.json in the state folder, written by `npm run https:setup`. */
export interface HttpsSettings {
  domain: string;
  hostedZoneId: string;
  /** The Route 53 access key. Empty means the AWS SDK's own sources: environment variables or ~/.aws/credentials. */
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

/**
 * The state folder: the settings with the Route 53 secret, the Let's Encrypt account key and the
 * certificates. It is outside the repository and readable only by this user:
 * ~/Library/Application Support/MultiPasker2 on a Mac, %AppData%\MultiPasker2 on Windows,
 * ~/.config/multi-pasker-2 elsewhere. PASKER_STATE points it somewhere else.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  if (env.PASKER_STATE) return env.PASKER_STATE;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'MultiPasker2');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'MultiPasker2');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'multi-pasker-2');
}

/** The stored settings, or null before the setup. */
export function loadSettings(dir: string): HttpsSettings | null {
  const file = path.join(dir, 'config.json');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let s: Partial<HttpsSettings>;
  try {
    s = JSON.parse(text) as Partial<HttpsSettings>;
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  }
  return {
    domain: s.domain || DEFAULT_DOMAIN,
    hostedZoneId: s.hostedZoneId ?? '',
    ...(s.awsAccessKeyId ? { awsAccessKeyId: s.awsAccessKeyId, awsSecretAccessKey: s.awsSecretAccessKey ?? '' } : {}),
  };
}

/** Writes config.json and returns its path. */
export function saveSettings(dir: string, s: HttpsSettings): string {
  const file = path.join(dir, 'config.json');
  writePrivate(file, `${JSON.stringify(s, null, 2)}\n`);
  return file;
}

/** Replaces a file in one step, readable only by its owner (and so is a folder it creates). */
export function writePrivate(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
