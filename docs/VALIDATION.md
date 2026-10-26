# Validation: what was tested, and what wasn't

The state at milestone 7. Everything below was run on a MacBook Pro M1 Max (macOS, Node 22.16,
Chrome 156 with ANGLE Metal, Playwright 1.64 with Chrome and WebKit).

## Automated tests (`npm test`): 107 passing

| Area | What the tests check |
|---|---|
| Collision and movement | Box traces against every brush kind, slide moves, steps, ground snap, crouch, jump, the ledge assist, identical results at any frame rate |
| Weapons | Fire rates, magazines, damage presets, recoil pattern, spread, reload timing, time to kill; the phone-out penalty (no ADS, wider hip spread) |
| Grenades | Bounces, fuse, blast blocked by cover |
| Range | Targets, drills, scoring |
| Garrison | Spawns and navigation points are clear of solids, the nav graph is connected, the gate brush |
| Match server | Rewind hits where the target was at the shooter's render time, cover blocks a claimed hit, fire rate and ammo caps, headshots, respawn, regeneration, reload refill timing, token rejoin, 15 bots fighting for a minute within the tick budget, rounds and intermission |
| Interpolation | Per-player timelines with state age, extrapolation cap, no blending across respawns, held states taking server-side changes, the adaptive delay and its render clock |
| Phone and varusmestari | Pairing by QR token and code, replacement with a notice on both, token resume, the simulator refused outside development; LATAA reloads only the sender, refuses a full magazine and never stacks; KRANAATTI carry limit and cooldown; duplicate request ids act once; requests from the dead, a previous life or an old round do nothing; a round restart; the PUNNERRETTU lockout; the typo feed's one-line-per-1.5 s rate limit preferring longer messages and keeping valid commands private; kill-feed drafts; the phone-in-hand flag exactly while a chat is open; command matching (case, spacing, punctuation, near misses, swearing, languages, greetings, numbers) |
| TJ ladder | First offer on the first kill or death, every 3rd kill and every 3rd death on separate counters, self-kills don't count; codes unique between players; one open task with a queue; every stage 1–6 including the office number opened by hand, the 17-digit number and its voice note, the serial number, the Swedish stage and "svara på svenska"; TJ 0; munkkikahvit; upgrade choice applied once; round reset; upgrade weapon numbers |
| Awards and evening | Each award to the right player, nothing for nothing, the evening scoreboard adding rounds, surviving a restart (file), leaving bots out |
| First-person hands | No glove vertex inside either weapon, no crossing triangles, in every held and reload pose (exact mesh test) |

## End-to-end, in real browsers

- `tools/e2e/two-desktops.ts`: two Chrome clients in one round. Hits in the open register and
  both clients agree on health; the kasarmi wall blocks all shots; kills and deaths agree.
- `tools/e2e/phone-flow.ts`: a desktop and an emulated touch phone (390×844, 375×667, 360×740, and
  once in WebKit, Safari's engine). Pairing by QR link, the sound check, the phone in hand while a
  chat is open and put away after sending, LATAA reloading the right player, a typo appearing in
  the desktop typo feed with the reply, a new chat to a number that doesn't exist, the phone page
  reloaded and resumed with its conversations.
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

- **Real phones.** No iPhone or Android device was available. The phone app was tested with
  Chrome's mobile emulation and WebKit at common portrait sizes. Still unproven on real devices:
  keeping the screen awake with the looping video, `<audio>` with the silent switch,
  reconnecting after a screen lock, touch latency, and the custom keyboard under fast thumbs.
  This is what Checkpoint B ([CHECKPOINT-B.md](CHECKPOINT-B.md)) is for.
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
| Damage, CoD preset | pistol 25 body / 50 head; rifle 20 → 17 body with range, 30 head |
| Damage, Scramble preset | pistol 17 / 34; rifle 13 → 11 / 20 |
| Player | 100 health, regeneration after 4.5 s at 40/s, respawn 2.5 s, spawn protection 1 s |
| Grenade | 2.5 s fuse, carry 1 (2 with Kranaattivyö), supply cooldown 15 s |
| Phone in hand | hip spread ×1.8 + 3.5°, recoil ×1.5, speed ×0.92, no ADS, raise 0.3 s |
| Rounds | 4 minutes, 12 s intermission; outer-ring gate opens above 8 players |
| Ladder | offer every 3 kills and every 3 deaths, +1 per 4 players above 6 |
| Typo feed | one line per 1.5 s, at most 4 lines, fades after 6 s |
| Network | client state 60 Hz, snapshots 30 Hz, interpolation delay 50–250 ms (adaptive), rewind ≤ 200 ms |
