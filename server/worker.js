const CANONICAL_ORIGIN = 'https://liveparse.com';

function securityHeaders(headers) {
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.liveparse.com' || (url.hostname === 'liveparse.com' && url.protocol !== 'https:')) {
      return Response.redirect(`${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 308);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = securityHeaders(new Headers(assetResponse.headers));

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
