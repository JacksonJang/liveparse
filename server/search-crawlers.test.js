import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calendarHourInTimeZone,
  ClaimedCrawlerCounter,
  claimedCrawlerFromRequest,
  classifyClaimedCrawler,
  validateClaimedCrawlerAggregate,
} from './search-crawlers.js';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'liveparse-search-crawlers-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('claimed crawler User-Agent classification', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 6.0.1) AppleWebKit/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'googlebot'],
    ['Googlebot-Image/1.0', 'googlebot'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bingbot'],
    ['DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)', 'duckduckbot'],
    ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'yandexbot'],
    ['Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)', 'baiduspider'],
    ['Yeti/1.1 (Naver Corp.; http://help.naver.com/robots/)', 'naver'],
    ['NaverBot/1.0', 'naver'],
    ['Mozilla/5.0 (compatible; SeznamBot/4.0; +http://napoveda.seznam.cz/en/seznambot-intro/)', 'seznambot'],
    ['Mozilla/5.0 (compatible; YepBot/1.0; +https://yep.com/yepbot)', 'yepbot'],
    ['Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)', 'amazonbot'],
    ['Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)', 'internet-archive'],
    ['ia_archiver/1.6', 'internet-archive'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Applebot/0.1', 'applebot'],
    ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'common-crawl'],
    ['Mozilla/5.0 (compatible; PetalBot; +https://webmaster.petalsearch.com/site/petalbot)', 'petalbot'],
    ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', 'bytespider'],
    ['Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)', 'yahoo-slurp'],
    ['Mozilla/5.0 (compatible; Bravebot/1.0; +https://search.brave.com/help/brave-search-crawler)', 'bravebot'],
    ['Mozilla/5.0 (compatible; MojeekBot/0.11; +https://www.mojeek.com/bot.html)', 'mojeekbot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)', 'oai-searchbot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'perplexitybot'],
  ])('classifies only the explicit token in %s as %s', (userAgent, expected) => {
    expect(classifyClaimedCrawler(userAgent)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'Mozilla/5.0 AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
    'GenericCrawler/1.0',
    'NotGooglebot/2.1',
    'bingbotnet/2.0',
    'DuckDuckBotImpersonator/1.0',
    'curl/8.0',
    'headless browser',
  ])('rejects non-explicit or malformed claim %s', (userAgent) => {
    expect(classifyClaimedCrawler(userAgent)).toBeNull();
  });

  it('rejects oversized User-Agent claims', () => {
    expect(classifyClaimedCrawler(`Googlebot/2.1 ${'x'.repeat(2_100)}`)).toBeNull();
  });
});

describe('canonical crawler request eligibility', () => {
  const allowedPaths = new Set(['/', '/uuid-v4-generator/', '/guides/uuid-versions-explained/']);
  const base = {
    method: 'GET',
    isHtml: true,
    requestPath: '/uuid-v4-generator/',
    userAgent: 'Googlebot/2.1',
    allowedPaths,
  };

  it('returns only a normalized crawler name and canonical path', () => {
    expect(claimedCrawlerFromRequest(base)).toEqual({ crawler: 'googlebot', path: '/uuid-v4-generator/' });
  });

  it.each([
    { method: 'HEAD' },
    { method: 'POST' },
    { isHtml: false },
    { requestPath: '/uuid-v4-generator' },
    { requestPath: '/uuid-v4-generator/?source=test' },
    { requestPath: '/unknown/' },
    { userAgent: 'Mozilla/5.0 Chrome/141.0' },
    { allowedPaths: undefined },
  ])('rejects a non-canonical or ineligible request override %#', (override) => {
    expect(claimedCrawlerFromRequest({ ...base, ...override })).toBeNull();
  });
});

describe('calendar heartbeat buckets', () => {
  it('uses the configured timezone at date and hour boundaries', () => {
    const instant = new Date('2026-08-03T15:05:00.000Z');
    expect(calendarHourInTimeZone(instant, 'Asia/Seoul')).toEqual({ date: '2026-08-04', hour: '00' });
    expect(calendarHourInTimeZone(instant, 'UTC')).toEqual({ date: '2026-08-03', hour: '15' });
    expect(calendarHourInTimeZone(instant, 'America/New_York')).toEqual({ date: '2026-08-03', hour: '11' });
  });

  it('rejects invalid dates and timezones', () => {
    expect(() => calendarHourInTimeZone(new Date('invalid'))).toThrow(/valid Date/);
    expect(() => calendarHourInTimeZone(new Date(), 'Not/A_Timezone')).toThrow();
  });
});

