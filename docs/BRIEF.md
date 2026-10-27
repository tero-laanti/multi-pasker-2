# MULTI-PASKER 2 — build brief

You have no prior conversation context; this brief is self-contained. Save a copy as `docs/BRIEF.md` in the project.

MULTI-PASKER 2 is a browser FPS for one LAN party: up to 16 Finnish players, each using a computer for combat and their own phone for weapon support. Players reload, get grenades and unlock upgrades by messaging a fictional army armourer, a *varusmestari*, in a fake messaging app on their phone. Reloading stays simple. Upgrades turn into escalating Finnish army bureaucracy: tongue twisters, transfers between offices, absurdly long numbers, voice notes spelled in the phonetic alphabet, and finally the Swedish-language brigade. Using the phone never pauses the game, and everyone can see who is on their phone.

Success criterion: the shooting is fun on its own, and the phone creates funny, visible moments of vulnerability that make everyone demand another round.

All player-facing text, on desktop and phone, is in Finnish.

## How to work

- Build the game. Do not stop at a plan, mockup or tech demo. The working directory is probably empty; if repository instructions exist, read them first.
- Work through the milestones in section 11 without asking for routine approval. There are exactly two planned stops (Checkpoints A and B) where you hand the game to the user for hands-on testing. The user is a native Finnish speaker and can playtest at any time.
- You cannot feel gunfeel, and a sandboxed environment cannot measure real frame rates or phone behaviour. Use measurable proxies, build tools that let the user tune quickly, and report honestly what you verified and what you did not.
- Initialise git and commit at the end of each milestone (push if a remote is configured). Every milestone ends in a runnable state.
- Keep all tuning values in one config module and all Finnish text in one editable script/data file, so the user can tune and rewrite without touching logic.
- Use sensible defaults for anything unspecified and list them in your final report.
- Keep code and comments about the current implementation; no historical commentary about removed approaches.

Priority order when trade-offs arise:

1. Excellent Call of Duty–style gunfeel, including over the LAN.
2. A reliable, easy computer-and-phone experience.
3. The complete varusmestari mechanic.
4. Visual and audio polish.

If time runs short, cut from the end: awards, then ladder stage 6, then stage 5. Never cut the gunfeel, the phone keyboard or pairing.

## 1. Step 0: choose the stack (first, keep it short)

Before writing the game, decide the client engine and the server runtime. Hard constraints:

- Desktop players use a desktop browser (Chrome/Edge primary, Firefox best-effort). No installs.
- The phone UI is a web page served by the same server.
- One server process on one port serves the desktop client, the phone UI and the real-time connections. The host machine runs macOS or Windows; the server must be easy to install and start there, and scripts must be cross-platform.
- Plain HTTP on the LAN. Features that need a secure context or cross-origin isolation (Wake Lock, async Clipboard, SharedArrayBuffer, Keyboard Lock) are unavailable to guest machines.
- The server validates shots against the same collision world as the client, so the collision code must run headlessly on the server and agree with the client's. Where practical, define the map as data shared by client and server for both rendering and collision.
- Up to 16 players on mixed laptops, some with integrated graphics, over Wi-Fi.
- You build everything from code and the command line; nothing may depend on a GUI editor.
- Gunfeel systems (movement, recoil, ADS, viewmodel) are custom code whatever the engine.

**Client engine:** evaluate at least Three.js (paired with a collision/physics library such as Rapier), Babylon.js, PlayCanvas (engine only) and Godot 4's web export. Native builds are out of scope. Wrapping the web build in Electron is a possible later fallback if browser frame-rate caps hurt; note it, don't build it.

**Server runtime:** evaluate at least Node.js, Bun and Deno with TypeScript (sharing code with the client), Rust (for example native Rapier on the server with Rapier's WASM build on the client), Go, and a headless build of the client engine where one exists (such as Godot's). A multiplayer framework such as Colyseus is fine if it helps rather than constrains. Weigh how much code the server can share with the client (protocol, map, collision, chat script, validation), how easy it is to install and start on a macOS or Windows host, tick timing at 30–60 Hz, testability, and how quickly you can iterate. Any of these handles 16 players easily, so raw performance is unlikely to decide it.

