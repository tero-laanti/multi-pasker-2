/**
 * Desktop + phone end to end: a desktop joins a match, an emulated phone pairs with it through
 * the QR link, types to the varusmestari on the in-page keyboard, and the desktop is checked.
 *
 *   npx tsx tools/e2e/phone-flow.ts <outDir> [--url=http://localhost:8088/] [--phone=390x844] [--webkit]
 *
 * --webkit runs the phone in Playwright's WebKit (Safari's engine) instead of Chrome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, type Page } from 'playwright';

const args = process.argv.slice(2);
const outDir = args[0]!;
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
const [pw, ph] = (args.find((a) => a.startsWith('--phone='))?.slice(8) ?? '390x844').split('x').map(Number);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const phoneBrowser = args.includes('--webkit') ? await webkit.launch({ headless: true }) : browser;
const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const phoneCtx = await phoneBrowser.newContext({
  viewport: { width: pw!, height: ph! },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const phone = await phoneCtx.newPage();
const logs: string[] = [];
for (const [name, page] of [['desktop', desktop], ['phone', phone]] as const) {
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[${name} error] ${m.text()}`));
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const result: Record<string, unknown> = {};

await desktop.goto(base);
await desktop.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
await desktop.evaluate(() => (window as any).__pasker.join('Tero'));
await desktop.waitForFunction(() => (window as any).__pasker.match?.pairInfo, null, { timeout: 10000 });
await desktop.evaluate(() => (window as any).__pasker.play());
const token = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.token as string);
await wait(300);

await phone.goto(`${base}phone#${token}`);
await phone.waitForSelector('.v-confirm', { timeout: 10000 });
await shot(phone, 'phone_1_confirm');
await phone.tap('.v-confirm .btn.primary');
await phone.waitForSelector('.v-sound');
await shot(phone, 'phone_2_sound');
await phone.tap('.v-sound .btn.primary');
await phone.waitForSelector('.v-list .conv');
await shot(phone, 'phone_3_list');
result.paired = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.phone);

/** Types on the phone's own keyboard, key by key. */
async function type(text: string): Promise<void> {
  for (const ch of text) {
    const k = ch === ' ' ? 'SPACE' : ch.toLowerCase();
    const upper = ch !== ch.toLowerCase();
    const shiftOn = await phone.evaluate(() => document.querySelector('.kb')?.classList.contains('upper') ?? false);
    if (upper !== shiftOn && ch.toLowerCase() !== ch.toUpperCase()) await phone.tap('.kb-key[data-k="SHIFT"]');
    await phone.tap(`.kb-key[data-k="${k}"]`);
  }
}

async function chat(text: string, name: string): Promise<void> {
  await phone.tap('.v-list .conv');
  await phone.waitForSelector('.v-chat');
  await wait(250);
  result[`${name}_phoneOutInChat`] = await desktop.evaluate(() => (window as any).__pasker.match.phoneOut);
  await type(text);
  await shot(phone, `phone_${name}_typed`);
  await phone.tap('.send');
  await wait(150);
  await shot(phone, `phone_${name}_sending`);
  await phone.waitForSelector('.v-list', { timeout: 4000 });
  await wait(400);
  result[`${name}_phoneOutAfter`] = await desktop.evaluate(() => (window as any).__pasker.match.phoneOut);
}

// A reload with a part-empty magazine: shoot a few times first.
for (let i = 0; i < 3; i++) {
  await desktop.evaluate(() => ((window as any).__pasker.input.leftPressed = true));
  await wait(220);
}
result.ammoBefore = await desktop.evaluate(() => (window as any).__pasker.game.weapons.ammo.pistol);
await chat('Lataa', 'reload');
result.reloadState = await desktop.evaluate(() => (window as any).__pasker.game.weapons.state);
await wait(1800);
result.ammoAfter = await desktop.evaluate(() => (window as any).__pasker.game.weapons.ammo.pistol);

// A typo: it goes to everyone's typo feed with the reply.
await chat('kranaati', 'typo');
await wait(1600);
result.typoFeed = await desktop.evaluate(() => document.querySelector('.typofeed')?.textContent ?? '');
await shot(desktop, 'desktop_typo');

// Open the chat again to read the replies.
await phone.tap('.v-list .conv');
await phone.waitForSelector('.v-chat');
await wait(2600);
await shot(phone, 'phone_4_replies');
result.replies = await phone.evaluate(() => [...document.querySelectorAll('.bubble.them')].map((b) => b.textContent));
await phone.tap('.back');

// New chat to a number that doesn't exist.
await phone.tap('.fab');
await wait(200);
await shot(phone, 'phone_5_newchat');
for (const d of '0401234567') await phone.tap(`.kb-key[data-k="${d}"]`);
await shot(phone, 'phone_6_number');
await phone.tap('.sheet .link.strong');
await phone.waitForSelector('.v-chat');
await type('Moi');
await phone.tap('.send');
await phone.waitForSelector('.v-list', { timeout: 4000 });
await phone.tap('.conv >> text=0401234567');
await wait(900);
await shot(phone, 'phone_7_unknown');

// Reload the phone: it resumes with its token and keeps the conversations.
await phone.reload();
await phone.waitForSelector('.v-confirm, .v-list, .v-chat', { timeout: 10000 });
result.afterReload = await phone.evaluate(() => (window as any).__phone && document.querySelector('.screen')?.className);
result.convsAfterReload = await phone.evaluate(() => (window as any).__phone['convs'].size);

console.log(JSON.stringify(result, null, 2));
if (logs.length) console.log('--- errors ---\n' + logs.join('\n'));
if (phoneBrowser !== browser) await phoneBrowser.close();
await browser.close();
