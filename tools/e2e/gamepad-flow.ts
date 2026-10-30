/**
 * A game controller beside the keyboard and mouse, on the range, with a scripted gamepad in place
 * of navigator.getGamepads():
 *
 * 1. Keyboard and mouse with a pad plugged in whose sticks drift: the drift moves and turns
 *    nobody, and W and the mouse button walk and fire as ever.
 * 2. The pad alone: A plays from the click-to-play screen with the mouse unlocked, the sticks walk
 *    and turn, the right trigger fires, Start pauses and plays again, a key puts the pad to sleep
 *    (a light push no longer walks, a firm one wakes it) and Esc pauses.
 * 3. No mouse lock to be had: A plays from the click-to-play screen, and a click takes the mouse.
 * 4. The hints follow the device: keys, PlayStation buttons for a DualSense, Xbox ones for an
 *    Xbox pad, and keys again after a key press.
 * 5. The menus on the pad: the D-pad steps to Settings, right raises a slider, B goes back, A
 *    starts the range (the mouse free), Start pauses and B resumes.
 * 6. The page without focus says so over everything.
 * 7. Settings → Controls: Jump to F with the mouse (Esc cancels a slot), the knife onto the middle
 *    mouse button, Jump to △ on the pad and, driven by the pad alone, Move forward to L1; then F
 *    and △ jump on the range and Space no longer does, the note says F, and Reset brings it all back.
 *
 *   npx tsx tools/e2e/gamepad-flow.ts <outDir> [--url=http://localhost:8088/]
 *
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const outDir = process.argv[2] ?? 'out/gamepad';
const base = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
fs.mkdirSync(outDir, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`) });
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

const keysShown = (p: Page) =>
  p.evaluate(() => ({
    menu: [...document.querySelectorAll('.controls-grid .key')].slice(0, 13).map((e) => e.textContent).join(' | '),
    note: [...document.querySelectorAll('.controls-note-grid .key')].map((e) => e.textContent).join(' | '),
    padNav: document.body.classList.contains('pad-nav'),
  }));

// 4. The hints follow the device.
{
  const page = await open();
  result.hintsKeyboard = await keysShown(page);
  await page.evaluate(() => ((window as any).__pad.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'));
  await tap(page, 3);
  result.hintsPlayStation = await keysShown(page);
  await shot(page, 'menu_playstation');
  await page.evaluate(() => ((window as any).__pad.id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'));
  await tap(page, 3);
  result.hintsXbox = await keysShown(page);
  await page.keyboard.press('KeyX');
  await wait(200);
  result.hintsKeyboardAgain = await keysShown(page);
  await page.close();
}

// 5. The menus on the pad.
{
  const page = await open();
  await page.evaluate(() => ((window as any).__pad.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'));
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
  await tap(page, 13);
  result.firstFocus = await focused();
  await tap(page, 13);
  await tap(page, 13);
  result.steppedTo = await focused();
  await tap(page, 0);
  await wait(200);
  result.settingsOpen = await page.isVisible('.screen.settings:not(.hidden)');
  const sens = () => page.evaluate(() => (window as any).__pasker.app.settings.sensitivity as number);
  const before = await sens();
  await tap(page, 15);
  result.sliderRight = { before, after: await sens() };
  await shot(page, 'settings_focus');
  await tap(page, 1);
  await wait(200);
  result.backToMain = await page.isVisible('.screen.main:not(.hidden)');
  result.focusAfterBack = await focused();
  await tap(page, 0);
  await wait(1500);
  const playing = await state(page);
  result.rangeFromPad = { paused: playing.paused, locked: playing.locked };
  await tap(page, 9);
  const paused = await state(page);
  result.pausedFocus = { pauseMenu: paused.pauseMenu, focus: await focused() };
  await shot(page, 'pause_focus');
  await tap(page, 1);
  const resumed = await state(page);
  result.bResumes = { paused: resumed.paused, pauseMenu: resumed.pauseMenu, locked: resumed.locked };
  await page.close();
}

// 6. No focus.
{
  const page = await open();
  const shown = () => page.evaluate(() => !document.querySelector('.focus-notice')?.classList.contains('hidden'));
  result.noticeWithFocus = await shown();
  await page.evaluate(() => {
    (window as any).__hasFocus = document.hasFocus;
    document.hasFocus = () => false;
  });
  await wait(300);
  result.noticeWithoutFocus = await shown();
  await shot(page, 'no_focus');
  await page.evaluate(() => {
    document.hasFocus = (window as any).__hasFocus;
  });
  await wait(300);
  result.noticeFocusBack = await shown();
  await page.close();
}

// 7. Settings → Controls.
{
  const page = await open();
  await page.evaluate(() => ((window as any).__pad.id = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'));
  const binds = () => page.evaluate(() => (window as any).__pasker.app.settings.bindings as { keys: Record<string, string[]>; buttons: Record<string, number[]> });
  const slot = (kind: string, action: string, i: number) => `[data-bind="${kind}:${action}:${i}"]`;
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Controls' }).click();
  await page.waitForSelector('.bind-grid');
  await page.click(slot('keys', 'jump', 0));
  result.waiting = await page.textContent(slot('keys', 'jump', 0));
  await page.keyboard.press('Escape');
  result.escCancels = { label: await page.textContent(slot('keys', 'jump', 0)), jump: (await binds()).keys.jump };
  await page.click(slot('keys', 'jump', 0));
  await page.keyboard.press('KeyF');
  await page.click(slot('keys', 'knife', 1));
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await page.click(slot('buttons', 'jump', 0));
  await tap(page, 3);
  // The pad alone: down to the first slot, right twice to Move forward's controller slot, A, then L1.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tap(page, 13);
  await tap(page, 15);
  await tap(page, 15);
  result.padFocus = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.bind);
  await tap(page, 0);
  await tap(page, 4);
  const b = await binds();
  result.bound = { jumpKeys: b.keys.jump, knifeKeys: b.keys.knife, jumpButtons: b.buttons.jump, nextWeapon: b.buttons.nextWeapon, forwardButtons: b.buttons.forward, knifeButtons: b.buttons.knife };
  result.slots = await page.evaluate(() => [...document.querySelectorAll('.bind-slot')].slice(16, 24).map((e) => e.textContent).join(' | '));
  await shot(page, 'controls_screen');
  // On the range, with the keyboard: F jumps, Space doesn't; the note says F.
  await page.keyboard.press('KeyX');
  await page.evaluate(() => (window as any).__pasker.play());
  await wait(1500);
  const rise = async (press: () => Promise<void>) => {
    const y0 = await page.evaluate(() => (window as any).__pasker.game.move.y as number);
    await press();
    let top = y0;
    for (let i = 0; i < 6; i++) {
      await wait(60);
      top = Math.max(top, await page.evaluate(() => (window as any).__pasker.game.move.y as number));
    }
    await wait(900);
    return Number((top - y0).toFixed(2));
  };
  const key = (code: string) => async () => {
    await page.keyboard.down(code);
    await wait(120);
    await page.keyboard.up(code);
  };
  result.spaceJumps = await rise(key('Space'));
  result.fJumps = await rise(key('KeyF'));
  result.noteJump = await page.evaluate(() => [...document.querySelectorAll('.controls-note-grid .key')][5]?.textContent);
  result.triangleJumps = await rise(async () => {
    await button(page, 3, true);
    await wait(120);
    await button(page, 3, false);
  });
  // Reset.
  await page.keyboard.press('KeyX');
  await page.evaluate(() => {
    const app = (window as any).__pasker.app;
    app.input.unlock();
    app.game.paused = true;
    app.menu.showSettings('pause');
  });
  await page.getByRole('button', { name: 'Controls' }).click();
  await page.getByRole('button', { name: 'Reset controls' }).click();
  const r = await binds();
  result.reset = { jump: r.keys.jump, knife: r.keys.knife, padJump: r.buttons.jump, padForward: r.buttons.forward };
  await page.close();
}

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
