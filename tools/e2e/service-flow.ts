/**
 * The service and the Sotku App through a real desktop and phone, end to end: the tab bar,
 * the shop locked through P-kausi, the company commander's text on day 42, the rifle's
 * paperwork typed on the phone's keyboard, the shop and a path's tree, a purchase, the
 * autofill chips, the pay line under a kill, and the sniper rifle's scope.
 *
 *   npx tsx tools/e2e/service-flow.ts <outDir> [--url=http://localhost:8088/]
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
// Trained already: straight into the match (tutorial-flow.ts covers the training).
await desktop.evaluate(() => localStorage.setItem('pasker.trained', '1'));
await desktop.evaluate(() => (window as any).__pasker.join('Aapo'));
await desktop.waitForFunction(() => (window as any).__pasker.match?.pairInfo, null, { timeout: 10000 });
await desktop.evaluate(() => (window as any).__pasker.play());
const token = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.token as string);
const dev = (cmd: string, arg?: unknown) => desktop.evaluate(([c, a]) => (window as any).__pasker.match.send({ t: 'dev', cmd: c, arg: a }), [cmd, arg] as const);
// A fresh evening, so an earlier run's service doesn't carry over.
await dev('newEvening');

await phone.goto(`${base}phone#${token}`);
await phone.waitForSelector('.v-confirm');
await phone.tap('.v-confirm .btn.primary');
await phone.tap('.v-sound .btn.primary');
await phone.waitForSelector('.v-list');

async function type(text: string): Promise<void> {
  for (const ch of text.toLowerCase()) {
    if (ch === ' ') await phone.tap('.kb-key[data-k="SPACE"]');
    else if (/[\d+]/.test(ch) && !(await phone.$('.kb[data-mode="numpad"]'))) {
      await phone.tap('.kb-key[data-k="SYM"]');
      await phone.tap(`.kb-key[data-k="${ch}"]`);
      await phone.tap('.kb-key[data-k="ABC"]');
    } else await phone.tap(`.kb-key[data-k="${ch}"]`);
  }
}

async function toList(): Promise<void> {
  if (await phone.$('.v-chat')) await phone.tap('.back');
  else if (await phone.$('.v-sotku')) await phone.tap('.tab >> nth=0');
  await phone.waitForSelector('.v-list');
}

async function openChat(name: string): Promise<void> {
  await toList();
  await phone.tap(`.conv >> text=${name}`);
  await phone.waitForSelector('.v-chat');
}

async function openSotku(): Promise<void> {
  await toList();
  await phone.tap('.tab >> nth=1');
  await phone.waitForSelector('.v-sotku');
}

/** Newest message from the other side in the open chat (not the typing indicator). */
const lastIncoming = () => phone.evaluate(() => [...document.querySelectorAll('.bubble.them:not(.typing)')].map((b) => b.textContent ?? '').pop() ?? '');

/** Waits (messages queue behind each other) until the newest incoming message matches. */
async function waitIncoming(test: (t: string) => boolean, ms = 20000): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    const t = await lastIncoming();
    if (test(t) || Date.now() > end) return t;
    await wait(250);
  }
}

/** The code in a message: its run of capitalised words. */
function codeIn(text: string): string {
  const runs = (text.match(/[A-ZÅÄÖ]{3,}(?: [A-ZÅÄÖ]{2,})*/g) ?? []).filter((r) => !['LATAA', 'KRANAATTI', 'PUNNERRETTU'].includes(r));
  return runs.sort((a, b) => b.length - a.length)[0] ?? '';
}

async function sendInChat(text: string): Promise<void> {
  await type(text);
  await phone.tap('.send');
  await phone.waitForSelector('.v-list', { timeout: 5000 });
}

const desk = () =>
  desktop.evaluate(() => {
    const p = (window as any).__pasker;
    return { rank: p.match.players.get(p.match.myId)?.rank, owned: p.game.weapons.owned, upgrades: p.game.weapons.upgrades, hud: document.querySelector('.ladder-line')?.textContent };
  });

const store = () => phone.evaluate(() => (window as any).__phone.store as { days: number; money: number; open: boolean; owned: string[]; waiting: string[] });

/** Buys in the open Sotku view: the node or café row with this name, then the sheet's button. */
async function buy(name: string): Promise<void> {
  await phone.tap(`.node:has-text("${name}"), .row2:has-text("${name}")`);
  await phone.waitForSelector('.item-sheet');
  await phone.tap('.item-sheet .btn.primary');
  await phone.waitForSelector('.item-sheet', { state: 'detached', timeout: 5000 });
}

