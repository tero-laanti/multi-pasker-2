/**
 * The training on the range, end to end: a first-time desktop walks to the table, shoots the
 * target, finds no spare magazine, picks up the phone, pairs an emulated phone through the QR
 * link, answers the radio check with YK on the phone's keyboard, and goes to the match. A
 * second desktop skips the phone.
 *
 *   npx tsx tools/e2e/tutorial-flow.ts <outDir> [--url=http://localhost:8088/]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const args = process.argv.slice(2);
const outDir = args[0]!;
const base = args.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phone = await phoneCtx.newPage();
const logs: string[] = [];
for (const [name, page] of [['desktop', desktop], ['phone', phone]] as const) {
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`[${name} error] ${m.text()}`));
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const result: Record<string, unknown> = {};

const stage = (pg: Page) => pg.evaluate(() => (window as any).__pasker.app.tutorial?.stage as string | undefined);
const panel = (pg: Page) => pg.evaluate(() => document.querySelector('.tutorial-title')?.textContent ?? '');

async function waitStage(pg: Page, want: string, ms = 8000): Promise<string | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const s = await stage(pg);
    if (s === want || Date.now() > end) return s;
    await wait(100);
  }
}

/** Joins as a first-timer: the server keeps us on the range. */
async function joinFresh(pg: Page, name: string): Promise<void> {
  await pg.goto(base);
  await pg.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  await pg.evaluate(() => localStorage.removeItem('pasker.trained'));
  await pg.evaluate((n) => (window as any).__pasker.join(n), name);
  await pg.waitForFunction(() => (window as any).__pasker.app.mode === 'training', null, { timeout: 10000 });
  await pg.evaluate(() => (window as any).__pasker.play());
}

