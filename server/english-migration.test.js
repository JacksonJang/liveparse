import { describe, expect, it } from 'vitest';
import worker from './worker.js';
import { RETIRED_LANGUAGE_ROUTES } from '../scripts/check-search-branding.mjs';

describe('English migration HTTP responses', () => {
  it('permanently redirects every language URL and alias directly, preserving the query', async () => {
    for (const [oldPath, target] of RETIRED_LANGUAGE_ROUTES) {
      for (const suffix of ['', '/', '/index.html']) {
        for (const origin of ['https://liveparse.com', 'http://liveparse.com', 'https://www.liveparse.com']) {
          const response = await worker.fetch(new Request(`${origin}${oldPath}${suffix}?q=a%20b&x=1&x=2`), {});
          expect(response.status).toBe(308);
          expect(response.headers.get('location')).toBe(`https://liveparse.com${target}?q=a%20b&x=1&x=2`);
        }
      }
    }
  });
  it('serves final English targets without another redirect and keeps unknown paths as 404', async () => {
    const env = { ASSETS: { fetch: async (request) => new Response('asset', {
      status: new URL(request.url).pathname === '/ko/missing/' ? 404 : 200,
    }) } };
    for (const path of new Set(RETIRED_LANGUAGE_ROUTES.values())) {
      const response = await worker.fetch(new Request(`https://liveparse.com${path}`), env);
      expect(response.status).toBe(200);
    }
    expect((await worker.fetch(new Request('https://liveparse.com/ko/missing/'), env)).status).toBe(404);
  });
});
