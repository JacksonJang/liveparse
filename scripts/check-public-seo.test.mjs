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
  return '<!doctype html><html lang="en"><head>' +
    '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">' +
    '<meta name="robots" content="index, follow">' +
    `<title>Public SEO test page</title><link href="${canonical}" rel="canonical">` +
    `</head><body>${body}</body></html>`;
}

const FEED_UPDATED = '2026-08-04T06:56:03+09:00';
const CHECK_NOW = new Date('2026-08-04T08:00:00+09:00');

function robotsFile(origin, extra = '') {
  return `User-agent: *\nAllow: /\n\n` +
    `Sitemap: ${origin}/sitemap.xml\n` +
    `Sitemap: ${origin}/feed.xml\n${extra}`;
}

function atomFeed(origin, urls = [`${origin}/`], {
  feedUpdated = FEED_UPDATED,
  hub = 'https://pubsubhubbub.appspot.com/',
} = {}) {
  const entries = urls.map((url, index) => `
  <entry>
    <id>${url}</id>
    <title>Recent page ${index + 1}</title>
    <link rel="alternate" type="text/html" href="${url}" />
    <published>${feedUpdated}</published>
    <updated>${feedUpdated}</updated>
    <summary>Useful recent page ${index + 1}.</summary>
  </entry>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <id>${origin}/feed.xml</id>
  <title>LiveParse Developer Tool Updates</title>
  <updated>${feedUpdated}</updated>
  <link rel="self" type="application/atom+xml" href="${origin}/feed.xml" />
  <link rel="alternate" type="text/html" href="${origin}/" />
  <link rel="hub" href="${hub}" />
  <author><name>Jackson Jang</name><uri>https://github.com/JacksonJang</uri></author>${entries}
</feed>`;
}

function sendAtom(response, source) {
  response.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
  response.end(source);
}

function sitemapFile(urls) {
  return `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
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
        response.end(robotsFile(canonicalOrigin));
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
      if (request.url === '/feed.xml') {
        sendAtom(response, atomFeed(canonicalOrigin));
        return;
      }
      const canonical = request.url === '/' ? `${canonicalOrigin}/` : `${canonicalOrigin}/tool/?mode=public&safe=1`;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(htmlPage(canonical));
    });

    const counts = await runPublicSeoCheck({ baseUrl, concurrency: 2, now: CHECK_NOW, timeoutMs: 2_000 });

    expect(counts).toEqual({ feedEntries: 1, feeds: 1, pageVariants: 4, robots: 1, sitemaps: 1, urls: 2 });
    expect(requests.every(({ forwardedHost }) => forwardedHost === 'liveparse.com')).toBe(true);
    expect(requests.every(({ forwardedProto }) => forwardedProto === 'https')).toBe(true);
    expect(requests.find(({ path }) => path === '/robots.txt')?.userAgent).toBe(GOOGLEBOT_SMARTPHONE_USER_AGENT);
    expect(requests.find(({ path }) => path === '/feed.xml')?.userAgent).toBe(GOOGLEBOT_SMARTPHONE_USER_AGENT);
    for (const path of ['/', '/tool/?mode=public&safe=1']) {
      const userAgents = requests.filter((request) => request.path === path).map((request) => request.userAgent);
      expect(userAgents).toHaveLength(2);
      expect(userAgents.some((userAgent) => userAgent.includes('Googlebot/2.1'))).toBe(true);
      expect(userAgents.some((userAgent) => !userAgent.includes('Googlebot/2.1'))).toBe(true);
    }
  });

  it('compares decoded Cloudflare email-protection tokens instead of their randomized ciphertext', async () => {
    let origin;
    const encode = (value, key) => {
      const bytes = Buffer.from(value);
      return key.toString(16).padStart(2, '0') + [...bytes].map((byte) => (byte ^ key).toString(16).padStart(2, '0')).join('');
    };
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(robotsFile(origin));
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(`<urlset><url><loc>${origin}/</loc></url></urlset>`);
        return;
      }
      if (request.url === '/feed.xml') {
        sendAtom(response, atomFeed(origin));
        return;
      }
      const isBot = (request.headers['user-agent'] || '').includes('Googlebot/2.1');
      const token = encode('yaml@2.9.0', isBot ? 0x4a : 0x25);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(htmlPage(`${origin}/`, `<h1>Useful public tool</h1><a data-cfemail="${token}" href="/cdn-cgi/l/email-protection">protected</a>`));
    });
    origin = baseUrl;

    await expect(runPublicSeoCheck({
      baseUrl,
      canonicalOrigin: baseUrl,
      now: CHECK_NOW,
      timeoutMs: 2_000,
    })).resolves.toMatchObject({ feedEntries: 1, feeds: 1, urls: 1 });
  });

  it('rejects an effective Googlebot blanket block even when the wildcard group allows crawling', async () => {
    const baseUrl = await startServer((request, response) => {
      response.setHeader('Content-Type', 'text/plain');
      response.end(
        `User-agent: *\nAllow: /\n\n` +
        `User-agent: Googlebot\nDisallow: /\n\n` +
        `Sitemap: http://${request.headers.host}/sitemap.xml\n` +
        `Sitemap: http://${request.headers.host}/feed.xml\n`,
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
        response.end(robotsFile(origin));
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
      await runPublicSeoCheck({ baseUrl, canonicalOrigin: baseUrl, now: CHECK_NOW, timeoutMs: 2_000 });
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
        response.end(robotsFile(origin));
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(`<urlset><url><loc>${origin}/broken/</loc></url></urlset>`);
        return;
      }
      if (request.url === '/feed.xml') {
        sendAtom(response, atomFeed(origin, [`${origin}/broken/`]));
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
      await runPublicSeoCheck({ baseUrl, canonicalOrigin: baseUrl, now: CHECK_NOW, timeoutMs: 2_000 });
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

  it('requires exactly the canonical URL-set and Atom feed declarations in robots.txt', async () => {
    let discoveryRequests = 0;
    let origin;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(robotsFile(
          origin,
          `Sitemap: ${origin}/feed.xml\nSitemap: ${origin}/extra.xml\n`,
        ));
        return;
      }
      discoveryRequests += 1;
      response.end('unexpected');
    });
    origin = baseUrl;

    await expect(runPublicSeoCheck({
      baseUrl,
      canonicalOrigin: baseUrl,
      now: CHECK_NOW,
      timeoutMs: 2_000,
    })).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.stringContaining('duplicate Sitemap directive'),
        expect.stringContaining('unexpected Sitemap directive'),
        expect.stringContaining('expected exactly 2 Sitemap directives'),
      ]),
    });
    expect(discoveryRequests).toBe(0);
  });

  it('reports Atom MIME, namespace, discovery-link, and author violations together', async () => {
    let pageRequests = 0;
    let origin;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(robotsFile(origin));
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(sitemapFile([`${origin}/`]));
        return;
      }
      if (request.url === '/feed.xml') {
        response.setHeader('Content-Type', 'application/xml');
        response.end(
          atomFeed(origin)
            .replace('xmlns="http://www.w3.org/2005/Atom"', 'xmlns="https://invalid.example/Atom"')
            .replace('rel="self" type="application/atom+xml"', 'rel="self" type="application/xml"')
            .replace(`rel="alternate" type="text/html" href="${origin}/"`, `rel="alternate" type="text/html" href="${origin}/guides/"`)
            .replace('https://pubsubhubbub.appspot.com/', 'https://invalid.example/hub')
            .replace(
              '<author><name>Jackson Jang</name><uri>https://github.com/JacksonJang</uri></author>',
              '<author><name></name></author>',
            ),
        );
        return;
      }
      pageRequests += 1;
      response.end('unexpected');
    });
    origin = baseUrl;

    let error;
    try {
      await runPublicSeoCheck({ baseUrl, canonicalOrigin: baseUrl, now: CHECK_NOW, timeoutMs: 2_000 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PublicSeoCheckError);
    expect(error.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('expected Content-Type application/atom+xml'),
      expect.stringContaining('must declare the Atom 1.0 namespace'),
      expect.stringContaining('rel="self" must declare type="application/atom+xml"'),
      expect.stringContaining('feed rel="alternate" must point to'),
      expect.stringContaining('rel="hub" must point to'),
      expect.stringContaining('<name> must not be empty'),
      expect.stringContaining('expected exactly one <uri>'),
    ]));
    expect(pageRequests).toBe(0);
  });

  it('rejects malformed Atom XML before requesting any pages', async () => {
    let pageRequests = 0;
    let origin;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(robotsFile(origin));
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(sitemapFile([`${origin}/`]));
        return;
      }
      if (request.url === '/feed.xml') {
        sendAtom(response, atomFeed(origin).replace('</feed>', ''));
        return;
      }
      pageRequests += 1;
      response.end('unexpected');
    });
    origin = baseUrl;

    await expect(runPublicSeoCheck({
      baseUrl,
      canonicalOrigin: baseUrl,
      now: CHECK_NOW,
      timeoutMs: 2_000,
    })).rejects.toMatchObject({
      failures: expect.arrayContaining([expect.stringContaining('malformed XML')]),
    });
    expect(pageRequests).toBe(0);
  });

  it('rejects duplicate, non-authoritative, and out-of-order Atom entries', async () => {
    let pageRequests = 0;
    let origin;
    const atomEntry = ({ id, url, updated }) => `
      <entry>
        <id>${id}</id><title>Recent entry</title>
        <link rel="alternate" type="text/html" href="${url}" />
        <published>${updated}</published><updated>${updated}</updated>
        <summary>A useful recent entry.</summary>
      </entry>`;
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/robots.txt') {
        response.end(robotsFile(origin));
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(sitemapFile([`${origin}/`, `${origin}/one/`, `${origin}/two/`]));
        return;
      }
      if (request.url === '/feed.xml') {
        const entries = [
          atomEntry({ id: `${origin}/one/`, url: `${origin}/one/`, updated: '2026-08-04T00:00:00Z' }),
          atomEntry({ id: `${origin}/one/`, url: `${origin}/two/`, updated: '2026-08-05T00:00:00Z' }),
          atomEntry({ id: `${origin}/outside/`, url: `${origin}/outside/`, updated: '2026-06-01T00:00:00Z' }),
          atomEntry({ id: `${origin}/two/`, url: `${origin}/two/`, updated: '2026-08-03T00:00:00Z' }),
        ].join('');
        sendAtom(response, `<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
            <id>${origin}/feed.xml</id><title>LiveParse Updates</title><updated>2026-08-05T00:00:00Z</updated>
            <link rel="self" type="application/atom+xml" href="${origin}/feed.xml" />
            <link rel="alternate" type="text/html" href="${origin}/" />
            <link rel="hub" href="https://pubsubhubbub.appspot.com/" />
            <author><name>Jackson Jang</name><uri>https://github.com/JacksonJang</uri></author>
            ${entries}
          </feed>`);
        return;
      }
      pageRequests += 1;
      response.end('unexpected');
    });
    origin = baseUrl;

    let error;
    try {
      await runPublicSeoCheck({
        baseUrl,
        canonicalOrigin: baseUrl,
        now: new Date('2026-08-10T00:00:00Z'),
        timeoutMs: 2_000,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PublicSeoCheckError);
    expect(error.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate <id>'),
      expect.stringContaining('<id> must equal its canonical alternate URL'),
      expect.stringContaining('not present in the authoritative URL-set sitemap'),
      expect.stringContaining('duplicate alternate URL'),
      expect.stringContaining('ordered by non-increasing <updated>'),
    ]));
    expect(pageRequests).toBe(0);
  });

  it('caps the Atom discovery feed at fifty recent canonical URLs', async () => {
    let pageRequests = 0;
    let origin;
    const baseUrl = await startServer((request, response) => {
      const recentUrls = Array.from({ length: 51 }, (_, index) => `${origin}/recent-${index + 1}/`);
      if (request.url === '/robots.txt') {
        response.end(robotsFile(origin));
        return;
      }
      if (request.url === '/sitemap.xml') {
        response.end(sitemapFile(recentUrls));
        return;
      }
      if (request.url === '/feed.xml') {
        sendAtom(response, atomFeed(origin, recentUrls));
        return;
      }
      pageRequests += 1;
      response.end('unexpected');
    });
    origin = baseUrl;

    await expect(runPublicSeoCheck({
      baseUrl,
      canonicalOrigin: baseUrl,
      now: CHECK_NOW,
      timeoutMs: 2_000,
    })).rejects.toMatchObject({
      failures: expect.arrayContaining([expect.stringContaining('must contain at most 50 entries')]),
    });
    expect(pageRequests).toBe(0);
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
