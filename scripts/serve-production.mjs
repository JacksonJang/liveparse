#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SearchReferralCounter, searchReferralFromRequest } from '../server/search-referrals.js';

const CANONICAL_ORIGIN = 'https://liveparse.com';
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parsePort(process.env.PORT || '4173');
const SEARCH_REFERRAL_DIR = resolve(PROJECT_ROOT, process.env.SEARCH_REFERRAL_DIR || '.runtime/search-referrals');
const DIRECTORY_ROUTES = new Set([
  '/ko/json-parser',
  '/json-repair',
  '/jsonl-parser',
  '/json-to-csv',
  '/csv-to-json',
  '/json-compare',
  '/unix-timestamp-converter',
  '/discord-timestamp-generator',
  '/base64-decoder',
  '/base64-encoder',
  '/uuid-generator',
  '/uuid-v7-generator',
  '/uuid-validator',
  '/jwt-decoder',
  '/jwt-expiration-checker',
  '/sql-formatter',
  '/mysql-sql-formatter',
  '/postgresql-sql-formatter',
  '/bigquery-sql-formatter',
  '/sql-server-formatter',
  '/xml-formatter',
  '/xml-validator',
  '/xml-viewer',
  '/privacy',
  '/guides/what-is-a-json-parser',
  '/guides/common-json-errors',
  '/guides/json-parser-vs-formatter-validator',
  '/guides/compare-api-responses',
  '/guides/compare-json-ignore-order',
  '/guides/unix-timestamp-seconds-vs-milliseconds',
  '/guides/unix-timestamp-code-examples',
  '/guides/discord-timestamp-formats',
  '/guides/base64-vs-base64url',
  '/guides/uuid-v4-vs-v7',
  '/guides/jwt-decode-vs-verify',
  '/guides/sql-dialect-formatting',
  '/guides/xml-well-formed-vs-valid',
]);
const ROUTE_REDIRECTS = new Map([
  ['/json-diff', '/json-compare/'],
  ['/json-diff/', '/json-compare/'],
  ['/json-diff-checker', '/json-compare/'],
  ['/json-diff-checker/', '/json-compare/'],
  ['/epoch-converter', '/unix-timestamp-converter/'],
  ['/epoch-converter/', '/unix-timestamp-converter/'],
  ['/epoch-time-converter', '/unix-timestamp-converter/'],
  ['/epoch-time-converter/', '/unix-timestamp-converter/'],
  ['/timestamp-converter', '/unix-timestamp-converter/'],
  ['/timestamp-converter/', '/unix-timestamp-converter/'],
  ['/unix-time-converter', '/unix-timestamp-converter/'],
  ['/unix-time-converter/', '/unix-timestamp-converter/'],
  ['/discord-timestamp', '/discord-timestamp-generator/'],
  ['/discord-timestamp/', '/discord-timestamp-generator/'],
  ['/discord-timestamp-converter', '/discord-timestamp-generator/'],
  ['/discord-timestamp-converter/', '/discord-timestamp-generator/'],
  ['/discord-time-converter', '/discord-timestamp-generator/'],
  ['/discord-time-converter/', '/discord-timestamp-generator/'],
  ['/discord-time-generator', '/discord-timestamp-generator/'],
  ['/discord-time-generator/', '/discord-timestamp-generator/'],
  ['/base64-decode', '/base64-decoder/'],
  ['/base64-decode/', '/base64-decoder/'],
  ['/base64-encode', '/base64-encoder/'],
  ['/base64-encode/', '/base64-encoder/'],
  ['/base64-encoder-decoder', '/base64-decoder/'],
  ['/base64-encoder-decoder/', '/base64-decoder/'],
  ['/guid-generator', '/uuid-generator/'],
  ['/guid-generator/', '/uuid-generator/'],
  ['/uuid-v4-generator', '/uuid-generator/'],
  ['/uuid-v4-generator/', '/uuid-generator/'],
  ['/generate-uuid', '/uuid-generator/'],
  ['/generate-uuid/', '/uuid-generator/'],
  ['/uuid-generator-online', '/uuid-generator/'],
  ['/uuid-generator-online/', '/uuid-generator/'],
  ['/uuid-v7', '/uuid-v7-generator/'],
  ['/uuid-v7/', '/uuid-v7-generator/'],
  ['/uuid-checker', '/uuid-validator/'],
  ['/uuid-checker/', '/uuid-validator/'],
  ['/jwt-decode', '/jwt-decoder/'],
  ['/jwt-decode/', '/jwt-decoder/'],
  ['/decode-jwt', '/jwt-decoder/'],
  ['/decode-jwt/', '/jwt-decoder/'],
  ['/jwt-parser', '/jwt-decoder/'],
  ['/jwt-parser/', '/jwt-decoder/'],
  ['/jwt-debugger', '/jwt-decoder/'],
  ['/jwt-debugger/', '/jwt-decoder/'],
  ['/jwt-inspector', '/jwt-decoder/'],
  ['/jwt-inspector/', '/jwt-decoder/'],
  ['/jwt-token-decoder', '/jwt-decoder/'],
  ['/jwt-token-decoder/', '/jwt-decoder/'],
  ['/json-web-token-decoder', '/jwt-decoder/'],
  ['/json-web-token-decoder/', '/jwt-decoder/'],
  ['/jwt-exp-checker', '/jwt-expiration-checker/'],
  ['/jwt-exp-checker/', '/jwt-expiration-checker/'],
  ['/jwt-expiry-checker', '/jwt-expiration-checker/'],
  ['/jwt-expiry-checker/', '/jwt-expiration-checker/'],
  ['/jwt-token-expiration-checker', '/jwt-expiration-checker/'],
  ['/jwt-token-expiration-checker/', '/jwt-expiration-checker/'],
  ['/sql-format', '/sql-formatter/'],
  ['/sql-format/', '/sql-formatter/'],
  ['/format-sql', '/sql-formatter/'],
  ['/format-sql/', '/sql-formatter/'],
  ['/sql-query-formatter', '/sql-formatter/'],
  ['/sql-query-formatter/', '/sql-formatter/'],
  ['/sql-beautifier', '/sql-formatter/'],
  ['/sql-beautifier/', '/sql-formatter/'],
  ['/sql-pretty-printer', '/sql-formatter/'],
  ['/sql-pretty-printer/', '/sql-formatter/'],
  ['/online-sql-formatter', '/sql-formatter/'],
  ['/online-sql-formatter/', '/sql-formatter/'],
  ['/mysql-formatter', '/mysql-sql-formatter/'],
  ['/mysql-formatter/', '/mysql-sql-formatter/'],
  ['/mysql-query-formatter', '/mysql-sql-formatter/'],
  ['/mysql-query-formatter/', '/mysql-sql-formatter/'],
  ['/postgresql-formatter', '/postgresql-sql-formatter/'],
  ['/postgresql-formatter/', '/postgresql-sql-formatter/'],
  ['/postgres-formatter', '/postgresql-sql-formatter/'],
  ['/postgres-formatter/', '/postgresql-sql-formatter/'],
  ['/postgres-query-formatter', '/postgresql-sql-formatter/'],
  ['/postgres-query-formatter/', '/postgresql-sql-formatter/'],
  ['/bigquery-formatter', '/bigquery-sql-formatter/'],
  ['/bigquery-formatter/', '/bigquery-sql-formatter/'],
  ['/google-sql-formatter', '/bigquery-sql-formatter/'],
  ['/google-sql-formatter/', '/bigquery-sql-formatter/'],
  ['/tsql-formatter', '/sql-server-formatter/'],
  ['/tsql-formatter/', '/sql-server-formatter/'],
  ['/t-sql-formatter', '/sql-server-formatter/'],
  ['/t-sql-formatter/', '/sql-server-formatter/'],
  ['/mssql-formatter', '/sql-server-formatter/'],
  ['/mssql-formatter/', '/sql-server-formatter/'],
  ['/sql-server-sql-formatter', '/sql-server-formatter/'],
  ['/sql-server-sql-formatter/', '/sql-server-formatter/'],
  ['/xml-format', '/xml-formatter/'],
  ['/xml-format/', '/xml-formatter/'],
  ['/format-xml', '/xml-formatter/'],
  ['/format-xml/', '/xml-formatter/'],
  ['/xml-beautifier', '/xml-formatter/'],
  ['/xml-beautifier/', '/xml-formatter/'],
  ['/xml-pretty-printer', '/xml-formatter/'],
  ['/xml-pretty-printer/', '/xml-formatter/'],
  ['/online-xml-formatter', '/xml-formatter/'],
  ['/online-xml-formatter/', '/xml-formatter/'],
  ['/xml-formatter-online', '/xml-formatter/'],
  ['/xml-formatter-online/', '/xml-formatter/'],
  ['/validate-xml', '/xml-validator/'],
  ['/validate-xml/', '/xml-validator/'],
  ['/xml-validation', '/xml-validator/'],
  ['/xml-validation/', '/xml-validator/'],
  ['/xml-checker', '/xml-validator/'],
  ['/xml-checker/', '/xml-validator/'],
  ['/xml-syntax-checker', '/xml-validator/'],
  ['/xml-syntax-checker/', '/xml-validator/'],
  ['/online-xml-validator', '/xml-validator/'],
  ['/online-xml-validator/', '/xml-validator/'],
  ['/xml-validator-online', '/xml-validator/'],
  ['/xml-validator-online/', '/xml-validator/'],
  ['/view-xml', '/xml-viewer/'],
  ['/view-xml/', '/xml-viewer/'],
  ['/xml-tree-viewer', '/xml-viewer/'],
  ['/xml-tree-viewer/', '/xml-viewer/'],
  ['/online-xml-viewer', '/xml-viewer/'],
  ['/online-xml-viewer/', '/xml-viewer/'],
  ['/xml-viewer-online', '/xml-viewer/'],
  ['/xml-viewer-online/', '/xml-viewer/'],
]);
const CANONICAL_METRIC_PATHS = new Set(['/', ...[...DIRECTORY_ROUTES].map((pathname) => `${pathname}/`)]);

