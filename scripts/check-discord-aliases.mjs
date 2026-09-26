#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_BASE_URL = 'https://liveparse.com';
export const CANONICAL_DISCORD_PATH = '/discord-timestamp-generator/';
export const DISCORD_REDIRECT_ROUTES = new Map([
  ['/discord-timestamp-converter', CANONICAL_DISCORD_PATH],
  ['/discord-time-converter', CANONICAL_DISCORD_PATH],
  ['/discord-time-generator', CANONICAL_DISCORD_PATH],
  ['/discord-snowflake-converter', CANONICAL_DISCORD_PATH],
  ['/discord-message-id-converter', CANONICAL_DISCORD_PATH],
  ['/discord-id-converter', CANONICAL_DISCORD_PATH],
]);
export const REDIRECT_PATH_SUFFIXES = ['', '/', '/index.html'];
const NORMAL_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const GOOGLEBOT_SMARTPHONE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export function discordRedirectRequests() {
  const requests = [];
  for (const [sourcePath, targetPath] of DISCORD_REDIRECT_ROUTES) {
    for (const suffix of REDIRECT_PATH_SUFFIXES) {
      for (const userAgent of [NORMAL_USER_AGENT, GOOGLEBOT_SMARTPHONE_USER_AGENT]) {
        requests.push({ sourcePath: `${sourcePath}${suffix}`, targetPath, userAgent });
      }
    }
  }
  return requests;
}

export async function runDiscordAliasCheck({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new TypeError(`Base URL is invalid: ${JSON.stringify(baseUrl)}`);
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash) {
    throw new TypeError('Base URL must be an HTTP(S) origin without a path, query, or fragment.');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch-compatible implementation is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Timeout must be a positive integer.');

  const failures = [];
  const requests = discordRedirectRequests();
  const results = await Promise.allSettled(requests.map(async ({ sourcePath, targetPath, userAgent }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      const response = await fetchImpl(new URL(sourcePath, base), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/html,*/*;q=0.8', 'User-Agent': userAgent },
      });
      await response.body?.cancel?.();
      const location = response.headers.get('location');
      if (response.status !== 308) {
        failures.push(`${sourcePath}: expected HTTP 308, received HTTP ${response.status}`);
        return;
      }
      if (!location) {
        failures.push(`${sourcePath}: expected Location ${targetPath}, received no Location`);
        return;
      }
      const resolved = new URL(location, base);
      if (resolved.pathname !== targetPath) {
        failures.push(`${sourcePath}: expected Location pathname ${targetPath}, received ${resolved.pathname}`);
      }
    } catch (error) {
      failures.push(`${sourcePath}: request failed (${error?.message || String(error)})`);
    } finally {
      clearTimeout(timeout);
    }
  }));

  for (const result of results) {
    if (result.status === 'rejected') failures.push(`redirect request failed (${result.reason?.message || String(result.reason)})`);
  }

  if (failures.length > 0) {
    const error = new Error(`${failures.length} Discord alias check${failures.length === 1 ? '' : 's'} failed`);
    error.name = 'DiscordAliasCheckError';
    error.failures = failures;
    throw error;
  }
  return { requests: requests.length, redirects: DISCORD_REDIRECT_ROUTES.size };
}

export function formatDiscordAliasCounts({ requests, redirects }) {
  return `${redirects} Discord alias routes (${requests} user-agent/redirect variants)`;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/check-discord-aliases.mjs [base-origin]');
    return 0;
  }
  if (argv.length > 1) {
    console.error('Usage: node scripts/check-discord-aliases.mjs [base-origin]');
    return 1;
  }
  try {
    const counts = await runDiscordAliasCheck({ baseUrl: argv[0] || DEFAULT_BASE_URL });
    console.log(`Discord alias check passed: ${formatDiscordAliasCounts(counts)}.`);
    return 0;
  } catch (error) {
    if (error.failures) {
      console.error(`Discord alias check failed: ${error.failures.length} failure${error.failures.length === 1 ? '' : 's'}.`);
      for (const failure of error.failures.slice(0, 25)) console.error(`- ${failure}`);
      if (error.failures.length > 25) console.error(`- ... ${error.failures.length - 25} additional failure(s) omitted`);
    } else {
      console.error(`Discord alias check could not run: ${error.message}`);
    }
    return 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = await main();