/** Faces a world point from the eye. */
function aimAt(pg: Page, x: number, y: number, z: number): Promise<void> {
  return pg.evaluate(
    ([x, y, z]) => {
      const g = (window as any).__pasker.game;
      const dx = x - g.eye.x;
      const dy = y - g.eye.y;
      const dz = z - g.eye.z;
      g.yaw = Math.atan2(-dx, -dz);
      g.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    [x, y, z],
  );
}

/** Stands in front of the duty table, looking at the phone. */
async function toPhone(pg: Page): Promise<void> {
  await pg.evaluate(() => (window as any).__pasker.game.teleport(5.5, 0.14, 5.65, Math.PI));
  await wait(100);
  await aimAt(pg, 5.5, 0.95, 6.55);
  await wait(300);
}

async function run(): Promise<void> {
  await joinFresh(desktop, 'Tero');
  result.joinedAs = await desktop.evaluate(() => (window as any).__pasker.app.mode);
  result.serverSaysTraining = await desktop.evaluate(() => (window as any).__pasker.match.training);
  result.step1 = [await stage(desktop), await panel(desktop)];
  await wait(400);
  await shot(desktop, 'tut_1_walk');

  // 1. Walk to the table (the last metres on the keyboard).
  await desktop.evaluate(() => (window as any).__pasker.game.teleport(-2.5, 0.14, 1.6, 0));
  await desktop.keyboard.down('KeyW');
  result.walked = await waitStage(desktop, 'shoot', 4000);
  await desktop.keyboard.up('KeyW');

  // 2. Knock the 10 m target down.
  await aimAt(desktop, -2.5, 1.25, -10);
  await wait(200);
  await shot(desktop, 'tut_2_shoot');
  for (let i = 0; i < 12 && (await stage(desktop)) === 'shoot'; i++) {
    await desktop.evaluate(() => ((window as any).__pasker.input.leftPressed = true));
    await wait(220);
  }
  result.afterShooting = { stage: await stage(desktop), ammo: await desktop.evaluate(() => (window as any).__pasker.game.weapons.ammo.pistol) };

  // 3. R: no spare magazine.
  await desktop.keyboard.press('KeyR');
  await wait(300);
  result.noSpare = await panel(desktop);
  await shot(desktop, 'tut_3_nospare');
  result.toPhone = await waitStage(desktop, 'phone', 5000);
  await shot(desktop, 'tut_4_phone');

  // 4. The phone on the duty table: E picks it up and the pairing screen opens.
  await toPhone(desktop);
  result.prompt = await desktop.evaluate(() => document.querySelector('.prompt')?.textContent);
  await shot(desktop, 'tut_5_table');
  await desktop.keyboard.press('KeyE');
  await desktop.waitForSelector('.tutorial-modal:not(.hidden)', { timeout: 3000 });
  result.modalPointerFree = await desktop.evaluate(() => !document.pointerLockElement);
  result.pauseHidden = await desktop.evaluate(() => document.querySelector('.screen.pause')?.classList.contains('hidden'));
  await wait(300);
  await shot(desktop, 'tut_6_pair');

  // 5. Pair the phone with the QR link; the radio check arrives.
  const token = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.token as string);
  await phone.goto(`${base}phone#${token}`);
  await phone.waitForSelector('.v-confirm', { timeout: 10000 });
  await phone.tap('.v-confirm .btn.primary');
  await phone.tap('.v-sound .btn.primary');
  await phone.waitForSelector('.v-list .conv');
  await desktop.waitForSelector('.tutorial-connected:not(.hidden)', { timeout: 5000 });
  await shot(desktop, 'tut_7_connected');
  result.stageAfterPair = await stage(desktop);
  await desktop.click('.tutorial-connected .btn.primary');
  await wait(300);
  result.modalClosed = await desktop.evaluate(() => document.querySelector('.tutorial-modal')?.classList.contains('hidden'));
  await desktop.evaluate(() => (window as any).__pasker.play());
  await wait(2500);
  await phone.tap('.v-list .conv');
  await phone.waitForSelector('.v-chat');
  await wait(600);
  result.radioCheck = await phone.evaluate(() => [...document.querySelectorAll('.bubble.them:not(.typing)')].map((b) => b.textContent).pop());
  result.phoneInHand = await desktop.evaluate(() => (window as any).__pasker.game.mode.phoneOut);
  await shot(phone, 'tut_8_phone_radiocheck');

  // 6. YK on the phone's keyboard: full magazines, training complete.
  await phone.tap('.kb-key[data-k="y"]');
  await phone.tap('.kb-key[data-k="k"]');
  await phone.tap('.send');
  result.done = await waitStage(desktop, 'done', 8000);
  // The armourer's answer follows its typing pause.
  await wait(3500);
  result.ammoDone = await desktop.evaluate(() => {
    const w = (window as any).__pasker.game.weapons;
    return { mag: w.ammo.pistol, spare: w.reserve.pistol };
  });
  await shot(desktop, 'tut_9_done');
  await phone.tap('.v-list .conv');
  await wait(400);
  await shot(phone, 'tut_10_phone_done');
  result.reply = await phone.evaluate(() => [...document.querySelectorAll('.bubble.them:not(.typing)')].map((b) => b.textContent).pop());
  await phone.tap('.back');

  // 7. Esc → Go to the match.
  await desktop.evaluate(() => document.exitPointerLock());
  await desktop.waitForSelector('.screen.pause:not(.hidden)', { timeout: 3000 });
  await shot(desktop, 'tut_11_pause');
  await desktop.click('.screen.pause .btn.primary >> text=Go to the match');
  await desktop.waitForFunction(() => (window as any).__pasker.app.mode === 'match' && (window as any).__pasker.match.alive, null, { timeout: 8000 });
  result.inMatch = await desktop.evaluate(() => ({ mode: (window as any).__pasker.app.mode, alive: (window as any).__pasker.match.alive, trained: localStorage.getItem('pasker.trained'), spare: (window as any).__pasker.game.weapons.reserve.pistol }));

  // A second first-timer skips the phone.
  const other = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  other.on('pageerror', (e) => logs.push(`[other pageerror] ${e.message}`));
  await joinFresh(other, 'Bertta');
  await other.evaluate(() => (window as any).__pasker.app.tutorial.set('phone'));
  await toPhone(other);
  await other.keyboard.press('KeyE');
  await other.waitForSelector('.tutorial-modal:not(.hidden)', { timeout: 3000 });
  await other.click('.tutorial-skip .btn');
  result.skipped = await other.evaluate(() => {
    const t = (window as any).__pasker.app.tutorial;
    return { stage: t.stage, noPhone: t.noPhone, title: document.querySelector('.tutorial-title')?.textContent };
  });
  await wait(500);
  await shot(other, 'tut_12_skipped');
  await other.evaluate(() => (window as any).__pasker.app.deploy());
  await other.waitForFunction(() => (window as any).__pasker.match?.alive, null, { timeout: 8000 });
  result.skipperOutOfAmmo = await other.evaluate(() => (window as any).__pasker.match.outOfAmmo());
  result.board = await desktop.evaluate(() => [...(window as any).__pasker.match.players.values()].map((p: any) => `${p.name}:${p.training}`));
}

try {
  await run();
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await shot(desktop, 'tut_failed').catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (logs.length) console.log('--- errors ---\n' + logs.join('\n'));
await browser.close();
