import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Writes dist/sw.js from src/sw.js with this build's files, for offline use.
// The speech runtime (.wasm, 26 MB) isn't kept up front; it is kept when first used.
function serviceWorker() {
  let outDir;
  return {
    name: 'kodama-service-worker',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    writeBundle(_, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map')).sort();
      const shell = ['/', ...files.filter(f => f !== 'index.html' && !f.endsWith('.wasm')).map(f => `/${f}`),
        '/manifest.webmanifest', '/icons/icon.svg'];
      const page = bundle['index.html']?.source ?? '';
      const version = createHash('sha256').update(files.join('\n')).update(page).digest('hex').slice(0, 8);
      const code = readFileSync(resolve(import.meta.dirname, 'src/sw.js'), 'utf8')
        .replace('__BUILT__', `${Date.now()}-${version}`)
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__ASSETS__', JSON.stringify(files.filter(f => f.startsWith('assets/')).map(f => `/${f}`)));
      writeFileSync(resolve(outDir, 'sw.js'), code);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
