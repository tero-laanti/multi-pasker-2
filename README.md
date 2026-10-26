# MULTI-PASKER

A browser FPS for one LAN party: up to 16 players, each on a computer for combat and on their
own phone for weapon support from a gruff Finnish army armourer, the *varusmestari*.
The interface is in English; voice lines, range commands and the varusmestari's dialogue are
Finnish. The full brief is in [docs/BRIEF.md](docs/BRIEF.md) and the technology choices are in
[docs/STACK.md](docs/STACK.md).

> **Status:** milestone 6 of 7: the shooting range, LAN free-for-all matches on the garrison map
> with bots, the phone (pairing, the messaging app with its own keyboard, the varusmestari's
> LATAA and KRANAATTI), the whole TJ ladder with ranks and upgrades, end-of-round awards and the
> evening scoreboard. Final polish and validation come next.
> Real-device test script: [docs/CHECKPOINT-B.md](docs/CHECKPOINT-B.md).

## Requirements

- **Host machine:** macOS or Windows with [Node.js](https://nodejs.org/) 22.12 or newer (24 LTS recommended).
- **Players:** a desktop browser, Chrome or Edge (Firefox best effort), and a phone (iPhone Safari or
  Android Chrome), all on the same network as the host. No app to install.
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
| `npm run gen:hands` | Re-solve the first-person hand poses after changing a weapon shape or a hand pose |

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

## The phone

Reloads and grenades come from the armourer, *varusmestari*, by text message from your own phone.

1. After joining, the *Click to play* screen (and the Esc menu) shows a **QR code**. Scan it with
   the phone's camera and open the link. Or open `http://<address>/phone` on the phone and type the
   4-digit code shown below the QR code.
2. The phone shows whose phone it is. Tap **Start** (keeps the screen on and enables sound) and
   check that you hear the chime.
3. Open the **Asevarasto** chat and text `LATAA` to reload the gun in your hands, or `KRANAATTI`
   for a grenade (throw it with G). Case, spaces and punctuation don't matter; anything else
   gets a reply from the armourer, and typos, swearing and chatter are shown to everyone.

While a chat is open your character holds the phone: one-handed, wider hip fire, no aiming down
sights. Sending a message shows *Sending…* and goes back to the chat list, which puts the phone
away. Messages you type on the phone use the app's own keyboard (no autocorrect or paste).

One phone per player: pairing another phone replaces the first. A phone that loses its connection
(screen lock, reload) comes back to the same chats. On the desktop, R only reminds you to text;
the host can turn on F2 → *R reloads directly* for everyone (`npm run dev` servers start with it on).

For development, F2 → *Open phone simulator* opens the phone app in a window that you type into
with the computer's keyboard (only on `npm run dev` servers or the host machine).

## The TJ ladder

Your first kill or first death brings an offer from the asevarasto; after that, every 3rd kill
(*Kunniamaininta*) and every 3rd death (*Vahinkoilmoitus käsitelty*) bring another (more with a
big crowd). Each completed task promotes you (alokas → sotamies → … → vääpeli) and counts TJ
down from 6. One task is open at a time; later offers wait in the queue.

| Stage | Where | What |
|---|---|---|
| 1 | Asevarasto | send the word it asks for: you get the rifle |
| 2 | Asevarasto | send a phrase exactly (tongue twisters included) |
| 3 | an office at a new number | open a chat with that number yourself, then send its phrase or the code word hidden in a wall of regulations |
| 4 | the huoltopäällikkö at a 17-digit +358 number | a voice note spells the code in the phonetic alphabet |
| 5 | the huoltopäällikkö again | your gun's serial number: inspect it (I). Sometimes the last three digits, reversed, or the pistol's |
| 6 | Nylands brigad at a new number | a Swedish voice note gives the code; answer in Swedish (*Svara på svenska, tack.*) |
| TJ 0 | — | *Kotiutettu.* LATAA and KRANAATTI still work |

Stages 2 and up open an upgrade screen on the phone (*Kokoa ei ole, ota mikä on.*): three choices
with their exact effect. Upgrades last until the round ends: a longer magazine, a muzzle brake, a
lighter bolt, a suppressor (quiet, no flash, visible), a grenade belt, dark mode (nobody sees you
on the phone), speed dial (`L` and `K`), sotkun munkkikahvit (KIITOS completes the next task),
and a drum magazine on the later stages. The desktop shows your rank and TJ under the clock and a
note when a task or an upgrade waits on the phone.

F2 → *Trigger an offer* and *Advance the ladder* skip the waiting while testing.

## Awards and the evening scoreboard

When a round ends, the scoreboard shows the awards: *Lomille ensimmäisenä* (most kills),
*Kaatui kesken viestin* (died mid-message most often), *Pisin keskeneräinen viesti* (the longest
unsent message, quoted), *Kirjoitusvirheiden kuningas* (most messages the armourer didn't
accept), *Kiire odottamaan* (most time on the phone), *Punnerruskuningas* (most push-ups) and
*Pakkoruotsin sankari* (first through Nylands brigad); and the evening scoreboard: wins, kills,
deaths, awards and TJ 0s over every round tonight, by player name. It is saved to
`data/evening.json` after each round, so restarting the server keeps it. Start a new evening with
F2 → *New evening* on the host (or delete the file). Bots don't count.

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
- **Phone can't open the link or keeps reconnecting:** the phone must be on the same Wi-Fi as the
  host (not mobile data, not a guest network). If the QR code is missing, the server could not
  find its LAN address; start it with `--host <address>`.
- **Phone screen dims or locks:** tap **Start** on the phone after (re)loading the page; it plays a
  tiny silent video that keeps the screen on. Low Power Mode on iPhone can still lock the screen.
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

## First-person hands

The gloved hands are the **WebXR Input Profiles "generic-hand"** model
(`assets/models/generic-hand-right.glb`, unmodified `dist/profiles/generic-hand/right.glb` from the
npm package `@webxr-input-profiles/assets` 1.0.20, https://github.com/immersive-web/webxr-input-profiles),
MIT licensed, Copyright (c) 2019 Amazon; the license text is in
[assets/models/LICENSE-generic-hand.md](assets/models/LICENSE-generic-hand.md). Left hands are the
same model mirrored. It is served with the client like any other bundled asset (nothing loads from
the internet).

Each pose (`src/client/game/models/handSpecs.ts`) places the hand on the gun and solves the fingers
against a distance field built from the same side profiles the gun meshes are extruded from
(`weaponShapes.ts`): gripping fingers close until each segment touches, the trigger finger is aimed
at the trigger with IK, the thumb is aimed along the frame. At load a worker skins the model with
dual quaternions, adds a glove cuff and thickness, subdivides it once and presses whatever still
touches the gun flat against its surface, so the glove never enters the weapon (`tests/hands.test.ts`
checks every hand against the real weapon triangles). Solved poses are cached in
`handPoses.json`; run `npm run gen:hands` after changing a pose, a weapon profile or the hand model
(the test fails while the cache is out of date). The support hand also has a phone-holding pose
(`hands.phone`, with a `phoneAnchor` at the phone's centre). `tools/handlab/` is a small page for
looking at a pose in development: `/tools/handlab/index.html` on the dev server.

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
- **Weapon models** are built in code from extruded, bevelled profiles; the **hands** are a posed,
  skinned hand model baked in a worker (see *First-person hands*).
- **Networking:** each client owns its movement (no reconciliation) and sends it 60 times a
  second in a small binary message stamped with its clock-synced send time. The server sends
  binary snapshots at 30 Hz; every player's state carries its age, so remote players are
  interpolated on their own timeline, behind an interpolation delay that adapts to measured
  jitter (about 50–70 ms on a LAN). Hits are claimed by the shooter against what they saw; the
  server rewinds the target (at most 200 ms) and checks line of sight through the collision world,
  so cover always blocks. The server owns health, damage, ammunition, grenades, score and rounds.
- **Phone app** (`/phone`, about 11 KB gzipped, no Three.js): a single page with its own keyboard
  (the compose field is not an input element, so the OS keyboard never opens). Every send carries
  a request id and the life and round it was sent in; the server acts on it once and only for the
  current life and round. Drafts and the chat-open state are streamed for the kill feed and the
  phone in hand. The varusmestari's matching is in `src/shared/chat.ts`, his script in `fi.ts`.
- **Bots** run on the server with the same movement code, A* over a navigation graph built from
  the map, a field of view, reaction time and aim error, and fire through the same validation
  as players.
- **Other players** are one skinned mesh each (one draw call), posed procedurally: walk, sprint,
  crouch, jump, aim pitch, reload and a death fall. Plain dark uniforms against the greenery,
  each player's accent colour on the beret, arm bands and chest band, and a name tag.

```
src/shared/    config.ts, ui.ts, fi.ts, protocol.ts, collision/, map/, nav.ts, history.ts, movement.ts, weapons.ts, grenade.ts, hitbox.ts, rangeSim.ts
src/client/    app.ts, net.ts, game/ (core loop, range and match modes, remote players, weapons, viewmodel, models, effects), render/, audio/, ui/
src/phone/     the phone app: app.ts, keyboard.ts, net.ts, media.ts
src/server/    main.ts (HTTP + WebSocket), game/ (room, players, bots, phones, varusmestari, ladder), voicenotes.ts, lan.ts, http.ts, tuningWriter.ts
tools/         sound import/synthesis, voice placeholders, e2e screenshot driver
assets/        sfx/ and voice/ (drop-in overrides), with _base/ and _placeholder/ defaults; models/ (hand model)
```

Browser tests drive real Chrome through Playwright: `npx tsx tools/e2e/shot.ts <outDir> <scenario.js>`
runs a scripted scenario against a running server and saves screenshots, and
`npx tsx tools/e2e/phone-flow.ts <outDir> --url=http://localhost:8088/ --phone=390x844` joins a
desktop, pairs an emulated touch phone and runs the LATAA / typo / new-chat / reload flow, and
`tools/e2e/ladder-flow.ts` climbs the TJ ladder through the phone (codes typed on its keyboard,
the upgrade screen, the office number, the voice note).

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
