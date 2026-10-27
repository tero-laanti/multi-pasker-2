import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { AudioFolder } from './src/server/http';

/**
 * The web version (`--mode web`, for mp2.laanti.fi) has no server to hand out sounds: they go
 * into the build, picked the way the server picks them (a recording in the top folder wins over
 * the generated one), at the same extensionless paths the client asks for.
 */
function bundledAudio(): Plugin {
  return {
    name: 'pasker-bundled-audio',
    generateBundle() {
      for (const [kind, fallback] of [
        ['sfx', '_base'],
        ['voice', '_placeholder'],
      ] as const) {
        const folder = new AudioFolder(path.resolve('assets', kind), path.resolve('assets', kind, fallback));
        const manifest = folder.manifest();
        for (const name of Object.keys(manifest)) {
          const file = folder.resolve(name);
          if (file) this.emitFile({ type: 'asset', fileName: `${kind}/${name}`, source: fs.readFileSync(file) });
        }
        if (kind === 'sfx') this.emitFile({ type: 'asset', fileName: 'sfx/manifest.json', source: JSON.stringify(manifest) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    root: '.',
    publicDir: false,
    appType: 'mpa',
    clearScreen: false,
    plugins: web ? [bundledAudio()] : [],
    build: {
      outDir: web ? 'dist-web' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: !web,
      chunkSizeWarningLimit: 4000,
      rolldownOptions: {
        input: { main: 'index.html', phone: 'phone.html' },
      },
    },
  };
});
