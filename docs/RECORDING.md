# Äänitykset

Kaikki pelin äänirepliikit. Nyt kaikista on koneäänellä tehty paikkamerkki kansiossa
`assets/voice/_placeholder/`. Kun äänität repliikin, tallenna se kansioon `assets/voice/`
täsmälleen alla olevalla tiedostonimellä (pääte saa olla .wav, .mp3, .m4a tai .ogg). Oma äänitys
korvaa paikkamerkin heti seuraavalla sivun latauksella, koodia ei tarvitse muuttaa.

Vinkit:

- Mono, 44,1 tai 48 kHz. Leikkaa hiljaisuus alusta ja lopusta (jätä noin 50 ms).
- Kirjainsanat ovat yksittäisiä tiedostoja, joista peli liittää ääniviestit yhteen
  (esim. KETTU = Kalle, Eemeli, Tyyne, Tyyne, Urho). Lausu jokainen sana samalla tavalla ja
  samalla voimakkuudella, niin liitokset kuulostavat luontevilta.
- Ruotsinkieliset viestit lausutaan suomenruotsiksi, kuin Nylands brigadin päivystäjä.
- Teksti ja tiedostonimet tulevat tiedostosta `src/shared/fi.ts` (kohta `voice`).
  Tämä dokumentti ja paikkamerkit tehdään uudelleen komennolla `npm run gen:voice`.

## Ammunnanjohtaja (ratakäskyt)

| Tiedosto | Repliikki | Huomio |
|---|---|---|
| `rata_positions` | Ampumapaikoille! | Ampumaradan ratakäsky |
| `rata_fire` | Tuli vapaa! | Ampumaradan ratakäsky |
| `rata_cease` | Tulitauko! | Ampumaradan ratakäsky |
| `rata_ended` | Ammunta päättyi. Varmista! | Ampumaradan ratakäsky |

## Huoltopäällikkö (ääniviestit, suomeksi)

| Tiedosto | Repliikki | Huomio |
|---|---|---|
| `aakkonen_tunnus` | Tunnus: | Ennen kirjaimia: "Tunnus:" |
| `aakkonen_aarne` | Aarne | Kirjain A. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_bertta` | Bertta | Kirjain B. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_celsius` | Celsius | Kirjain C. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_daavid` | Daavid | Kirjain D. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_eemeli` | Eemeli | Kirjain E. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_faarao` | Faarao | Kirjain F. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_gideon` | Gideon | Kirjain G. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_heikki` | Heikki | Kirjain H. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_iivari` | Iivari | Kirjain I. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_jussi` | Jussi | Kirjain J. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_kalle` | Kalle | Kirjain K. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_lauri` | Lauri | Kirjain L. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_matti` | Matti | Kirjain M. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_niilo` | Niilo | Kirjain N. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_otto` | Otto | Kirjain O. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_paavo` | Paavo | Kirjain P. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_kuu` | Kuu | Kirjain Q. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_risto` | Risto | Kirjain R. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_sakari` | Sakari | Kirjain S. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_tyyne` | Tyyne | Kirjain T. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_urho` | Urho | Kirjain U. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_vihtori` | Vihtori | Kirjain V. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_wiski` | Wiski | Kirjain W. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_aksa` | Äksä | Kirjain X. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_yrjo` | Yrjö | Kirjain Y. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_tseta` | Tseta | Kirjain Z. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_ake` | Åke | Kirjain Å. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_aiti` | Äiti | Kirjain Ä. Yksi sana, selkeästi, lyhyt tauko perään |
| `aakkonen_oljy` | Öljy | Kirjain Ö. Yksi sana, selkeästi, lyhyt tauko perään |
| `aani_alku_1` | Huoltopäällikkö täällä. Tunnus tulee, kirjoita ylös. | Ääniviestin alku |
| `aani_alku_2` | No niin. Kuuntele tarkkaan, en toista. | Ääniviestin alku |
| `aani_alku_3` | Huolto, päivää. Tässä tunnus. | Ääniviestin alku |
| `aani_loppu_1` | Siinä se. Loppu. | Ääniviestin loppu |
| `aani_loppu_2` | Ei toisteta. Kiire odottamaan. | Ääniviestin loppu |
| `aani_loppu_3` | Kuittaa viestillä. Loppu. | Ääniviestin loppu |

## Nylands brigad (ääniviesti, ruotsiksi)

| Tiedosto | Repliikki | Huomio |
|---|---|---|
| `ruotsi_alg` | Hej! Koden är älg. | Vastaus: ÄLG |
| `ruotsi_rav` | Hej! Koden är räv. | Vastaus: RÄV |
| `ruotsi_bjorn` | Hej! Koden är björn. | Vastaus: BJÖRN |
| `ruotsi_varg` | Hej! Koden är varg. | Vastaus: VARG |
| `ruotsi_hare` | Hej! Koden är hare. | Vastaus: HARE |
| `ruotsi_lo` | Hej! Koden är lo. | Vastaus: LO |
| `ruotsi_uggla` | Hej! Koden är uggla. | Vastaus: UGGLA |
| `ruotsi_korp` | Hej! Koden är korp. | Vastaus: KORP |
| `ruotsi_gadda` | Hej! Koden är gädda. | Vastaus: GÄDDA |
| `ruotsi_abborre` | Hej! Koden är abborre. | Vastaus: ABBORRE |
| `ruotsi_sill` | Hej! Koden är sill. | Vastaus: SILL |
| `ruotsi_mas` | Hej! Koden är mås. | Vastaus: MÅS |

Yhteensä 52 repliikkiä.
