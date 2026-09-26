import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_DISCORD_LINES,
  allDiscordTimestampCodes,
  parseBulkDiscordTimestampInput,
  parseBulkDiscordTimestamps,
} from './discord-timestamp';

describe('bulk Discord timestamp parsing', () => {
  it('accepts tags, Unix seconds, naive dates, and explicit UTC offsets', () => {
    expect(parseBulkDiscordTimestampInput('<t:1754208000:F>', 'UTC', 1)).toMatchObject({
      ok: true,
      seconds: '1754208000',
      source: 'tag',
    });
    expect(parseBulkDiscordTimestampInput(' 42 ', 'UTC', 2)).toMatchObject({
      ok: true,
      seconds: '42',
      source: 'seconds',
    });
    expect(parseBulkDiscordTimestampInput('2026-08-03 12:00', 'UTC', 3)).toMatchObject({
      ok: true,
      seconds: '1785758400',
      source: 'date',
    });
    expect(parseBulkDiscordTimestampInput('2026-08-03T21:00:00+09:00', 'Asia/Seoul', 4)).toMatchObject({
      ok: true,
      seconds: '1785758400',
      source: 'date',
    });
  });

  it('uses midnight for a date-only line and the earliest overlap for ambiguous dates', () => {
    expect(parseBulkDiscordTimestampInput('2026-08-03', 'UTC', 1)).toMatchObject({
      ok: true,
      seconds: String(Date.UTC(2026, 7, 3) / 1_000),
    });

    const overlap = parseBulkDiscordTimestampInput('2026-11-01 01:30', 'America/New_York', 2);
    expect(overlap).toMatchObject({ ok: true, seconds: String(Date.UTC(2026, 10, 1, 5, 30) / 1_000) });
    expect(overlap.ok && overlap.warning).toContain('more than once');
  });

  it('rejects invalid lines and preserves the line number', () => {
    expect(parseBulkDiscordTimestampInput('2023-02-29 12:00', 'UTC', 7)).toMatchObject({
      ok: false,
      line: 7,
      error: 'Enter a real calendar date and time.',
    });
    expect(parseBulkDiscordTimestampInput('1754208000.5', 'UTC', 8)).toMatchObject({
      ok: false,
      line: 8,
    });
  });

  it('rejects empty input and more than 500 non-empty lines', () => {
    expect(parseBulkDiscordTimestamps('\n  \n', 'UTC')).toEqual({
      ok: false,
      error: 'Enter one timestamp or date per line.',
      entries: [],
    });

    const tooMany = parseBulkDiscordTimestamps(Array.from({ length: MAX_BULK_DISCORD_LINES + 1 }, (_, index) => String(index)).join('\n'), 'UTC');
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringContaining('500 non-empty lines') });
  });

  it('parses the maximum supported set', () => {
    const bulk = parseBulkDiscordTimestamps(Array.from({ length: MAX_BULK_DISCORD_LINES }, (_, index) => String(index)).join('\n'), 'UTC');
    expect(bulk.ok).toBe(true);
    if (bulk.ok) {
      expect(bulk.entries).toHaveLength(MAX_BULK_DISCORD_LINES);
      const last = bulk.entries[bulk.entries.length - 1]!;
      expect(last.ok).toBe(true);
      expect(allDiscordTimestampCodes(last.ok ? last.seconds : '0').F).toBe(`<t:${MAX_BULK_DISCORD_LINES - 1}:F>`);
    }
  });
});
