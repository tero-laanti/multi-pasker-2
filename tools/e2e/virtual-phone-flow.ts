/**
 * The virtual phone: a desktop without a phone opens it from the Esc menu, the character has
 * the phone out while it shows, the keyboard does nothing, and LATAA is typed by clicking.
 *
 *   npx tsx tools/e2e/virtual-phone-flow.ts <outDir> [--url=http://localhost:8088/]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const outDir = args[0]!;
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const result: Record<string, unknown> = {};

try {
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('pasker.trained', '1'));
  await page.evaluate(() => (window as any).__pasker.join('Tero'));
  await page.waitForFunction(() => (window as any).__pasker.match?.alive && (window as any).__pasker.match?.pairInfo, null, { timeout: 10000 });
  await page.evaluate(() => (window as any).__pasker.play());
  await wait(500);
  // Esc → the pause menu → Open a virtual phone.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.screen.pause:not(.hidden)', { timeout: 3000 });
  await page.click('.screen.pause .pair-virtual .btn');
  await page.waitForSelector('.vphone:not(.hidden) iframe', { timeout: 3000 });
  const frame = page.frameLocator('.vphone-frame');
  await frame.locator('.v-list .conv').first().waitFor({ timeout: 10000 });
  await wait(1200);
  result.pairInfo = await page.evaluate(() => (window as any).__pasker.match.pairInfo);
  result.phoneOutWhileShown = await page.evaluate(() => (window as any).__pasker.match.phoneOut);
  result.pauseHidden = await page.evaluate(() => document.querySelector('.screen.pause')?.classList.contains('hidden'));
  await shot('vphone_1_open');
  // Into the armoury chat: the keyboard does nothing, clicking the keys types.
  await frame.locator('.v-list .conv').first().click();
  await frame.locator('.v-chat').waitFor();
  await page.keyboard.type('lataa');
  await wait(200);
  result.typedWithKeyboard = await frame.locator('.field').textContent();
  // A few real shots first (the server keeps the count), so there is something to refill.
  await page.evaluate(() => (window as any).__pasker.app.closeVirtualPhone());
  await page.evaluate(() => (window as any).__pasker.play());
  for (let i = 0; i < 4; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await wait(220);
  }
  result.ammoBefore = await page.evaluate(() => (window as any).__pasker.game.weapons.ammo.pistol);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.screen.pause:not(.hidden)', { timeout: 3000 });
  await page.click('.screen.pause .pair-virtual .btn');
  await frame.locator('.v-chat, .v-list').first().waitFor();
  if (await frame.locator('.v-list').count()) await frame.locator('.v-list .conv').first().click();
  await frame.locator('.v-chat').waitFor();
  await wait(1200);
  result.phoneOutAfterReopen = await page.evaluate(() => (window as any).__pasker.match.phoneOut);
  for (const k of 'lataa') await frame.locator(`.kb-key[data-k="${k}"]`).click();
  result.typedWithMouse = await frame.locator('.field').textContent();
  await shot('vphone_2_typed');
  await frame.locator('.send').click();
  await wait(2500);
  result.ammoAfter = await page.evaluate(() => {
    const w = (window as any).__pasker.game.weapons;
    return { mag: w.ammo.pistol, spare: w.reserve.pistol };
  });
  await frame.locator('.v-list .conv').first().click();
  await wait(400);
  result.reply = await frame.locator('.bubble.them:not(.typing)').last().textContent().catch(() => null);
  await shot('vphone_3_reply');
  // Put it away: back in the game, the phone goes down.
  await page.click('.vphone .vphone-bar .btn');
  await wait(800);
  result.afterClose = await page.evaluate(() => ({ shown: !document.querySelector('.vphone')?.classList.contains('hidden'), phoneOut: (window as any).__pasker.match.phoneOut, locked: !!document.pointerLockElement }));
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await shot('vphone_failed').catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
