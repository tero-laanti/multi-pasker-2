/**
 * Finnish content: what is spoken or typed in Finnish in the game (range commands, voice
 * lines, in-world place names, the varusmestari's script and the phone commands).
 * Interface text is English and lives in ui.ts.
 * Edit freely: the keys are used by code, the strings are yours.
 */
export const FI = {
  range: {
    /** Place-name signs in the world. */
    signs: {
      title: 'AMPUMARATA',
      office: 'RATATOIMISTO',
      duty: 'PÄIVYSTÄJÄ',
    },
    /** Range commands shown with the voice lines (see docs/RECORDING.md). */
    commands: {
      positions: 'Ampumapaikoille!',
      fire: 'Tuli vapaa!',
      cease: 'Tulitauko!',
      ended: 'Ammunta päättyi. Varmista!',
    },
  },

  /**
   * Voice lines. `tools/gen-voice.ts` makes placeholders from these and writes
   * docs/RECORDING.md; recordings dropped into assets/voice/ with the same file name replace them.
   */
  voice: {
    range: [
      ['rata_positions', 'Ampumapaikoille!'],
      ['rata_fire', 'Tuli vapaa!'],
      ['rata_cease', 'Tulitauko!'],
      ['rata_ended', 'Ammunta päättyi. Varmista!'],
    ] as [string, string][],
    /** The match's rounds, called with the range's own commands: Tulitauko! as a round ends, Tuli vapaa! as the next one starts. */
    roundEnd: 'rata_cease',
    roundStart: 'rata_fire',
    /** Finnish phonetic alphabet: letter, word, file. Voice notes are spliced from these. */
    alphabet: [
      ['A', 'Aarne', 'aakkonen_aarne'],
      ['B', 'Bertta', 'aakkonen_bertta'],
      ['C', 'Celsius', 'aakkonen_celsius'],
      ['D', 'Daavid', 'aakkonen_daavid'],
      ['E', 'Eemeli', 'aakkonen_eemeli'],
      ['F', 'Faarao', 'aakkonen_faarao'],
      ['G', 'Gideon', 'aakkonen_gideon'],
      ['H', 'Heikki', 'aakkonen_heikki'],
      ['I', 'Iivari', 'aakkonen_iivari'],
      ['J', 'Jussi', 'aakkonen_jussi'],
      ['K', 'Kalle', 'aakkonen_kalle'],
      ['L', 'Lauri', 'aakkonen_lauri'],
      ['M', 'Matti', 'aakkonen_matti'],
      ['N', 'Niilo', 'aakkonen_niilo'],
      ['O', 'Otto', 'aakkonen_otto'],
      ['P', 'Paavo', 'aakkonen_paavo'],
      ['Q', 'Kuu', 'aakkonen_kuu'],
      ['R', 'Risto', 'aakkonen_risto'],
      ['S', 'Sakari', 'aakkonen_sakari'],
      ['T', 'Tyyne', 'aakkonen_tyyne'],
      ['U', 'Urho', 'aakkonen_urho'],
      ['V', 'Vihtori', 'aakkonen_vihtori'],
      ['W', 'Wiski', 'aakkonen_wiski'],
      ['X', 'Äksä', 'aakkonen_aksa'],
      ['Y', 'Yrjö', 'aakkonen_yrjo'],
      ['Z', 'Tseta', 'aakkonen_tseta'],
      ['Å', 'Åke', 'aakkonen_ake'],
      ['Ä', 'Äiti', 'aakkonen_aiti'],
      ['Ö', 'Öljy', 'aakkonen_oljy'],
    ] as [string, string, string][],
    codeWord: ['aakkonen_tunnus', 'Tunnus:'] as [string, string],
    intros: [
      ['aani_alku_1', 'Huoltopäällikkö täällä. Tunnus tulee, kirjoita ylös.'],
      ['aani_alku_2', 'No niin. Kuuntele tarkkaan, en toista.'],
      ['aani_alku_3', 'Huolto, päivää. Tässä tunnus.'],
    ] as [string, string][],
    outros: [
      ['aani_loppu_1', 'Siinä se. Loppu.'],
      ['aani_loppu_2', 'Ei toisteta. Kiire odottamaan.'],
      ['aani_loppu_3', 'Kuittaa viestillä. Loppu.'],
    ] as [string, string][],
    /** Swedish voice notes for stage 6: file, code word (the answer), full spoken line. */
    swedish: [
      ['ruotsi_alg', 'ÄLG', 'Hej! Koden är älg.'],
      ['ruotsi_rav', 'RÄV', 'Hej! Koden är räv.'],
      ['ruotsi_bjorn', 'BJÖRN', 'Hej! Koden är björn.'],
      ['ruotsi_varg', 'VARG', 'Hej! Koden är varg.'],
      ['ruotsi_hare', 'HARE', 'Hej! Koden är hare.'],
      ['ruotsi_lo', 'LO', 'Hej! Koden är lo.'],
      ['ruotsi_uggla', 'UGGLA', 'Hej! Koden är uggla.'],
      ['ruotsi_korp', 'KORP', 'Hej! Koden är korp.'],
      ['ruotsi_gadda', 'GÄDDA', 'Hej! Koden är gädda.'],
      ['ruotsi_abborre', 'ABBORRE', 'Hej! Koden är abborre.'],
      ['ruotsi_sill', 'SILL', 'Hej! Koden är sill.'],
      ['ruotsi_mas', 'MÅS', 'Hej! Koden är mås.'],
    ] as [string, string, string][],
  },

  /**
   * The varusmestari at the asevarasto. Each list is a set of variants picked at random.
   * `{cmd}` is the command the player probably meant, `{rank}` the player's rank (alokas…).
   * Commands themselves (LATAA, KRANAATTI, PUNNERRETTU) are matched in shared/chat.ts.
   */
  varusmestari: {
    /** Contact name and number shown on the phone. */
    name: 'Asevarasto',
    number: '7413',
    /** First message in the chat; it stays in the history as the instructions. In English, so newcomers understand it. */
    welcome: ['Asevarasto. Services:\nLATAA: full magazines, the spare too.\nKRANAATTI: one grenade, throw with G.\nThere is nothing else. Hurry up and wait.'],
    /** Short acknowledgements after a reload; an empty string means no reply at all. */
    reloadOk: ['Kuitattu.', 'Ladattu. Seuraava.', 'Lipas vaihdettu.', 'Tässä. Älä tuhlaa.', 'Ota ja mene.', 'Patruunat eivät kasva puussa.', '', '', ''],
    reloadFull: ['Lippaat ovat täynnä. Ammu ensin, {rank}.', 'Kaikki täynnä, varalipaskin. Mitä sinä oikein lataat?', 'Sinulla on jo kaikki. Laske itse.'],
    reloadBusy: ['Jo ladataan. Kiire odottamaan.', 'Yksi lataus kerrallaan.'],
    grenadeOk: ['Yksi kranaatti. Sokka pysyy paikallaan kunnes heität.', 'Kranaatti kuitattu. Älä pudota sitä jalkoihisi.', 'Tässä. Heitä kauas. Kauemmas kuin luulet.', 'Kuitattu. Heitto G:llä, ei hampailla.'],
    grenadeLimit1: ['Yksi per mies.', 'Sinulla on jo kranaatti. Käytä se ensin.'],
    grenadeLimit2: ['Kaksi per mies. Vyö ei veny.', 'Vyö on täynnä. Heitä ensin.'],
    grenadeCooldown: ['Kranaatit loppu. Uusi erä tulee kun tulee.', 'Varasto on tyhjä. Kysy hetken päästä.', 'Ei ole. Huolto on matkalla.'],
    dead: ['Kaatuneita ei palvella.', 'Kuolleet eivät tilaa mitään.', 'Ensin ylös, sitten viestit.'],
    oldRound: ['Se oli eri kierros. Aloita alusta.'],
    nearMiss: ['Tarkoititko {cmd}? Täällä ei arvailla.', '{cmd} kirjoitetaan {cmd}. Uudestaan.', 'Lue ohje. {cmd}. Ei muuta.'],
    swear: ['{rank}! Kieli! Punnerra kymmenen ja ilmoita: PUNNERRETTU.', 'Tuollaista kieltä ei käytetä asevarastolle. Kymmenen punnerrusta, ja ilmoitat: PUNNERRETTU.'],
    locked: ['Punnerrukset ensin. Ilmoita: PUNNERRETTU.', 'Ei palvelua ennen kuin olet punnertanut. PUNNERRETTU.'],
    unlocked: ['Hyvä. Palvelu jatkuu.', 'No niin. Ja kieli kurissa jatkossa.'],
    unlockedNotLocked: ['Kukaan ei käskenyt punnertaa. Mutta hyvä.'],
    question: ['Kiire odottamaan.', 'Kysymykset kirjallisena komppanian toimistoon.'],
    help: ['Apua jaetaan torstaisin hernekeiton yhteydessä.'],
    english: ['Puolustusvoimissa puhutaan suomea. Tai ruotsia.', 'Englanniksi ei palvella. Suomeksi, kiitos.'],
    swedish: ['Nylands brigad on Dragsvikissä. Täällä puhutaan suomea.'],
    greeting: ['Päivää. Asiaan.', 'Terve terve. Mitä tarvitaan? LATAA vai KRANAATTI.', 'Moi vaan. Ei tämä mikään chatti ole.'],
    thanks: ['Ei kestä. Mene jo.', 'Kiitokset hernekeittojonoon.', 'Joo joo.'],
    numbers: ['Numerot toimistolle. Täällä tilataan sanoilla.', 'Ei tämä mikään vaihde ole.'],
    empty: ['Puhu suomea.', 'Mitä?'],
    spam: ['Yksi viesti kerrallaan, {rank}.', 'Rauhoitu. Täällä ei juosta.'],
    other: [
      'Ei kuulu meille.',
      'Kokoa ei ole, ota mikä on. LATAA tai KRANAATTI.',
      'Tästä luukusta saa kahta asiaa: LATAA ja KRANAATTI.',
      'Palvelusohjesääntö ei tunne tuollaista pyyntöä.',
      'TJ on pitkä ja sinä kirjoitat tuollaista.',
      'Mitä?',
    ],
    /** Message to a number that doesn't exist. */
    unknownNumber: 'Numeroa ei ole olemassa.',
    /** A service now and then comes with an old typo quoted back ({typo}, as it was typed). */
    roast: ['Muistan sinut, {rank}. Viimeksi kirjoitit ”{typo}”.', 'Täällä ei unohdeta, {rank}. ”{typo}”, niin sinä kirjoitit.', '”{typo}”. Sinä se olit. Kyllä minä muistan.', 'Tällä kertaa oikein. Viimeksi tuli ”{typo}”.'],
    /** To the killer of someone caught texting: {name} the victim, {days} what the kill served, {tj} days left. */
    caught: ['{name} jäi kiinni tekstailusta. Siitä lähtee {days} aamua. TJ {tj}.', '{name} oli puhelimessa. Ei ole enää. TJ {tj}.', 'Ammuit jonkun kesken lauseen. Tehokasta. {days} aamua pois palveluksesta.'],
  },

  /**
   * Ranks by days served: alokas in P-kausi, sotamies after it, korpraali and alikersantti with
   * the pay rises, kersantti once discharged. How the varusmestari addresses them.
   */
  ranks: ['alokas', 'sotamies', 'korpraali', 'alikersantti', 'kersantti', 'ylikersantti', 'vääpeli'],
  /** "Ylennys sotamieheksi": the same ranks in the translative. */
  ranksTo: ['alokkaaksi', 'sotamieheksi', 'korpraaliksi', 'alikersantiksi', 'kersantiksi', 'ylikersantiksi', 'vääpeliksi'],
  /** Short forms for the kill feed and scoreboard. */
  rankAbbr: ['Alok.', 'Stm.', 'Kpl.', 'Alik.', 'Kers.', 'Ylik.', 'Vääp.'],

  /**
   * The company commander: a higher-up who texts the milestones of your service (only to you).
   * In English on purpose, so everyone understands the rules they announce; Päiväraha and the
   * ranks keep their Finnish names. {name} the player, {tj} days left, {eur} the new Päiväraha,
   * {rank} the new rank, {number} where to write.
   */
  commander: {
    name: 'Komppanian päällikkö',
    number: '7400',
    /** P-kausi is passed: the Sotku App opens. */
    pkausi: ['Congratulations on passing P-kausi. You may now use the Sotku App to buy goods and services.'],
    /** A pay rise, which is also a promotion (just the pay for someone still in P-kausi). */
    rise: ['TJ {tj}! You are promoted to {rank}. Your Päiväraha is now {eur} € a day.'],
    raise: ['TJ {tj}! Your Päiväraha is now {eur} € a day.'],
    /** TJ 0: the discharge paperwork, at Nylands brigad. */
    tj0: ['TJ 0! Your discharge papers are waiting. The last counter is in Dragsvik: Nylands brigad, number {number}. Svenska, tack.'],
    /** Discharged: the reservist star and a free pick from the Sotku. */
    discharged: ['Discharged. Reservin kersantti {name}, you have earned the reservist star. Your discharge gift: one item from the Sotku, free.'],
    /** Anything texted to the company commander. */
    reply: ['The company commander does not answer text messages.', 'Go through the vääpeli.', 'This number is for announcements only.'],
  },

  /** Gear and the Sotku App's goods, by id (src/shared/service.ts), and the shop's paths. */
  items: {
    rifle: 'Rynnäkkökivääri',
    lipas: 'Pidennetty lipas',
    puukko: 'Teroitettu puukko',
    vyo: 'Kranaattivyö',
    pveto: 'Pistoolikoulutus',
    plipas: 'Pistoolin pidennetty lipas',
    lonkka: 'Lonkalta',
    ontelo: 'Ontelokärjet',
    kevyt: 'Kevyt varustus',
    sarja: 'Sarjatulipistooli',
    suujarru: 'Suujarru',
    lipas2: 'Pidennetty lipas II',
    punapiste: 'Punapistetähtäin',
    rumpu: 'Rumpulipas',
    vaimennin: 'Vaimennin',
    tkiv: 'Tarkkuuskivääri',
    pikavalinta: 'Pikavalinta',
    autofill: 'Automaattitäyttö',
    tutka: 'Tutka',
    tumma: 'Tumma tila',
    kannykka: 'Kännykkätutka',
    lennokki: 'Tiedustelulennokki',
    tihea: 'Tiheä huolto',
    heitto: 'Hyvä heittäjä',
    sirpale: 'Lisää sirpaleita',
    kolmas: 'Kolmas kranaatti',
    raskas: 'Raskas panos',
    tuli: 'Tulitoimitus',
    munkki: 'Munkkikahvit',
    nakkisuoja: 'Nakkisuoja',
  } as Record<string, string>,
  paths: { sp: 'Sotilaspoliisi', ta: 'Tarkka-ampuja', vm: 'Viestimies', pi: 'Pioneeri' } as Record<string, string>,

  /**
   * The paperwork that hands gear over. Placeholders: {rank} {name} the player, {code} what to
   * send, {office} and {number} a contact to write to, {tj} days left, {item} or {upgrade} the
   * gear's name.
   */
  /**
   * Surprise inventory checks: a question about your own kit or the round, answered with a
   * number. {s} is the seconds to answer, {rank} the player's rank.
   */
  inventory: {
    /** The company's sergeant major does the inventory checks, in a chat of his own. */
    name: 'Vääpeli',
    number: '7420',
    ask: {
      mag: ['Inventaario! Montako patruunaa lippaassasi on nyt? Vastaa numerolla, {s} sekuntia.', 'Inventaario. Lippaan patruunat, montako? Numerolla. Aikaa {s} sekuntia.'],
      spare: ['Inventaario! Montako patruunaa varalippaassasi on? Numerolla, {s} sekuntia.', 'Inventaario. Varalipas, montako patruunaa? Aikaa {s} sekuntia.'],
      grenades: ['Inventaario! Montako kranaattia sinulla on mukana? Numerolla, {s} sekuntia.', 'Inventaario. Kranaatit, montako kappaletta? Aikaa {s} sekuntia.'],
      kills: ['Tilastointi! Montako kaatoa sinulla on tässä harjoituksessa? Numerolla, {s} sekuntia.', 'Tilastointi. Kaadot tästä harjoituksesta, montako? Aikaa {s} sekuntia.'],
      deaths: ['Tilastointi! Montako kertaa sinut on kaadettu tässä harjoituksessa? Rehellisesti, {s} sekuntia.', 'Tilastointi. Montako kertaa olet kaatunut tässä harjoituksessa? Aikaa {s} sekuntia.'],
      players: ['Vahvuusilmoitus! Montako sotilasta kentällä on, sinut mukaan lukien? {s} sekuntia.', 'Vahvuusilmoitus. Kentän vahvuus, itsesi mukaan lukien? Aikaa {s} sekuntia.'],
    } as Record<string, string[]>,
    right: ['Täsmää. Kranaatti tulee.', 'Oikein. Ota kranaatti, ansaitsit sen.', 'Täsmää. Harvinaista. Kranaatti mukaan.'],
    rightFull: ['Täsmää. Vyö on jo täynnä, joten saat kiitoksen.', 'Oikein. Kranaatille ei ole tilaa, pelkkä kiitos.'],
    wrong: ['Ei täsmää. Laske uudestaan.', 'Väärin. Kello käy.', 'Ei pidä paikkaansa, {rank}. Uusi yritys.'],
    timeout: ['Inventaario jäi tekemättä. Kaksikymmentä punnerrusta. Kuittaa PUNNERRETTU.', 'Aika loppui. Punnerrusasentoon, ja kuittaa PUNNERRETTU kun olet valmis.'],
    /** Anything else typed to the vääpeli. */
    other: ['Numerolla. Inventaario ei ole keskustelu.', 'Vääpeli kysyy, alokas vastaa numerolla.', 'Täällä lasketaan, ei jutella.'],
    idle: ['Ei inventaariota käynnissä. Odota vuoroasi.', 'Kysyn kun kysyn.'],
    unlocked: ['Hyvä. Asevarasto palvelee taas.', 'Kuitattu. Jatka.'],
  },

  /**
   * The tutorial on the range: Asevarasto's first text is a radio check, just "YK". In English,
   * so newcomers understand it: anything but YK gets the explanation, and after that the
   * shorter tellings-off.
   */
  training: {
    radioCheck: ['YK'],
    radioCheckExplain: ["Asevarasto, radio check. If this message got through, reply YK. If it didn't, don't reply at all."],
    radioCheckOk: ['Loud and clear. Magazines on the way.\nFrom now on: LATAA when you run out of rounds, KRANAATTI when you need a grenade. There is nothing else.'],
    radioCheckWrong: ['Reply YK. Two letters, {rank}.', 'YK. Nothing else. A radio check is not a conversation.', "Type YK. Capitals or not, as long as it's two letters."],
  },
  ladder: {
    /** P-kausi gear came due with a kill or with a death: the first line before the task. */
    offerKill: ['Kunniamaininta, {rank} {name}. Varastossa olisi jotain sinulle.', 'Kunniamaininta. Joku on kerrankin tehnyt töitä.', 'Kunniamaininta tuli tänne asti. Katsotaan mitä löytyy.'],
    offerDeath: ['Vahinkoilmoitus käsitelty. Korvaavaa kalustoa on tarjolla.', 'Vahinkoilmoitus käsitelty. Kokoa ei ole, ota mikä on.', 'Vahinkoilmoitus käsitelty. Ei se aina sinun vikasi ole. Yleensä on.'],
    /** What is being handed over: P-kausi gear, or something bought from the Sotku. */
    gearIntro: ['Nimellesi on kirjattu: {item}.', 'P-kauden varusteita: {item} odottaa nimelläsi.'],
    orderIntro: ['Sotkun tilaus saapui: {item}.', 'Tilauksesi on täällä: {item}.', 'Sotku toimitti: {item}.'],
    /** A word to sign with (row II, and anything else handed over at the counter). */
    word: ['Kuittaa vastaanotto viestillä: {code}', 'Kuittaa: {code}', 'Lähetä {code}, niin kirjaan sen ulos.'],
    /** Stage 1: the rifle. */
    stage1: ['Nimellesi on kirjattu rynnäkkökivääri. Kuittaa vastaanotto viestillä: {code}', 'Rynkky odottaa luukulla. Kuittaa: {code}', 'Ase on varattu nimellesi. Lähetä {code}, niin kirjaan sen ulos.'],
    stage1Codes: ['KUITTAAN', 'SELVÄ', 'UUDISTUS', 'VASTAANOTETTU'],
    stage1Done: ['Kuitattu. Rynnäkkökivääri on nyt sinun. Älä hukkaa sitä.', 'Kuitattu. Rynkky on sinun. Kakkosnäppäin, jos et muuten löydä.'],
    /** Stage 2: the proper form of address at the asevarasto. */
    stage2: ['Varastossa on parannuksia, mutta ensin muodollisuudet. Kirjoita: {code}', 'Täällä puhutellaan oikein. Lähetä: {code}', 'Ennen kuin mitään luovutetaan, kirjoita: {code}'],
    stage2Codes: ['PYYDÄN LUPAA PUHUTELLA', 'HERRA KERSANTTI {RANK} {NAME}', 'UUDENLAINEN UUDISTUS', 'VESIHIISI SIHISI HISSISSÄ', 'MUSTAN KISSAN PAKSUT POSKET', 'KOKOO KOKOON KOKO KOKKO'],
    /** Stage 3: "not ours" — off to an office at a new number. */
    stage3: ['Ei kuulu meille. Ota yhteys: {office}, numero {number}.', 'Väärä luukku. {office} hoitaa tämän. Numero on {number}.', 'Tämä menee ylemmäs. {office}, {number}. Kirjoita itse, en minä sinua sinne vie.'],
    offices: [
      ['Komppanian toimisto', 'Komppanian toimistolle'],
      ['Esikunta', 'Esikunnalle'],
      ['Huolto-osasto', 'Huolto-osastolle'],
    ] as [string, string][],
    /** The office's first message when the player opens its chat: a phrase to send… */
    officePhrase: ['{office}. Asianne? Pyynnöt vain kirjallisena muodossa: {code}', '{office}, päivystäjä. Kirjoita pyyntösi näin: {code}'],
    officePhrases: ['HALUAN PAREMMAN ASEEN', 'ANON PARANNUSTA ASEESEENI', 'PYYDÄN LISÄVARUSTEITA', 'TARVITSEN SITÄ OIKEASTI'],
    /** …or a wall of regulations with the code word hidden in it ({code} in capitals). */
    officeRules: [
      '{office}. Palvelusohjesäännön mukaisesti varusmies, joka anoo lisävarusteita, on velvollinen ensin perehtymään asiaa koskeviin määräyksiin. Anomus käsitellään järjestyksessä, ellei esimies toisin määrää, ja käsittelyn kesto riippuu muun muassa kalustotilanteesta, vuorokaudenajasta ja käsittelijän mielialasta. Hyväksytty anomus vahvistetaan tunnussanalla {code}, joka lähetetään tähän numeroon. Väärin lähetetyt tunnussanat käsitellään torstaisin hernekeiton jälkeen.',
      '{office}. Varusmiehen on noudatettava saamiaan käskyjä viipymättä ja täsmällisesti. Kalustoa luovutetaan vain kuittausta vastaan, ja kuittaus annetaan kirjallisesti. Mikäli kuittaus on puutteellinen, epäselvä tai lähetetty väärään osoitteeseen, se katsotaan tekemättömäksi. Tämän pyynnön kuittaussana on {code}. Kuittaussanaa ei lausuta ääneen eikä kirjoiteta seinään. Kiire odottamaan.',
    ],
    officeWords: ['TELTTA', 'KAMINA', 'NUOTIO', 'KOMPASSI', 'SAAPAS', 'KENTTÄLAPIO', 'MAKUUPUSSI', 'HERNEKEITTO'],
    /** An office replying to anything else. */
    officeOther: ['Ei kuulu meille.', 'Toimisto on kiinni. Kiire odottamaan.', 'Pyynnöt kirjallisena ja oikeassa muodossa.'],
    /** Stage 4: a voice note from the Huoltopäällikkö at a long number. */
    stage4: ['Huoltopäällikkö hoitaa loput. Numero {number}. Kuuntele mitä hän sanoo.', 'Nyt mennään huoltopäällikön kautta: {number}. Hän lähettää tunnuksen ääniviestinä.'],
    huolto: 'Huoltopäällikkö',
    huoltoNote: ['Huoltopäällikkö. Tunnus tulee ääniviestinä. Vastaa tunnuksella.', 'Huolto. Kuuntele viesti ja kirjoita tunnus.'],
    /** Code words the voice note spells out in the phonetic alphabet. */
    stage4Codes: ['KETTU', 'KARHU', 'HIRVI', 'ILVES', 'SUSI', 'MÄYRÄ', 'JÄNIS', 'PÖLLÖ', 'TIKKA', 'NAALI', 'AHMA', 'SAUKKO'],
    /** A stage done: promotion. */
    promoted: ['Hyvä. Ylennys {rankTo}. TJ {tj}.', 'Kuitattu. Olet nyt {rank}. TJ {tj}.', 'Selvä. Ylennys {rankTo}. Aamuja jäljellä: {tj}.'],
    /** The upgrade screen's heading on the phone. */
    upgradeTitle: 'Kokoa ei ole, ota mikä on.',
    upgradeTaken: ['Kuitattu: {upgrade}.', '{upgrade} luovutettu. Allekirjoitus tähän.', '{upgrade}. Älä riko sitä heti.'],
    /** The right code in the wrong chat. */
    wrongChat: ['Väärä luukku. Lähetä se sinne, minne käskettiin.', 'Se ei kuulu tänne. Lue ohje uudestaan.'],
    /** Sotkun munkkikahvit: KIITOS completes the next challenge. */
    munkkiDone: ['Munkkikahvit tekivät tehtävänsä. Hoidettu.', 'Kiitos itsellesi. Tehtävä kuitattu munkin voimalla.'],
    /** Stage 5: the huoltopäällikkö wants the weapon's serial number (inspect: I). */
    stage5Intro: ['Huoltopäällikkö haluaa vielä jotain. Sama numero kuin viimeksi.', 'Huoltopäällikkö soittaa vielä. Tai siis kirjoittaa. Sama numero.'],
    /** The same, the first time you hear of the huoltopäällikkö. */
    stage5New: ['Tämä luovutetaan huoltopäällikön kautta: {number}. Hän tarkistaa ensin vanhan aseesi.', 'Huoltopäällikkö hoitaa tämän. Numero {number}. Pidä ase käden ulottuvilla.'],
    stage5: {
      full: ['Ennen luovutusta: ilmoita kiväärisi numero.', 'Ennen luovutusta tarkistetaan. Kiväärisi numero, kiitos.'],
      last3: ['Ennen luovutusta: kiväärisi numeron kolme viimeistä numeroa.', 'Ennen luovutusta: kolme viimeistä numeroa kiväärisi kyljestä.'],
      reversed: ['Ennen luovutusta: kiväärisi numero takaperin. Kyllä, takaperin.', 'Ennen luovutusta: lue kiväärisi numero lopusta alkuun.'],
      pistol: ['Ennen luovutusta: ilmoita pistoolisi numero.', 'Ennen luovutusta: sivuaseen numero, kiitos.'],
    },
    /** Stage 6: Nylands brigad, in Swedish. */
    stage6: ['Nyt mennään ruotsiksi. Nylands brigad, numero {number}. Onnea.', 'Viimeinen luukku on Dragsvikissä. Nylands brigad, {number}. Svenska, tack.'],
    nylands: 'Nylands brigad',
    nylandsNote: ['Nylands brigad, jourhavande. Lyssna på röstmeddelandet och svara med koden.', 'Hej från Dragsvik. Koden kommer som röstmeddelande.'],
    /** Answering in Finnish, or anything that isn't the code. */
    nylandsFinnish: ['Svara på svenska, tack.', 'På svenska, tack. Vi är tvåspråkiga här.'],
    nylandsWrong: ['Fel kod. Lyssna igen.', 'Det stämmer inte. Lyssna en gång till.'],
    nylandsDone: ['Rätt. Bra jobbat. Hälsa till Asevarasto.', 'Korrekt. Tack och adjö.'],
    /** The Swedish code words in Finnish, to catch answers in the wrong language. */
    swedishInFinnish: {
      ÄLG: 'HIRVI',
      RÄV: 'KETTU',
      BJÖRN: 'KARHU',
      VARG: 'SUSI',
      HARE: 'JÄNIS',
      LO: 'ILVES',
      UGGLA: 'PÖLLÖ',
      KORP: 'KORPPI',
      GÄDDA: 'HAUKI',
      ABBORRE: 'AHVEN',
      SILL: 'SILAKKA',
      MÅS: 'LOKKI',
    } as Record<string, string>,
    /** Discharged: the asevarasto's farewell. */
    tj0: 'TJ 0. Kotiutettu. LATAA ja KRANAATTI toimivat vielä, koska olen hyvä ihminen.',
  },

  /** The Sotku's once-a-round commands, texted to the asevarasto, and the café's goods at work. */
  abilities: {
    droneOk: ['Lennokki ilmassa. Viisitoista sekuntia, katso karttaa.', 'Tiedustelulennokki matkalla. Kartta näyttää kaikki.'],
    mortarOk: ['Tulitoimitus vastaanotettu. Kolme laukausta, kymmenen sekuntia. Pysy kaukana.', 'Tuli! Iskemät kymmenen sekunnin päästä. Varo itse.'],
    /** Already used this round. */
    used: ['Se on jo käytetty tällä kierroksella.', 'Yksi per kierros. Odota seuraavaa.'],
    /** TULI without a target: looking at the sky, or too far away. */
    noTarget: ['Ei maalia. Katso sinne, minne tuli halutaan.', 'Mihin? Osoita maali ensin.'],
    /** Nakkisuoja: the vääpeli's inventory check skips you once. */
    nakkisuoja: ['Nakkisuoja käytetty. Tällä kertaa säästyit inventaariolta.', 'Nakkisuoja. Vääpeli katsoo toiseen suuntaan, tämän kerran.'],
  },

  /** End-of-round awards (names; the English explanations are in ui.ts). */
  awards: {
    winner: 'Lomille ensimmäisenä',
    deathsTyping: 'Kaatui kesken viestin',
    longestDraft: 'Pisin keskeneräinen viesti',
    typos: 'Kirjoitusvirheiden kuningas',
    phoneTime: 'Kiire odottamaan',
    pushups: 'Punnerruskuningas',
    swedish: 'Pakkoruotsin sankari',
  },
};
