import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import { App } from './app';

const root = document.getElementById('app')!;
new App(root).start().catch((err) => {
  console.error(err);
  root.insertAdjacentHTML('beforeend', `<div class="fatal">Start-up failed: ${String(err?.message ?? err)}</div>`);
});
