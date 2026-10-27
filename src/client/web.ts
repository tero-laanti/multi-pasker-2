/**
 * The browser version on mp2.laanti.fi (`npm run build:web`): a static site with no game server.
 * Its match is a bot match whose server runs in the page, its phone is the virtual one, and the
 * main menu says the game is made for a LAN.
 */
export const WEB = import.meta.env.MODE === 'web';

export const REPO_URL = 'https://github.com/tero-laanti/multi-pasker-2';
