#!/usr/bin/env node

import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(projectRoot, 'server/worker.js');
const serverDirectory = resolve(projectRoot, 'dist/server');
const destination = resolve(serverDirectory, 'index.js');

await mkdir(serverDirectory, { recursive: true });
await copyFile(source, destination);
console.log('Prepared Cloudflare Worker entry for Sites hosting.');
