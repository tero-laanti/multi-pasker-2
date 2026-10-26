/**
 * Two desktop clients in one match: A shoots B in the open and through cover; both clients must
 * agree on health, kills and deaths. Positions are set by test hooks (client-owned movement).
 *
 *   npx tsx tools/e2e/two-desktops.ts [--url=http://localhost:8088/]
 */
import { chromium, type Page } from 'playwright';

const base = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:8088/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function join(name: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log(`[${name}] ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => (window as any).__pasker?.game, null, { timeout: 30000 });
  await page.evaluate((n) => (window as any).__pasker.join(n), name);
  await page.waitForFunction(() => (window as any).__pasker.match?.joined && (window as any).__pasker.match.alive, null, { timeout: 10000 });
  await page.evaluate(() => (window as any).__pasker.play());
  return page;
}

const a = await join('Anna');
const b = await join('Ben');
const idOf = (p: Page) => p.evaluate(() => (window as any).__pasker.match.myId as number);
const [ida, idb] = [await idOf(a), await idOf(b)];

/** Puts a player somewhere (their client owns its position) and keeps them still. */
async function place(p: Page, x: number, z: number, yaw: number): Promise<void> {
  await p.evaluate(
    ([x, z, yaw]) => {
      const g = (window as any).__pasker.game;
      const tr = g.tr;
      g.world.trace(tr, x, 3, z, x, -2, z, 0.3, 0.1, 0.3, 1);
      g.teleport(x, tr.y + 0.02, z, yaw);
    },
    [x, z, yaw],
  );
}

/** A aims at B as drawn and fires `n` single shots. */
async function shoot(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await a.evaluate((target) => {
      const p = (window as any).__pasker;
      const r = p.match.remotes.players.get(target);
      const g = p.game;
      const ex = g.move.x;
      const ey = g.move.y + g.move.eye;
      const ez = g.move.z;
      g.yaw = Math.atan2(-(r.s.x - ex), -(r.s.z - ez));
      g.pitch = Math.atan2(r.s.y + 1.15 - ey, Math.hypot(r.s.x - ex, r.s.z - ez));
      p.input.leftPressed = true;
    }, idb);
    await wait(260);
  }
}

const state = async (p: Page) =>
  p.evaluate(() => {
    const m = (window as any).__pasker.match;
    return { hp: m.hp, alive: m.alive, players: [...m.players.values()].map((x: any) => `${x.name}:${x.kills}/${x.deaths}`).sort().join(' ') };
  });
const seenHp = (p: Page, id: number) => p.evaluate((id) => (window as any).__pasker.match.remotes.players.get(id)?.s.hp, id);

const results: Record<string, unknown> = { ids: [ida, idb] };

// 1. In the open on the parade ground, 10 m apart.
await place(a, 0, 14, 0);
await place(b, 0, 4, Math.PI);
await wait(1500); // past spawn protection, and interpolation settles
await shoot(2);
await wait(500);
results.open = { bOwnHp: (await state(b)).hp, bHpSeenByA: await seenHp(a, idb) };

// 2. Behind cover: the kasarmi's south wall between them.
await place(a, 5, -20, Math.PI);
await place(b, 5, -28.5, 0); // inside the kasarmi, solid south wall between
await wait(5500); // health regenerates meanwhile
const before = (await state(b)).hp;
await shoot(3);
await wait(500);
results.cover = { before, after: (await state(b)).hp };

// 3. Back in the open: finish B; both clients agree on kills and deaths.
await place(a, 0, 14, 0);
await place(b, 0, 4, Math.PI);
await wait(1200);
await shoot(6);
await wait(800);
results.scoreA = (await state(a)).players;
results.scoreB = (await state(b)).players;
results.bAlive = (await state(b)).alive;

console.log(JSON.stringify(results, null, 2));
await browser.close();
