# Validation: what was tested, and what wasn't

The state after the Checkpoint B feedback (milestone 7 plus the training, spare magazines and
held grenades). Everything below was run on a MacBook Pro M1 Max (macOS, Node 22.16,
Chrome 156 with ANGLE Metal, Playwright 1.64 with Chrome and WebKit).

## Automated tests (`npm test`): 143 passing

| Area | What the tests check |
|---|---|
| Collision and movement | Box traces against every brush kind, slide moves, steps, ground snap, crouch, jump, the ledge assist, identical results at any frame rate |
| Weapons | Fire rates, magazines, damage presets, recoil pattern, spread, reload timing, time to kill; the phone-out penalty (no ADS, wider hip spread); the spare magazine (R takes it once, an empty trigger reloads, nothing left clicks) |
| Grenades | Bounces, fuse, blast blocked by cover; the fuse burns from the G press, so a held grenade lands with less of it and one held too long goes off in the hand (a self-kill); a player shot with the pin out drops it, still burning; paused while holding it, it falls |
| Range | Targets, drills, scoring |
| Garrison | Spawns and navigation points are clear of solids, the nav graph is connected, the gate brushes; bots find a way into the tent camp (and back, and through the back gate) only while the gates are open; bots reach the Veksi waiting room, corridor, ward and yard; every spawn faces into the map. In Chrome: the Veksi from the street and the side door, its lobby and ward, the back gate |
| Match server | Rewind hits where the target was at the shooter's render time, cover blocks a claimed hit, fire rate and ammo caps, headshots, respawn, regeneration, reload refill timing, R taking only what the magazine needs from the spare, LATAA filling every magazine and spare (also during an R reload), token rejoin, 15 bots fighting for a minute within the tick budget, rounds and intermission; a browser on the server machine counts as the host by any of its addresses |
| Training | A first-timer stays out of the match (no spawn, no snapshots, not counted, no awards or evening) until they deploy; the radio check sent when the phone is picked up (or right away if already paired), only YK answers it, then LATAA and KRANAATTI work for the range's guns |
| Knife | Reach: a body in front within arm's length is reached, standing or crouched, but not one behind, beside or too far; the nearest of two takes the stab. Server: two stabs kill from full health and the kill is the knife's; a second stab too soon is ignored; no damage out of reach, through a wall, facing away or on spawn protection. Client: the stab lands once, at its moment, no shots while the knife is out, the gun ready again after; refused while reloading or holding a grenade. The hand round the handle sinks at most 1.7 mm into it. In Chrome: the stab in first person with both guns, the arm coming up from below |
| Minimap | Turned so the view points up (north, west and east views); a box seen from above is its four corners; the garrison gives walls, low cover, floors and fences, never the ground, anything starting above head height (roofs, lintels over doorways) or tree trunks. In Chrome: north on the rim and test shots straight ahead at the top while facing north, east and south, the closed gate as a red bar, bots' shots as red dots, hidden when turned off in the settings, and the same in the web version's bot match |
| Interpolation | Per-player timelines with state age, extrapolation cap, no blending across respawns, held states taking server-side changes, the adaptive delay and its render clock |
| Phone and varusmestari | Pairing by QR token and code, replacement with a notice on both, token resume, the simulator refused outside development; LATAA refills only the sender, refuses when everything is full and never stacks; KRANAATTI carry limit and cooldown; duplicate request ids act once; requests from the dead, a previous life or an old round do nothing; a round restart; the PUNNERRETTU lockout; the typo feed's one-line-per-1.5 s rate limit preferring longer messages and keeping valid commands private; kill-feed drafts; a death with the phone out tells the phone who did it and what never got sent (nothing when the phone was away); the phone-in-hand flag exactly while a chat is open; command matching (case, spacing, punctuation, near misses, swearing, languages, greetings, numbers) |
| Inventory check | From the vääpeli, in his own chat, never in a player's first minute in the match; asked only of the living with a connected phone during a round; the answer time starts when the question arrives; the number when asked or when answered counts; a right answer gives a grenade and closes it, a wrong one keeps it open, a timeout locks the phone until PUNNERRETTU; bots answer (mostly right) and report their push-ups |
| Messages | One new message per chat: an unasked-for message waits until the one before has been read (a ladder offer and its task arrive as one message; the radio check waits behind an unread welcome); replies are never held back |
| TJ ladder | First offer on the first kill or death, every 3rd kill and every 3rd death on separate counters, self-kills don't count; codes unique between players; one open task with a queue; every stage 1–6 including the office number opened by hand, the 17-digit number and its voice note, the serial number, the Swedish stage and "svara på svenska"; TJ 0; munkkikahvit; upgrade choice applied once; round reset; upgrade weapon numbers |
| Awards and evening | Each award to the right player, nothing for nothing, the evening scoreboard adding rounds, surviving a restart (file), leaving bots out |
| First-person hands | Every pose builds; fingers bend only towards the palm and within joint limits; no wrist bends more than 28°; left hands are true mirror images; no glove sinks more than 2.5 mm into the gun or phone it holds (exact mesh distance) |

