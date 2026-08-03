const CANONICAL_ORIGIN = 'https://liveparse.com';
const DIRECTORY_ROUTES = new Set([
  '/ko/json-parser',
  '/json-repair',
  '/jsonl-parser',
  '/json-to-csv',
  '/csv-to-json',
  '/json-compare',
  '/unix-timestamp-converter',
  '/privacy',
  '/guides/what-is-a-json-parser',
  '/guides/common-json-errors',
  '/guides/json-parser-vs-formatter-validator',
  '/guides/compare-api-responses',
  '/guides/compare-json-ignore-order',
  '/guides/unix-timestamp-seconds-vs-milliseconds',
  '/guides/unix-timestamp-code-examples',
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
]);

function normalizeKnownRoutePath(pathname) {
  if (ROUTE_REDIRECTS.has(pathname)) return ROUTE_REDIRECTS.get(pathname);
  if (DIRECTORY_ROUTES.has(pathname)) return `${pathname}/`;
  if (pathname === '/index.html') return '/';
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length);
  return pathname;
}

function securityHeaders(headers) {
  headers.set('Content-Security-Policy', [
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
  ].join('; '));
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.liveparse.com' || (url.hostname === 'liveparse.com' && url.protocol !== 'https:')) {
      return Response.redirect(`${CANONICAL_ORIGIN}${normalizeKnownRoutePath(url.pathname)}${url.search}`, 308);
    }
    if (ROUTE_REDIRECTS.has(url.pathname)) {
      url.pathname = ROUTE_REDIRECTS.get(url.pathname);
      return Response.redirect(url.toString(), 308);
    }
    if (DIRECTORY_ROUTES.has(url.pathname)) {
      // Keep private/preview Sites hosts on their current origin while still
      // normalizing the public liveparse.com URL to its canonical slash form.
      url.pathname = `${url.pathname}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === '/index.html' || url.pathname.endsWith('/index.html')) {
      url.pathname = url.pathname === '/index.html' ? '/' : url.pathname.slice(0, -'index.html'.length);
      return Response.redirect(url.toString(), 308);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = securityHeaders(new Headers(assetResponse.headers));

    if (url.hostname !== 'liveparse.com' && url.hostname !== 'www.liveparse.com') {
      headers.set('X-Robots-Tag', 'noindex, nofollow');
    }

    if (url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(url.pathname)) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if ((headers.get('Content-Type') || '').includes('text/html')) {
      headers.set('Cache-Control', 'no-cache');
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
