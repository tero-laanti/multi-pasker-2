/**
 * Numbers and codewords in the phone's chats, end to end: the codes to send back are bold, the
 * office's and the huoltopäällikkö's numbers are underlined, the asevarasto explains New chat half
 * a minute after the office's number was read, a tap on the number copies it, and the chats opened
 * with New chat bring the task (the office's wall of regulations keeps its code word plain).
 *
 *   npx tsx tools/e2e/numbers-flow.ts <outDir> [--url=http://localhost:8088/]
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

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
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
await desktop.evaluate(() => (window as any).__pasker.join('Aapo'));
await desktop.waitForFunction(() => (window as any).__pasker.match?.pairInfo, null, { timeout: 10000 });
await desktop.evaluate(() => (window as any).__pasker.play());
const token = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.token as string);
const dev = (cmd: string, arg?: unknown) => desktop.evaluate(([c, a]) => (window as any).__pasker.match.send({ t: 'dev', cmd: c, arg: a }), [cmd, arg] as const);
await dev('newEvening');
await desktop.evaluate(() => (window as any).__pasker.match.send({ t: 'settings', s: { bots: 0 } }));

await phone.goto(`${base}phone#${token}`);
await phone.waitForSelector('.v-confirm');
await phone.tap('.v-confirm .btn.primary');
await phone.tap('.v-sound .btn.primary');
await phone.waitForSelector('.v-list');

/** Newest message from the other side in the open chat (not the typing indicator). */
const lastIncoming = () => phone.evaluate(() => [...document.querySelectorAll('.bubble.them:not(.typing)')].map((b) => b.textContent ?? '').pop() ?? '');

async function waitIncoming(test: (t: string) => boolean, ms = 20000): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    const t = await lastIncoming();
    if (test(t) || Date.now() > end) return t;
    await wait(250);
  }
}

/** What the open chat draws bold and as numbers. */
const marks = () =>
  phone.evaluate(() => ({
    bold: [...document.querySelectorAll('.bubble.them strong')].map((b) => b.textContent),
    numbers: [...document.querySelectorAll('.bubble.them .num')].map((n) => n.textContent),
  }));

const chatName = () => phone.evaluate(() => document.querySelector('.v-chat .bar-name')?.textContent ?? '');

/** A new chat the usual way: + in the chat's bar, the number on the pad, Open. */
async function newChat(number: string): Promise<void> {
  await phone.tap('.bar-add');
  await phone.waitForSelector('.sheet');
  for (const d of number) await phone.tap(`.kb-key[data-k="${d}"]`);
  await phone.tap('.sheet .link.strong');
}

/** A finger held on an element (Playwright has no long press). */
async function longPress(selector: string): Promise<void> {
  const box = (await phone.locator(selector).boundingBox())!;
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: 'touch', bubbles: true };
  await phone.dispatchEvent(selector, 'pointerdown', at);
  await wait(600);
  await phone.dispatchEvent(selector, 'pointerup', at);
}

const menu = () => phone.evaluate(() => [...document.querySelectorAll('.ctx-menu .ctx-item')].map((b) => b.textContent));

async function run(): Promise<void> {
  await phone.tap('.conv >> text=Asevarasto');
  await phone.waitForSelector('.v-chat');
  // Day 20: the rifle's and the magazine's paperwork through the dev shortcut, then the knife's
  // sends the player to an office at a new number.
  await dev('serve', 20);
  await waitIncoming((t) => /Sign|Send/.test(t));
  await dev('advance');
  await waitIncoming((t) => /[Ww]rite:|Send:/.test(t));
  await dev('advance');
  result.stage3 = await waitIncoming((t) => /\b\d{4}\b/.test(t));
  const asevarasto = await marks();
  result.asevarasto = asevarasto;
  await shot(phone, 'numbers_1_asevarasto');

  // No chat opened with the number: half a minute after reading it comes the how-to.
  result.reminder = await waitIncoming((t) => t.startsWith('Hey, I told you'), 45000);
  await shot(phone, 'numbers_2_reminder');

  // One tap on the number offers to copy it; New chat's number takes it with a long press.
  await phone.tap('.bubble.them .num >> nth=-1');
  await phone.waitForSelector('.ctx-menu');
  result.copyMenu = await menu();
  await shot(phone, 'numbers_3_copy');
  await phone.tap('.ctx-menu .ctx-item');
  await phone.tap('.bar-add');
  await phone.waitForSelector('.sheet');
  await longPress('.sheet-number');
  await phone.waitForSelector('.ctx-menu');
  result.pasteMenu = await menu();
  await phone.tap('.ctx-menu .ctx-item');
  result.pasted = await phone.evaluate(() => document.querySelector('.sheet-number')?.textContent);
  await phone.tap('.sheet .link.strong');
  await phone.waitForFunction(() => document.querySelector('.v-chat .bar-name')?.textContent !== 'Asevarasto', null, { timeout: 5000 });
  result.officeChat = await chatName();
  result.officeTask = await waitIncoming((t) => t.length > 0);
  result.office = await marks();
  await shot(phone, 'numbers_4_office');

  // Day 30: the huoltopäällikkö's long number, from the asevarasto.
  await dev('advance');
  await dev('serve', 10);
  await phone.tap('.back');
  await phone.tap('.conv >> text=Asevarasto');
  await phone.waitForSelector('.v-chat');
  result.stage4 = await waitIncoming((t) => /\+358/.test(t));
  const huolto = (await marks()).numbers.at(-1)!;
  result.huoltoNumber = huolto;
  await shot(phone, 'numbers_5_huolto_number');
  await newChat(huolto);
  await phone.waitForFunction(() => /Huolto/.test(document.querySelector('.v-chat .bar-name')?.textContent ?? ''), null, { timeout: 5000 });
  result.huoltoChat = await chatName();
  await phone.waitForSelector('.bubble.voice', { timeout: 10000 });
  result.huoltoVoice = true;
  await shot(phone, 'numbers_6_huolto');
}

try {
  await run();
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await shot(phone, 'numbers_failed').catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
