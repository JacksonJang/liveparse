import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calendarDateInTimeZone,
  calendarDatesEndingOn,
  fillUnobservedCalendarDays,
  formatClaimedCrawlerReport,
  parseRequestedDays,
  runClaimedCrawlerReport,
} from './report-search-crawlers.mjs';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'liveparse-crawler-report-'));
  temporaryDirectories.push(directory);
  return directory;
}

function aggregate(date, {
  observedHours = ['00'],
  claimedCrawlerRequests = 0,
  crawlers = {},
  pages = {},
} = {}) {
  return { date, observedHours, claimedCrawlerRequests, crawlers, pages };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('crawler report calendar parsing', () => {
  it.each([
    [undefined, 30],
    ['1', 1],
    [7, 7],
    ['366', 366],
  ])('parses %s as %i requested days', (value, expected) => {
    expect(parseRequestedDays(value)).toBe(expected);
  });

  it.each([0, -1, 367, 1.5, 'seven', '', null])('rejects invalid requested day value %s', (value) => {
    expect(() => parseRequestedDays(value)).toThrow(/days from 1 to 366/);
  });

  it('uses the reporting timezone and spans month boundaries', () => {
    const instant = new Date('2026-08-03T15:30:00.000Z');
    expect(calendarDateInTimeZone(instant, 'Asia/Seoul')).toBe('2026-08-04');
    expect(calendarDateInTimeZone(instant, 'UTC')).toBe('2026-08-03');
    expect(calendarDatesEndingOn('2026-08-01', 3)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
  });

  it('rejects impossible calendar dates', () => {
    expect(() => calendarDatesEndingOn('2026-02-30', 1)).toThrow(/Invalid calendar date/);
    expect(() => calendarDateInTimeZone(new Date('invalid'))).toThrow(/valid Date/);
  });
});

describe('observed and unobserved report rows', () => {
  it('marks missing dates unobserved instead of inventing zero-request observations', () => {
    const rows = fillUnobservedCalendarDays(
      ['2026-08-02', '2026-08-03', '2026-08-04'],
      new Map([['2026-08-03', aggregate('2026-08-03', { observedHours: ['01', '03'] })]]),
    );
    expect(rows).toEqual([
      {
        date: '2026-08-02', observed: false, observedHours: [], claimedCrawlerRequests: null, crawlers: {}, pages: {},
      },
      {
        date: '2026-08-03', observed: true, observedHours: ['01', '03'], claimedCrawlerRequests: 0, crawlers: {}, pages: {},
      },
      {
        date: '2026-08-04', observed: false, observedHours: [], claimedCrawlerRequests: null, crawlers: {}, pages: {},
      },
    ]);
  });

  it('prints the unverified-UA warning, hourly coverage, requests, and crawler/page totals', () => {
    const rows = fillUnobservedCalendarDays([
      '2026-08-02', '2026-08-03', '2026-08-04',
    ], [
      aggregate('2026-08-02', { observedHours: ['00', '01'], claimedCrawlerRequests: 0 }),
      aggregate('2026-08-04', {
        observedHours: ['05', '06', '07'],
        claimedCrawlerRequests: 4,
        crawlers: { googlebot: 3, bingbot: 1 },
        pages: { '/': 1, '/uuid-v4-generator/': 3 },
      }),
    ]);
    const report = formatClaimedCrawlerReport({ rows, recordedAggregateCount: 2 });

    expect(report).toMatch(/unverified User-Agent claims/i);
    expect(report).toContain('2026-08-02  observed  heartbeat:  2/24 hours (00, 01)  claimed requests:     0');
    expect(report).toContain('2026-08-03  UNOBSERVED  heartbeat: unobserved  claimed requests: unobserved');
    expect(report).toContain('2026-08-04  observed  heartbeat:  3/24 hours (05, 06, 07)  claimed requests:     4');
    expect(report).toContain('Total claimed crawler requests on observed days: 4');
    expect(report).toMatch(/\n\s*3\s+googlebot\n\s*1\s+bingbot/);
    expect(report).toMatch(/\n\s*3\s+\/uuid-v4-generator\/\n\s*1\s+\//);
    expect(report).not.toMatch(/2026-08-03.*claimed requests:\s+0/);
  });

  it('rejects an empty calendar window', () => {
    expect(() => formatClaimedCrawlerReport({ rows: [], recordedAggregateCount: 0 })).toThrow(/at least one day/);
  });
});

describe('crawler aggregate report I/O', () => {
  it('reads valid aggregate days, ignores out-of-window files, and preserves unobserved days', async () => {
    const directory = await temporaryDirectory();
    await Promise.all([
      writeFile(join(directory, '2026-08-02.json'), JSON.stringify(aggregate('2026-08-02', {
        observedHours: ['22', '23'],
        claimedCrawlerRequests: 1,
        crawlers: { yandexbot: 1 },
        pages: { '/uuid-decoder/': 1 },
      }))),
      writeFile(join(directory, '2026-08-04.json'), JSON.stringify(aggregate('2026-08-04', {
        observedHours: ['00'],
        claimedCrawlerRequests: 2,
        crawlers: { googlebot: 2 },
        pages: { '/': 2 },
      }))),
      writeFile(join(directory, '2025-01-01.json'), JSON.stringify(aggregate('2025-01-01'))),
      writeFile(join(directory, 'notes.txt'), 'ignored'),
    ]);
    const output = [];
    const result = await runClaimedCrawlerReport({
      aggregateDirectory: directory,
      now: new Date('2026-08-04T03:00:00.000Z'),
      requestedDays: 3,
      write: (value) => output.push(value),
    });

    expect(result.dates).toEqual(['2026-08-02', '2026-08-03', '2026-08-04']);
    expect(result.recordedAggregateCount).toBe(2);
    expect(result.rows.map((row) => row.observed)).toEqual([true, false, true]);
    expect(result.rows[1].claimedCrawlerRequests).toBeNull();
    expect(result.report).toContain('2 observed days, 1 unobserved day');
    expect(result.report).toContain('Total claimed crawler requests on observed days: 3');
    expect(output).toEqual([result.report]);
  });

  it('reports a completely missing directory as unobserved coverage', async () => {
    const parent = await temporaryDirectory();
    const result = await runClaimedCrawlerReport({
      aggregateDirectory: join(parent, 'does-not-exist'),
      now: new Date('2026-08-04T03:00:00.000Z'),
      requestedDays: 2,
      write: () => {},
    });
    expect(result.recordedAggregateCount).toBe(0);
    expect(result.rows.every((row) => !row.observed && row.claimedCrawlerRequests === null)).toBe(true);
    expect(result.report).toContain('0 observed days, 2 unobserved days');
    expect(result.report.match(/UNOBSERVED/g)).toHaveLength(2);
  });

  it('rejects malformed JSON and privacy-breaking or inconsistent aggregates', async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, '2026-08-04.json'), '{not-json');
    await expect(runClaimedCrawlerReport({
      aggregateDirectory: directory,
      now: new Date('2026-08-04T03:00:00.000Z'),
      requestedDays: 1,
      write: () => {},
    })).rejects.toThrow(/Cannot read claimed crawler aggregate/);

    await writeFile(join(directory, '2026-08-04.json'), JSON.stringify({
      ...aggregate('2026-08-04', { observedHours: ['12'] }),
      rawUserAgent: 'Googlebot/2.1',
    }));
    await expect(runClaimedCrawlerReport({
      aggregateDirectory: directory,
      now: new Date('2026-08-04T03:00:00.000Z'),
      requestedDays: 1,
      write: () => {},
    })).rejects.toThrow(/unexpected or missing fields/);

    await writeFile(join(directory, '2026-08-04.json'), JSON.stringify(aggregate('2026-08-04', {
      observedHours: ['12'],
      claimedCrawlerRequests: 2,
      crawlers: { googlebot: 1 },
      pages: { '/': 1 },
    })));
    await expect(runClaimedCrawlerReport({
      aggregateDirectory: directory,
      now: new Date('2026-08-04T03:00:00.000Z'),
      requestedDays: 1,
      write: () => {},
    })).rejects.toThrow(/totals do not match/);
  });
});
