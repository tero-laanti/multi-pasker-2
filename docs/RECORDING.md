# Voice recordings

Every voice line in the game. Each one currently has a machine-voice placeholder in
`assets/voice/_placeholder/`. To replace a line, save your recording into `assets/voice/`
with exactly the file name below (extension .wav, .mp3, .m4a or .ogg). It replaces the placeholder
on the next page load; no code changes needed.

Tips:

- Mono, 44.1 or 48 kHz. Trim silence at both ends (leave about 50 ms).
- The phonetic-alphabet words, *Tunnus:* and the voice-note intros and outros are separate files
  that the server splices into one voice note (e.g. KETTU = intro, Tunnus, Kalle, Eemeli, Tyyne,
  Tyyne, Urho, outro). **Save these as WAV** (any sample rate, 16/24-bit or float, mono or stereo):
  other formats can't be spliced, and the placeholder is used for that word instead. The server
  trims silence and evens out the level, but the joins sound most natural if every word is said
  the same way. Restart the server after adding recordings.
- The Swedish notes are spoken in Finland-Swedish, like a duty officer at Nylands brigad.
- Texts and file names come from `src/shared/fi.ts` (the `voice` section). This document and
  the placeholders are regenerated with `npm run gen:voice`.

## Range officer (range commands and the match rounds)

| File | Line (Finnish/Swedish) | Note |
|---|---|---|
| `rata_positions` | Ampumapaikoille! | Range command |
| `rata_fire` | Tuli vapaa! | Range command; also as each round of a match starts |
| `rata_cease` | Tulitauko! | Range command; also as each round of a match ends |
| `rata_ended` | Ammunta päättyi. Varmista! | Range command |

## Huoltopäällikkö (voice notes, Finnish)

| File | Line (Finnish/Swedish) | Note |
|---|---|---|
| `aakkonen_tunnus` | Tunnus: | Said before the letters |
| `aakkonen_aarne` | Aarne | Letter A. One word, clearly, short pause after |
| `aakkonen_bertta` | Bertta | Letter B. One word, clearly, short pause after |
| `aakkonen_celsius` | Celsius | Letter C. One word, clearly, short pause after |
| `aakkonen_daavid` | Daavid | Letter D. One word, clearly, short pause after |
| `aakkonen_eemeli` | Eemeli | Letter E. One word, clearly, short pause after |
| `aakkonen_faarao` | Faarao | Letter F. One word, clearly, short pause after |
| `aakkonen_gideon` | Gideon | Letter G. One word, clearly, short pause after |
| `aakkonen_heikki` | Heikki | Letter H. One word, clearly, short pause after |
| `aakkonen_iivari` | Iivari | Letter I. One word, clearly, short pause after |
| `aakkonen_jussi` | Jussi | Letter J. One word, clearly, short pause after |
| `aakkonen_kalle` | Kalle | Letter K. One word, clearly, short pause after |
| `aakkonen_lauri` | Lauri | Letter L. One word, clearly, short pause after |
| `aakkonen_matti` | Matti | Letter M. One word, clearly, short pause after |
| `aakkonen_niilo` | Niilo | Letter N. One word, clearly, short pause after |
| `aakkonen_otto` | Otto | Letter O. One word, clearly, short pause after |
| `aakkonen_paavo` | Paavo | Letter P. One word, clearly, short pause after |
| `aakkonen_kuu` | Kuu | Letter Q. One word, clearly, short pause after |
| `aakkonen_risto` | Risto | Letter R. One word, clearly, short pause after |
| `aakkonen_sakari` | Sakari | Letter S. One word, clearly, short pause after |
| `aakkonen_tyyne` | Tyyne | Letter T. One word, clearly, short pause after |
| `aakkonen_urho` | Urho | Letter U. One word, clearly, short pause after |
| `aakkonen_vihtori` | Vihtori | Letter V. One word, clearly, short pause after |
| `aakkonen_wiski` | Wiski | Letter W. One word, clearly, short pause after |
| `aakkonen_aksa` | Äksä | Letter X. One word, clearly, short pause after |
| `aakkonen_yrjo` | Yrjö | Letter Y. One word, clearly, short pause after |
| `aakkonen_tseta` | Tseta | Letter Z. One word, clearly, short pause after |
| `aakkonen_ake` | Åke | Letter Å. One word, clearly, short pause after |
| `aakkonen_aiti` | Äiti | Letter Ä. One word, clearly, short pause after |
| `aakkonen_oljy` | Öljy | Letter Ö. One word, clearly, short pause after |
| `aani_alku_1` | Huoltopäällikkö täällä. Tunnus tulee, kirjoita ylös. | Voice-note intro |
| `aani_alku_2` | No niin. Kuuntele tarkkaan, en toista. | Voice-note intro |
| `aani_alku_3` | Huolto, päivää. Tässä tunnus. | Voice-note intro |
| `aani_loppu_1` | Siinä se. Loppu. | Voice-note outro |
| `aani_loppu_2` | Ei toisteta. Kiire odottamaan. | Voice-note outro |
| `aani_loppu_3` | Kuittaa viestillä. Loppu. | Voice-note outro |

## Nylands brigad (voice note, Swedish)

| File | Line (Finnish/Swedish) | Note |
|---|---|---|
| `ruotsi_alg` | Hej! Koden är älg. | Answer: ÄLG |
| `ruotsi_rav` | Hej! Koden är räv. | Answer: RÄV |
| `ruotsi_bjorn` | Hej! Koden är björn. | Answer: BJÖRN |
| `ruotsi_varg` | Hej! Koden är varg. | Answer: VARG |
| `ruotsi_hare` | Hej! Koden är hare. | Answer: HARE |
| `ruotsi_lo` | Hej! Koden är lo. | Answer: LO |
| `ruotsi_uggla` | Hej! Koden är uggla. | Answer: UGGLA |
| `ruotsi_korp` | Hej! Koden är korp. | Answer: KORP |
| `ruotsi_gadda` | Hej! Koden är gädda. | Answer: GÄDDA |
| `ruotsi_abborre` | Hej! Koden är abborre. | Answer: ABBORRE |
| `ruotsi_sill` | Hej! Koden är sill. | Answer: SILL |
| `ruotsi_mas` | Hej! Koden är mås. | Answer: MÅS |

52 lines in total.
