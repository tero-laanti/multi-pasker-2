# MULTI-PASKER

A browser FPS for one LAN party: up to 16 players, each on a computer for combat and on their
own phone for weapon support from a gruff Finnish army armourer, the *varusmestari*.
The interface is in English; voice lines, range commands and the varusmestari's dialogue are
Finnish. The full brief is in [docs/BRIEF.md](docs/BRIEF.md) and the technology choices are in
[docs/STACK.md](docs/STACK.md).

> **Status:** milestone 3 of 7: the shooting range and LAN free-for-all matches on the garrison
> map with bots. The phone and the varusmestari come in the next milestones; until then the
> host can let R reload directly (see *Playing a match*).

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
 Players: open  http://192.168.1.23:8088/  in Chrome or Edge
```

On the host machine itself you can also use `http://localhost:8088/`.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload (same port, same LAN address) |
| `npm test` | Unit tests (collision, movement, weapons, range, grenades, map, match server, bots) |
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

## Playing a match

1. Start the server on one machine (`npm start`) and have everyone open the printed address.
2. **Join game**, type a name (letters including Å, Ä, Ö and digits, up to 12) and click the view.
3. Free-for-all on the garrison (*varuskunta*): 4-minute rounds, respawn after ~2.5 s, a short
   spawn protection that ends when you fire. Tab shows the scoreboard; it also appears between
   rounds, and the next round starts by itself after 12 s.
4. With more than 8 players the gate (*puomi*) opens the outer ring: the tent camp and the forest.

Reloading the page puts you back into the same player (score kept). Leaving from the Esc menu
shows you as *left* to the others; you can come back during the round.

**Bots** fill empty slots for testing: F2 → *Add bot* / *Fill with bots (15)*, or start the server
with `PASKER_BOTS=15 npm start` (`set PASKER_BOTS=15` first on Windows).

**Reloading before the phone exists:** reloading is meant to happen by texting the varusmestari
(next milestone). Until then, the host turns on F2 → *R reloads directly*, which applies to
everyone. `npm run dev` servers start with it on.

The dev panel's match controls (bots, round restart, gate, kill speed, giving weapons) work from
the host machine, or from any machine on a `npm run dev` server. The *network conditioner*
in the same panel adds latency and jitter to your own connection, for testing interpolation and
hit registration.

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
  Esc needs about a second (browser rule). *Raw input* is on by default; if the browser doesn't
  support it the game falls back to normal pointer lock (F3 shows which).
- **No sound:** browsers start audio only after a click or key press; click the game once.
- **Low frame rate on a laptop:** Settings → Graphics quality → *Low*, and lower
  *Render resolution*. Plug the laptop in; Chrome's frame rate drops on battery.

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Mouse | look |
| Left mouse | fire |
| Right mouse | aim down sights |
| Shift | sprint |
| Space | jump (a small ledge assist lets you climb ledges just above jump height) |
| C | crouch (toggle by default, hold in settings) |
| 1 / 2 / wheel | rifle / pistol |
| G | throw grenade |
| I | inspect weapon (SA stamp and the weapon's serial number) |
| Tab | scoreboard |
| R | reminder that reloading happens on the phone (on the range, a dev toggle makes R reload directly) |
| Esc | menu (the match keeps running) |
| F2 | dev panel |
| F3 | performance overlay (frame time, CPU time, RTT, jitter, snapshot rate, interpolation delay, server tick) |
| F4 | live tuning panel |

## The shooting range (Ampumarata)

A covered firing point with six lanes; silhouettes, steel plates and gongs at 10, 25 and 50 m; a
target running on a rail; pop-up drill targets behind cover; and a training yard behind the firing
point (kill house, tower with stairs and a ramp, crates) for testing movement.
Shoot the **yellow plate** in front of the firing point to start a 30-second drill
("Ampumapaikoille!" → "Tuli vapaa!" → … → "Tulitauko!"). Your best score is kept in the browser.
On the range you start with the pistol; the dev panel (F2) gives the rifle and grenades, which
later come from the varusmestari.

## Tuning

All gameplay numbers live in [src/shared/config.ts](src/shared/config.ts). Interface text lives
in [src/shared/ui.ts](src/shared/ui.ts) and all Finnish content (range commands, voice lines, the
varusmestari's script) in [src/shared/fi.ts](src/shared/fi.ts).

The F4 panel edits every movement and weapon value live, shows derived numbers (time to kill,
ADS time, time to top speed, stopping distance, jump height) and plots the recoil pattern.
**Save to config.ts** writes the values back into `config.ts` (only from the host machine);
**Show as text** shows them as text. Unsaved changes survive a page reload within the
browser session.

The dev panel (F2) switches the kill-speed preset between *CoD* (the brief's values) and
*Scramble* (~0.75 s body kills), triggers a reload, gives the rifle and grenades, and starts a drill.

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
  the fixed step. Grenades bounce off the same collision world and their blast is blocked by cover.
- **Weapon models and hands** are built in code: the guns from extruded, bevelled profiles, the
  gloved hands as signed-distance shapes meshed with surface nets.
- **Networking:** each client owns its movement (no reconciliation) and sends it 60 times a
  second in a small binary message stamped with its clock-synced send time. The server sends
  binary snapshots at 30 Hz; every player's state carries its age, so remote players are
  interpolated on their own timeline, behind an interpolation delay that adapts to measured
  jitter (about 50–70 ms on a LAN). Hits are claimed by the shooter against what they saw; the
  server rewinds the target (at most 200 ms) and checks line of sight through the collision world,
  so cover always blocks. The server owns health, damage, ammunition, grenades, score and rounds.
- **Bots** run on the server with the same movement code, A* over a navigation graph built from
  the map, a field of view, reaction time and aim error, and fire through the same validation
  as players.
- **Other players** are one skinned mesh each (one draw call), posed procedurally: walk, sprint,
  crouch, jump, aim pitch, reload and a death fall. Plain dark uniforms against the greenery,
  each player's accent colour on the beret, arm bands and chest band, and a name tag.

```
src/shared/    config.ts, ui.ts, fi.ts, protocol.ts, collision/, map/, nav.ts, history.ts, movement.ts, weapons.ts, grenade.ts, hitbox.ts, rangeSim.ts
src/client/    app.ts, net.ts, game/ (core loop, range and match modes, remote players, weapons, viewmodel, models, effects), render/, audio/, ui/
src/server/    main.ts (HTTP + WebSocket), game/ (room, players, bots), lan.ts, http.ts, tuningWriter.ts
tools/         sound import/synthesis, voice placeholders, e2e screenshot driver
assets/        sfx/ and voice/ (drop-in overrides), with _base/ and _placeholder/ defaults
```

Browser tests drive real Chrome through Playwright: `npx tsx tools/e2e/shot.ts <outDir> <scenario.js>`
runs a scripted scenario against a running server and saves screenshots.

### Measured performance (milestone 3)

16 players (this client and 15 bots fighting on the garrison), production build, Chrome 156 on a
MacBook Pro M1 Max (ANGLE Metal), 1920×1080, *High* preset, standing at the parade ground with
all 15 bots in the world, over 20 seconds (2,400 frames):

| | average | p95 | p99 | max |
|---|---|---|---|---|
| Frame interval (display is 120 Hz) | 8.33 ms | 9.2 ms | 9.3 ms | 9.4 ms |
| Main-thread time per frame | 1.09 ms | 1.4 ms | 1.5 ms | 2.1 ms |
| Server tick (60 Hz, 16 players) | 0.15–0.21 ms | | | 0.82 ms |

About 120 draw calls and 0.4 M triangles per frame. Not yet measured on an integrated GPU.
