import { describe, expect, it } from 'vitest';
import {
  allDiscordTimestampCodes,
  dateTimeInputForZone,
  decodeDiscordSnowflake,
  DISCORD_TIMESTAMP_STYLES,
  discordTimestampCode,
  discordTimestampPreview,
  isValidTimeZone,
  parseDiscordTimestampInput,
  parseWallClockInput,
  resolveWallClock,
  timeZoneOffsetLabel,
} from './discord-timestamp';

describe('Discord timestamp syntax', () => {
  it('exposes all nine styles in the current documented order', () => {
    expect(DISCORD_TIMESTAMP_STYLES).toEqual(['t', 'T', 'd', 'D', 'f', 'F', 's', 'S', 'R']);
  });

  it('generates styled and default tags', () => {
    expect(discordTimestampCode('1754208000')).toBe('<t:1754208000>');
    expect(discordTimestampCode(1754208000n, 'F')).toBe('<t:1754208000:F>');
    expect(() => discordTimestampCode('-1', 'R')).toThrow(/non-negative/);
  });

  it('generates all nine tags without dropping case-sensitive styles', () => {
    expect(allDiscordTimestampCodes('42')).toEqual({
      t: '<t:42:t>',
      T: '<t:42:T>',
      d: '<t:42:d>',
      D: '<t:42:D>',
      f: '<t:42:f>',
      F: '<t:42:F>',
      s: '<t:42:s>',
      S: '<t:42:S>',
      R: '<t:42:R>',
    });
  });
});

describe('Discord timestamp parsing', () => {
  it('decodes a styled tag', () => {
    expect(parseDiscordTimestampInput('<t:1754208000:S>')).toMatchObject({
      ok: true,
      seconds: '1754208000',
      milliseconds: 1_754_208_000_000,
      style: 'S',
      explicitStyle: true,
      source: 'tag',
    });
  });

  it('uses f when the style is omitted', () => {
    expect(parseDiscordTimestampInput('<t:0>')).toMatchObject({
      ok: true,
      seconds: '0',
      style: 'f',
      explicitStyle: false,
    });
  });

  it('normalizes raw non-negative whole seconds', () => {
    expect(parseDiscordTimestampInput('  00042  ')).toMatchObject({ ok: true, seconds: '42', source: 'seconds' });
    expect(parseDiscordTimestampInput('-1')).toMatchObject({ ok: false });
  });

  it('rejects decimals, malformed tags, and undocumented styles', () => {
    expect(parseDiscordTimestampInput('1754208000.5')).toMatchObject({ ok: false });
    expect(parseDiscordTimestampInput('<t:1754208000:r>')).toMatchObject({ ok: false });
    expect(parseDiscordTimestampInput('<t:1754208000:F')).toMatchObject({ ok: false });
  });

  it('warns when a modern value looks like milliseconds, microseconds, or nanoseconds', () => {
    expect(parseDiscordTimestampInput('1754208000000')).toMatchObject({
      ok: true,
      suggestedUnit: 'milliseconds',
      suggestedSeconds: '1754208000',
    });
    expect(parseDiscordTimestampInput('1754208000000000')).toMatchObject({
      ok: false,
      suggestedUnit: 'microseconds',
      suggestedSeconds: '1754208000',
    });
    expect(parseDiscordTimestampInput('1754208000000000000')).toMatchObject({
      ok: false,
      suggestedUnit: 'nanoseconds',
      suggestedSeconds: '1754208000',
    });
  });

  it('rejects values beyond the browser preview range and caps input length', () => {
    expect(parseDiscordTimestampInput('8640000000001')).toMatchObject({ ok: false });
    expect(parseDiscordTimestampInput('1'.repeat(81))).toMatchObject({ ok: false });
  });
});

describe('Discord snowflake decoding', () => {
  it('extracts the creation time and bit fields from a decimal snowflake', () => {
    expect(decodeDiscordSnowflake(' 1199835124667021433 ')).toEqual({
      ok: true,
      snowflake: '1199835124667021433',
      milliseconds: 1_706_133_385_579,
      seconds: '1706133385',
      iso: '2024-01-24T21:56:25.579Z',
      workerId: '8',
      processId: '7',
      increment: '2169',
    });
  });

  it('requires a decimal ID inside the 64-bit range', () => {
    expect(decodeDiscordSnowflake('')).toMatchObject({ ok: false });
    expect(decodeDiscordSnowflake('1199835124667021433n')).toMatchObject({ ok: false });
    expect(decodeDiscordSnowflake('-1199835124667021433')).toMatchObject({ ok: false });
    expect(decodeDiscordSnowflake('18446744073709551616')).toMatchObject({
      ok: false,
      error: expect.stringContaining('64-bit'),
    });
  });
});

describe('wall-clock timezone resolution', () => {
  it('validates calendar input without Date year 0-99 coercion', () => {
    expect(parseWallClockInput('2024-02-29T12:34:56')).toEqual({
      year: 2024, month: 2, day: 29, hour: 12, minute: 34, second: 56,
    });
    expect(parseWallClockInput('2023-02-29T12:34:56')).toBeNull();
    expect(parseWallClockInput('2026-13-01T00:00')).toBeNull();
  });

  it('resolves UTC and a fixed contemporary IANA offset exactly', () => {
    expect(resolveWallClock('2026-08-03T12:00:00', 'UTC')).toEqual({
      ok: true,
      candidates: [1_785_758_400_000],
      warning: null,
    });
    expect(resolveWallClock('2026-08-03T21:00:00', 'Asia/Seoul')).toEqual({
      ok: true,
      candidates: [1_785_758_400_000],
      warning: null,
    });
  });

  it('rejects a DST gap and exposes both sides of a DST overlap', () => {
    expect(resolveWallClock('2026-03-08T02:30:00', 'America/New_York')).toMatchObject({ ok: false });
    const overlap = resolveWallClock('2026-11-01T01:30:00', 'America/New_York');
    expect(overlap.ok).toBe(true);
    if (overlap.ok) {
      expect(overlap.candidates).toHaveLength(2);
      expect(overlap.candidates[1] - overlap.candidates[0]).toBe(3_600_000);
      expect(overlap.warning).toContain('more than once');
    }
  });

  it('does not turn a pre-epoch wall clock into an unverified negative tag', () => {
    expect(resolveWallClock('1969-12-31T23:59:59', 'UTC')).toMatchObject({ ok: false, error: expect.stringContaining('pre-1970') });
  });

  it('validates timezones and formats values for a selected zone', () => {
    expect(isValidTimeZone('Asia/Seoul')).toBe(true);
    expect(isValidTimeZone('Not/A_Zone')).toBe(false);
    expect(dateTimeInputForZone(1_785_758_400_000, 'Asia/Seoul')).toBe('2026-08-03T21:00:00');
    expect(timeZoneOffsetLabel(1_785_758_400_000, 'Asia/Seoul')).toBe('UTC+09:00');
  });
});

describe('browser previews', () => {
  it('formats absolute styles in the requested preview timezone', () => {
    expect(discordTimestampPreview(0, 'T', 'en-GB', 'UTC', 0)).toBe('00:00:00');
    expect(discordTimestampPreview(0, 'D', 'en-US', 'UTC', 0)).toContain('January');
  });

  it('formats deterministic relative previews without claiming Discord refresh cadence', () => {
    expect(discordTimestampPreview(3_600_000, 'R', 'en-US', 'UTC', 0)).toBe('in 1 hour');
    expect(discordTimestampPreview(-86_400_000, 'R', 'en-US', 'UTC', 0)).toBe('yesterday');
  });
});
