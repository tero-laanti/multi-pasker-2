# How to play

MULTI-PASKER 2 from a player’s seat: joining, the training, the keys, the phone and the armourer, matches and pairs, the service and its shop, and the awards. Hosting the game is in [HOSTING.md](HOSTING.md).

## Joining a match

One person hosts: `npm start` on their computer makes it the server (no internet or cloud
service involved), and they can play on the same machine.

1. Start the server on one machine (`npm start`) and have everyone open the printed address.
2. **Join game**, type a name (letters including Å, Ä, Ö and digits, up to 12) and click the view.
   The first time, you start on the shooting range for a short training (see below); after that,
   joining goes straight to the match.
3. On the garrison (*varuskunta*), free-for-all or in pairs (the host's choice, see *Matches*):
   4-minute rounds, respawn after 3 s, a short spawn protection that ends when you fire. Tab shows the scoreboard; it also appears between
   rounds, and the next round starts by itself after 12 s.
4. The garrison: the kasarmi (barracks) to the north, the asevarasto (armoury) to the east, the
   sotku (canteen) to the west, the esterata (obstacle course) to the south, and the **Veksi**,
   the garrison sick bay, in the south-east corner: a waiting room with the reception counter, a
   corridor and a ward of beds, with doors to the street, the parade ground and the yard.
5. With more than 8 players the two gates (*puomi*) open the outer ring, a tent camp you can loop
   through by the road gate and the back gate. Bots use the gates too, once they are open.

Reloading the page puts you back into the same player (score kept). Leaving from the Esc menu
shows you as *left* to the others; you can come back during the round.

**The minimap** (top left) is the garrison from above, turned so that where you look is up, with
north marked on its rim. An enemy who fires without a suppressor shows as a red dot where the shot
came from for 2.5 s (on the rim when further away), and the closed gate is a red bar. Its range
and timing are `MINIMAP` in `config.ts`; Settings → *Show the minimap* turns it off.

**Bots** fill empty slots for testing: F2 → *Add bot* / *Fill with bots (15)*, or start the server
with `PASKER_BOTS=15 npm start` (`set PASKER_BOTS=15` first on Windows).

### The training

Everyone's first join starts on the range, not in the match (the scoreboard shows them as *on
the range*): walk to the marked table, knock down the marked target, press R and find there is
no spare magazine, then pick up the phone from the duty table behind you (E). That opens the
pairing screen, which explains that the phone app is only a web page from the host's computer
(nothing to install, no permissions, it connects only to the host computer). Asevarasto's first
text is a radio check (*yhteyskoe*), just `YK`: reply `YK` and the magazines are full (anything
else gets the explanation, and after that less patience). Train as long as you like, then Esc → **Go to the match**.
The browser remembers that you've done it.

A **CONTROLS** note is pinned to the wall right behind the start (the first step says so): look at
it and press E to read every key up close, and E again (or a step back) to put it away. It stays
on the range for later visits too.

**Without a phone of your own:** the pairing panel (on the training's pairing screen and in the
Esc menu) has **Open a virtual phone**: the same phone app on your screen, typed on by clicking
its keys with the mouse (the keyboard does nothing). Your character has the phone out while it
is open and the game waits for you, so it is much slower and clumsier than a real phone; *Back
to the game* or Esc puts it away. Phones never use Bluetooth or a cable: the phone page connects
over Wi-Fi to the computer hosting the game, so the phones' Wi-Fi has to be the same network as
the host (wired PCs are fine).

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Mouse | look |
| Left mouse | fire |
| Right mouse / Q | aim down sights (hold by default; *Right click / Q toggles aiming* in the settings: a press aims, the next lets go, and Shift to sprint ends it). Q is there for a mouse without a right button to hold, such as Apple's Magic Mouse or a trackpad |
| Shift | sprint |
| Space | jump (a small ledge assist lets you climb ledges just above jump height) |
| C | crouch (toggle by default, hold in settings) |
| 1 / 2 / 3 / wheel | pistol / rifle / sniper rifle (you start with the pistol; the rifle comes in P-kausi, the sniper rifle from the Sotku) |
| G | grenade: the pin comes out and the 2.5 s fuse starts; let go to throw. Hold it too long and it goes off in your hand |
| V | knife: the gun dips and a puukko stabs at arm's length; two stabs kill, one with P-kausi's *teroitettu puukko* |
| I | inspect weapon (SA stamp and the weapon's serial number) |
| Tab | scoreboard |
| R | reload with the spare magazine (more comes with LATAA) |
| E | pick up (the training's phone), read (the CONTROLS note on the range) |
| Esc | menu (the match keeps running) |
| F2 | dev panel |
| F3 | performance overlay (frame time, CPU time, RTT, jitter, snapshot rate, interpolation delay, server tick) |
| F4 | live tuning panel |

## Ammo

Each gun has its magazine and one spare. **R** (or pulling the trigger on an empty gun) puts in
the spare; after that, text `LATAA` to the armourer for full magazines *and* a new spare. Every
life starts with a full magazine and a spare.

## The knife

**V** stabs with a puukko: the gun dips, the knife goes in at arm's length (1.9 m, within 30° of
where you look) and comes back, 0.6 s in all. A stab does 55 damage, so two kill from full
health; not while reloading or holding a grenade. The server checks the reach against where the
target was when you saw them, and that no wall is in between, as it does for shots. Bots stab
when someone is close. Its numbers are `TUNING.melee` in `config.ts`.

## The phone

Ammo and grenades come from the armourer, *varusmestari*, by text message from your own phone.

1. The training pairs it. Later, the *Click to play* screen and the Esc menu show a **QR code**:
   scan it with the phone's camera and open the link, or open `http://<address>/phone` on the
   phone and type the 4-digit code shown below the QR code.
2. The phone shows whose phone it is. Tap **Start** (keeps the screen on and enables sound) and
   check that you hear the chime.
3. Open the **Asevarasto** chat and text `LATAA` for full magazines and a new spare, or
   `KRANAATTI` for a grenade (G pulls the pin, let go to throw). Case, spaces and
   punctuation don't matter; anything else gets a reply from the armourer, and typos, swearing
   and chatter are shown to everyone.

The armourer never forgets a typo: your mistyped commands (and other short nonsense) are kept all
evening, over matches and server restarts, and now and then a LATAA or KRANAATTI comes back with
an old one quoted (*Muistan sinut, alokas. Viimeksi kirjoitit ”LATAAA”.*), each one only once.

**Inventory checks** (*inventaario*): now and then (never in your first minute in the match) the
company's **Vääpeli** texts a question about your own kit or the round, in a chat of his own:
rounds in your magazine or spare, grenades, your kills or deaths, or how many soldiers are on the
field. Both screens count down from 20 seconds. The right number earns a grenade; wrong answers
go to everyone's typo feed, and no right answer in time means push-ups (no service at the
armoury until you report `PUNNERRETTU`).

