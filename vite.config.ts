import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(projectRoot, 'index.html'),
        koJsonParser: resolve(projectRoot, 'ko/json-parser/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['liveparse.com', 'www.liveparse.com'],
  },
  preview: {
    port: 4173,
    allowedHosts: ['liveparse.com', 'www.liveparse.com'],
  },
});
