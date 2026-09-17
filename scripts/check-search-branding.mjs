#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnglishBranding, validatePngIcon } from './seo-branding.mjs';

export const RETIRED_LANGUAGE_ROUTES = new Map([
  ['/ko/json-parser', '/json-formatter/'],
  ['/ko/character-counter', '/character-counter/'],
  ['/ja/character-counter', '/character-counter/'],
  ['/es/contador-de-palabras', '/word-counter/'],
  ['/es/contador-de-caracteres', '/character-counter/'],
  ['/es/contador-palabras', '/word-counter/'],
  ['/es/contar-palabras', '/word-counter/'],
  ['/es/contador-caracteres', '/character-counter/'],
  ['/es/contar-caracteres', '/character-counter/'],
]);

export async function runSearchBrandingCheck({ baseUrl = 'https://liveparse.com', fetchImpl = fetch } = {}) {
  const failures = [];
  const base = new URL(baseUrl);
  const request = (path, userAgent) => fetchImpl(new URL(path, base), {
    redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { 'X-Forwarded-Host': 'liveparse.com', 'X-Forwarded-Proto': 'https', 'User-Agent': userAgent },
  });
  // These are access checks using claimed crawler identities, not proof of indexing.
  for (const userAgent of ['Mozilla/5.0', 'Googlebot']) {
    for (const path of ['/', '/json-formatter/', '/word-counter/', '/character-counter/']) {
      const response = await request(path, userAgent);
      if (response.status !== 200) failures.push(`${path}: expected 200, got ${response.status}`);
      if (!response.headers.get('content-type')?.includes('text/html')) failures.push(`${path}: expected HTML`);
      failures.push(...validateEnglishBranding(await response.text(), `${path} [${userAgent}]`));
    }
    for (const [oldPath, target] of RETIRED_LANGUAGE_ROUTES) {
      for (const suffix of ['', '/', '/index.html']) {
        const path = `${oldPath}${suffix}?source=english-migration&value=%E2%9C%93`;
        const response = await request(path, userAgent);
        const location = response.headers.get('location');
        const resolved = location ? new URL(location, base) : null;
        if (response.status !== 308 || resolved?.pathname !== target
          || resolved?.search !== '?source=english-migration&value=%E2%9C%93'
          || ![base.origin, 'https://liveparse.com'].includes(resolved?.origin)) {
          failures.push(`${path}: expected direct 308 to ${target} with query preserved; got ${response.status} ${location}`);
        }
        await response.arrayBuffer();
      }
    }
  }
  for (const userAgent of ['Mozilla/5.0', 'Googlebot-Image']) {
    for (const [path, size] of [['/icon-192.png', 192], ['/icon-512.png', 512], ['/apple-touch-icon.png', 180]]) {
      const response = await request(path, userAgent);
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('image/png')) {
        failures.push(`${path} [${userAgent}]: expected 200 image/png`);
      }
      failures.push(...validatePngIcon(Buffer.from(await response.arrayBuffer()), size, path));
    }
    const ico = await request('/favicon.ico', userAgent);
    const bytes = Buffer.from(await ico.arrayBuffer());
    if (ico.status !== 200 || !/^image\/(?:x-icon|vnd\.microsoft\.icon)/.test(ico.headers.get('content-type') || '')
      || bytes.length < 6 || bytes.readUInt16LE(2) !== 1 || bytes.readUInt16LE(4) < 1) {
      failures.push(`/favicon.ico [${userAgent}]: expected a valid, accessible ICO`);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return 'English pages, 54 permanent redirect variants, and search icons passed.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(await runSearchBrandingCheck({ baseUrl: process.argv[2] })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
