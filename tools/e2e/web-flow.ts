/**
 * The web version (mp2.laanti.fi), end to end against the static build (`npm run build:web`,
 * then `npm run preview:web`): the LAN notice on the main menu, sounds from the build, no server
 * connection before the bot match; then a first-timer's training with the virtual phone (YK),
 * the bot match with its bots, and LATAA typed on the virtual phone.
 *
 *   npx tsx tools/e2e/web-flow.ts <outDir> [--url=http://localhost:8100/]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const outDir = args[0]!;
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8100/';
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
const failedRequests: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('response', (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url()}`));
page.on('websocket', (ws) => failedRequests.push(`websocket ${ws.url()}`));
const shot = (name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const result: Record<string, unknown> = {};

try {
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  await wait(600);
  await shot('web_1_menu');
  result.menu = await page.evaluate(() => ({
    notice: document.querySelector('.web-notice-title')?.textContent,
    buttons: [...document.querySelectorAll('.screen.main .buttons .btn')].map((b) => b.textContent),
    sounds: (window as any).__pasker.audio['buffers'].size,
    connected: (window as any).__pasker.net.stats.connected,
  }));

  // A first-timer: the training on the range, paired with the virtual phone.
  await page.evaluate(() => localStorage.removeItem('pasker.trained'));
  await page.evaluate(() => (window as any).__pasker.join('Tero'));
  await page.waitForFunction(() => (window as any).__pasker.app.mode === 'training', null, { timeout: 15000 });
  await page.evaluate(() => (window as any).__pasker.play());
  await page.evaluate(() => (window as any).__pasker.app.tutorial.set('phone'));
  await page.evaluate(() => (window as any).__pasker.game.teleport(5.5, 0.14, 5.65, Math.PI));
  await page.evaluate(() => {
    const g = (window as any).__pasker.game;
    const dx = 5.5 - g.eye.x;
    const dy = 0.95 - g.eye.y;
    const dz = 6.55 - g.eye.z;
    g.yaw = Math.atan2(-dx, -dz);
    g.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  });
  await wait(300);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.tutorial-modal:not(.hidden)', { timeout: 3000 });
  await shot('web_2_pairing');
  result.pairing = await page.evaluate(() => ({
    lead: document.querySelector('.tutorial-modal .tutorial-lead')?.textContent,
    qrShown: getComputedStyle(document.querySelector('.tutorial-modal .pair-qr')!).display !== 'none',
    step: document.querySelector('.tutorial-title')?.textContent,
  }));
  await page.click('.tutorial-modal .pair-virtual .btn');
  const frame = page.frameLocator('.vphone-frame');
  await frame.locator('.v-list .conv').first().waitFor({ timeout: 10000 });
  await frame.locator('.v-list .conv').first().click();
  await frame.locator('.v-chat').waitFor();
  await wait(3500);
  await frame.locator('.kb-key[data-k="y"]').click();
  await frame.locator('.kb-key[data-k="k"]').click();
  await frame.locator('.send').click();
  await page.waitForFunction(() => (window as any).__pasker.app.tutorial?.stage === 'done', null, { timeout: 10000 });
  result.training = await page.evaluate(() => ({ stage: (window as any).__pasker.app.tutorial.stage, virtual: (window as any).__pasker.match.pairInfo.virtual }));
  await page.click('.vphone .vphone-bar .btn');

  // Into the bot match.
  await page.evaluate(() => (window as any).__pasker.app.deploy());
  await page.waitForFunction(() => (window as any).__pasker.match?.alive, null, { timeout: 8000 });
  await page.evaluate(() => (window as any).__pasker.play());
  await wait(1500);
  result.match = await page.evaluate(() => ({ mode: (window as any).__pasker.app.mode, players: [...(window as any).__pasker.match.players.values()].map((p: any) => p.name) }));
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => ((window as any).__pasker.input.leftPressed = true));
    await wait(220);
  }
  result.ammoBefore = await page.evaluate(() => (window as any).__pasker.game.weapons.ammo.pistol);
  await shot('web_3_match');

  // LATAA on the virtual phone, from the Esc menu.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.screen.pause:not(.hidden)', { timeout: 3000 });
  await shot('web_4_pause');
  await page.click('.screen.pause .pair-virtual .btn');
  await frame.locator('.v-chat, .v-list').first().waitFor();
  if (await frame.locator('.v-list').count()) await frame.locator('.v-list .conv').first().click();
  await frame.locator('.v-chat').waitFor();
  for (const k of 'lataa') await frame.locator(`.kb-key[data-k="${k}"]`).click();
  await frame.locator('.send').click();
  await wait(2500);
  result.ammoAfter = await page.evaluate(() => {
    const w = (window as any).__pasker.game.weapons;
    return { mag: w.ammo.pistol, spare: w.reserve.pistol };
  });
  await page.click('.vphone .vphone-bar .btn');
  await page.evaluate(() => (window as any).__pasker.play());
  // The bots fight on; give them a moment.
  await wait(8000);
  result.scores = await page.evaluate(() => [...(window as any).__pasker.match.players.values()].map((p: any) => `${p.name} ${p.kills}/${p.deaths}`));
  await shot('web_5_later');
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await shot('web_failed').catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (failedRequests.length) console.log('--- failed requests ---\n' + failedRequests.join('\n'));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
