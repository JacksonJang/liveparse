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
        jsonRepair: resolve(projectRoot, 'json-repair/index.html'),
        jsonlParser: resolve(projectRoot, 'jsonl-parser/index.html'),
        jsonToCsv: resolve(projectRoot, 'json-to-csv/index.html'),
        csvToJson: resolve(projectRoot, 'csv-to-json/index.html'),
        jsonCompare: resolve(projectRoot, 'json-compare/index.html'),
        unixTimestampConverter: resolve(projectRoot, 'unix-timestamp-converter/index.html'),
        discordTimestampGenerator: resolve(projectRoot, 'discord-timestamp-generator/index.html'),
        base64Decoder: resolve(projectRoot, 'base64-decoder/index.html'),
        base64Encoder: resolve(projectRoot, 'base64-encoder/index.html'),
        uuidGenerator: resolve(projectRoot, 'uuid-generator/index.html'),
        uuidV7Generator: resolve(projectRoot, 'uuid-v7-generator/index.html'),
        uuidValidator: resolve(projectRoot, 'uuid-validator/index.html'),
        jwtDecoder: resolve(projectRoot, 'jwt-decoder/index.html'),
        jwtExpirationChecker: resolve(projectRoot, 'jwt-expiration-checker/index.html'),
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
