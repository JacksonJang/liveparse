#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INDEXNOW_HOST = 'liveparse.com';
export const INDEXNOW_KEY = 'c88f079f99dd87428d1f2d70cfc08b6f';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_STATE_VERSION = 1;

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_SITEMAP_PATH = resolve(PROJECT_ROOT, 'public/sitemap.xml');
const DEFAULT_DIST_CLIENT_ROOT = resolve(PROJECT_ROOT, 'dist/client');
const DEFAULT_KEY_PATH = resolve(PROJECT_ROOT, `public/${INDEXNOW_KEY}.txt`);
const DEFAULT_STATE_PATH = resolve(PROJECT_ROOT, '.runtime/indexnow-state.json');

export function parseCanonicalSitemapUrls(source, host = INDEXNOW_HOST) {
  const values = [...source.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
  if (values.length === 0) throw new Error('No URLs found in the sitemap.');

  const seen = new Set();
  for (const value of values) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.host !== host || url.username || url.password || url.search || url.hash) {
      throw new Error(`Refusing to submit a non-canonical URL: ${value}`);
    }
    if (seen.has(url.href)) throw new Error(`Duplicate canonical URL in sitemap: ${url.href}`);
    seen.add(url.href);
  }
  return [...seen];
}

export function canonicalUrlToHtmlPath(value, distClientRoot, host = INDEXNOW_HOST) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.host !== host) throw new Error(`Unexpected canonical URL: ${value}`);
  const decodedPath = decodeURIComponent(url.pathname);
  if (!decodedPath.startsWith('/') || decodedPath.includes('\\') || decodedPath.split('/').includes('..')) {
    throw new Error(`Unsafe canonical URL path: ${value}`);
  }
  if (decodedPath === '/') return resolve(distClientRoot, 'index.html');
  if (!decodedPath.endsWith('/')) throw new Error(`Canonical HTML URL must end with a slash: ${value}`);
  return resolve(distClientRoot, `.${decodedPath}`, 'index.html');
}

export async function hashCanonicalHtml(urlList, distClientRoot, host = INDEXNOW_HOST) {
  const hashes = {};
  for (const value of urlList) {
    const htmlPath = canonicalUrlToHtmlPath(value, distClientRoot, host);
    let html;
    try {
      html = await readFile(htmlPath);
    } catch (error) {
      throw new Error(`Cannot hash built canonical page ${value} at ${htmlPath}: ${error.message}`);
    }
    hashes[value] = createHash('sha256').update(html).digest('hex');
  }
  return hashes;
}

export function changedCanonicalUrls(currentHashes, previousHashes = null) {
  if (!previousHashes) return Object.keys(currentHashes).sort();
  const changed = new Set();
  for (const [url, hash] of Object.entries(currentHashes)) {
    if (previousHashes[url] !== hash) changed.add(url);
  }
  for (const url of Object.keys(previousHashes)) {
    if (!(url in currentHashes)) changed.add(url);
  }
  return [...changed].sort();
}

function validHashMap(value, host) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([url, hash]) => {
      try {
        const parsed = new URL(url);
        return parsed.href === url && parsed.protocol === 'https:' && parsed.host === host
          && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
          && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
      } catch {
        return false;
      }
    });
}

export async function readIndexNowState(statePath, host = INDEXNOW_HOST) {
  let source;
  try {
    source = await readFile(statePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const state = JSON.parse(source);
  if (state?.version !== INDEXNOW_STATE_VERSION || !validHashMap(state.hashes, host)) {
    throw new Error(`Invalid IndexNow state file: ${statePath}`);
  }
  return state;
}

export async function writeIndexNowState(statePath, hashes, now = new Date()) {
  const state = {
    version: INDEXNOW_STATE_VERSION,
    submittedAt: now.toISOString(),
    hashes,
  };
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, statePath);
  return state;
}

export async function runIndexNowSubmission({
  sitemapPath = DEFAULT_SITEMAP_PATH,
  distClientRoot = DEFAULT_DIST_CLIENT_ROOT,
  keyPath = DEFAULT_KEY_PATH,
  statePath = DEFAULT_STATE_PATH,
  host = INDEXNOW_HOST,
  key = INDEXNOW_KEY,
  endpoint = INDEXNOW_ENDPOINT,
  fetchImpl = fetch,
  now = () => new Date(),
  write = console.log,
} = {}) {
  const [sitemap, keySource, previousState] = await Promise.all([
    readFile(sitemapPath, 'utf8'),
    readFile(keyPath, 'utf8'),
    readIndexNowState(statePath, host),
  ]);
  if (keySource.trim() !== key) throw new Error(`IndexNow key file does not contain the configured key: ${keyPath}`);

  const urlList = parseCanonicalSitemapUrls(sitemap, host);
  const hashes = await hashCanonicalHtml(urlList, distClientRoot, host);
  const changedUrls = changedCanonicalUrls(hashes, previousState?.hashes);
  if (changedUrls.length === 0) {
    write(`IndexNow skipped: all ${urlList.length} canonical pages match the last successful submission.`);
    return { submitted: false, status: null, urlList: [], canonicalCount: urlList.length };
  }

  const keyLocation = `https://${host}/${key}.txt`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation, urlList: changedUrls }),
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(`IndexNow submission failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  await writeIndexNowState(statePath, hashes, now());
  write(`IndexNow received ${changedUrls.length} changed canonical URL${changedUrls.length === 1 ? '' : 's'} (HTTP ${response.status}; ${urlList.length} current canonical pages).`);
  return { submitted: true, status: response.status, urlList: changedUrls, canonicalCount: urlList.length };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await runIndexNowSubmission();
}