Client criteria: input latency and pointer-lock control (including `unadjustedMovement`), rendering performance on weak GPUs, headless collision on the server, character-controller and physics quality, spatial audio, download size over the LAN, glTF pipeline, TypeScript support, maturity and documentation, and how well you can build and debug it without an editor.

Research from documentation and your own knowledge. If a question can only be settled empirically, build a throwaway spike of at most ~100 lines. Spend only a small fraction of the project here. Write a one-page decision record to `docs/STACK.md` covering both choices (options, criteria, decision, risks), then proceed without waiting for approval. Use TypeScript for browser code unless the chosen engine makes that impractical. Pin exact dependency versions.

## 2. Setup, LAN and networking

- After installing dependencies, one documented command starts everything.
- The server prints useful join URLs. It detects the LAN address while ignoring virtual adapters (VPN, WSL, Docker, VirtualBox); the address can be overridden by flag or environment variable. QR codes and printed URLs never use `localhost` or `0.0.0.0`.
- Bundle every runtime asset. Nothing loads from a CDN or external service during a match.
- No accounts, database or phone app installation. Small local JSON files for persistence are fine.
- Computers and phones will be on fast, stable Wi-Fi, not wired.

Networking is tuned for feel, with no anti-cheat; it is a room of friends.

- Each client owns its own movement and camera: immediate, with no server reconciliation. The server sanity-checks speed and collision only to catch bugs.
- Remote players are interpolated with an adaptive buffer sized to measured jitter. Start around 30 Hz snapshots and tune.
- Hit detection favours the shooter: the client reports hits, and the server validates them against a bounded history of player positions (rewind of at most ~200 ms) and line of sight through the static collision world. Cover must block shots.
- The server owns health, damage, ammunition, grenades, score, upgrades, challenge validation and round timing.
- WebSocket transport only: no long-polling fallback and no per-message compression. Use whichever WebSocket library suits the chosen server.
- Stable player identity via a token, so a reloaded desktop tab or phone rejoins its player without restarting the match. Player departure and phone disconnection are visible to others.
- Phone actions carry request IDs and are validated against player, round, challenge and life. Retries never duplicate grenades or upgrades. Requests from an old round or a previous life have no effect.
- A dev network conditioner (added latency and jitter) tests interpolation and rewind.

## 3. Gunfeel and weapons

Controls: WASD move, mouse look, left mouse fire, right mouse aim down sights, Shift sprint, Space jump, **C crouch** (not Ctrl: Ctrl+W closes the tab on Windows and cannot be blocked over HTTP), G throw grenade, 1/2 and mouse wheel switch weapon, I inspect weapon, Tab scoreboard. R shows a reminder to message the varusmestari; it must not reload. Add a `beforeunload` confirmation during matches.

Requirements:

- Pointer lock with raw input where supported (`unadjustedMovement`), adjustable sensitivity and no smoothing.
- Responsive acceleration and deceleration, dependable collision, stable grounded movement, and identical behaviour at any frame rate (fixed-step simulation).
- Hitscan with accurate first shots and a readable, learnable recoil pattern.
- Smooth ADS with aligned sights (target ~200–250 ms); sprint-to-fire ~150–200 ms.
- Sharp weapon kick, restrained camera recoil, subtle sway and clean recovery.
- A punchy reload animation (~1.2–1.5 s) with mechanical audio and a clear refill moment.
- Layered firing audio, spatial enemy shots and footsteps, impact effects, distinct hit and headshot confirmation, and clear kill feedback. Wall impacts look and sound different from player hits.
- Damage feedback that never prevents aiming.
- Shots fire from the eye, the weapon model never clips through walls, and you cannot shoot through a wall you are pressed against.

Weapons (starting values; tune by playing, not by screenshots):

| | Pistooli (inspired by Lahti L-35) | Rynnäkkökivääri (inspired by Rk 62) |
|---|---|---|
| Obtained | spawn weapon, kept as sidearm | first upgrade |
| Fire | semi-auto, ~400 rpm cap | automatic, 600 rpm |
| Magazine | 12 (try the authentic 8 in playtests) | 30 |
| Damage body / head | 25 / 50 | 20 / 30 up close, body falling to ~17 at range |
| Ideal kill time | 0.45 s body, 0.15 s head | 0.4 s body, 0.3 s head |

