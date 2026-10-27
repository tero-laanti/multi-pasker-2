# Validation: what was tested, and what wasn't

The state after the Checkpoint B feedback (milestone 7 plus the training, spare magazines and
held grenades). Everything below was run on a MacBook Pro M1 Max (macOS, Node 22.16,
Chrome 156 with ANGLE Metal, Playwright 1.64 with Chrome and WebKit).

## Automated tests (`npm test`): 158 passing

| Area | What the tests check |
|---|---|
| Collision and movement | Box traces against every brush kind, slide moves, steps, ground snap, crouch, jump, the ledge assist, identical results at any frame rate |
| Weapons | Fire rates, magazines, damage presets, recoil pattern, spread, reload timing, time to kill; the phone-out penalty (no ADS, wider hip spread); the spare magazine (R takes it once, an empty trigger reloads, nothing left clicks) |
| Grenades | Bounces, fuse, blast blocked by cover; the fuse burns from the G press, so a held grenade lands with less of it and one held too long goes off in the hand (a self-kill); a player shot with the pin out drops it, still burning; paused while holding it, it falls |
| Range | Targets, drills, scoring |
| Garrison | Spawns and navigation points are clear of solids, the nav graph is connected, the gate brushes; bots find a way into the tent camp (and back, and through the back gate) only while the gates are open; bots reach the Veksi waiting room, corridor, ward and yard; every spawn faces into the map. In Chrome: the Veksi from the street and the side door, its lobby and ward, the back gate |
| Match server | Rewind hits where the target was at the shooter's render time, cover blocks a claimed hit, fire rate and ammo caps, headshots, respawn, regeneration, reload refill timing, R taking only what the magazine needs from the spare, LATAA filling every magazine and spare (also during an R reload), token rejoin, 15 bots fighting for a minute within the tick budget, rounds and intermission; a browser on the server machine counts as the host by any of its addresses |
| Training | A first-timer stays out of the match (no spawn, no snapshots, not counted, no awards or evening) until they deploy; the radio check sent when the phone is picked up (or right away if already paired), just "YK"; the first other reply gets the explanation and later ones the tellings-off, only YK answers it, then LATAA and KRANAATTI work for the range's guns |
| Knife | Reach: a body in front within arm's length is reached, standing or crouched, but not one behind, beside or too far; the nearest of two takes the stab. Server: two stabs kill from full health and the kill is the knife's; a second stab too soon is ignored; no damage out of reach, through a wall, facing away or on spawn protection. Client: the stab lands once, at its moment, no shots while the knife is out, the gun ready again after; refused while reloading or holding a grenade. The hand holds it in a saber grip (the handle across the palm, the thumb along its back) and keeps clear of it. In Chrome: the stab in first person with both guns, the back of the hand up and the forearm coming in from the lower right |
| Minimap | Turned so the view points up (north, west and east views); a box seen from above is its four corners; the garrison gives walls, low cover, floors and fences, never the ground, anything starting above head height (roofs, lintels over doorways) or tree trunks. In Chrome: north on the rim and test shots straight ahead at the top while facing north, east and south, the closed gate as a red bar, bots' shots as red dots, hidden when turned off in the settings, and the same in the web version's bot match |
| Interpolation | Per-player timelines with state age, extrapolation cap, no blending across respawns, held states taking server-side changes, the adaptive delay and its render clock |
| Phone and varusmestari | Pairing by QR token and code, replacement with a notice on both, token resume, the simulator refused outside development; LATAA refills only the sender, refuses when everything is full and never stacks; KRANAATTI carry limit and cooldown; duplicate request ids act once; requests from the dead, a previous life or an old round do nothing; a round restart; the PUNNERRETTU lockout; the typo feed's one-line-per-1.5 s rate limit preferring longer messages and keeping valid commands private; kill-feed drafts; a death with the phone out tells the phone who did it and what never got sent (nothing when the phone was away); the phone-in-hand flag exactly while a chat is open; command matching (case, spacing, punctuation, near misses, swearing, languages, greetings, numbers) |
| Inventory check | From the vääpeli, in his own chat, never in a player's first minute in the match; asked only of the living with a connected phone during a round; the answer time starts when the question arrives; the number when asked or when answered counts; a right answer gives a grenade and closes it, a wrong one keeps it open, a timeout locks the phone until PUNNERRETTU; bots answer (mostly right) and report their push-ups |
| Messages | One new message per chat: an unasked-for message waits until the one before has been read (a piece of gear and its paperwork arrive as one message; the radio check waits behind an unread welcome); replies are never held back |
| Service | Päiväraha 5 / 10 / 15 € a day in its bands (3,105 € for the whole service, a kill across a band boundary paid day by day, nothing after TJ 0); ranks by days served; a kill serves 3 days and pays the killer (shown under the kill), the victim serves 1, suicides nothing, killing someone with a lower TJ 1 more; the rifle's paperwork on the first kill or death, kept over a new round; codes unique between players; P-kausi's gear on days 1, 10, 20 and 30, one paperwork at a time in order; the office opened by hand and the code in the wrong chat; the supply chief's voice note from a 17-digit number; the company commander's text once 42 days are served and P-kausi's four pieces of gear signed for, opening the shop with 210 € (the shop shut until both; the dev skip hands the gear over with the days, so nothing waits behind P-kausi's paperwork; the shop shows which paperwork is open and where); the pay rises texted only to that player, with the promotions; the shop's checks (shut in P-kausi, needs, money), row I at once and the rest after paperwork; the café's munkki (KIITOS does the paperwork) and nakkisuoja (skips an inventory check); TJ 0 through Nylands brigad in Swedish, the star and a free pick; the service kept by name in the evening file over a server restart, and reset by a new evening; every node of the tree reachable, the tree costing more than two services |
| Sotku gear | Pistol magazine, full auto, quicker draw, the light kit's speed and hollow points (+50 %: 37 per body hit, 25 without); the red dot's quicker and steadier aiming; more shrapnel's damage and the heavier charge's reach; the sniper rifle's headshot kills; rifle magazines and drum; the one-stab knife kills from full health; LENNOKKI and TULI only for those who bought them, once a round, the mortar's three rounds landing and blasting |
| Matches | The host's number of rounds: a break with no awards between rounds, kills and the service carried over, then the match's awards and its winner on the evening's list; the next match resets TJ, money, gear, kills and the match's chats (only the asevarasto's and the vääpeli's stay, with a divider); nobody hurt between rounds; fewer rounds set mid-match end it after the current round; the host's settings take only offered choices, keep the bots at the number, use the days per kill at once, and only the host may change them |
| Awards and evening | Each award to the right player, nothing for nothing, ties broken as on the scoreboard; who won each match and the host's settings surviving a restart (file); a new evening clearing the winners but not the settings |
| First-person hands | Every pose builds; fingers bend only towards the palm and within joint limits; no wrist bends past a wrist's range (30° towards the little finger, 15° towards the thumb, 45° back or forward); left hands are true mirror images; no glove sinks more than 2.5 mm into the gun, phone, knife or grenade it holds (exact mesh distance) |

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
  `virtual-phone-flow.ts` and the old ladder flow (all six stages, the voice note playing) were
  run again against a LAN server.