const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    'upgrade-insecure-requests',
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received ${JSON.stringify(value)}`);
  }
  return port;
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(',', 1)[0].trim() : '';
}

function requestProtocol(request) {
  const forwarded = firstHeaderValue(request.headers['x-forwarded-proto']).toLowerCase();
  if (forwarded) return forwarded.replace(/:$/, '');
  return request.socket.encrypted ? 'https' : 'http';
}

function requestHostname(request) {
  const forwarded = firstHeaderValue(request.headers['x-forwarded-host']);
  const host = forwarded || firstHeaderValue(request.headers.host);
  if (!host) return '';

  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.replace(/:\d+$/, '').toLowerCase();
  }
}

function normalizeKnownRoutePath(pathname) {
  if (ROUTE_REDIRECTS.has(pathname)) return ROUTE_REDIRECTS.get(pathname);
  if (DIRECTORY_ROUTES.has(pathname)) return `${pathname}/`;
  if (pathname === '/index.html') return '/';
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length);
  return pathname;
}

function setSecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

function sendText(request, response, statusCode, message, extraHeaders = {}) {
  const body = Buffer.from(`${message}\n`, 'utf8');
  response.statusCode = statusCode;
  setSecurityHeaders(response);
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', body.byteLength);
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(request.method === 'HEAD' ? undefined : body);
}

function redirectToCanonical(request, response) {
  let parsed;
  try {
    parsed = new URL(request.url || '/', 'http://request.invalid');
  } catch {
    parsed = new URL('/', 'http://request.invalid');
  }
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${CANONICAL_ORIGIN}${normalizeKnownRoutePath(parsed.pathname)}${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function redirectToTrailingSlash(request, response, pathname) {
  const parsed = new URL(request.url || '/', 'http://request.invalid');
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${pathname}/${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function redirectFromIndexHtml(request, response, pathname) {
  const parsed = new URL(request.url || '/', 'http://request.invalid');
  const canonicalPath = pathname === '/index.html' ? '/' : pathname.slice(0, -'index.html'.length);
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${canonicalPath}${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function redirectToRoute(request, response, pathname) {
  const parsed = new URL(request.url || '/', 'http://request.invalid');
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${pathname}${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function decodedRequestPath(request) {
  let encodedPath;
  try {
    encodedPath = new URL(request.url || '/', 'http://request.invalid').pathname;
  } catch {
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\')) return null;
  if (pathname.split('/').some((segment) => segment === '..')) return null;
  return pathname;
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

async function findStaticFile(distRoot, requestPath) {
  const candidate = resolve(distRoot, requestPath.slice(1));
  if (!isWithin(distRoot, candidate)) return null;

  let candidateStat;
  try {
    candidateStat = await stat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }

  let filePath = candidate;
  if (candidateStat.isDirectory()) {
    filePath = resolve(candidate, 'index.html');
    if (!isWithin(distRoot, filePath)) return null;
    try {
      candidateStat = await stat(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
      throw error;
    }
  }

  if (!candidateStat.isFile()) return null;

  const realFilePath = await realpath(filePath);
  if (!isWithin(distRoot, realFilePath)) return null;
  return { filePath: realFilePath, fileStat: candidateStat };
}

function isHashedAsset(requestPath) {
  return requestPath.startsWith('/assets/') && /(?:^|\/)[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(requestPath);
}

function cacheControl(requestPath, filePath) {
  if (['.htm', '.html'].includes(extname(filePath).toLowerCase())) return 'no-cache';
  if (isHashedAsset(requestPath)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=300';
}

function etagFor(fileStat) {
  return `W/\"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}\"`;
}