**One new message per chat:** nobody sends you a second message before you have read the first;
the next one comes in when you open the chat. Replies to what you send always come straight
away. A yellow bar under the round timer says who has written (or counts down an inventory
check).

While a chat is open your character holds the phone: one-handed, wider hip fire, no aiming down
sights. Sending a message shows *Sending…* and goes back to the chat list, which puts the phone
away. Messages you type on the phone use the app's own keyboard (no autocorrect). Phone numbers
in a message can be copied: long-press the message (or click it with a mouse) and pick *Copy*;
then long-press (or click) the number in a new chat (**+**) and pick *Paste*.
The dead have no phone: die and the phone shows a note until you respawn (who did it, and the
message that never got sent if you were typing), and nothing can be texted or bought meanwhile.

One phone per player: pairing another phone replaces the first. A phone that loses its connection
(screen lock, reload) comes back to the same chats. For testing without phones, the host can turn
on F2 → *R refills like LATAA* for everyone.

The dev panel's match controls (bots, rounds, the service) work in a browser on the host computer, by
`localhost` or by its network address, or from any machine on an `npm run dev` server.

For development, F2 → *Open phone simulator* opens the phone app in a window that you type into
with the computer's keyboard (only on `npm run dev` servers or the host machine).

## Matches

A match is a set number of rounds: 6 rounds of 4 minutes by default, with a 12-second break
between rounds and the match's results after the last one. Everything lasts one match: TJ,
money, gear, kills, deaths and awards. The next match starts everyone again at TJ 347 with a
pistol. The scoreboard counts kills and deaths over the match and shows everyone's TJ, and its
winner is whoever has the most kills (then the fewest deaths). Nobody gets hurt between rounds,
so the scores stand. The range officer calls the rounds: *Tulitauko!* as a round ends and *Tuli
vapaa!* as the next one starts (the range's own recordings).

The host sets the match in the pause menu (*Match settings*, shown only on the host): rounds per
match, round length, how many days a kill serves, the number of bots, the kill speed and the mode
(free-for-all or pairs). Changes apply at once (the round length from the next round), and *Start a
new match now* restarts. The
settings and who won each match tonight are saved in `data/evening.json`, with the services of the
match under way, so restarting the server keeps them.

**Pairs** (*Mode: Pairs (2v2v2…)*): the pairs are drawn at random for each match, and with an odd
number the host plays alone. A pair wears the same colour (beret, arm bands, name tag, kill feed and
scoreboard), sees the partner's name tag through walls and as a ringed dot on the minimap, and
can't hurt each other (your own grenade still gets you; shots and the knife pass a partner by).
Spawns lean towards a living partner. A line beside the round timer says who you are paired with.
The scoreboard lists the pairs by their kills together (the *Total kills* column), and the match goes
to the pair with the most. Someone who joins or comes off the range mid-match pairs up with whoever is
alone (when that makes the number odd, the host's partner gets the newcomer and the host goes on
alone); someone who leaves keeps their place until they are dropped at the next round.

## The service and the Sotku App

Your service lasts the match: TJ counts down from 347, kept by name over rounds, a rejoin and a
server restart. A kill serves 3 days (the host can change it), being killed by someone
else 1 (a day in the veksi counts too), killing someone with a lower TJ than yours (further
into their service) 1 more, and catching someone texting (a chat open on their phone) 1 more:
the kill feed shows a 📱 by their name, and now and then the armourer texts you about it
(*Ammuit jonkun kesken lauseen. Tehokasta.*). Every day
served pays the päiväraha: 5 € a day for days 1–165, 10 € for days 166–255 and 15 € after that,
3,105 € for the whole service. Each of the four promotions pays a 100 € bonus on top. The money
shows only on the phone; the game shows what a kill paid under the kill confirmation.

The first six weeks are P-kausi. Gear comes by text, as paperwork at the asevarasto:

| Day | Gear | How you sign for it |
|---|---|---|
| 1 | the rifle (key 2) | send the word it asks for |
| 10 | a longer rifle magazine (30 → 40) | send a phrase exactly (tongue twisters included) |
| 20 | *Teroitettu puukko*: one stab kills | an office at a new number: open a chat with it yourself, then send its phrase or the code word hidden in a wall of regulations |
| 30 | the grenade belt (two grenades) | the huoltopäällikkö at a 17-digit +358 number: a voice note spells the code in the phonetic alphabet |

Once you have served 42 days and signed for all four, the company commander (*Komppanian
päällikkö*) texts that P-kausi is over: you are sotamies, and the **Sotku App** opens on the phone's
second tab (until then it shows the days and the gear still to go). It sells four specialist paths
of six nodes each, rows I–IV, each node needing one from the row above:

| Path | Role | Nodes |
|---|---|---|
| Sotilaspoliisi | the pistol as a main weapon | quick draw, 18-round magazine, hip-fire accuracy, hollow points (+50 % damage), 20 % faster with the pistol out, full auto |
| Tarkka-ampuja | rifle expert | muzzle brake, 50-round magazine, a red dot sight in place of the iron sights (quicker and steadier aiming), drum magazine, suppressor, and the sniper rifle on key 3 |
| Viestimies | the phone and the minimap | dark mode, speed dial (`L`, `K`), a wider minimap, autofill of codes, enemies holding a phone on the minimap, and a recon drone (text LENNOKKI) |
| Pioneeri | grenades | quicker resupply, a good arm (the throw's path shown while you hold the grenade, and 30 % farther), more shrapnel (+50 % damage), a third grenade, a heavier charge (+50 % blast radius), and a mortar strike where you are looking (text TULI) |

The whole tree costs 7,190 €, so a service buys nearly two paths. Row I is handed over at
once; the rows above need paperwork like P-kausi's (a word, a phrase or an office, the supply
chief's voice note, and for the sniper rifle your rifle's serial number). One paperwork is open at
a time and the rest queue. The café sells *Munkkikahvit* (the next paperwork is done by texting
KIITOS) and *Nakkisuoja* (skips the next inventory check). Shopping takes the phone out, just like
texting.

The pay rises (TJ 181 and TJ 91) come as texts from the company commander with a promotion
(korpraali, then alikersantti). At TJ 0 the discharge paperwork sends you to Nylands brigad, in
Swedish (*Svara på svenska, tack.*); after it you are *reservin kersantti*, with a star in the kill
feed and the scoreboard, and one Sotku item of your choice free. No päiväraha is paid after TJ 0,
so the discharge's promotion bonus is the last money of the service.

Every price and rule is in `SERVICE`, `SOTKU` and `GEAR` in `src/shared/config.ts`. F2 → *Skip
P-kausi (its days and its gear)*, *Do the paperwork (or serve 10 days)* and *Add 500 €* skip the
waiting while testing.

## Awards and the evening

When a match ends, the scoreboard shows its winner and the awards: *Lomille ensimmäisenä* (most
kills), *Kaatui kesken viestin* (died mid-message most often), *Pisin keskeneräinen viesti* (the
longest unsent message, quoted), *Kirjoitusvirheiden kuningas* (most messages the armourer didn't
accept), *Kiire odottamaan* (most time on the phone), *Punnerruskuningas* (most push-ups) and
*Pakkoruotsin sankari* (first through Nylands brigad); and, the only thing kept from one match to
the next, who won each match tonight. Start a new evening (that list cleared, a new match) with
F2 → *New evening* on the host (or delete the file).

The dev panel's match controls (bots, round restart, gate, kill speed, giving weapons) work from
the host machine, or from any machine on a `npm run dev` server. The *network conditioner*
in the same panel adds latency and jitter to your own connection, for testing interpolation and
hit registration.

## The shooting range (Ampumarata)

A covered firing point with six lanes; silhouettes, steel plates and gongs at 10, 25 and 50 m; a
target running on a rail; pop-up drill targets behind cover; and a training yard behind the firing
point (kill house, tower with stairs and a ramp, crates) for testing movement.
Shoot the **yellow plate** in front of the firing point to start a 30-second drill
("Ampumapaikoille!" → "Tuli vapaa!" → … → "Tulitauko!"). Your best score is kept in the browser.
On the range you have the pistol (1) and the rifle (2), and reloads never run out; the dev panel
(F2) gives grenades, which in a match come from the varusmestari. The training (above) happens
here too: it starts with the pistol only, like a match, and hands you the rifle once it is done.
