#!/usr/bin/env node

import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDirectory = resolve(process.argv[2] || process.env.DIST_DIR || resolve(projectRoot, 'dist'));
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

// Cloudflare Pages reads this static-routing layer before deploying an updated
// Worker runtime, so canonical aliases remain live during rolling deployments.
const workerSource = await readFile(source, 'utf8');
const redirectEntries = [...workerSource.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)]
  .map((match) => [match[1], match[2]]);
if (redirectEntries.length === 0) throw new Error('No canonical redirects parsed from the Worker entry.');
const redirectSources = new Set(redirectEntries.map(([source]) => source));
if (redirectSources.size !== redirectEntries.length) throw new Error('Duplicate canonical redirect source.');
await writeFile(
  resolve(clientDirectory, '_redirects'),
  `${redirectEntries.map(([aliasPath, target]) => `${aliasPath} ${target} 308`).join('\n')}\n`,
);

console.log('Prepared Cloudflare Worker entry for Sites hosting.');
