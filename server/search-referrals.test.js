import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySearchReferrer,
  dayInTimeZone,
  isLikelyBot,
  SearchReferralCounter,
  searchReferralFromRequest,
} from './search-referrals.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('search referrer classification', () => {
  it.each([
    ['https://www.google.com/search?q=unix+timestamp', 'google'],
    ['https://www.google.co.kr/search?q=json', 'google'],
    ['https://cn.bing.com/search?q=json', 'bing'],
    ['https://duckduckgo.com/?q=json', 'duckduckgo'],
    ['https://search.yahoo.co.jp/search?p=json', 'yahoo'],
    ['https://search.brave.com/search?q=json', 'brave'],
    ['https://search.naver.com/search.naver?query=json', 'naver'],
  ])('classifies %s as %s', (referrer, expected) => {
    expect(classifySearchReferrer(referrer)).toBe(expected);
  });

  it('rejects lookalike, non-web, malformed, and oversized referrers', () => {
    expect(classifySearchReferrer('https://evilgoogle.com/search')).toBeNull();
    expect(classifySearchReferrer('file:///search')).toBeNull();
    expect(classifySearchReferrer('not a url')).toBeNull();
    expect(classifySearchReferrer(`https://google.com/${'x'.repeat(2_100)}`)).toBeNull();
  });
});

describe('request eligibility', () => {
  const browser = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
  const allowedPaths = new Set([
    '/json-compare/',
    '/discord-timestamp-generator/',
    '/base64-decoder/',
    '/jwt-decoder/',
    '/jwt-expiration-checker/',
  ]);

  it('counts only GET HTML landings from a recognized search engine', () => {
    expect(searchReferralFromRequest({
      method: 'GET', isHtml: true, requestPath: '/json-compare/',
      referrer: 'https://www.google.com/search?q=json+compare', userAgent: browser, allowedPaths,
    })).toEqual({ engine: 'google', path: '/json-compare/' });
    expect(searchReferralFromRequest({
      method: 'HEAD', isHtml: true, requestPath: '/json-compare/',
      referrer: 'https://www.google.com/search?q=json+compare', userAgent: browser, allowedPaths,
    })).toBeNull();
    expect(searchReferralFromRequest({
      method: 'GET', isHtml: true, requestPath: '/discord-timestamp-generator/',
      referrer: 'https://www.google.com/search?q=discord+timestamp+generator', userAgent: browser, allowedPaths,
    })).toEqual({ engine: 'google', path: '/discord-timestamp-generator/' });
    expect(searchReferralFromRequest({
      method: 'GET', isHtml: true, requestPath: '/base64-decoder/',
      referrer: 'https://www.google.co.uk/search?q=base64+decode', userAgent: browser, allowedPaths,
    })).toEqual({ engine: 'google', path: '/base64-decoder/' });
    expect(searchReferralFromRequest({
      method: 'GET', isHtml: true, requestPath: '/jwt-decoder/',
      referrer: 'https://www.google.com/search?q=jwt+decoder', userAgent: browser, allowedPaths,
    })).toEqual({ engine: 'google', path: '/jwt-decoder/' });
    expect(searchReferralFromRequest({
      method: 'GET', isHtml: true, requestPath: '/jwt-expiration-checker/',
      referrer: 'https://www.bing.com/search?q=jwt+expiration+checker', userAgent: browser, allowedPaths,
    })).toEqual({ engine: 'bing', path: '/jwt-expiration-checker/' });
    expect(searchReferralFromRequest({
      method: 'GET', isHtml: false, requestPath: '/og.png',
      referrer: 'https://www.google.com/search?q=json+compare', userAgent: browser, allowedPaths,
    })).toBeNull();
  });

  it('rejects non-canonical pages, prefetches, prerenders, and non-document fetches', () => {
    const base = {
      method: 'GET', isHtml: true, referrer: 'https://www.google.com/search?q=json',
      userAgent: browser, allowedPaths,
    };
    expect(searchReferralFromRequest({ ...base, requestPath: '/unknown/' })).toBeNull();
    expect(searchReferralFromRequest({ ...base, requestPath: '/json-compare/', purpose: 'prefetch' })).toBeNull();
    expect(searchReferralFromRequest({ ...base, requestPath: '/json-compare/', secPurpose: 'prefetch;prerender' })).toBeNull();
    expect(searchReferralFromRequest({ ...base, requestPath: '/json-compare/', secFetchDest: 'iframe' })).toBeNull();
  });

  it('filters bots without storing their user agent', () => {
    expect(isLikelyBot('Googlebot/2.1')).toBe(true);
    expect(isLikelyBot('')).toBe(true);
    expect(isLikelyBot(browser)).toBe(false);
  });

  it('uses the configured reporting timezone at a date boundary', () => {
    const instant = new Date('2026-08-03T15:30:00.000Z');
    expect(dayInTimeZone(instant, 'Asia/Seoul')).toBe('2026-08-04');
    expect(dayInTimeZone(instant, 'UTC')).toBe('2026-08-03');
  });
});

describe('SearchReferralCounter', () => {
  it('persists only daily engine and landing-page aggregates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liveparse-search-referrals-'));
    temporaryDirectories.push(directory);
    const counter = new SearchReferralCounter({
      directory,
      now: () => new Date('2026-08-03T12:00:00.000Z'),
      onError: (...details) => { throw new Error(details.join(' ')); },
    });

    counter.record({ engine: 'google', path: '/unix-timestamp-converter/' });
    counter.record({ engine: 'bing', path: '/unix-timestamp-converter/' });
    counter.record({ engine: 'google', path: '/json-compare/' });
    await counter.flush();

    const saved = JSON.parse(await readFile(join(directory, '2026-08-03.json'), 'utf8'));
    expect(saved).toMatchObject({
      date: '2026-08-03',
      searchLandingVisits: 3,
      engines: { google: 2, bing: 1 },
      pages: { '/unix-timestamp-converter/': 2, '/json-compare/': 1 },
    });
    expect(Object.keys(saved).sort()).toEqual(['date', 'engines', 'pages', 'searchLandingVisits']);
    expect(JSON.stringify(saved)).not.toMatch(/ip|user.?agent|refer|query/i);
  });
});
