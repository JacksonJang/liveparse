#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'liveparse.com';
const KEY = 'c88f079f99dd87428d1f2d70cfc08b6f';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sitemap = await readFile(resolve(PROJECT_ROOT, 'public/sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());

if (urlList.length === 0) throw new Error('No URLs found in public/sitemap.xml.');
for (const value of urlList) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== HOST) throw new Error(`Refusing to submit a non-canonical URL: ${value}`);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
});

if (!response.ok) {
  const detail = (await response.text()).trim();
  throw new Error(`IndexNow submission failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
}

console.log(`IndexNow accepted ${urlList.length} canonical URL${urlList.length === 1 ? '' : 's'} (HTTP ${response.status}).`);