- 100 health. Regeneration starts after ~4–5 s without damage.
- A dev "kill speed" preset switch: *CoD* (the values above) and *Scramble* (~0.7–0.8 s body kill time), so both can be compared in one session.
- Each life starts with full magazines in both weapons.
- `Lataa` refills the weapon in your hands. Weapon switching is quick: running dry and switching to the pistol is a core moment.
- Inspect (I, ~1.5 s, no firing meanwhile): the weapon turns to show an *SA* stamp and a 6-digit serial number, random per player per round and readable at 1080p. Each weapon has its own serial.
- Grenade: one frag type, ~2.5 s fuse, bounces off the collision world, at most 1 carried (2 with an upgrade), with a configurable supply cooldown.
- The first-person weapons must read as properly designed guns, not tubes. Use gloved first-person hands if they look convincing; go handless only if it looks deliberate.

## 4. Match, map and players

- Free-for-all deathmatch for 2–16 players. Do not build team modes, but don't make them hard to add later.
- Player names use letters (including Å, Ä, Ö) and digits, up to 12 characters, so they can be typed on the phone keyboard.
- 4-minute rounds, quick respawns (~2–3 s), a scoreboard that fits 16, end-of-round awards (section 8) and an immediate rematch. An evening scoreboard accumulates across rounds and survives a server restart (local JSON).
- Spawn selection avoids enemy line of sight. Spawn protection lasts ~1 s and ends when you fire. There are no phone safe zones, and using the phone grants no immunity.
- Map: a summer Finnish garrison (*varuskunta*). The core has a kasarmi, the asevarasto and the sotku around a paraatikenttä with a flagpole landmark, plus an esterata as a flanking route. An outer ring has a telttaleiri (tents with a kamina) and a forest edge. A gate with a *puomi* opens the outer ring when more than ~8 players are in the match. Short fights, readable cover, two flanking routes per area, and corners where you can briefly hide to type, but nowhere truly safe.
- Players must read clearly against greenery and concrete; no camouflage that blends in. Identify players by name tags and a per-player accent colour; do not rely on 16 distinguishable hues.
- Solo modes: *Ampumarata*, a shooting range with moving targets and range commands such as "Tuli vapaa!" and "Tulitauko!", plus bots. Bots can fill up to 15 slots; they exist to test combat, phone distractions and 16-player load.
- Performance at 16 players: pool and cap effects (for example at most ~24 simultaneous gunshot sounds, nearest first, and capped decals and particles). Avoid runtime shader recompiles; in Three.js, changing the number of lights causes them, so use a fixed light pool or fake muzzle-flash lighting. Provide quality presets for integrated GPUs.

## 5. The phone

The phone page is a convincing but fictional Finnish messaging app that copies no real app's branding. It has a conversation list, unread badges, history, a compose field, send, delivery states (*Lähetetty / Toimitettu / Luettu*), a typing indicator ("Asevarasto kirjoittaa…"), a voice-note player, and a way to start a new conversation by entering a number. It fits common portrait phone sizes, and touch targets and scrolling feel polished.

- **Custom in-page keyboard.** Players type on our own Finnish QWERTY keyboard (with Å, Ä, Ö and a number pad), never the operating system's keyboard. This guarantees no autocorrect, predictive text, swipe typing, text replacements or paste, and gives the server every keystroke. Keys respond on touch start, show key previews and feel instant.
- Starting a new conversation opens the number pad as a half-height sheet, so the message containing the number stays readable above it. There is no copy/paste.
- Numbers are fictional identifiers only. Long ones have 17 digits, longer than any real phone number can be. Short ones avoid emergency and service prefixes (112, 116…, 118, 0800…). Add `<meta name="format-detection" content="telephone=no">`.
- Keep the screen awake with the hidden looping-video technique, started by a tap during pairing; the Wake Lock API is not available over HTTP.
- Voice notes play through an `<audio>` element so they work with the iPhone silent switch on. Tap to play, replayable, with progress.
- Pairing: each desktop shows a QR code that pairs a phone to that specific player, plus a manual fallback with a short code. The phone confirms which player it belongs to and runs a sound check. One phone per player; pairing a new phone replaces the old one, with a notice on both.
- Reconnecting or reloading the phone restores conversations, the current challenge, inventory and upgrades. iPhones drop the connection when the screen locks, so resume quickly.
- The phone streams its current draft and touch activity to the server, for the phone glow and the kill feed.
- A development-only desktop phone simulator uses the same protocol and validation and accepts a physical keyboard. It is not available in normal matches.

