/**
 * Finnish content: what is spoken or typed in Finnish in the game (range commands, voice
 * lines, in-world place names and, later, the varusmestari's script and the phone commands).
 * Interface text is English and lives in ui.ts.
 * Edit freely: the keys are used by code, the strings are yours.
 */
export const FI = {
  range: {
    /** Place-name signs in the world. */
    signs: {
      title: 'AMPUMARATA',
      office: 'RATATOIMISTO',
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

};
