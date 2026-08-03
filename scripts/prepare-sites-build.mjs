#!/usr/bin/env node

import { cp, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDirectory = resolve(projectRoot, 'dist');
const source = resolve(projectRoot, 'server/worker.js');
const serverDirectory = resolve(distDirectory, 'server');
const destination = resolve(serverDirectory, 'index.js');
const clientDirectory = resolve(distDirectory, 'client');
const hostingSource = resolve(projectRoot, '.openai/hosting.json');
const hostingDirectory = resolve(distDirectory, '.openai');
const hostingDestination = resolve(hostingDirectory, 'hosting.json');

await mkdir(serverDirectory, { recursive: true });
await copyFile(source, destination);
await mkdir(hostingDirectory, { recursive: true });
await copyFile(hostingSource, hostingDestination);
await rm(clientDirectory, { recursive: true, force: true });
await mkdir(clientDirectory, { recursive: true });

for (const entry of await readdir(distDirectory, { withFileTypes: true })) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') continue;
  await cp(resolve(distDirectory, entry.name), resolve(clientDirectory, entry.name), { recursive: true });
}

console.log('Prepared Cloudflare Worker entry for Sites hosting.');