- `tools/e2e/inventory-flow.ts`: an inventory check on a desktop and an emulated phone: the
  countdown on both, a wrong answer in the typo feed, the right one earning a grenade, and a
  timed-out check in the typo feed with the push-ups.
- The dev panel from Esc and F2, in a browser on the server machine using its LAN address: *Add
  bot* adds a bot (before the fix the server ignored it).
- `tools/e2e/match-flow.ts`: a match from the host's seat: *Match settings* in the pause menu (2
  rounds, 5 bots, applied at once), "Round 1/2" on the HUD, the break after round 1 with the
  leader, *Match over* with the winner, the awards and the evening's list after round 2 (the
  winner line matching the awards), and the next match at TJ 347 with "Round 1/2".
- `tools/e2e/service-flow.ts`: the service through a desktop and an emulated phone: the Chats |
  Sotku tab bar, the shop locked in P-kausi (day 0 of 42, gear 0 of 4), the rifle's code read from
  the chat and typed, the shop still shut until the rest of P-kausi's gear is signed for, then the
  company commander's text and the shop opening with 210 €, the Tarkka-ampuja
  path's tree with its lines, the buy sheet and a row I purchase handed over at once (the desktop's
  recoil upgrade), "+15 €" under a kill confirmation, Automaattitäyttö's chip with the code from
  the message and the armoury's commands (tapping it fills the field), munkkikahvit skipping
  paperwork on the way to the sniper rifle (the red dot, the suppressor and the magazines first),
  the sniper rifle on key 3 at the hip and through its scope. Run with no bots in the match: one
  shot the player mid-message once and the phone's "Message not delivered" note stopped the run.
- Screenshots in Chrome on the range: the red dot sight on the rifle at the hip and aimed (the dot
  on the crosshair, the front post just under it, the rear sight taken off for it); the grenade
  in the left hand from the pin to the throw, with the rifle and with the pistol (the thumb across
  the spoon, the forearm out of view, the hand dropping away after the release and the rifle's
  support hand back on it); Hyvä heittäjä's dotted path with its bounces and the ring where the
  grenade stops (into the firing-line table when aimed low); the knife's stab with the back of the
  hand up. `tutorial-flow.ts`: the radio check is just "YK" and the reply is in English. The old ladder flow (all six stages through the phone's keyboard, the voice note fetched
  as a 9–10 s WAV with byte ranges and played) ran before the ladder became the service.
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
| Player | 100 health, regeneration after 4.5 s at 40/s, respawn 3 s (any number of times in a round), spawn protection 1 s |
| Grenade | 2.5 s fuse from the G press (it can go off in the hand), pin pull 0.28 s, carry 1 (2 with Kranaattivyö, 3 with Kolmas kranaatti), supply cooldown 15 s |
| Phone in hand | hip spread ×1.8 + 3.5°, recoil ×1.5, speed ×0.92, no ADS, raise 0.3 s |
| Matches | 6 rounds of 4 minutes, 12 s between rounds, 20 s of results; the host can pick 1–12 rounds, 2–10 minutes, 2–6 days per kill, 0–15 bots and the kill speed; outer-ring gate opens above 8 players |
| Service | TJ 347; a kill 3 days, a death 1, killing someone with a lower TJ +1; päiväraha 5 € (days 1–165), 10 € (166–255), 15 € (256–347); P-kausi 42 days, gear on days 1, 10, 20, 30; the shop opens when both are done |
| Sotku | four paths of six nodes, 7,190 € in all; row I at once, rows II–IV after paperwork; munkkikahvit 30 €, nakkisuoja 40 € |
| Sniper rifle | 48 rpm (bolt action), 5 rounds, 90 body / 200 head, 4× scope, hip spread 6° |
| Inventory check | from the vääpeli every 90–180 s, never in the first 60 s in the match, 20 s to answer; a grenade for the right number, push-ups for none |
| Typo feed | one line per 1.5 s, at most 4 lines, fades after 6 s |
| Network | client state 60 Hz, snapshots 30 Hz, interpolation delay 50–250 ms (adaptive), rewind ≤ 200 ms |
