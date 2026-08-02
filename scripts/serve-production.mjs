#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL_ORIGIN = 'https://liveparse.com';
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parsePort(process.env.PORT || '4173');
const DIRECTORY_ROUTES = new Set([
  '/ko/json-parser',
  '/json-repair',
  '/jsonl-parser',
  '/privacy',
  '/guides/what-is-a-json-parser',
  '/guides/common-json-errors',
  '/guides/json-parser-vs-formatter-validator',
]);

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

function requestPathAndQuery(request) {
  try {
    const parsed = new URL(request.url || '/', 'http://request.invalid');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
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
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${CANONICAL_ORIGIN}${requestPathAndQuery(request)}`);
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

async function handleRequest(distRoot, request, response) {
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
  if (DIRECTORY_ROUTES.has(requestPath)) {
    redirectToTrailingSlash(request, response, requestPath);
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

  const server = createServer((request, response) => {
    handleRequest(distRoot, request, response).catch((error) => {
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
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}

await main();
