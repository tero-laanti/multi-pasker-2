/**
 * Scripted screenshots of the running game in real Chrome (Playwright).
 *
 *   npx tsx tools/e2e/shot.ts <outDir> <scenario.js> [--headed] [--url=http://localhost:8088/]
 *
 * The scenario file is evaluated in the page as the body of an async function with
 * `p` (window.__pasker) and `shot(name)` available; each shot(name) saves <outDir>/<name>.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const outDir = args[0]!;
const scenario = fs.readFileSync(args[1]!, 'utf8');
const headed = args.includes('--headed');
const url = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
const size = (args.find((a) => a.startsWith('--size='))?.slice(7) ?? '1920x1080').split('x').map(Number);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !headed,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: size[0]!, height: size[1]! }, deviceScaleFactor: 1 });
const logs: string[] = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.exposeFunction('__shot', async (name: string) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
});
await page.goto(url);
await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
const result = await page.evaluate(`(async () => { const p = window.__pasker; const shot = (n) => window.__shot(n); ${scenario} })()`);
console.log(JSON.stringify(result, null, 2));
const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]') || l.startsWith('[warn]'));
if (errs.length) console.log('--- console ---\n' + errs.join('\n'));
await browser.close();
