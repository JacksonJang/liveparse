import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calendarDateInTimeZone,
  calendarDatesEndingOn,
  fillMissingCalendarDays,
  formatSearchReferralReport,
  parseRequestedDays,
  recentSearchReferralAverage,
  runSearchReferralReport,
} from './report-search-referrals.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function aggregate(date, visits, engines = {}, pages = {}) {
  return { date, searchLandingVisits: visits, engines, pages };
}

describe('search referral calendar windows', () => {
  it('uses the Asia/Seoul calendar date at a UTC boundary', () => {
    expect(calendarDateInTimeZone(new Date('2026-08-03T14:59:59.999Z'))).toBe('2026-08-03');
    expect(calendarDateInTimeZone(new Date('2026-08-03T15:00:00.000Z'))).toBe('2026-08-04');
  });

  it('builds an inclusive recent calendar window across month boundaries', () => {
    expect(calendarDatesEndingOn('2026-08-04', 7)).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('rejects invalid day counts and impossible calendar dates', () => {
    expect(() => parseRequestedDays(0)).toThrow(/days from 1 to 366/);
    expect(() => parseRequestedDays(367)).toThrow(/days from 1 to 366/);
    expect(() => calendarDatesEndingOn('2026-02-30', 7)).toThrow(/Invalid calendar date/);
  });
});

describe('zero-filled search referral reporting', () => {
  it('fills missing dates and includes all seven calendar days in the average', () => {
    const dates = calendarDatesEndingOn('2026-08-04', 7);
    const rows = fillMissingCalendarDays(dates, new Map([
      ['2026-08-04', aggregate('2026-08-04', 100, { google: 100 }, { '/xml-formatter/': 100 })],
    ]));

    expect(rows.map((row) => row.searchLandingVisits)).toEqual([0, 0, 0, 0, 0, 0, 100]);
    expect(recentSearchReferralAverage(rows)).toEqual({
      days: 7,
      total: 100,
      dailyAverage: 100 / 7,
    });

    const report = formatSearchReferralReport({ rows, recordedAggregateCount: 1 });
    expect(report).toContain('Calendar window: 2026-07-29 through 2026-08-04 (7 days; missing aggregate dates count as zero)');
    expect(report).toContain('1 day had an aggregate; 6 missing days count as zero.');
    expect(report).toContain('7-day calendar average: 14.3 search landing visits/day');
  });

  it('prints a useful all-zero report when no aggregate files exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liveparse-empty-search-report-'));
    temporaryDirectories.push(directory);
    let written = '';

    const result = await runSearchReferralReport({
      aggregateDirectory: directory,
      now: new Date('2026-08-03T15:00:00.000Z'),
      requestedDays: 7,
      write: (value) => { written = value; },
    });

    expect(result.recordedAggregateCount).toBe(0);
    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((row) => row.searchLandingVisits === 0)).toBe(true);
    expect(written).toContain('No search referral aggregates were recorded in this calendar window; every day counts as zero.');
    expect(written).toContain('7-day calendar average: 0.0 search landing visits/day (0.0% of the 100/day target)');
    expect(written).toContain('    0  (none recorded)');
  });

  it('loads only aggregate files inside the requested calendar window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'liveparse-windowed-search-report-'));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(join(directory, '2026-07-28.json'), `${JSON.stringify(aggregate('2026-07-28', 700))}\n`),
      writeFile(join(directory, '2026-08-01.json'), `${JSON.stringify(aggregate('2026-08-01', 70, { google: 70 }, { '/xml-formatter/': 70 }))}\n`),
      writeFile(join(directory, '2026-08-05.json'), `${JSON.stringify(aggregate('2026-08-05', 900))}\n`),
    ]);
    let written = '';

    const result = await runSearchReferralReport({
      aggregateDirectory: directory,
      now: new Date('2026-08-03T15:00:00.000Z'),
      requestedDays: 7,
      write: (value) => { written = value; },
    });

    expect(result.recordedAggregateCount).toBe(1);
    expect(result.rows.map((row) => row.searchLandingVisits)).toEqual([0, 0, 0, 70, 0, 0, 0]);
    expect(written).toContain('7-day calendar average: 10.0 search landing visits/day');
    expect(written).not.toContain('700 visits');
    expect(written).not.toContain('900 visits');
  });
});
