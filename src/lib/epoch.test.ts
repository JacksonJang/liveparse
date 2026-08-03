import { describe, expect, it } from 'vitest';
import { dateToEpoch, parseEpoch } from './epoch';

function success(input: string, unit: Parameters<typeof parseEpoch>[1] = 'auto') {
  const result = parseEpoch(input, unit);
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
  return result;
}

describe('parseEpoch exact conversion', () => {
  it('converts integer seconds to every exact unit', () => {
    const result = success('1700000000', 'seconds');

    expect(result.detectedUnit).toBe('seconds');
    expect(result.iso).toBe('2023-11-14T22:13:20.000Z');
    expect(result.seconds).toBe('1700000000');
    expect(result.milliseconds).toBe('1700000000000');
    expect(result.microseconds).toBe('1700000000000000');
    expect(result.nanoseconds).toBe('1700000000000000000');
  });

  it('preserves integers larger than Number.MAX_SAFE_INTEGER', () => {
    const result = success('9007199254740993', 'nanoseconds');

    expect(result.epochNanoseconds).toBe(9_007_199_254_740_993n);
    expect(result.nanoseconds).toBe('9007199254740993');
    expect(result.microseconds).toBe('9007199254740.993');
    expect(result.milliseconds).toBe('9007199254.740993');
    expect(result.seconds).toBe('9007199.254740993');
  });

  it('accepts up to nine decimal places for seconds without rounding', () => {
    const result = success('1.230000001', 'seconds');

    expect(result.epochNanoseconds).toBe(1_230_000_001n);
    expect(result.seconds).toBe('1.230000001');
    expect(result.milliseconds).toBe('1230.000001');
    expect(result.microseconds).toBe('1230000.001');
    expect(result.nanoseconds).toBe('1230000001');
  });

  it('canonicalizes a decimal result while keeping its exact value', () => {
    const result = success('+001.230000000', 'seconds');

    expect(result.seconds).toBe('1.23');
    expect(result.nanoseconds).toBe('1230000000');
  });

  it('rejects excess decimal precision and fractions on smaller units', () => {
    expect(parseEpoch('1.1234567890', 'seconds')).toMatchObject({
      ok: false,
      code: 'too-many-fraction-digits',
    });
    expect(parseEpoch('1.5', 'milliseconds')).toMatchObject({
      ok: false,
      code: 'fraction-not-supported',
    });
  });

  it('rejects oversized input before attempting an expensive BigInt conversion', () => {
    expect(parseEpoch('9'.repeat(81), 'nanoseconds')).toMatchObject({
      ok: false,
      code: 'input-too-long',
    });
  });
});

describe('parseEpoch auto detection', () => {
  it.each([
    ['9999999999', 'seconds'],
    ['10000000000', 'milliseconds'],
    ['9999999999999', 'milliseconds'],
    ['10000000000000', 'microseconds'],
    ['9999999999999999', 'microseconds'],
    ['10000000000000000', 'nanoseconds'],
  ] as const)('detects %s as %s', (input, expectedUnit) => {
    const result = success(input);
    expect(result.detectedUnit).toBe(expectedUnit);
    expect(result.warning).toContain(`auto-detected as ${expectedUnit}`);
  });

  it('ignores a sign and leading zeroes when detecting integer units', () => {
    expect(success('-0001700000000').detectedUnit).toBe('seconds');
  });

  it('interprets an auto-detected decimal as seconds', () => {
    const result = success('-0.000000001');
    expect(result.detectedUnit).toBe('seconds');
    expect(result.epochNanoseconds).toBe(-1n);
    expect(result.warning).toContain('interpreted as seconds');
  });
});