async function run(): Promise<void> {
  // The tab bar, and the shop shut through P-kausi.
  await shot(phone, 'service_1_chats');
  await openSotku();
  result.locked = await phone.evaluate(() => document.querySelector('.lockbox')?.textContent);
  await shot(phone, 'service_2_locked');

  // Day 42: the rifle's paperwork and the company commander's text.
  await dev('serve', 42);
  await openChat('Asevarasto');
  const rifle = await waitIncoming((t) => codeIn(t).length > 0);
  result.rifleMessage = rifle;
  await sendInChat(codeIn(rifle));
  await openChat('Komppanian päällikkö');
  result.commander = await waitIncoming((t) => /Sotku/.test(t));
  await shot(phone, 'service_3_commander');
  await wait(1000);
  result.afterPkausi = { desk: await desk(), store: await store() };
  // The rest of P-kausi's gear (magazine, knife, grenade belt) through the dev shortcut.
  for (let i = 0; i < 3; i++) await dev('advance');
  await wait(800);

  // The shop, a path, and a row I buy (handed over at once).
  await openSotku();
  await shot(phone, 'service_4_shop');
  await phone.tap('.pcard:has-text("Tarkka-ampuja")');
  await phone.waitForSelector('.tree .node');
  await wait(300);
  await shot(phone, 'service_5_tree');
  await phone.tap('.node:has-text("Suujarru")');
  await phone.waitForSelector('.item-sheet');
  await wait(400);
  await shot(phone, 'service_6_sheet');
  await phone.tap('.item-sheet .btn.primary');
  await phone.waitForSelector('.item-sheet', { state: 'detached', timeout: 5000 });
  result.afterSuujarru = { desk: await desk(), store: await store() };

  // The pay line under a kill confirmation (once the purchase's note has gone).
  await wait(4000);
  await desktop.evaluate(() => {
    const hud = (window as any).__pasker.match.hud;
    hud.killConfirm('Virtanen', false);
    hud.killPay('+15 €');
  });
  await wait(200);
  await shot(desktop, 'service_7_hud');

  // Automaattitäyttö: the code shows above the keyboard.
  await dev('money', 2000);
  await wait(500);
  await phone.tap('.back');
  await phone.tap('.pcard:has-text("Viestimies")');
  await buy('Pikavalinta');
  await buy('Automaattitäyttö');
  await openChat('Asevarasto');
  const auto = await waitIncoming((t) => /Automaattitäyttö/.test(t) && codeIn(t).length > 0);
  await sendInChat(codeIn(auto));
  await openSotku();
  await phone.tap('.pcard:has-text("Viestimies")');
  await buy('Tutka');
  await openChat('Asevarasto');
  const tutka = await waitIncoming((t) => /Tutka/.test(t));
  await phone.waitForSelector('.chip-btn', { timeout: 5000 });
  result.chips = await phone.evaluate(() => [...document.querySelectorAll('.chip-btn')].map((c) => c.textContent));
  await shot(phone, 'service_8_autofill');
  await phone.tap('.chip-btn >> nth=0');
  result.filled = await phone.evaluate(() => document.querySelector('.field .text')?.textContent);
  result.tutkaCode = codeIn(tutka);
  await phone.tap('.send');
  await phone.waitForSelector('.v-list', { timeout: 5000 });

  // The sniper rifle: doughnut coffee skips the paperwork on the way.
  await openSotku();
  for (let i = 0; i < 4; i++) await buy('Munkkikahvit');
  await phone.tap('.pcard:has-text("Tarkka-ampuja")');
  for (const name of ['Kevennetty lukko', 'Vaimennin', 'Tarkkuuskivääri']) {
    await buy(name);
    await openChat('Asevarasto');
    await sendInChat('Kiitos');
    await wait(400);
    await openSotku();
    await phone.tap('.pcard:has-text("Tarkka-ampuja")');
  }
  await wait(800);
  result.afterSniper = { desk: await desk(), store: await store() };
  await shot(phone, 'service_9_tree_done');
  // The phone goes down (no aiming with it in hand), then the sniper rifle on 3.
  await toList();
  await desktop.keyboard.press('Digit3');
  await wait(900);
  await shot(desktop, 'service_10_sniper');
  await desktop.mouse.down({ button: 'right' });
  await wait(800);
  await shot(desktop, 'service_11_scope');
  await desktop.mouse.up({ button: 'right' });
}

try {
  await run();
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await shot(phone, 'service_failed').catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