## 6. The varusmestari

The armourer is a bored, gruff *varusmestari* at the asevarasto. Go overboard with Finnish military and conscript culture: *kiire odottamaan*, *kokoa ei ole, ota mikä on*, TJ and aamut, the sotku, hernekeitto torstaisin, the palvelusohjesääntö. Write natural spoken army Finnish, not translated Finnish; the user will review and edit the script file. Use a scripted, stateful system: no live AI and no real SMS.

Core commands, typed manually and predictable for the whole round:

- `Lataa` starts a short reload of the weapon in your hands.
- `Kranaatti` supplies one grenade, subject to the carry limit and cooldown. It is thrown on the computer with G.

Matching is case-insensitive and tolerant of extra whitespace and punctuation, and otherwise exact. Spamming cannot stack reloads or stockpile grenades. Every service requires being alive; requests sent while dead are refused and never queued.

Authored replies cover everything else. Vary the wording; starter examples:

- Near-miss typo → "Tarkoititko LATAA? Täällä ei arvailla."
- Swearing → "Alokas! Kieli! Punnerra kymmenen ja ilmoita: PUNNERRETTU." All service is locked until the player sends `PUNNERRETTU`.
- `?` → "Kiire odottamaan."
- `apua` → "Apua jaetaan torstaisin hernekeiton yhteydessä."
- English → "Puolustusvoimissa puhutaan suomea. Tai ruotsia."
- While dead → "Kaatuneita ei palvella."
- `Kranaatti` at the carry limit → "Yksi per mies."
- `Lataa` with a full magazine → "Lipas on täynnä. Ammu ensin, alokas."
- Also cover greetings, thanks, numbers only, spam, and the right code sent to the wrong conversation.

Important instructions stay available in the conversation history.

## 7. Upgrades and the TJ ladder

**Triggers** are per player, not a shared clock:

- The first offer comes on the player's first kill or first death. Completing stage 1 always delivers the rifle; there is no choice.
- After that, an offer comes every 3rd kill (*Kunniamaininta*) and every 3rd death (*Vahinkoilmoitus käsitelty*). These are two independent counters, so leaders and strugglers progress at similar rates. Self-kills don't count. Thresholds are configurable and scale up with player count.
- One open challenge at a time; further offers queue ("Jonossa: 2"). An unfinished challenge stays valid through deaths. Nothing carries into the next round.

**Upgrade screen.** Completing stages 2–6 opens a phone screen ("Kokoa ei ole, ota mikä on.") with three random eligible choices. It shows the exact benefit before the player confirms; tapping a choice is fine here. It never takes over the desktop. The desktop shows a brief confirmation and, where practical, a visible attachment.

| Parannus | Effect | Levels |
|---|---|---|
| Pidennetty lipas | rifle magazine 30 → 40 → 50 | 2 |
| Suujarru | recoil −25 % / −40 % | 2 |
| Kevennetty lukko | 600 → 700 → 800 rpm | 2 |
| Vaimennin | quieter, no muzzle flash, smaller audible radius; visible on the model | 1 |
| Kranaattivyö | carry 2 grenades | 1 |
| Tumma tila | others can't see your phone glow | 1 |
| Pikavalinta | `L` works as Lataa and `K` as Kranaatti | 1 |
| Sotkun munkkikahvit | the next challenge is completed by sending `KIITOS` in the Asevarasto chat | 1 |
| Rumpulipas | 75-round drum magazine; visible on the model; offered only on the stage 5 and 6 screens | 1 |

