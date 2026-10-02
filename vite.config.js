import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import lookupApi from './server/vite-plugin.js';

export default defineConfig({
  plugins: [react(), lookupApi()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