describe('parseEpoch negative instants', () => {
  it('uses floor division and a positive remainder below the Unix epoch', () => {
    const result = success('-1', 'nanoseconds');

    expect(result.iso).toBe('1969-12-31T23:59:59.999999999Z');
    expect(result.date.getTime()).toBe(-1);
    expect(result.millisecondFloor).toBe('-1');
    expect(result.subMillisecondNanoseconds).toBe('999999');
    expect(result.seconds).toBe('-0.000000001');
    expect(result.milliseconds).toBe('-0.000001');
    expect(result.microseconds).toBe('-0.001');
  });

  it('floors across multiple negative milliseconds without losing the remainder', () => {
    const result = success('-1000001', 'nanoseconds');

    expect(result.iso).toBe('1969-12-31T23:59:59.998999999Z');
    expect(result.date.getTime()).toBe(-2);
    expect(result.millisecondFloor).toBe('-2');
    expect(result.subMillisecondNanoseconds).toBe('999999');
    expect(result.milliseconds).toBe('-1.000001');
  });

  it('keeps the exact nanosecond fraction across a negative whole-second boundary', () => {
    const result = success('-1000000001', 'nanoseconds');

    expect(result.iso).toBe('1969-12-31T23:59:58.999999999Z');
    expect(result.utc).toBe('1969-12-31 23:59:58.999999999 UTC');
    expect(result.date.toISOString()).toBe('1969-12-31T23:59:58.999Z');
    expect(result.seconds).toBe('-1.000000001');
    expect(result.warning).toContain('ISO/UTC and exact epoch values preserve nanoseconds');
  });

  it('emits exact positive sub-millisecond ISO precision', () => {
    const result = success('1', 'nanoseconds');

    expect(result.iso).toBe('1970-01-01T00:00:00.000000001Z');
    expect(result.date.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('JavaScript Date range validation', () => {
  it('accepts both inclusive Date boundaries', () => {
    expect(success('8640000000000000', 'milliseconds').iso).toBe('+275760-09-13T00:00:00.000Z');
    expect(success('-8640000000000000', 'milliseconds').iso).toBe('-271821-04-20T00:00:00.000Z');
  });

  it('rejects timestamps whose floored milliseconds are outside Date range', () => {
    expect(parseEpoch('8640000000000001', 'milliseconds')).toMatchObject({
      ok: false,
      code: 'date-out-of-range',
    });
    expect(parseEpoch('-8640000000000000000001', 'nanoseconds')).toMatchObject({
      ok: false,
      code: 'date-out-of-range',
    });
  });

  it('rejects any exact instant beyond the inclusive Date boundaries', () => {
    expect(success('8640000000000000000000', 'nanoseconds').date.getTime()).toBe(8_640_000_000_000_000);
    expect(success('-8640000000000000000000', 'nanoseconds').date.getTime()).toBe(-8_640_000_000_000_000);
    expect(parseEpoch('8640000000000000000001', 'nanoseconds')).toMatchObject({
      ok: false,
      code: 'date-out-of-range',
    });
    expect(parseEpoch('-8640000000000000000001', 'nanoseconds')).toMatchObject({
      ok: false,
      code: 'date-out-of-range',
    });
  });
});

describe('dateToEpoch', () => {
  it('converts Date milliseconds into exact seconds, microseconds, and nanoseconds', () => {
    const result = dateToEpoch(new Date(-1));
    if (!result.ok) throw new Error(result.error);

    expect(result.detectedUnit).toBe('milliseconds');
    expect(result.seconds).toBe('-0.001');
    expect(result.milliseconds).toBe('-1');
    expect(result.microseconds).toBe('-1000');
    expect(result.nanoseconds).toBe('-1000000');
    expect(result.iso).toBe('1969-12-31T23:59:59.999Z');
  });

  it('accepts ISO strings and millisecond numbers', () => {
    const iso = dateToEpoch('2024-01-01T00:00:00.123Z');
    const milliseconds = dateToEpoch(1_704_067_200_123);

    expect(iso.ok && iso.milliseconds).toBe('1704067200123');
    expect(milliseconds.ok && milliseconds.iso).toBe('2024-01-01T00:00:00.123Z');
  });

  it('rejects blank and invalid dates', () => {
    expect(dateToEpoch('')).toMatchObject({ ok: false, code: 'invalid-date' });
    expect(dateToEpoch(new Date(Number.NaN))).toMatchObject({ ok: false, code: 'invalid-date' });
  });
});