Completed upgrades persist through deaths and reset each round. The server and all clients apply them consistently.

**The ladder.** Each completed stage promotes the player (alokas → sotamies → korpraali → alikersantti → kersantti → ylikersantti → vääpeli) and counts down from TJ 6 to TJ 0. The varusmestari addresses players by rank. Each stage draws its challenge from a random pool and has 2–3 variants of the surrounding text, so rounds don't repeat. Codes are unique per player within a round wherever the pool allows.

| Stage | Where | Challenge |
|---|---|---|
| 1 | Asevarasto | one word: `KUITTAAN` / `SELVÄ` / `UUDISTUS` / `VASTAANOTETTU` |
| 2 | Asevarasto | `PYYDÄN LUPAA PUHUTELLA` / `HERRA KERSANTTI <ARVO> <NIMI>` (the player's current rank and name) / `UUDENLAINEN UUDISTUS` / `VESIHIISI SIHISI HISSISSÄ` / `MUSTAN KISSAN PAKSUT POSKET` / `KOKOO KOKOON KOKO KOKKO` |
| 3 | "Ei kuulu meille." Transfer to an office (Komppanian toimisto / Esikunta / Huolto-osasto) at a new short number | a phrase such as `HALUAN PAREMMAN ASEEN`, or a code word buried in a wall of *palvelusohjesääntö* text |
| 4 | Transfer to the Huoltopäällikkö at a 17-digit "+358" number | a voice note spelling the code in the Finnish phonetic alphabet: "Tunnus: Kalle, Eemeli, Tyyne, Tyyne, Urho." (KETTU) |
| 5 | Huoltopäällikkö: "Ennen luovutusta…" | "Ilmoita aseesi numero." The player inspects (I) and reads the serial. Variants: the last three digits, reversed, or the pistol's number |
| 6 | Transfer to Nylands brigad | a Swedish voice note: "Hej! Koden är ÄLG." Answering in Finnish gets "Svara på svenska, tack." |
| TJ 0 | — | "TJ 0. Kotiutettu. Asevarasto on suljettu." `Lataa` and `Kranaatti` keep working |

The player must perform every contact change themselves; never auto-open a target conversation. If an offer arrives while an earlier challenge is unfinished, keep the earlier one valid and queue the next clearly. Never overwrite instructions or silently invalidate a code.

Finnish phonetic alphabet: Aarne, Bertta, Celsius, Daavid, Eemeli, Faarao, Gideon, Heikki, Iivari, Jussi, Kalle, Lauri, Matti, Niilo, Otto, Paavo, Kuu, Risto, Sakari, Tyyne, Urho, Vihtori, Wiski, Äksä, Yrjö, Tseta, Åke, Äiti, Öljy.

## 8. Public shame

- **Phone glow:** when a player has touched their phone within the last ~2.5 s, their character visibly holds a glowing phone. It is readable at combat range but not a beacon across the map. *Tumma tila* hides it.
- **Kill feed with drafts:** if the victim was typing, the kill feed shows their unfinished message: *"Alik. Mikko ➜ Alok. Tero — kirjoitti: 'pyydän lupaa puh'"*.
- **Public typo feed:** every phone message that isn't valid in its conversation (typos, off-script text, the right code in the wrong chat, messages while dead, swearing) appears on every desktop together with the varusmestari's reply:

  > **Tero → Asevarasto:** kranaati
  > **Asevarasto:** Tarkoititko KRANAATTI? Täällä ei arvailla.

  Correct commands stay private. The feed sits bottom-left, away from the crosshair, fades after ~6 s and shows at most ~4 lines. A global rate limit allows about one line per 1.5 s and prefers longer messages.
- **End-of-round awards:** *Lomille ensimmäisenä* (winner), *Kaatui kesken viestin* (most deaths while typing), *Pisin keskeneräinen viesti* (shows the draft), *Kirjoitusvirheiden kuningas*, *Kiire odottamaan* (most time on the phone), *Punnerruskuningas* and *Pakkoruotsin sankari*.
- Optional, only after everything else works: a positional notification chirp that nearby enemies can hear when your phone receives a message.

## 9. Presentation and audio

- Summer garrison: strong daylight and good shadows; pale concrete, red-brick or ochre buildings, gunmetal, birch and spruce, with a touch of hazard yellow at the asevarasto. Stylised but intentional, with composed landmarks and clear sightlines.
- Prioritise the first-person weapons: their lighting and animation, muzzle flash, impacts and sound. Keep effects restrained so enemies and sights stay readable.
- Compact desktop HUD: crosshair, health, ammo, grenade, score, time, rank and TJ, plus a small indicator for an open challenge. Instructions live on the phone; desktop notifications stay brief.
- Volume controls (master and effects), and a sound check during phone pairing.
- Any assets may be used, since nothing leaves the room: for example Kenney, Quaternius, Poly Haven, ambientCG, Freesound or Sonniss packs, or assets you create. Bundle everything locally.
- **Voice recordings:** the user will record the voice lines. Generate clearly marked placeholders with an offline TTS (for example Piper's Finnish voice or espeak-ng) so everything works now. Write `docs/RECORDING.md` listing every line with its exact filename: the 29 phonetic-alphabet words, voice-note intros and outros (3 variants each), Swedish voice notes (~12 code words) and the range commands. Recordings dropped into the voice folder replace placeholders without code changes. Phonetic-alphabet voice notes are spliced from the recorded words, so any code word works.

## 10. Dev tools

- The phone simulator (section 5).
- A dev panel to trigger an offer, advance the ladder, restart the round, add or remove bots, inspect connections, switch the kill-speed preset and run the network conditioner.
- A live tuning panel for every gun and movement value, with export to the config.
- An F3 overlay showing a frame-time graph, round-trip time, jitter, snapshot rate, interpolation delay and server tick time.

## 11. Milestones

0. Stack decision (section 1).
1. Ampumarata with the pistol: movement, collision, ADS, recoil, impacts, sound, moving targets, the tuning panel and the F3 overlay.
   **Checkpoint A: stop and ask the user to play the range.** Give exact run instructions and say what feedback you want. Continue after feedback.
2. The rifle, weapon switching, inspect with serial numbers, and grenade throwing (granted from the dev panel for now).
3. LAN combat: server, join flow, interpolation, shooter-favoured hits with rewind, damage, death, respawn, spawn logic, kill feed and scoreboard. Bots, and a 16-player load test.
4. The phone: pairing, the custom keyboard, the messaging app, the Lataa/Kranaatti loop, the phone glow, kill-feed drafts, the typo feed and reconnects.
   **Checkpoint B: stop and ask the user for a real-device test with at least 4 players and their phones.** Provide a test script. Continue after feedback.
5. Upgrade triggers, the upgrade screen, ladder stages 1–4, ranks and TJ, and voice-note splicing.
6. Stages 5–6, awards and the evening scoreboard.
7. The garrison map with the outer-ring gate, presentation and audio polish, reconnect hardening, and final validation.

## 12. Validation and deliverables

Verify the following, using focused automated tests for the stateful server logic and command validation, plus browser testing of the actual game:

- A fresh install and the one-command start.
- Two or more desktop clients sharing a round with consistent damage and score, and hits blocked by cover.
- A 16-player load test with bots: frame time on your machine (state the hardware and browser) and server tick time.
- Phones, real or simulated, paired to the correct players; reload and grenade requests affect only the correct player.
- Every ladder stage, including both number transfers, voice playback, inspect serials and the Swedish stage.
- Phone interaction while desktop play continues, and a phone reload or reconnect restoring state.
- Duplicate sends, death during a request, a round restart, and a late request from an old round.
- The PUNNERRETTU lockout, the typo feed's rate limit and kill-feed drafts.
- The phone layout at common portrait sizes.

If real iOS or Android devices aren't available to you, test responsive layouts and say so. Simulated phones do not prove real-device behaviour.

Deliver:

- The runnable project with all assets bundled.
- A README covering setup, LAN instructions, troubleshooting (Windows Firewall blocking connections on networks marked "Public", guest Wi-Fi client isolation, choosing the LAN address), controls and a short technical overview.
- `docs/STACK.md` and `docs/RECORDING.md`.
- A clear account of what was tested and what remains.
