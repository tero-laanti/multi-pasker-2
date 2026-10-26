# Checkpoint B: real-device test

Goal: four or more players, each with a computer and their own phone, play a few rounds and
check that pairing, the phone keyboard, the varusmestari (LATAA / KRANAATTI), the phone in
hand, the typo feed and reconnects work on real devices. About 30 minutes.

## Before you start (host)

1. On the host machine: `npm install`, then `npm start`. Note the address it prints
   (`Players: open http://192.168.x.y:8088/`).
2. Everyone, computers **and phones**, on the same Wi-Fi. Not a guest network: those usually
   stop devices from seeing each other. Phones on mobile data cannot reach the server.
3. Optional, for a busier match: `PASKER_BOTS=6 npm start` (Windows: `set PASKER_BOTS=6` first).
   Bots also text the armourer, make typos and die mid-message.
4. Until everyone has paired, the host can press F2 and tick *R reloads directly* if needed;
   untick it for the phone test.

## Each player (2 minutes)

1. Computer: open the printed address in Chrome or Edge → **Join game** → type a name → Join.
2. The *Click to play* screen shows a QR code. Point the phone's camera at it and open the link.
   If the camera won't open it: on the phone, go to `http://192.168.x.y:8088/phone` and type the
   4-digit code shown under the QR code.
3. Phone: check it says **This phone belongs to <your name>** → **Start** → you should hear a
   chime → **Yes, I heard it**.
4. Turn the phone's volume up. Put the phone on the desk next to the keyboard.
5. Click the game view to play.

## Test script

### A. Pairing and reconnects (5 min)

- [ ] Every phone shows its own player's name.
- [ ] One player scans their QR code with a second phone: the first phone says it was replaced,
      and that player's computer says *Phone paired. It replaced your previous phone.*
      (Go back to the first phone afterwards the same way.)
- [ ] Lock a phone for ~20 s and unlock it: the chats are still there and it reconnects by itself.
      How long did it take?
- [ ] Reload the phone page: tap Start again; conversations are still there.
- [ ] Reload a computer's game tab: it comes back as the same player with the same score, and the
      phone stays paired.
- [ ] Does the phone screen stay on while you play (it should not dim or lock)?

### B. LATAA and KRANAATTI (8 min)

- [ ] Shoot part of a magazine. On the phone open **Asevarasto**, type `lataa`, send. The phone
      shows *Sending…* and goes back to the chat list, and **your** gun reloads on your computer,
      nobody else's.
- [ ] While a chat is open, your character holds the phone: others should see it in your hand
      (look at each other). Your hip fire spreads much wider and right-click aiming doesn't work.
      Leaving the chat (or sending) puts the phone away.
- [ ] `Kranaatti`: a grenade appears on your HUD; throw it with G. Ask again right away:
      *Yksi per mies.* Throw it, ask again: the armourer makes you wait.
- [ ] `lataa` with a full magazine: *Lipas on täynnä…* and nothing happens.
- [ ] Get killed (or F2 → *Kill me* on the host computer) and send `lataa` while dead:
      *Kaatuneita ei palvella.*, and nothing happens after you respawn.
- [ ] Mash send several times in a row: no double reloads, no extra grenades.
- [ ] Try typing fast with both thumbs: are any key presses lost? Do keys feel instant?
- [ ] Open a new chat with **+** (in the list or in a conversation), type any number, send a message:
      it bounces (*Numeroa ei ole olemassa.*).

### C. Public shame (5 min)

- [ ] Send typos (`lataaa`, `kranaati`), `moi`, `?`, `apua`, something in English: each appears at
      the bottom left of **every** computer with the armourer's reply. Correct commands never do.
- [ ] Swear at the armourer (`perkele`): everything is locked until you send `PUNNERRETTU`.
- [ ] Get killed while a half-typed message sits in the compose field: the kill feed shows
      *— was typing: '…'*.
- [ ] Tab: the scoreboard shows a phone icon for connected phones (grey when disconnected).

### D. Playing (10 min)

- [ ] Play a full 4-minute round and the rematch. How do hits, movement of other players and
      the kill feed feel? Any rubber-banding or hits that didn't count?
- [ ] The first-person hands and guns (reworked since checkpoint A).
- [ ] With 9+ players (bots count), the gate opens to the outer ring.

## What to send back

- Each player's phone model and browser, and whether QR pairing worked (or the code was needed).
- Did the screen stay awake? Did the chime and incoming-message sound play?
- Missed or doubled keys, layout problems (screenshots help), anything slow.
- Any LATAA or KRANAATTI that went to the wrong player, did nothing, or did something twice.
- How the phone-in-hand trade-off feels: is the hip spread too wide or too narrow?
  (All values are in F4 → *phoneOut*.)
- The armourer's Finnish: lines to change. They are in `src/shared/fi.ts` under `varusmestari`;
  edit them there or tell me.
- Anything that broke, with roughly when it happened (the host terminal shows connection logs).

## Known limits at this checkpoint

- The phone app's own labels are English (as you asked for the interface); the conversations are
  Finnish. The brief's *Lähetetty / Toimitettu / Luettu* are one edit away in `src/shared/ui.ts`.
- Upgrades, ranks and the TJ ladder (including voice notes and the office transfers) come in the
  next milestone; until then the armourer only serves LATAA and KRANAATTI.
- Tested here with emulated phones (Chrome mobile emulation at 360×740, 375×667 and 390×844) and
  the desktop simulator; not yet on a real iPhone or Android phone.
