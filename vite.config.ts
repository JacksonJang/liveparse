import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['liveparse.com', 'www.liveparse.com'],
  },
  preview: {
    port: 4173,
    allowedHosts: ['liveparse.com', 'www.liveparse.com'],
  },
});
