/**
 * In-world content: what the game's characters text and say (the chats, range commands, voice
 * lines, place names). The chats are in English and keep the Finnish names, ranks, army terms
 * and the codes players type; the voice lines and signs are Finnish, the discharge Swedish.
 * Interface text lives in ui.ts.
 * Edit freely: the keys are used by code, the strings are yours.
 * **WORD** marks a codeword the player writes back: the phone draws it bold (shared/markup.ts).
 */
export const FI = {
  range: {
    /** Place-name signs in the world. */
    signs: {
      title: 'AMPUMARATA',
      office: 'RATATOIMISTO',
      duty: 'PÄIVYSTÄJÄ',
    },
    /** Range commands shown with the voice lines (the recording booth, tools/recorder/, lists them all). */
    commands: {
      positions: 'Ampumapaikoille!',
      fire: 'Tuli vapaa!',
      cease: 'Tulitauko!',
      ended: 'Ammunta päättyi. Varmista!',
    },
  },

  /**
   * Voice lines. `tools/gen-voice.ts` makes placeholders from these and the recording booth's list
   * (tools/recorder/); recordings in assets/voice/ with the same file name replace them.
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
    /** First message in the chat; it stays in the history as the instructions. */
    welcome: ['Asevarasto. Services:\n**LATAA**: full magazines, the spare too.\n**KRANAATTI**: one grenade, throw with G.\nThere is nothing else. Hurry up and wait.'],
    /** Short acknowledgements after a reload; an empty string means no reply at all. */
    reloadOk: ['Signed for.', 'Loaded. Next.', 'Magazine swapped.', "Here. Don't waste it.", 'Take it and go.', "Rounds don't grow on trees.", '', '', ''],
    reloadFull: ['Your magazines are full. Shoot first, {rank}.', 'All full, the spare too. What are you even loading?', 'You have everything already. Count for yourself.'],
    reloadBusy: ['Already loading. Hurry up and wait.', 'One reload at a time.'],
    grenadeOk: ['One grenade. The pin stays in until you throw.', "Grenade signed out. Don't drop it at your feet.", 'Here. Throw it far. Farther than you think.', 'Signed for. G throws it. Keep your teeth off the pin.'],
    grenadeLimit1: ['One per man.', 'You already have a grenade. Use it first.'],
    grenadeLimit2: ["Two per man. The belt doesn't stretch.", 'Your belt is full. Throw one first.'],
    grenadeCooldown: ['Out of grenades. The next batch comes when it comes.', 'The store is empty. Ask again in a moment.', 'None left. Supply is on the way.'],
    dead: ['The fallen are not served.', "The dead don't order anything.", 'Get up first, then text.'],
    oldRound: ['That was a different round. Start over.'],
    nearMiss: ["Did you mean **{cmd}**? We don't guess here.", '**{cmd}** is spelled **{cmd}**. Again.', 'Read the instructions. **{cmd}**. Nothing else.'],
    swear: ['{rank}! Language! Ten push-ups, then report **PUNNERRETTU**.', 'Nobody talks to the asevarasto like that. Ten push-ups, and you report **PUNNERRETTU**.'],
    locked: ['Push-ups first. Report **PUNNERRETTU**.', 'No service until you have done your push-ups. **PUNNERRETTU**.'],
    unlocked: ['Good. Service continues.', 'Right. And mind your language from now on.'],
    unlockedNotLocked: ['Nobody told you to do push-ups. Good, though.'],
    question: ['Hurry up and wait.', 'Questions in writing to Komppanian toimisto.'],
    help: ['Help is handed out on Thursdays, with the hernekeitto.'],
    /** Writing English or Swedish to the asevarasto: the orders are Finnish. */
    english: ['Orders here are given in Finnish. **LATAA** or **KRANAATTI**.', 'Say it in Finnish. **LATAA** for ammo, **KRANAATTI** for a grenade.'],
    swedish: ['Nylands brigad is in Dragsvik. Orders here are given in Finnish.'],
    greeting: ['Päivää. Get to the point.', 'Terve terve. What do you need? **LATAA** or **KRANAATTI**.', "Moi. This isn't a chat room."],
    thanks: ['Ei kestä. Now go.', 'Thanks go in the hernekeitto queue.', 'Joo joo.'],
    numbers: ['Numbers go to the office. Here you order with words.', 'This is no switchboard.'],
    empty: ['Use words.', 'What?'],
    spam: ['One message at a time, {rank}.', 'Calm down. No running in here.'],
    other: [
      'Not our department.',
      'No sizes, take what there is. **LATAA** or **KRANAATTI**.',
      'This counter hands out two things, **LATAA** and **KRANAATTI**.',
      'The service regulations know no such request.',
      'Your TJ is long, and you write things like that.',
      'What?',
    ],
    /** Message to a number that doesn't exist. */
    unknownNumber: 'This number does not exist.',
    /** A service now and then comes with an old typo quoted back ({typo}, as it was typed). */
    roast: ['I remember you, {rank}. Last time you wrote “{typo}”.', "Nothing is forgotten here, {rank}. “{typo}”, that's what you wrote.", '“{typo}”. That was you. I remember.', 'Right this time. Last time it was “{typo}”.'],
    /** To the killer of someone caught texting: {name} the victim, {days} what the kill served, {tj} days left. */
    caught: ['{name} got caught texting. That takes {days} days off. TJ {tj}.', '{name} was on the phone. Not anymore. TJ {tj}.', 'You shot someone mid-sentence. Efficient. {days} days off your service.'],
  },

  /**
   * Ranks by days served: alokas in P-kausi, sotamies after it, korpraali and alikersantti with
   * the pay rises, kersantti once discharged. How the varusmestari addresses them.
   */
  ranks: ['alokas', 'sotamies', 'korpraali', 'alikersantti', 'kersantti', 'ylikersantti', 'vääpeli'],
  /** Short forms for the kill feed and scoreboard. */
  rankAbbr: ['Alok.', 'Stm.', 'Kpl.', 'Alik.', 'Kers.', 'Ylik.', 'Vääp.'],

  /**
   * The company commander: a higher-up who texts the milestones of your service (only to you).
   * In English on purpose, so everyone understands the rules they announce; Päiväraha and the
   * ranks keep their Finnish names. {name} the player, {tj} days left, {eur} the new Päiväraha,
   * {rank} the new rank, {bonus} the promotion bonus in €, {number} where to write.
   */
  commander: {
    name: 'Komppanian päällikkö',
    number: '7400',
    /** P-kausi is passed: the Sotku App opens, and alokas becomes sotamies. */
    pkausi: ['Congratulations on passing P-kausi. You are promoted to {rank} and get a {bonus} € promotion bonus. You may now use the Sotku App to buy goods and services.'],
    /** A pay rise, which is also a promotion (just the pay for someone still in P-kausi). */
    rise: ['TJ {tj}! You are promoted to {rank} and get a {bonus} € promotion bonus. Your Päiväraha is now {eur} € a day.'],
    raise: ['TJ {tj}! Your Päiväraha is now {eur} € a day.'],
    /** TJ 0: the discharge paperwork, at Nylands brigad. */
    tj0: ['TJ 0! Your discharge papers are waiting. The last counter is in Dragsvik: Nylands brigad, number {number}. Svenska, tack.'],
    /** Discharged: the reservist star and a free pick from the Sotku. */
    discharged: ['Discharged. Reservin kersantti {name}, you have earned the reservist star and a {bonus} € promotion bonus. Your discharge gift: one item from the Sotku, free.'],
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
    /** Each opens with the check's Finnish name, as the vääpeli shouts it. */
    ask: {
      mag: ['Inventaario! How many rounds are in your magazine right now? Answer with a number, {s} seconds.', 'Inventaario. Rounds in your magazine, how many? A number. You have {s} seconds.'],
      spare: ['Inventaario! How many rounds are in your spare magazine? A number, {s} seconds.', 'Inventaario. Spare magazine, how many rounds? You have {s} seconds.'],
      grenades: ['Inventaario! How many grenades are you carrying? A number, {s} seconds.', 'Inventaario. Grenades, how many? You have {s} seconds.'],
      kills: ['Tilastointi! How many kills do you have in this exercise? A number, {s} seconds.', 'Tilastointi. Kills in this exercise, how many? You have {s} seconds.'],
      deaths: ['Tilastointi! How many times have you been killed in this exercise? Honestly, {s} seconds.', 'Tilastointi. How many times have you fallen in this exercise? You have {s} seconds.'],
      players: ['Vahvuusilmoitus! How many soldiers are on the field, you included? {s} seconds.', 'Vahvuusilmoitus. Strength on the field, yourself included? You have {s} seconds.'],
    } as Record<string, string[]>,
    right: ['That tallies. A grenade is coming.', 'Right. Take a grenade, you earned it.', "That tallies. That's rare. Take a grenade."],
    rightFull: ['That tallies. Your belt is already full, so you get a thank-you.', 'Right. No room for a grenade, so just a thank-you.'],
    wrong: ["That doesn't tally. Count again.", 'Wrong. The clock is running.', 'Not true, {rank}. Try again.'],
    timeout: ['Inventaario not done. Twenty push-ups. Report **PUNNERRETTU**.', 'Time is up. Down for push-ups, and report **PUNNERRETTU** when you are done.'],
    /** Anything else typed to the vääpeli. */
    other: ['With a number. An inventaario is no conversation.', 'The vääpeli asks, the alokas answers with a number.', 'We count here. No chatting.'],
    idle: ['No inventaario going on. Wait your turn.', 'I ask when I ask.'],
    unlocked: ['Good. The asevarasto serves you again.', 'Signed for. Carry on.'],
  },

  /**
   * The tutorial on the range: Asevarasto's first text is a radio check, just "YK". Anything but
   * YK gets the explanation, and after that the shorter tellings-off.
   */
  training: {
    radioCheck: ['**YK**'],
    radioCheckExplain: ["Asevarasto, radio check. If this message got through, reply **YK**. If it didn't, don't reply at all."],
    radioCheckOk: ["Alright, the comms work. Here's full ammo for you.\nIn the future you can send me the code word **LATAA** for full ammo and **KRANAATTI** for a grenade."],
    radioCheckWrong: ['Reply **YK**. Two letters, {rank}.', '**YK**. Nothing else. A radio check is not a conversation.', "Type **YK**. Capitals or not, as long as it's two letters."],
  },
  ladder: {
    /** P-kausi gear came due with a kill or with a death: the first line before the task. */
    offerKill: ['Commendation, {rank} {name}. There is something in the store for you.', 'Commendation. Somebody did some work for once.', "Word of your commendation reached us. Let's see what we have."],
    offerDeath: ['Damage report processed. Replacement kit is available.', 'Damage report processed. No sizes, take what there is.', "Damage report processed. It isn't always your fault. Usually it is."],
    /** What is being handed over: P-kausi gear, or something bought from the Sotku. */
    gearIntro: ['Booked under your name: {item}.', 'P-kausi gear: {item} is waiting under your name.'],
    orderIntro: ['Your Sotku order arrived: {item}.', 'Your order is here: {item}.', 'Delivered by the Sotku: {item}.'],
    /** A word to sign with (row II, and anything else handed over at the counter). */
    word: ['Sign for it with a message: **{code}**', 'Sign: **{code}**', "Send **{code}** and I'll book it out."],
    /** Stage 1: the rifle. */
    stage1: ['A rynnäkkökivääri is booked under your name. Sign for it with a message: **{code}**', 'The rynkky is waiting at the counter. Sign: **{code}**', "A rifle is reserved under your name. Send **{code}** and I'll book it out."],
    stage1Codes: ['KUITTAAN', 'SELVÄ', 'UUDISTUS', 'VASTAANOTETTU'],
    stage1Done: ["Signed for. The rynnäkkökivääri is yours now. Don't lose it.", "Signed for. The rynkky is yours. Key 2, if you can't find it otherwise."],
    /** Stage 2: the proper form of address at the asevarasto. */
    stage2: ['There are upgrades in the store, but formalities first. Write: **{code}**', 'We address people properly here. Send: **{code}**', 'Before anything is handed over, write: **{code}**'],
    stage2Codes: ['PYYDÄN LUPAA PUHUTELLA', 'HERRA KERSANTTI {RANK} {NAME}', 'UUDENLAINEN UUDISTUS', 'VESIHIISI SIHISI HISSISSÄ', 'MUSTAN KISSAN PAKSUT POSKET', 'KOKOO KOKOON KOKO KOKKO'],
    /** Stage 3: "not ours", off to an office at a new number. */
    stage3: ['Not our department. Contact {office}, number {number}.', 'Wrong counter. {office} handles this. The number is {number}.', "This goes higher up. {office}, {number}. Write to them yourself, I won't take you there."],
    offices: ['Komppanian toimisto', 'Esikunta', 'Huolto-osasto'],
    /** The office's first message when the player opens its chat: a phrase to send… */
    officePhrase: ['{office}. Your business? Requests in writing only, in this form: **{code}**', '{office}, duty officer. Write your request like this: **{code}**'],
    officePhrases: ['HALUAN PAREMMAN ASEEN', 'ANON PARANNUSTA ASEESEENI', 'PYYDÄN LISÄVARUSTEITA', 'TARVITSEN SITÄ OIKEASTI'],
    /** …or a wall of regulations with the code word hidden in it ({code} in capitals, not bold: finding it is the task). */
    officeRules: [
      '{office}. Under the service regulations, a conscript applying for additional equipment must first study the orders concerning the matter. Applications are processed in order unless a superior orders otherwise, and the processing time depends on, among other things, the equipment situation, the time of day and the mood of the clerk. An approved application is confirmed with the code word {code}, sent to this number. Code words sent to the wrong number are processed on Thursdays after the hernekeitto.',
      '{office}. A conscript shall carry out the orders received without delay and to the letter. Equipment is handed over only against a signature, and the signature is given in writing. A signature that is incomplete, unclear or sent to the wrong address is considered not given. The signature word for this request is {code}. The signature word is not to be spoken aloud or written on walls. Hurry up and wait.',
    ],
    officeWords: ['TELTTA', 'KAMINA', 'NUOTIO', 'KOMPASSI', 'SAAPAS', 'KENTTÄLAPIO', 'MAKUUPUSSI', 'HERNEKEITTO'],
    /** An office replying to anything else. */
    officeOther: ['Not our department.', 'The office is closed. Hurry up and wait.', 'Requests in writing, in the correct form.'],
    /** Stage 4: a voice note from the Huoltopäällikkö at a long number. */
    stage4: ['The huoltopäällikkö handles the rest. Number {number}. Listen to the voice message.', 'This one goes through the huoltopäällikkö, {number}. The code comes as a voice message.'],
    huolto: 'Huoltopäällikkö',
    huoltoNote: ['Huoltopäällikkö. The code comes as a voice message. Reply with the code.', 'Huolto. Listen to the message and write the code.'],
    /** Code words the voice note spells out in the phonetic alphabet. */
    stage4Codes: ['KETTU', 'KARHU', 'HIRVI', 'ILVES', 'SUSI', 'MÄYRÄ', 'JÄNIS', 'PÖLLÖ', 'TIKKA', 'NAALI', 'AHMA', 'SAUKKO'],
    /** A stage done: promotion ({rank} is the new one). */
    promoted: ['Good. Promoted to {rank}. TJ {tj}.', 'Signed for. You are {rank} now. TJ {tj}.', 'Selvä. Promoted to {rank}. TJ {tj}.'],
    /** The upgrade screen's heading on the phone. */
    upgradeTitle: 'No sizes. Take what there is.',
    upgradeTaken: ['Signed for: {upgrade}.', '{upgrade} handed over. Sign here.', "{upgrade}. Don't break it right away."],
    /** The right code in the wrong chat. */
    wrongChat: ['Wrong counter. Send it where you were told.', "That doesn't belong here. Read the instructions again."],
    /** A new number read, but its chat still not opened after SERVICE.numberReminder seconds. */
    numberReminder: ['Hey, I told you to send a message to number {number}! You can do it from the main menu of your phone by pressing the + icon in the corner.'],
    /** Sotkun munkkikahvit: KIITOS completes the next challenge. */
    munkkiDone: ['The munkkikahvit did their job. Done.', 'Thank yourself. Paperwork signed for on the strength of a munkki.'],
    /** Stage 5: the huoltopäällikkö wants the weapon's serial number (inspect: I). */
    stage5Intro: ['The huoltopäällikkö wants something else. Same number as last time.', 'The huoltopäällikkö is calling again. Writing, that is. Same number.'],
    /** The same, the first time you hear of the huoltopäällikkö. */
    stage5New: ['This is handed over through the huoltopäällikkö, {number}. Your old weapon gets checked first.', 'The huoltopäällikkö handles this. Number {number}. Keep your weapon within reach.'],
    stage5: {
      full: ["Before the handover, report your rifle's serial number.", "There's a check before the handover. Your rifle's serial number, please."],
      last3: ["Before the handover, the last three digits of your rifle's serial number.", 'Before the handover, the last three digits off the side of your rifle.'],
      reversed: ["Before the handover, your rifle's serial number backwards. Yes, backwards.", "Before the handover, read your rifle's serial number from the end to the start."],
      pistol: ["Before the handover, report your pistol's serial number.", "Before the handover, your sidearm's serial number, please."],
    },
    /** The discharge: Nylands brigad, in Swedish (the company commander gives the number). */
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
    tj0: 'TJ 0. Discharged. **LATAA** and **KRANAATTI** still work, because I am a good person.',
  },

  /** The Sotku's once-a-round commands, texted to the asevarasto, and the café's goods at work. */
  abilities: {
    droneOk: ['Lennokki in the air. Fifteen seconds, watch the map.', 'Tiedustelulennokki on its way. The map shows everyone.'],
    mortarOk: ['Tulitoimitus received. Three rounds, ten seconds. Stay well clear.', 'Tuli! Impacts in ten seconds. Watch yourself.'],
    /** Already used this round. */
    used: ['Already used this round.', 'One per round. Wait for the next one.'],
    /** TULI without a target: looking at the sky, or too far away. */
    noTarget: ['No target. Look where you want the fire.', 'Where? Point at the target first.'],
    /** Nakkisuoja: the vääpeli's inventory check skips you once. */
    nakkisuoja: ['Nakkisuoja used. You were spared the inventaario this time.', 'Nakkisuoja. The vääpeli looks the other way, just this once.'],
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
