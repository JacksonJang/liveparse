import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GOOGLEBOT_SMARTPHONE_USER_AGENT,
  PublicSeoCheckError,
  runPublicSeoCheck,
} from './check-public-seo.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function startServer(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function htmlPage(canonical, body = '<h1>Useful public tool</h1>') {
  return '<!doctype html><html><head>' +
    '<meta name="robots" content="index, follow">' +
    `<title>Public SEO test page</title><link href="${canonical}" rel="canonical">` +
    `</head><body>${body}</body></html>`;
}

describe('public SEO deployment guard', () => {
  it('checks a canonical sitemap through a local transport with both browser user agents', async () => {
    const requests = [];
    const canonicalOrigin = 'https://liveparse.com';
    const baseUrl = await startServer((request, response) => {
      requests.push({
        path: request.url,
        forwardedHost: request.headers['x-forwarded-host'] || '',
        forwardedProto: request.headers['x-forwarded-proto'] || '',
        userAgent: request.headers['user-agent'] || '',
      });
      if (request.url === '/robots.txt') {
        response.setHeader('Content-Type', 'text/plain');
        response.end(`User-agent: *\nAllow: /\n\nSitemap: ${canonicalOrigin}/sitemap.xml\n`);
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.setHeader('Content-Type', 'application/xml');
        response.end('<?xml version="1.0"?><urlset>' +
          `<url><loc>${canonicalOrigin}/</loc></url>` +
          `<url><loc>${canonicalOrigin}/tool/?mode=public&amp;safe=1</loc></url>` +
          '</urlset>');
        return;
      }
      const canonical = request.url === '/' ? `${canonicalOrigin}/` : `${canonicalOrigin}/tool/?mode=public&safe=1`;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(htmlPage(canonical));
    });

    const counts = await runPublicSeoCheck({ baseUrl, concurrency: 2, timeoutMs: 2_000 });

    expect(counts).toEqual({ pageVariants: 4, robots: 1, sitemaps: 1, urls: 2 });
    expect(requests.every(({ forwardedHost }) => forwardedHost === 'liveparse.com')).toBe(true);
    expect(requests.every(({ forwardedProto }) => forwardedProto === 'https')).toBe(true);
    expect(requests.find(({ path }) => path === '/robots.txt')?.userAgent).toBe(GOOGLEBOT_SMARTPHONE_USER_AGENT);
    for (const path of ['/', '/tool/?mode=public&safe=1']) {
      const userAgents = requests.filter((request) => request.path === path).map((request) => request.userAgent);
      expect(userAgents).toHaveLength(2);
      expect(userAgents.some((userAgent) => userAgent.includes('Googlebot/2.1'))).toBe(true);
      expect(userAgents.some((userAgent) => !userAgent.includes('Googlebot/2.1'))).toBe(true);
    }
  });

  it('rejects an effective Googlebot blanket block even when the wildcard group allows crawling', async () => {
    const baseUrl = await startServer((request, response) => {
      response.setHeader('Content-Type', 'text/plain');
      response.end(
        `User-agent: *\nAllow: /\n\n` +
        `User-agent: Googlebot\nDisallow: /\n\nSitemap: http://${request.headers.host}/sitemap.xml\n`,
      );
    });

    await expect(runPublicSeoCheck({ baseUrl, canonicalOrigin: baseUrl, timeoutMs: 2_000 })).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.stringContaining('effective Googlebot group has no non-empty Allow'),
        expect.stringContaining('blanket Disallow'),
      ]),
    });
  });

  it('rejects duplicate and cross-origin sitemap locations before requesting pages', async () => {
    let pageRequests = 0;
    let origin;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end('<urlset>' +
          `<url><loc>${origin}/tool/</loc></url>` +
          `<url><loc>${origin}/tool/</loc></url>` +
          '<url><loc>https://other.example/tool/</loc></url>' +
          '</urlset>');
        return;
      }
      pageRequests += 1;
      response.end('unexpected');
    });
    origin = baseUrl;

    let error;
    try {
      await runPublicSeoCheck({ baseUrl, canonicalOrigin: baseUrl, timeoutMs: 2_000 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PublicSeoCheckError);
    expect(error.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('must use canonical origin'),
      expect.stringContaining('duplicate <loc> URL'),
    ]));
    expect(pageRequests).toBe(0);
  });

  it('reports page indexability, metadata, status, and user-agent body differences together', async () => {
    let origin;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(`<urlset><url><loc>${origin}/broken/</loc></url></urlset>`);
        return;
      }

      const isBot = (request.headers['user-agent'] || '').includes('Googlebot/2.1');
      if (!isBot) {
        response.statusCode = 503;
        response.setHeader('X-Robots-Tag', 'googlebot: noindex');
      }
      response.setHeader('Content-Type', 'text/html');
      response.end('<html><head><title></title><meta name="robots" content="nofollow">' +
        `<link rel="canonical" href="${origin}/wrong/"></head><body>` +
        (isBot ? '<p>bot-only response</p>' : '<p>browser response</p>') +
        '</body></html>');
    });
    origin = baseUrl;

    let error;
    try {
      await runPublicSeoCheck({ baseUrl, canonicalOrigin: baseUrl, timeoutMs: 2_000 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PublicSeoCheckError);
    expect(error.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('expected HTTP 200, received HTTP 503'),
      expect.stringContaining('X-Robots-Tag contains'),
      expect.stringContaining('meta robots contains'),
      expect.stringContaining('canonical is'),
      expect.stringContaining('no non-empty <title>'),
      expect.stringContaining('no non-empty <h1>'),
      expect.stringContaining('body differs between normal and Googlebot smartphone'),
    ]));
  });

  it('does not let robots and sitemap redefine the expected public canonical origin', async () => {
    const untrustedOrigin = 'https://untrusted.example';
    let sitemapRequests = 0;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(`User-agent: *\nAllow: /\nSitemap: ${untrustedOrigin}/sitemap.xml\n`);
        return;
      }
      sitemapRequests += 1;
      if (request.url === '/sitemap.xml') {
        response.end(`<urlset><url><loc>${untrustedOrigin}/</loc></url></urlset>`);
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(htmlPage(`${untrustedOrigin}/`));
    });

    await expect(runPublicSeoCheck({ baseUrl, timeoutMs: 2_000 })).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.stringContaining(
          `Sitemap must use canonical origin https://liveparse.com (${untrustedOrigin}/sitemap.xml)`,
        ),
      ]),
    });
    expect(sitemapRequests).toBe(0);
  });
});
