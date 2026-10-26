import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: false,
  appType: 'mpa',
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      input: { main: 'index.html' },
    },
  },
});