## End-to-end, in real browsers

- `tools/e2e/two-desktops.ts`: two Chrome clients in one round. Hits in the open register and
  both clients agree on health; the kasarmi wall blocks all shots; kills and deaths agree.
- `tools/e2e/phone-flow.ts`: a desktop and an emulated touch phone (390×844, 375×667, 360×740, and
  once in WebKit, Safari's engine). Pairing by QR link, the sound check, the phone in hand while a
  chat is open and put away after sending, LATAA reloading the right player, a typo appearing in
  the desktop typo feed with the reply, dying with a half-typed message (the phone goes back to
  the chats with the "never sent" note, and the chat's draft is empty), a new chat to a number
  that doesn't exist, the phone page reloaded and resumed with its conversations. Run on Chrome
  at 390×844 after the death note was added.
- `tools/e2e/tutorial-flow.ts`: the training with a first-time desktop and an emulated phone: the
  walk (on the keyboard), the target knocked down, R finding no spare, E on the phone, the pairing
  screen freeing the mouse without the pause menu, the QR pairing, the radio check on the phone,
  YK typed on its keyboard filling magazine and spare (12 + 12), *Go to the match* spawning the
  player; a second first-timer skipping the phone gets the no-phone texts in the match.
- `tools/e2e/virtual-phone-flow.ts`: a desktop without a phone opens the virtual phone from the Esc
  menu: it pairs as a virtual phone, the character has the phone out exactly while it shows, the
  keyboard types nothing, LATAA clicked on its keys refills 8 rounds to 12 + 12, and *Back to the
  game* locks the mouse again. The training's radio check also works on it (YK clicked).
- `tools/e2e/web-flow.ts`: the web version's static build (`npm run preview:web`): the LAN notice
  and *Bot match* on the main menu, sounds loaded from the build, no server connection and no
  failed requests; a first-timer's training with the virtual phone (no QR code shown), YK clicked;
  the bot match with 7 bots fighting; LATAA clicked on the virtual phone refilling 8 rounds to
  12 + 12. A voice note spliced in the page (9.2 s) and a Swedish line decode as audio.
  After the server code was split so the page can run it, `phone-flow.ts`,
  `virtual-phone-flow.ts` and `ladder-flow.ts` (all six stages, the voice note playing) were run
  again against a LAN server.
- `tools/e2e/inventory-flow.ts`: an inventory check on a desktop and an emulated phone: the
  countdown on both, a wrong answer in the typo feed, the right one earning a grenade, and a
  timed-out check in the typo feed with the push-ups.
- The dev panel from Esc and F2, in a browser on the server machine using its LAN address: *Add
  bot* adds a bot (before the fix the server ignored it).
- `tools/e2e/ladder-flow.ts`: all six ladder stages through the phone's own keyboard: codes read
  from the chat and typed, the upgrade screen, the office number opened by hand, the voice note
  fetched as a 9–10 s WAV with byte ranges and played, the serial number from the desktop, a
  Finnish answer to Nylands brigad told off in Swedish, TJ 0.
- The phone simulator: typing on the computer keyboard and Enter sends (KRANAATTI arrived).
- Network conditioner: with 50 ms each way and ±10 ms jitter, every claimed hit the server
  refused was a follow-up shot at a target that had just died (20 of 24 confirmed).
- A tab reloaded during a match rejoins the same player (same id and score).
- A fresh clone: `npm ci` and `npm start` build and serve the game, the phone page, sounds and
  voice lines; both end-to-end flows pass against that production build.

## 16-player load test

15 bots and this client on the garrison, production build, headed Chrome, 1920×1080, *High*
preset, all 15 bots in the world, 20 s (2,400 frames). Bots text the armourer, make typos and
chirp; the typo feed and kill feed are busy.

| | average | p95 | p99 | max |
|---|---|---|---|---|
| Frame interval (120 Hz display) | 8.33 ms | 9.6 ms | 10.2 ms | 10.4 ms |
| Main-thread time per frame | 1.55 ms | 1.9 ms | 2.2 ms | 7.4 ms |
| Server tick (60 Hz) | 0.20–0.38 ms | | | 1.34 ms |

About 130 draw calls and 0.38 M triangles. Shaders are compiled when a game starts, so nothing
compiles mid-fight (earlier hitches came from the test tool's screenshots, not the game).

## Not verified

- **Real phones.** I had no phones myself; the app was tested with Chrome's mobile emulation and
  WebKit. The host then ran Checkpoint B ([CHECKPOINT-B.md](CHECKPOINT-B.md)) with real players
  and phones and reported that the game worked smoothly; what they reported (the dev panel, the
  grenade, the ammo model) is changed above. The checklist's single items (screen-lock
  reconnects, the silent switch) weren't reported one by one, and the training hasn't been
  played on real phones yet.
- **Integrated GPUs and Windows hosts.** Performance was measured only on the M1 Max; the *Low*
  preset exists but hasn't been measured on weak hardware. Windows Firewall and guest-network
  advice in the README comes from documentation, not a test.
- **A full evening.** No session longer than a few rounds was played; the evening file was tested
  through unit tests and short runs.
- **Your recordings.** Only the machine-voice placeholders have been spliced; recordings in WAV
  at other rates and bit depths are handled by the splicer's code paths but haven't been heard.

## Defaults (all in `src/shared/config.ts`)

| Setting | Value |
|---|---|
| Movement | walk 5.2 m/s, sprint 7.6 m/s, crouch 2.6 m/s, gravity 18.5 m/s² |
| Pistol | 400 rpm cap, magazine 12, reload 1.2 s (empty 1.4 s), ADS 0.2 s |
| Rifle | 600 rpm, magazine 30, reload 1.35 s (empty 1.5 s), ADS 0.24 s |
| Ammo | one spare magazine per gun at spawn; LATAA fills magazines and spares |
| Damage, CoD preset | pistol 25 body / 50 head; rifle 20 → 17 body with range, 30 head |
| Damage, Scramble preset | pistol 17 / 34; rifle 13 → 11 / 20 |
| Player | 100 health, regeneration after 4.5 s at 40/s, respawn 2.5 s, spawn protection 1 s |
| Grenade | 2.5 s fuse from the G press (it can go off in the hand), pin pull 0.28 s, carry 1 (2 with Kranaattivyö), supply cooldown 15 s |
| Phone in hand | hip spread ×1.8 + 3.5°, recoil ×1.5, speed ×0.92, no ADS, raise 0.3 s |
| Rounds | 4 minutes, 12 s intermission; outer-ring gate opens above 8 players |
| Ladder | offer every 3 kills and every 3 deaths, +1 per 4 players above 6 |
| Inventory check | from the vääpeli every 90–180 s, never in the first 60 s in the match, 20 s to answer; a grenade for the right number, push-ups for none |
| Typo feed | one line per 1.5 s, at most 4 lines, fades after 6 s |
| Network | client state 60 Hz, snapshots 30 Hz, interpolation delay 50–250 ms (adaptive), rewind ≤ 200 ms |