function isNotModified(request, fileStat, etag) {
  const ifNoneMatch = firstHeaderValue(request.headers['if-none-match']);
  if (ifNoneMatch && ifNoneMatch === etag) return true;

  const ifModifiedSince = firstHeaderValue(request.headers['if-modified-since']);
  if (!ifNoneMatch && ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (Number.isFinite(since) && Math.trunc(fileStat.mtimeMs / 1000) <= Math.trunc(since / 1000)) return true;
  }
  return false;
}

async function handleRequest(distRoot, searchReferralCounter, request, response) {
  if (requestProtocol(request) !== 'https' || requestHostname(request) !== 'liveparse.com') {
    redirectToCanonical(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(request, response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  const requestPath = decodedRequestPath(request);
  if (requestPath === null) {
    sendText(request, response, 400, 'Bad Request');
    return;
  }
  if (ROUTE_REDIRECTS.has(requestPath)) {
    redirectToRoute(request, response, ROUTE_REDIRECTS.get(requestPath));
    return;
  }
  if (DIRECTORY_ROUTES.has(requestPath)) {
    redirectToTrailingSlash(request, response, requestPath);
    return;
  }
  if (requestPath === '/index.html' || requestPath.endsWith('/index.html')) {
    redirectFromIndexHtml(request, response, requestPath);
    return;
  }

  const staticFile = await findStaticFile(distRoot, requestPath);
  if (!staticFile) {
    sendText(request, response, 404, 'Not Found');
    return;
  }

  const { filePath, fileStat } = staticFile;
  const etag = etagFor(fileStat);
  response.statusCode = 200;
  setSecurityHeaders(response);
  response.setHeader('Content-Type', MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream');
  response.setHeader('Content-Length', fileStat.size);
  response.setHeader('Cache-Control', cacheControl(requestPath, filePath));
  response.setHeader('ETag', etag);
  response.setHeader('Last-Modified', fileStat.mtime.toUTCString());

  const referral = searchReferralFromRequest({
    method: request.method,
    isHtml: ['.htm', '.html'].includes(extname(filePath).toLowerCase()),
    requestPath,
    referrer: firstHeaderValue(request.headers.referer),
    userAgent: firstHeaderValue(request.headers['user-agent']),
    allowedPaths: CANONICAL_METRIC_PATHS,
    purpose: firstHeaderValue(request.headers.purpose),
    secPurpose: firstHeaderValue(request.headers['sec-purpose']),
    secFetchDest: firstHeaderValue(request.headers['sec-fetch-dest']),
  });
  if (referral) void searchReferralCounter.record(referral);

  if (isNotModified(request, fileStat, etag)) {
    response.statusCode = 304;
    response.removeHeader('Content-Length');
    response.end();
    return;
  }

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    console.error(`Failed to stream ${filePath}:`, error);
    if (!response.headersSent) sendText(request, response, 500, 'Internal Server Error');
    else response.destroy(error);
  });
  stream.pipe(response);
}

async function main() {
  let distRoot;
  try {
    distRoot = await realpath(DIST_ROOT);
    const distStat = await stat(distRoot);
    if (!distStat.isDirectory()) throw new Error(`${DIST_ROOT} is not a directory`);
  } catch (error) {
    console.error(`Cannot serve production build at ${DIST_ROOT}:`, error.message);
    process.exitCode = 1;
    return;
  }

  const searchReferralCounter = new SearchReferralCounter({
    directory: SEARCH_REFERRAL_DIR,
    onError: (...details) => console.error(...details),
  });

  const server = createServer((request, response) => {
    handleRequest(distRoot, searchReferralCounter, request, response).catch((error) => {
      console.error('Unhandled request error:', error);
      if (!response.headersSent) sendText(request, response, 500, 'Internal Server Error');
      else response.destroy(error);
    });
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  server.on('error', (error) => {
    console.error('Production server error:', error);
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    console.log(`Serving ${distRoot} on http://${HOST}:${PORT}`);
    console.log(`Canonical origin: ${CANONICAL_ORIGIN}`);
    console.log('Cookie-free search referral aggregation: enabled');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => {
      await searchReferralCounter.flush();
      process.exit(0);
    }));
  }
}

await main();
