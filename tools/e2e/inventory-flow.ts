/**
 * The armourer's inventory check on a desktop and an emulated phone: the question arrives,
 * the desktop and the phone count down, a wrong answer, then the right one earns a grenade.
 *
 *   npx tsx tools/e2e/inventory-flow.ts <outDir> [--url=http://localhost:8088/]
 *
 * Needs a server where dev commands work (`npm run dev`, or running on this machine).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const args = process.argv.slice(2);
const outDir = args[0]!;
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
fs.mkdirSync(outDir, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage();
const errors: string[] = [];
for (const [n, pg] of [['desktop', desktop], ['phone', phone]] as const) pg.on('pageerror', (e) => errors.push(`[${n}] ${e.message}`));
const shot = (pg: Page, name: string) => pg.screenshot({ path: path.join(outDir, `${name}.png`) });
const result: Record<string, unknown> = {};

await desktop.goto(base);
await desktop.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
await desktop.evaluate(() => localStorage.setItem('pasker.trained', '1'));
await desktop.evaluate(() => (window as any).__pasker.join('Tero'));
await desktop.waitForFunction(() => (window as any).__pasker.match?.pairInfo, null, { timeout: 10000 });
await desktop.evaluate(() => (window as any).__pasker.play());
const token = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.token as string);
await phone.goto(`${base}phone#${token}`);
await phone.tap('.v-confirm .btn.primary');
await phone.tap('.v-sound .btn.primary');
await phone.waitForSelector('.v-list .conv');
await wait(600);

const dev = (cmd: string) => desktop.evaluate((c) => (window as any).__pasker.match.send({ t: 'dev', cmd: c }), cmd);
await dev('inventory');
await desktop.waitForSelector('.inventory-alert:not(.hidden)', { timeout: 8000 });
await wait(400);
result.desktopAlert = await desktop.evaluate(() => document.querySelector('.inventory-alert')?.textContent);
await shot(desktop, 'inv_1_desktop');
await phone.waitForSelector('.banner.urgent:not(.hidden)', { timeout: 5000 });
result.phoneBanner = await phone.evaluate(() => document.querySelector('.banner')?.textContent);
// The check comes from the vääpeli, in a chat of his own.
await phone.tap('.conv >> text=Vääpeli');
await phone.waitForSelector('.v-chat');
await wait(300);
const question = await phone.evaluate(() => [...document.querySelectorAll('.bubble.them:not(.typing)')].map((b) => b.textContent).pop() ?? '');
result.question = question;
await shot(phone, 'inv_2_phone');

/** The right answer, read off the desktop as a player would. */
const answer = await desktop.evaluate((q) => {
  const p = (window as any).__pasker;
  const w = p.game.weapons;
  const me = p.match.players.get(p.match.myId);
  if (/lippaassasi on nyt|Lippaan patruunat/.test(q)) return w.ammo[w.current];
  if (/varalippaa|Varalipas/.test(q)) return w.reserve[w.current];
  if (/kranaattia|Kranaatit/.test(q)) return w.grenades;
  if (/kaatoa|Kaadot/.test(q)) return me.kills;
  if (/kaadettu|kaatunut/.test(q)) return me.deaths;
  return [...p.match.players.values()].filter((x: any) => x.connected || x.bot).filter((x: any) => !x.training).length;
}, question);
result.answer = answer;

async function send(text: string): Promise<void> {
  if (!(await phone.$('.v-chat'))) {
    await phone.tap('.conv >> text=Vääpeli');
    await phone.waitForSelector('.v-chat');
  }
  await phone.tap('.kb-key[data-k="SYM"]');
  for (const d of text) await phone.tap(`.kb-key[data-k="${d}"]`);
  await phone.tap('.send');
  await phone.waitForSelector('.v-list', { timeout: 5000 });
}

await send(String(answer + 7));
await wait(3000);
result.afterWrong = await desktop.evaluate(() => ({ alert: document.querySelector('.inventory-alert')?.classList.contains('hidden') ? 'hidden' : 'shown', typo: document.querySelector('.typofeed')?.textContent }));
const grenadesBefore = await desktop.evaluate(() => (window as any).__pasker.game.weapons.grenades);
await send(String(answer));
await wait(3500);
result.afterRight = await desktop.evaluate(() => ({ alert: document.querySelector('.inventory-alert')?.classList.contains('hidden') ? 'hidden' : 'shown', grenades: (window as any).__pasker.game.weapons.grenades }));
result.grenadesBefore = grenadesBefore;
await phone.tap('.conv >> text=Vääpeli');
await wait(500);
result.replies = await phone.evaluate(() => [...document.querySelectorAll('.bubble.them:not(.typing)')].map((b) => b.textContent).slice(-3));
await shot(phone, 'inv_3_phone_after');
await phone.tap('.back');

// Time one out: push-ups. (A new check waits until the vääpeli's last message has been read.)
await phone.tap('.conv >> text=Vääpeli');
await wait(300);
await phone.tap('.back');
await dev('inventory');
await desktop.waitForSelector('.inventory-alert:not(.hidden)', { timeout: 8000 });
await dev('inventory');
await wait(3500);
result.timedOut = await desktop.evaluate(() => document.querySelector('.typofeed')?.textContent);

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