describe('ClaimedCrawlerCounter', () => {
  const allowedPaths = new Set(['/', '/uuid-v4-generator/', '/uuid-decoder/']);

  it('persists unique sorted heartbeat hours with restrictive file permissions', async () => {
    const directory = await temporaryDirectory();
    let current = new Date('2026-08-03T18:30:00.000Z');
    const counter = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date(current),
      onError: () => {},
    });

    await expect(counter.touch()).resolves.toBe(true);
    await expect(counter.touch()).resolves.toBe(false);
    current = new Date('2026-08-03T16:30:00.000Z');
    await expect(counter.touch()).resolves.toBe(true);
    await counter.flush();

    const filePath = join(directory, '2026-08-04.json');
    const saved = JSON.parse(await readFile(filePath, 'utf8'));
    expect(saved).toEqual({
      date: '2026-08-04',
      observedHours: ['01', '03'],
      claimedCrawlerRequests: 0,
      crawlers: {},
      pages: {},
    });
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('records only eligible canonical HTML GETs and never persists raw request metadata', async () => {
    const directory = await temporaryDirectory();
    const counter = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date('2026-08-03T20:15:00.000Z'),
      onError: () => {},
    });
    const request = {
      method: 'GET',
      isHtml: true,
      requestPath: '/uuid-v4-generator/',
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ip: '203.0.113.42',
      referrer: 'https://example.test/private-query',
    };

    await expect(counter.record(request)).resolves.toBe(true);
    await expect(counter.record({ ...request, requestPath: '/uuid-decoder/', userAgent: 'bingbot/2.0' })).resolves.toBe(true);
    await expect(counter.record({ ...request, method: 'HEAD' })).resolves.toBe(false);
    await expect(counter.record({ ...request, isHtml: false })).resolves.toBe(false);
    await expect(counter.record({ ...request, requestPath: '/uuid-v4-generator' })).resolves.toBe(false);
    await expect(counter.record({ ...request, userAgent: 'Mozilla/5.0 Chrome/141.0' })).resolves.toBe(false);
    await counter.flush();

    const source = await readFile(join(directory, '2026-08-04.json'), 'utf8');
    const saved = JSON.parse(source);
    expect(saved).toEqual({
      date: '2026-08-04',
      observedHours: ['05'],
      claimedCrawlerRequests: 2,
      crawlers: { googlebot: 1, bingbot: 1 },
      pages: { '/uuid-v4-generator/': 1, '/uuid-decoder/': 1 },
    });
    expect(Object.keys(saved).sort()).toEqual(['claimedCrawlerRequests', 'crawlers', 'date', 'observedHours', 'pages']);
    expect(source).not.toContain('203.0.113.42');
    expect(source).not.toContain('private-query');
    expect(source).not.toContain('Mozilla/5.0');
    expect(source).not.toMatch(/user.?agent|refer|\bip\b/i);
  });

  it('serializes concurrent writes without losing counts', async () => {
    const directory = await temporaryDirectory();
    const counter = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date('2026-08-04T02:00:00.000Z'),
      onError: () => {},
    });
    const requests = Array.from({ length: 40 }, (_, index) => counter.record({
      method: 'GET',
      isHtml: true,
      requestPath: index % 2 === 0 ? '/' : '/uuid-v4-generator/',
      userAgent: index % 3 === 0 ? 'DuckDuckBot/1.1' : 'Googlebot/2.1',
    }));
    await Promise.all(requests);
    await counter.flush();

    const saved = JSON.parse(await readFile(join(directory, '2026-08-04.json'), 'utf8'));
    expect(saved.claimedCrawlerRequests).toBe(40);
    expect(saved.crawlers).toEqual({ duckduckbot: 14, googlebot: 26 });
    expect(saved.pages).toEqual({ '/': 20, '/uuid-v4-generator/': 20 });
    expect(saved.observedHours).toEqual(['11']);
  });

  it('keeps heartbeat observations separated across local calendar days', async () => {
    const directory = await temporaryDirectory();
    let current = new Date('2026-08-03T14:30:00.000Z');
    const counter = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date(current),
      onError: () => {},
    });
    await counter.touch();
    current = new Date('2026-08-03T15:30:00.000Z');
    await counter.touch();
    await counter.flush();
    expect((await readdir(directory)).sort()).toEqual(['2026-08-03.json', '2026-08-04.json']);
  });

  it('loads a valid existing aggregate before appending a new observation', async () => {
    const directory = await temporaryDirectory();
    const first = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date('2026-08-04T00:00:00.000Z'),
      onError: () => {},
    });
    await first.touch();
    const second = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date('2026-08-04T01:00:00.000Z'),
      onError: () => {},
    });
    await second.record({ method: 'GET', isHtml: true, requestPath: '/', userAgent: 'Amazonbot/0.1' });
    const saved = JSON.parse(await readFile(join(directory, '2026-08-04.json'), 'utf8'));
    expect(saved.observedHours).toEqual(['09', '10']);
    expect(saved.claimedCrawlerRequests).toBe(1);
  });

  it('rejects invalid stored aggregates instead of silently overwriting them', async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '2026-08-04.json'), JSON.stringify({
      date: '2026-08-04',
      observedHours: ['05', '05'],
      claimedCrawlerRequests: 0,
      crawlers: {},
      pages: {},
    }));
    const counter = new ClaimedCrawlerCounter({
      directory,
      allowedPaths,
      now: () => new Date('2026-08-04T00:00:00.000Z'),
      onError: () => {},
    });
    await expect(counter.touch()).rejects.toThrow(/invalid, duplicate, or unsorted observed hours/);
  });

  it('validates aggregate totals and constructor invariants', () => {
    expect(() => validateClaimedCrawlerAggregate({
      date: '2026-08-04',
      observedHours: ['05'],
      claimedCrawlerRequests: 2,
      crawlers: { googlebot: 1 },
      pages: { '/': 1 },
    }, '2026-08-04')).toThrow(/totals do not match/);
    expect(() => new ClaimedCrawlerCounter({ directory: '/tmp/example', allowedPaths: new Set() })).toThrow(/non-empty Set/);
    expect(() => new ClaimedCrawlerCounter({ directory: '/tmp/example', allowedPaths: new Set(['/not-canonical']) })).toThrow(/Invalid canonical/);
  });
});
