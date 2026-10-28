# Development

How MULTI-PASKER 2 is built, tuned, tested and measured. The original brief is in [BRIEF.md](BRIEF.md), the technology choices in [STACK.md](STACK.md), and what was tested in [VALIDATION.md](VALIDATION.md).

> **Status:** all seven milestones are in: the shooting range, LAN matches on the garrison map
> with bots (free-for-all or pairs), the phone (pairing, the messaging app with its own keyboard,
> the varusmestari), the service from TJ 347 to 0 with the päiväraha, P-kausi's gear by text and
> the Sotku App's four upgrade paths, end-of-round awards, the evening scoreboard and the recorded
> voice lines. Not yet tried on real phones: see [CHECKPOINT-B.md](CHECKPOINT-B.md) for the
> real-device test and [VALIDATION.md](VALIDATION.md) for what was tested.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload (same port, same LAN address) |
| `npm test` | Unit tests (collision, movement, weapons, range, grenades, map, match server, bots) |
| `npm run typecheck` | TypeScript type check |
| `npm run build:web` | Build the web version (range and bot match, no server) into `dist-web/` |
| `npm run preview:web` | Serve the web build at http://localhost:8100/ |
| `npm run deploy:web` | Type check, test, build and deploy the web version (asks before changing anything) |
| `npm run gen:sfx` | Re-synthesise footsteps, impacts, hit markers, grenade sounds |
| `npm run gen:voice` | Re-make placeholder voice lines, `docs/RECORDING.md` and the recording booth's list |
| `npm run clean:voice -- <folder>` | Filter the background noise out of recorded takes and put them in `assets/voice/` |

## Tuning

