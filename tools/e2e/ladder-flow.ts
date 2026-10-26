/**
 * The TJ ladder through the phone, end to end: offers (dev command), codes read from the chat
 * and typed on the phone's keyboard, the upgrade screen, the office at a new number, and the
 * huoltopäällikkö's voice note from a 17-digit number.
 *
 *   npx tsx tools/e2e/ladder-flow.ts <outDir> [--url=http://localhost:8088/]
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
await desktop.evaluate(() => (window as any).__pasker.join('Tero'));
await desktop.waitForFunction(() => (window as any).__pasker.match?.pairInfo, null, { timeout: 10000 });
await desktop.evaluate(() => (window as any).__pasker.play());
const token = await desktop.evaluate(() => (window as any).__pasker.match.pairInfo.token as string);
const dev = (cmd: string) => desktop.evaluate((c) => (window as any).__pasker.match.send({ t: 'dev', cmd: c }), cmd);

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

async function openChat(name: string): Promise<void> {
  if (await phone.$('.v-chat')) {
    await phone.tap('.back');
    await phone.waitForSelector('.v-list');
  }
  await phone.tap(`.conv >> text=${name}`);
  await phone.waitForSelector('.v-chat');
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

async function run(): Promise<void> {
// Stage 1: the rifle.
await dev('offer');
await openChat('Asevarasto');
const s1 = await waitIncoming((t) => codeIn(t).length > 0);
result.stage1Message = s1;
await shot(phone, 'ladder_1_task');
await sendInChat(codeIn(s1));
await wait(1500);
result.afterStage1 = await desk();

// Stage 2: the proper form of address, then the upgrade screen.
await dev('offer');
await openChat('Asevarasto');
const s2 = await waitIncoming((t) => codeIn(t).length > 0 && t !== s1);
result.stage2Message = s2;
await sendInChat(codeIn(s2));
await phone.waitForSelector('.upgrade-card', { timeout: 6000 });
await shot(phone, 'ladder_2_upgrade');
result.upgradeOptions = await phone.evaluate(() => [...document.querySelectorAll('.upgrade-card')].map((c) => c.textContent));
await phone.tap('.upgrade-card');
await phone.tap('.upgrade .btn.primary');
await phone.waitForSelector('.upgrade-wrap', { state: 'detached', timeout: 5000 });
await wait(800);
result.afterStage2 = await desk();
await shot(desktop, 'ladder_desktop_hud');

// Stage 3: "ei kuulu meille" — an office at a new number, opened by hand.
await dev('offer');
await openChat('Asevarasto');
const s3 = await waitIncoming((t) => /\b\d{4}\b/.test(t));
result.stage3Message = s3;
const office = /(\d{4})/.exec(s3)?.[1] ?? '';
await phone.tap('.bar-add');
for (const d of office) await phone.tap(`.sheet .kb-key[data-k="${d}"]`);
await shot(phone, 'ladder_3_number');
await phone.tap('.sheet .link.strong');
await phone.waitForSelector('.v-chat');
const officeText = await waitIncoming((t) => codeIn(t).length > 0);
result.officeMessage = officeText.slice(0, 160);
await shot(phone, 'ladder_3_office');
await sendInChat(codeIn(officeText));
await phone.waitForSelector('.upgrade-card', { timeout: 8000 });
await phone.tap('.upgrade-card >> nth=1');
await phone.tap('.upgrade .btn.primary');
await phone.waitForSelector('.upgrade-wrap', { state: 'detached', timeout: 5000 });
await wait(800);
result.afterStage3 = await desk();

// Stage 4: the huoltopäällikkö's voice note from a 17-digit number.
await dev('offer');
await openChat('Asevarasto');
const s4 = await waitIncoming((t) => /\+\d{17}/.test(t));
result.stage4Message = s4;
const long = /(\+\d{17})/.exec(s4)?.[1] ?? '';
await phone.tap('.bar-add');
for (const d of long) await phone.tap(`.sheet .kb-key[data-k="${d}"]`);
await phone.tap('.sheet .link.strong');
await phone.waitForSelector('.v-chat');
await phone.waitForSelector('.bubble.voice', { timeout: 20000 });
await shot(phone, 'ladder_4_voice');
const voiceUrl = await phone.evaluate(() => {
  const app = (window as any).__phone;
  for (const c of app.convs.values()) for (const m of c.messages) if (m.voice) return m.voice.url as string;
  return '';
});
result.voiceUrl = voiceUrl;
if (voiceUrl) {
  const res = await phone.evaluate(async (u) => {
    const r = await fetch(u, { headers: { Range: 'bytes=0-' } });
    const buf = await r.arrayBuffer();
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(buf);
    return { status: r.status, type: r.headers.get('content-type'), seconds: +audio.duration.toFixed(2) };
  }, voiceUrl);
  result.voice = res;
  await phone.tap('.bubble.voice');
  await wait(600);
  result.voicePlaying = await phone.evaluate(() => document.querySelector('.vplay')?.textContent);
}
await dev('advance');
await wait(1500);
result.afterStage4 = await desk();
// The stage 4 upgrade.
await phone.waitForSelector('.upgrade-card', { timeout: 8000 });
await phone.tap('.upgrade-card >> nth=0');
await phone.tap('.upgrade .btn.primary');
await phone.waitForSelector('.upgrade-wrap', { state: 'detached', timeout: 5000 });

// Stage 5: the serial number off the gun (the desktop knows its serials).
await dev('offer');
await openChat('Huoltopäällikkö');
const s5 = await waitIncoming((t) => /Ennen luovutusta/.test(t));
result.stage5Message = s5;
const serials = await desktop.evaluate(() => (window as any).__pasker.game.serials as { rifle: string; pistol: string });
const answer = /kolme viimeistä/.test(s5)
  ? serials.rifle.slice(-3)
  : /takaperin|lopusta alkuun/.test(s5)
    ? [...serials.rifle].reverse().join('')
    : /pistoolisi|sivuaseen/.test(s5)
      ? serials.pistol
      : serials.rifle;
await phone.tap('.kb-key[data-k="SYM"]');
for (const d of answer) await phone.tap(`.kb-key[data-k="${d}"]`);
await phone.tap('.send');
await phone.waitForSelector('.v-list', { timeout: 5000 });
await phone.waitForSelector('.upgrade-card', { timeout: 10000 });
result.upgrade5 = await phone.evaluate(() => [...document.querySelectorAll('.upgrade-name')].map((n) => n.textContent));
await phone.tap('.upgrade-card >> nth=0');
await phone.tap('.upgrade .btn.primary');
await phone.waitForSelector('.upgrade-wrap', { state: 'detached', timeout: 5000 });
await wait(600);
result.afterStage5 = await desk();

// Stage 6: Nylands brigad in Swedish. A Finnish answer is told off; then the code.
await dev('offer');
await openChat('Asevarasto');
const s6 = await waitIncoming((t) => /Nylands/.test(t));
result.stage6Message = s6;
const nylands = /\b(\d{4})\b/.exec(s6)?.[1] ?? '';
await phone.tap('.bar-add');
for (const d of nylands) await phone.tap(`.sheet .kb-key[data-k="${d}"]`);
await phone.tap('.sheet .link.strong');
await phone.waitForSelector('.v-chat');
await phone.waitForSelector('.bubble.voice', { timeout: 20000 });
result.swedishVoice = await phone.evaluate(() => {
  const app = (window as any).__phone;
  for (const c of app.convs.values()) for (const m of c.messages) if (m.voice?.url?.startsWith('/voice/')) return m.voice.url as string;
  return '';
});
await sendInChat('hirvi');
await openChat('Nylands brigad');
result.finnishReply = await waitIncoming((t) => /svenska/i.test(t), 15000);
await shot(phone, 'ladder_6_nylands');
await dev('advance');
await wait(2000);
result.afterStage6 = await desk();
}

try {
  await run();
} catch (e) {
  result.failed = (e as Error).message.split('\n')[0];
  await shot(phone, 'ladder_failed').catch(() => undefined);
}
console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('--- errors ---\n' + errors.join('\n'));
await browser.close();
