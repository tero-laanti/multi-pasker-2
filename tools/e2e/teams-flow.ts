/**
 * Team mode from the host's seat: Match settings → Mode: Pairs with 4 bots (five of us, so the
 * host plays alone), then 3 bots (paired up), the pair line beside the timer, the scoreboard by
 * pairs, the round calls (Tulitauko! as a round ends, Tuli vapaa! as the next starts) and the
 * Right click / Q toggles aiming setting (and Q aiming like the right button).
 *
 *   npx tsx tools/e2e/teams-flow.ts <outDir> [--url=http://localhost:8088/]
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const voices: string[] = [];
page.on('request', (r) => {
  const m = /\/voice\/([a-z_]+)$/.exec(r.url());
  if (m) voices.push(m[1]!);
});
const result: Record<string, unknown> = {};
try {
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('pasker.trained', '1'));
  await page.evaluate(() => (window as any).__pasker.join('Isäntä'));
  await page.waitForFunction(() => (window as any).__pasker.match?.alive && (window as any).__pasker.match?.settings, null, { timeout: 20000 });
  const dev = (cmd: string, arg?: unknown) => page.evaluate(([c, a]) => (window as any).__pasker.match.send({ t: 'dev', cmd: c, arg: a }), [cmd, arg] as const);
  await dev('newEvening');
  await wait(500);
  // The host's screen: Esc → Match settings → Mode: Pairs, 4 bots.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.screen.pause:not(.hidden)', { timeout: 3000 });
  await page.click('.screen.pause button:has-text("Match settings")');
  await page.waitForSelector('.screen.settings:not(.hidden)');
  result.modes = await page.$$eval('.settings-form .row:has-text("Mode") option', (o) => o.map((x) => x.textContent));
  await page.selectOption('.settings-form .row:has-text("Bots") select', '4');
  await page.selectOption('.settings-form .row:has-text("Mode") select', 'true');
  await wait(800);
  await page.screenshot({ path: `${out}/1_settings.png` });
  const teams = () =>
    page.evaluate(() => {
      const m = (window as any).__pasker.match;
      const by = new Map<number, string[]>();
      for (const p of m.players.values()) by.set(p.team, [...(by.get(p.team) ?? []), p.name]);
      return [...by.values()].map((n) => n.join(' & ')).sort();
    });
  result.oddTeams = await teams();
  result.oddLine = await page.evaluate(() => document.querySelector('.team-line')?.textContent);
  await page.selectOption('.settings-form .row:has-text("Bots") select', '3');
  await wait(800);
  result.evenTeams = await teams();
  await page.click('.screen.settings .btn.primary');
  await page.evaluate(() => (window as any).__pasker.play());
  await wait(1500);
  result.line = await page.evaluate(() => document.querySelector('.team-line')?.textContent);
  result.mateTags = await page.evaluate(() => [...(window as any).__pasker.match.remotes.players.values()].filter((r: any) => r.mate).map((r: any) => r.info.name));
  await page.screenshot({ path: `${out}/2_round.png` });
  await page.keyboard.down('Tab');
  await wait(400);
  result.board = await page.evaluate(() => [...document.querySelectorAll('.scoreboard .sb-row')].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  await page.screenshot({ path: `${out}/3_board.png` });
  await page.keyboard.up('Tab');
  // The round ends: Tulitauko!; the next starts: Tuli vapaa!
  await dev('endRound');
  await wait(1200);
  result.voicesAtEnd = [...voices];
  await page.screenshot({ path: `${out}/4_break.png` });
  await page.waitForFunction(() => (window as any).__pasker.match.round?.state === 'playing' && (window as any).__pasker.match.round?.round === 2, null, { timeout: 20000 });
  await wait(800);
  result.voicesAtStart = [...voices];
  // Right click toggles aiming: one click aims and stays aimed, the next lets go.
  await page.evaluate(() => ((window as any).__pasker.game.deps.settings.adsToggle = true));
  const click = async () => {
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
  };
  const ads = () => page.evaluate(() => (window as any).__pasker.game.weapons.ads);
  await click();
  await wait(700);
  result.adsAfterClick = await ads();
  await wait(700);
  result.adsStill = await ads();
  await click();
  await wait(700);
  result.adsAfterSecond = await ads();
  // Q does the same: a press toggles, the next lets go.
  await page.keyboard.press('KeyQ');
  await wait(700);
  result.adsAfterQ = await ads();
  await page.keyboard.press('KeyQ');
  await wait(700);
  result.adsAfterSecondQ = await ads();
  await page.evaluate(() => ((window as any).__pasker.game.deps.settings.adsToggle = false));
  await click();
  await wait(700);
  result.adsHoldMode = await ads();
  // Held, Q aims for as long as it is down.
  await page.keyboard.down('KeyQ');
  await wait(700);
  result.adsQHeld = await ads();
  await page.keyboard.up('KeyQ');
  await wait(700);
  result.adsQReleased = await ads();
  // Leave the server in free-for-all for whatever runs next.
  await page.evaluate(() => (window as any).__pasker.match.send({ t: 'settings', s: { teams: false } }));
  await wait(300);
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await page.screenshot({ path: `${out}/failed.png` });
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