All gameplay numbers live in [src/shared/config.ts](../src/shared/config.ts). Interface text lives
in [src/shared/ui.ts](../src/shared/ui.ts) and all Finnish content (range commands, voice lines, the
varusmestari's script) in [src/shared/fi.ts](../src/shared/fi.ts).

The F4 panel edits every movement and weapon value live, shows derived numbers (time to kill,
ADS time, time to top speed, stopping distance, jump height) and plots the recoil pattern.
**Save to config.ts** writes the values back into `config.ts` (only from the host machine);
**Show as text** shows them as text. Unsaved changes survive a page reload within the
browser session.

The dev panel (F2) switches the kill-speed preset between *CoD* (the brief's values) and
*Scramble* (~0.75 s body kills), refills ammo, gives the rifle and grenades, and starts a drill.

## Sounds and voice

- Gunshots and weapon handling are from **Snake's Authentic Gun Sounds** and **Snake's SECOND
  Authentic Gun Sounds** by F8 Studios (free, commercial use allowed), split into a dry *close*
  layer and a reverb *tail* by `tools/import-sfx.ts`. Footsteps, impacts, steel targets, hit
  markers and grenades are synthesised by `tools/gen-sfx.ts`.
- To replace any sound, drop a file with the same base name (e.g. `pistol_shot_1.wav`) into
  `assets/sfx/`; it overrides `assets/sfx/_base/`.
- Voice lines are recordings in `assets/voice/` (WAV, so the voice notes can splice them); a
  line without one falls back to its machine-voice placeholder in `assets/voice/_placeholder/`.
  Every line and its file name is in [RECORDING.md](RECORDING.md). The recording booth records
  them: open `tools/recorder/index.html` in Chrome (no server needed), choose a folder and record
  line by line; each take is trimmed, evened out and saved as WAV under its file name. Then
  `npm run clean:voice -- <that folder>` filters out the room's background (a low cut for rumble
  and hum, and a noise gate that learns each take's background from its silent lead-in, about
  15 dB quieter without touching the voice) and writes the takes into `assets/voice/`.
- The soundtrack is one song, `assets/music/main-menu.mp3`: the main menu plays it from the top,
  the shooting range keeps it going very quietly, and a match is silent except a clip from 2:20
  that fades in and out over each break between rounds (and a longer one over the match's
  results). Its levels and the clip are `AUDIO.music` in `config.ts`; Settings → *Music* sets
  its volume.

## First-person hands

The gloved hands are built from plain shapes in
[src/client/game/models/hands.ts](../src/client/game/models/hands.ts): a rounded palm with knuckles,
three capsule segments per finger, the thumb, a glove cuff and a sleeve, merged into one mesh per
hand. A pose ([handPoses.ts](../src/client/game/models/handPoses.ts)) is where the wrist sits on the
gun (or phone), how far each finger joint curls, where the thumb points and which side its
knuckles face (its two joints curl the other way, in one plane), and the direction of the
forearm. Fingers and thumbs only bend towards the palm, and the wrist never bends more than 28°:
past that, the forearm turns with the hand. `tests/hands.test.ts` checks those limits and that no
glove sinks more than 2.5 mm into what it holds.

![The hands on the pistol, the rifle and the phone](hands/new-hands.jpg)

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
- **Weapon models** are built in code from extruded, bevelled profiles; the **hands** from simple
  shapes posed by a few joint angles (see *First-person hands*).
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
src/shared/    config.ts, ui.ts, fi.ts, protocol.ts, service.ts (pay, ranks, the Sotku tree), upgrades.ts, collision/, map/, nav.ts, history.ts, movement.ts, weapons.ts, grenade.ts, hitbox.ts, rangeSim.ts
src/client/    app.ts, net.ts, game/ (core loop, range and match modes, remote players, weapons, viewmodel, models, effects), render/, audio/, ui/
src/phone/     the phone app: app.ts, keyboard.ts, net.ts, media.ts
src/server/    main.ts (HTTP + WebSocket), game/ (room, players, bots, phones, varusmestari, service), voicenotes.ts, lan.ts, http.ts, tuningWriter.ts
tools/         sound import/synthesis, voice placeholders, the recording booth and voice cleaning, e2e browser flows
assets/        sfx/ and voice/ (drop-in overrides), with _base/ and _placeholder/ defaults; phone/ (wake video, icon)
```

Browser tests drive real Chrome through Playwright: `npx tsx tools/e2e/shot.ts <outDir> <scenario.js>`
runs a scripted scenario against a running server and saves screenshots, and
`npx tsx tools/e2e/phone-flow.ts <outDir> --url=http://localhost:8088/ --phone=390x844` joins a
desktop, pairs an emulated touch phone and runs the LATAA / typo / new-chat / reload flow,
`tools/e2e/service-flow.ts` goes through the service on a phone (the shop locked in P-kausi, the
commander's text, paperwork typed on its keyboard, a path's tree, buying, autofill, the sniper
rifle's scope), `tools/e2e/tutorial-flow.ts` runs the
training from the first step to the match, once with a phone and once with the virtual phone, and
`tools/e2e/inventory-flow.ts` answers an inventory check wrong, then right, then lets one run out,
and `tools/e2e/teams-flow.ts` plays pairs from the host's seat (the host alone with an odd number,
the pair line, the scoreboard by pairs, the round calls and the aiming toggle).

## Measured performance

16 players (this client and 15 bots fighting on the garrison, texting the armourer), production
build, Chrome 156 on a MacBook Pro M1 Max (ANGLE Metal), 1920×1080, *High* preset, over 20 seconds
(2,400 frames):

| | average | p95 | p99 | max |
|---|---|---|---|---|
| Frame interval (display is 120 Hz) | 8.33 ms | 9.6 ms | 10.2 ms | 10.4 ms |
| Main-thread time per frame | 1.55 ms | 1.9 ms | 2.2 ms | 7.4 ms |
| Server tick (60 Hz, 16 players) | 0.20–0.38 ms | | | 1.34 ms |

About 130 draw calls and 0.4 M triangles per frame. Not measured on an integrated GPU. The
shadow map is redrawn at most 60 times a second (faster screens reuse it in between), and each
desktop receives about 17 KiB/s with 16 players.
The full account of tests, what remains unverified and the default values is in
[docs/VALIDATION.md](VALIDATION.md).
