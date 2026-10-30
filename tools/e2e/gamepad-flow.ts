/**
 * A game controller beside the keyboard and mouse, on the range, with a scripted gamepad in place
 * of navigator.getGamepads():
 *
 * 1. Keyboard and mouse with a pad plugged in whose sticks drift: the drift moves and turns
 *    nobody, and W and the mouse button walk and fire as ever.
 * 2. The pad alone: A plays from the click-to-play screen with the mouse unlocked, the sticks walk
 *    and turn, the right trigger fires, Start pauses and plays again, a key puts the pad to sleep
 *    (a light push no longer walks, a firm one wakes it) and Esc pauses.
 *
 *   npx tsx tools/e2e/gamepad-flow.ts [--url=http://localhost:8088/]
 */
import { chromium, type Page } from 'playwright';

const base = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A standard-mapping gamepad the page reads through navigator.getGamepads(), set from here. */
const FAKE_PAD = `
  window.__pad = {
    id: 'Scripted pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  navigator.getGamepads = () => [window.__pad, null, null, null];
  localStorage.setItem('pasker.trained', '1');
`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [];
const result: Record<string, unknown> = {};

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(FAKE_PAD);
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  return page;
}

const axes = (p: Page, a: number[]) => p.evaluate((v) => ((window as any).__pad.axes = v), a);
const button = (p: Page, i: number, down: boolean) =>
  p.evaluate(([b, d]) => ((window as any).__pad.buttons[b as number] = { pressed: d, touched: d, value: d ? 1 : 0 }), [i, down] as const);
async function tap(p: Page, i: number): Promise<void> {
  await button(p, i, true);
  await wait(250);
  await button(p, i, false);
  await wait(250);
}
const state = (p: Page) =>
  p.evaluate(() => {
    const { game, input } = (window as any).__pasker;
    return {
      x: game.move.x as number,
      z: game.move.z as number,
      yaw: game.yaw as number,
      pitch: game.pitch as number,
      ammo: game.weapons.ammo[game.weapons.current] as number,
      paused: game.paused as boolean,
      locked: input.locked as boolean,
      padActive: input.padActive as boolean,
      pauseMenu: (window as any).__pasker.app.menu.pauseVisible as boolean,
    };
  });
const moved = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);

// 1. Keyboard and mouse, with a drifting pad plugged in.
{
  const page = await open();
  await axes(page, [0.3, 0.25, -0.35, 0.3]);
  await page.evaluate(() => (window as any).__pasker.play());
  await wait(800);
  const a = await state(page);
  await wait(1000);
  const b = await state(page);
  result.driftIgnored = { moved: moved(a, b), turned: Math.abs(b.yaw - a.yaw) + Math.abs(b.pitch - a.pitch), padActive: b.padActive };
  await page.keyboard.down('KeyW');
  await wait(600);
  await page.keyboard.up('KeyW');
  const c = await state(page);
  result.keyboardWalks = moved(b, c);
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await wait(80);
  await page.mouse.up();
  await wait(400);
  const d = await state(page);
  result.mouseFires = { before: c.ammo, after: d.ammo };
  await page.close();
}

// 2. The pad alone.
{
  const page = await open();
  await page.getByRole('button', { name: 'Shooting range' }).click();
  await page.waitForSelector('.overlay:not(.hidden), .menu-overlay:not(.hidden)', { timeout: 10000 }).catch(() => {});
  await wait(800);
  const start = await state(page);
  result.beforeA = { paused: start.paused, locked: start.locked };
  await tap(page, 0);
  const playing = await state(page);
  result.afterA = { paused: playing.paused, locked: playing.locked, padActive: playing.padActive };
  await axes(page, [0, -1, 0, 0]);
  await wait(600);
  await axes(page, [0, 0, 0, 0]);
  const walked = await state(page);
  result.stickWalks = moved(playing, walked);
  await axes(page, [0, 0, 1, 0]);
  await wait(300);
  await axes(page, [0, 0, 0, 0]);
  const turned = await state(page);
  result.stickTurnsDeg = ((walked.yaw - turned.yaw) * 180) / Math.PI;
  await tap(page, 7);
  await wait(300);
  const fired = await state(page);
  result.triggerFires = { before: turned.ammo, after: fired.ammo };
  await tap(page, 9);
  const paused = await state(page);
  result.startPauses = { paused: paused.paused, pauseMenu: paused.pauseMenu };
  await tap(page, 9);
  const resumed = await state(page);
  result.startPlays = { paused: resumed.paused, pauseMenu: resumed.pauseMenu };
  // A key puts the pad to sleep: a light push no longer walks, a firm one wakes it.
  await page.keyboard.press('KeyX');
  await axes(page, [0, -0.45, 0, 0]);
  await wait(500);
  const asleep = await state(page);
  result.asleep = { padActive: asleep.padActive, moved: moved(resumed, asleep) };
  await axes(page, [0, -0.9, 0, 0]);
  await wait(500);
  await axes(page, [0, 0, 0, 0]);
  const awake = await state(page);
  result.firmPushWakes = { padActive: awake.padActive, moved: moved(asleep, awake) };
  await page.keyboard.press('Escape');
  await wait(300);
  const esc = await state(page);
  result.escPauses = { paused: esc.paused, pauseMenu: esc.pauseMenu };
  await page.close();
}

// 3. No mouse lock to be had: A plays from the click-to-play screen, and a click takes the mouse.
{
  const page = await open();
  await page.evaluate(() => {
    const el = HTMLCanvasElement.prototype as unknown as { requestPointerLock: () => Promise<void>; realLock?: unknown };
    el.realLock = el.requestPointerLock;
    el.requestPointerLock = () => Promise.reject(new DOMException('blocked for the test', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'Shooting range' }).click();
  await wait(800);
  const before = await state(page);
  const overlay = await page.evaluate(() => (window as any).__pasker.app.menu.overlayVisible as boolean);
  result.noLock = { paused: before.paused, locked: before.locked, overlay };
  await tap(page, 0);
  const playing = await state(page);
  result.aPlaysUnlocked = { paused: playing.paused, locked: playing.locked };
  await page.evaluate(() => {
    const el = HTMLCanvasElement.prototype as unknown as { requestPointerLock: unknown; realLock: unknown };
    el.requestPointerLock = el.realLock;
  });
  await page.mouse.click(640, 360);
  // The lock can take a moment (raw input refused first, then a plain lock).
  await wait(3000);
  const clicked = await state(page);
  result.clickTakesMouse = { paused: clicked.paused, locked: clicked.locked };
  await page.close();
}

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
