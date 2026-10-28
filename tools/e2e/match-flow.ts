/**
 * A match from the host's seat: the pause menu's Match settings (2 rounds, 5 bots), the round
 * counter, the break after round 1 with the leader, the match's results after round 2, and the
 * next match starting everyone again at TJ 347.
 *
 *   npx tsx tools/e2e/match-flow.ts <outDir> [--url=http://localhost:8088/]
 *
 * The URL can be the HTTPS test server (--local-https); its self-signed certificate is accepted.
 *
 * Needs a server where this browser is the host (`npm run dev`, or running on this machine).
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args[0]!;
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
fs.mkdirSync(out, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const result: Record<string, unknown> = {};
try {
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('pasker.trained', '1'));
  await page.evaluate(() => (window as any).__pasker.join('Aapo'));
  await page.waitForFunction(() => (window as any).__pasker.match?.alive && (window as any).__pasker.match?.settings, null, { timeout: 20000 });
  const dev = (cmd: string, arg?: unknown) => page.evaluate(([c, a]) => (window as any).__pasker.match.send({ t: 'dev', cmd: c, arg: a }), [cmd, arg] as const);
  await dev('newEvening');
  await wait(500);
  // The host's screen: Esc → Match settings.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.screen.pause:not(.hidden)', { timeout: 3000 });
  result.hostButton = await page.isVisible('.screen.pause button:has-text("Match settings")');
  await page.click('.screen.pause button:has-text("Match settings")');
  await page.waitForSelector('.screen.settings:not(.hidden)');
  await page.selectOption('.settings-form .row:has-text("Rounds per match") select', '2');
  await page.selectOption('.settings-form .row:has-text("Bots") select', '5');
  await wait(800);
  await page.screenshot({ path: `${out}/1_settings.png` });
  result.settings = await page.evaluate(() => (window as any).__pasker.match.settings);
  result.bots = await page.evaluate(() => [...(window as any).__pasker.match.players.values()].filter((p: any) => p.bot).length);
  await page.click('.screen.settings .btn.primary');
  await page.evaluate(() => (window as any).__pasker.play());
  await wait(1500);
  result.timer = await page.evaluate(() => document.querySelector('.round-timer')?.textContent);
  await page.screenshot({ path: `${out}/2_round.png` });
  // Round 1 ends: the break.
  await dev('endRound');
  await wait(1200);
  result.between = await page.evaluate(() => document.querySelector('.scoreboard')?.textContent?.slice(0, 120));
  await page.screenshot({ path: `${out}/3_between.png` });
  await page.waitForFunction(() => (window as any).__pasker.match.round?.state === 'playing' && (window as any).__pasker.match.round?.round === 2, null, { timeout: 20000 });
  await wait(4000);
  // The last round ends: the match's results.
  await dev('endRound');
  await wait(1500);
  result.results = await page.evaluate(() => document.querySelector('.scoreboard')?.textContent?.slice(0, 200));
  await page.screenshot({ path: `${out}/4_results.png` });
  await page.waitForFunction(() => (window as any).__pasker.match.round?.match === 2, null, { timeout: 30000 });
  await wait(1000);
  result.newMatch = await page.evaluate(() => ({ round: (window as any).__pasker.match.round, line: document.querySelector('.ladder-line')?.textContent }));
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await page.screenshot({ path: `${out}/failed.png` });
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
