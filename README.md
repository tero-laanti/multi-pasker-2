# MULTI-PASKER

A browser FPS for one LAN party: up to 16 players, each on a computer for combat and on their
own phone for weapon support from a gruff Finnish army armourer, the *varusmestari*.
All player-facing text is in Finnish. The full brief is in [docs/BRIEF.md](docs/BRIEF.md) and
the technology choices are in [docs/STACK.md](docs/STACK.md).

> **Status:** milestone 1 of 7, the **Ampumarata** (solo shooting range) with the pistol.
> LAN matches, the phone and the varusmestari come in later milestones.

## Requirements

- **Host machine:** macOS or Windows with [Node.js](https://nodejs.org/) 22.12 or newer (24 LTS recommended).
- **Players:** a desktop browser, Chrome or Edge (Firefox best effort), on the same network as the host.
- Everything is bundled: nothing is loaded from the internet while playing.

## Install and start

```bash
npm install
```

```bash
npm start
```

`npm start` builds the client and starts the server on port 8088. It prints the address
players should open, for example:

```
 Tietokoneet: avaa selaimessa  http://192.168.1.23:8088/
```

On the host machine itself you can also use `http://localhost:8088/`.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload (same port, same LAN address) |
| `npm test` | Unit tests (collision, movement, weapons, range, server helpers) |
| `npm run typecheck` | TypeScript type check |
| `npm run gen:sfx` | Re-synthesise footsteps, impacts, hit markers, grenade sounds |
| `npm run gen:voice` | Re-make placeholder voice lines and `docs/RECORDING.md` |

### Choosing the address and port

The server picks the host's Wi-Fi/Ethernet address and ignores VPN, WSL, Docker, VirtualBox
and VMware adapters. If it picks the wrong one (it also lists the alternatives), override it:

```bash
npm start -- --host 192.168.1.23 --port 8088
```

or set the environment variables `PASKER_HOST` and `PASKER_PORT`.

## Troubleshooting

- **Other computers can't connect (Windows host):** Windows Firewall blocks Node.js on networks
  marked *Public*. Either mark the network *Private* (Settings → Network & internet → Wi-Fi →
  the network → Network profile type → Private) or allow Node.js through the firewall when Windows asks.
  On macOS, allow incoming connections for `node` if prompted.
- **Guest Wi-Fi:** many routers' guest networks isolate clients from each other, so nobody can
  reach the host. Use the main network, or a dedicated router/hotspot for the party.
- **Wrong address printed:** VPN clients (Tailscale, corporate VPNs) and virtual adapters can
  confuse the choice; use `--host` with the address shown in the Wi-Fi settings.
- **Mouse doesn't lock / look feels accelerated:** click the game view. The first click after
  Esc needs about a second (browser rule). *Raakasyöte* (raw input) is on by default; if the
  browser doesn't support it the game falls back to normal pointer lock (F3 shows which).
- **No sound:** browsers start audio only after a click or key press; click the game once.
- **Low frame rate on a laptop:** Asetukset → Grafiikan laatu → *Matala*, and lower
  *Renderöintitarkkuus*. Plug the laptop in; Chrome's frame rate drops on battery.

## Controls

| Key | Action |
|---|---|
| WASD | liiku (move) |
| Mouse | katse (look) |
| Left mouse | ammu (fire) |
| Right mouse | tähtää (aim down sights) |
| Shift | juokse (sprint) |
| Space | hyppää (jump) |
| C | kyykky (crouch; toggle by default, hold in settings) |
| 1 / 2 / wheel | vaihda ase (switch weapon) |
| G | heitä kranaatti (throw grenade) |
| I | tarkasta ase (inspect weapon) |
| Tab | tulostaulu (scoreboard) |
| R | reminder that reloading happens on the phone (on the range, a dev toggle makes R reload directly) |
| Esc | menu |
| F2 | dev panel |
| F3 | performance overlay (frame time, RTT, jitter, snapshots, interpolation, server tick) |
| F4 | live tuning panel |

## The range (Ampumarata)

A covered firing point with six lanes; silhouettes, steel plates and gongs at 10, 25 and 50 m; a
target running on a rail; pop-up drill targets behind cover; and a training yard behind the firing
point (kill house, tower with stairs and a ramp, crates) for testing movement.
Shoot the **yellow plate** in front of the firing point to start a 30-second drill
("Ampumapaikoille!" → "Tuli vapaa!" → … → "Tulitauko!"). Your best score is kept in the browser.

## Tuning

All gameplay numbers live in [src/shared/config.ts](src/shared/config.ts); all Finnish text,
including voice lines, lives in [src/shared/fi.ts](src/shared/fi.ts).

The F4 panel edits every movement and weapon value live, shows derived numbers (time to kill,
ADS time, time to top speed, stopping distance, jump height) and plots the recoil pattern.
**Tallenna config.ts** writes the values back into `config.ts` (only from the host machine);
**Näytä tekstinä** shows them as text. Unsaved changes survive a page reload within the
browser session.

The dev panel (F2) switches the kill-speed preset between *CoD* (the brief's values) and
*Scramble* (~0.75 s body kills), triggers a reload, and starts a drill.

## Sounds and voice

- Gunshots and weapon handling are from **Snake's Authentic Gun Sounds** and **Snake's SECOND
  Authentic Gun Sounds** by F8 Studios (free, commercial use allowed), split into a dry *close*
  layer and a reverb *tail* by `tools/import-sfx.ts`. Footsteps, impacts, steel targets, hit
  markers and grenades are synthesised by `tools/gen-sfx.ts`.
- To replace any sound, drop a file with the same base name (e.g. `pistol_shot_1.wav`) into
  `assets/sfx/`; it overrides `assets/sfx/_base/`.
- Voice lines are machine-voice placeholders in `assets/voice/_placeholder/`. Record the real
  ones using [docs/RECORDING.md](docs/RECORDING.md) and drop them into `assets/voice/`.

## Technical overview

- **Client:** Three.js r186 (WebGL2) + TypeScript, bundled by Vite. The weapon is drawn in a
  separate pass after the world with a cleared depth buffer, so it never clips into walls.
- **Server:** Node.js + TypeScript (tsx), `ws` WebSockets on the same port as the web page.
  In development Vite runs inside the same process.
- **Shared code (`src/shared`)** runs in the browser, on the server and in tests: maps as data,
  collision, movement, weapons, hitboxes, the range logic, tuning and Finnish text.
- **Collision:** convex brushes with Quake III-style box traces (exact for boxes, rotated boxes,
  ramps and prisms). **Movement:** fixed 120 Hz steps (slide move, step-up, ground snap),
  identical at any frame rate; rendering interpolates between steps, mouse look applies instantly.
- **Weapons:** hitscan from the eye; deterministic, learnable recoil split into a share that stays
  in your aim and a punch that springs back; ADS, sprint-to-fire, spread and fire-rate caps all in
  the fixed step.

```
src/shared/    config.ts, fi.ts, collision/, map/, movement.ts, weapons.ts, hitbox.ts, rangeSim.ts
src/client/    app.ts, game/ (game loop, weapons, viewmodel, models, effects), render/, audio/, ui/
src/server/    main.ts (HTTP + WebSocket), lan.ts, http.ts, tuningWriter.ts
tools/         sound import/synthesis, voice placeholders, e2e screenshot driver
assets/        sfx/ and voice/ (drop-in overrides), with _base/ and _placeholder/ defaults
```

Browser tests drive real Chrome through Playwright: `npx tsx tools/e2e/shot.ts <outDir> <scenario.js>`
runs a scripted scenario against a running server and saves screenshots.
