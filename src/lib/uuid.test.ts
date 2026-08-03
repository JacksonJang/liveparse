import { describe, expect, it, vi } from 'vitest';
import {
  estimateUuidV4Collision,
  formatUuid,
  generateUuidBatch,
  generateUuidV4,
  generateUuidV7,
  parseUuid,
  UuidParseError,
  type UuidCase,
  type UuidFormat,
  type UuidParseErrorCode,
} from './uuid';

const RFC_V1 = 'c232ab00-9414-11ec-b3c8-9f6bdeced846';
const RFC_V4 = '919108f7-52d1-4320-9bac-f847db4148a8';
const RFC_V6 = '1ec9414c-232a-6b00-b3c8-9f6bdeced846';
const RFC_V7 = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
const RFC_V7_TIME = 1_645_557_742_000;

function zeroRandom(length: number): Uint8Array {
  expect(length).toBe(16);
  return new Uint8Array(length);
}

function expectParseError(input: string, code: UuidParseErrorCode, offset: number | null): void {
  try {
    parseUuid(input);
    throw new Error('Expected UUID parsing to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(UuidParseError);
    expect(error).toMatchObject({ code, offset });
  }
}

describe('UUID parsing and RFC 9562 fields', () => {
  it('parses the RFC version 4 example', () => {
    const parsed = parseUuid(RFC_V4);
    expect(parsed.canonical).toBe(RFC_V4);
    expect(parsed.version).toBe(4);
    expect(parsed.variant).toBe('rfc9562');
    expect(parsed.variantBits).toBe('10');
    expect(parsed.isNil).toBe(false);
    expect(parsed.isMax).toBe(false);
    expect(parsed.timestampMs).toBeNull();
    expect(parsed.timestampIso).toBeNull();
    expect(parsed.timestampPrecision).toBeNull();
    expect(parsed.gregorianTimestamp100ns).toBeNull();
    expect(parsed.clockSequence).toBeNull();
    expect(parsed.node).toBeNull();
  });

  it('parses the RFC version 7 test vector and its timestamp', () => {
    const parsed = parseUuid(RFC_V7);
    expect(parsed.version).toBe(7);
    expect(parsed.variant).toBe('rfc9562');
    expect(parsed.timestampMs).toBe(RFC_V7_TIME);
    expect(parsed.timestampIso).toBe('2022-02-22T19:22:22.000Z');
    expect(parsed.timestampPrecision).toBe('millisecond');
    expect(parsed.gregorianTimestamp100ns).toBeNull();
    expect(parsed.clockSequence).toBeNull();
    expect(parsed.node).toBeNull();
  });

  it.each([
    [1, RFC_V1],
    [6, RFC_V6],
  ] as const)('decodes RFC version %i Gregorian time, clock sequence, and node fields', (version, input) => {
    const parsed = parseUuid(input);
    expect(parsed.version).toBe(version);
    expect(parsed.timestampMs).toBe(RFC_V7_TIME);
    expect(parsed.timestampIso).toBe('2022-02-22T19:22:22.000Z');
    expect(parsed.timestampPrecision).toBe('100ns');
    expect(parsed.gregorianTimestamp100ns).toBe(138648505420000000n);
    expect(parsed.clockSequence).toBe(13_256);
    expect(parsed.node).toBe('9f:6b:de:ce:d8:46');
  });

  it('decodes the Gregorian epoch without rounding negative time toward zero', () => {
    const parsed = parseUuid('00000000-0000-1000-8000-000000000000');
    expect(parsed.timestampMs).toBe(-12_219_292_800_000);
    expect(parsed.timestampIso).toBe('1582-10-15T00:00:00.000Z');
    expect(parsed.gregorianTimestamp100ns).toBe(0n);
  });

  it.each([
    RFC_V4.toUpperCase(),
    RFC_V4.replace(/-/g, ''),
    `{${RFC_V4.toUpperCase()}}`,
    `URN:UUID:${RFC_V4.toUpperCase()}`,
  ])('accepts a documented presentation and returns canonical text: %s', (input) => {
    const parsed = parseUuid(input);
    expect(parsed.canonical).toBe(RFC_V4);
    expect(parsed.version).toBe(4);
  });

  it('classifies Nil and Max as special values without an RFC version', () => {
    const nil = parseUuid('00000000-0000-0000-0000-000000000000');
    expect(nil).toMatchObject({ isNil: true, isMax: false, version: null, variant: 'ncs', variantBits: '0' });

    const max = parseUuid('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(max).toMatchObject({ isNil: false, isMax: true, version: null, variant: 'future', variantBits: '111' });
  });

  it.each([
    ['00000000-0000-4000-7fff-000000000000', 'ncs', '0', null],
    ['00000000-0000-4000-8fff-000000000000', 'rfc9562', '10', 4],
    ['00000000-0000-4000-cfff-000000000000', 'microsoft', '110', null],
    ['00000000-0000-4000-efff-000000000000', 'future', '111', null],
  ] as const)('classifies variant space for %s', (input, variant, bits, version) => {
    expect(parseUuid(input)).toMatchObject({ variant, variantBits: bits, version });
  });

  it('does not assign unsupported RFC version nibbles', () => {
    expect(parseUuid('00000000-0000-0000-8000-000000000000').version).toBeNull();
    expect(parseUuid('00000000-0000-9000-8000-000000000000').version).toBeNull();
  });

  it('reports every defined RFC version nibble from 1 through 8', () => {
    for (let version = 1; version <= 8; version += 1) {
      const input = `00000000-0000-${version.toString(16)}000-8000-000000000000`;
      expect(parseUuid(input).version).toBe(version);
    }
  });

  it('does not decode a v7-looking timestamp in non-RFC variant space', () => {
    const parsed = parseUuid('017f22e2-79b0-7cc3-78c4-dc0c0c07398f');
    expect(parsed).toMatchObject({ variant: 'ncs', version: null, timestampMs: null, timestampIso: null });
  });

  it('returns stable error codes and source offsets', () => {
    expectParseError('', 'EMPTY_INPUT', 0);
    expectParseError(` ${RFC_V4}`, 'WHITESPACE_NOT_ALLOWED', 0);
    expectParseError(`${RFC_V4}\n`, 'WHITESPACE_NOT_ALLOWED', 36);
    expectParseError(`{${RFC_V4}`, 'INVALID_WRAPPER', 37);
    expectParseError(`${RFC_V4}}`, 'INVALID_WRAPPER', 36);
    expectParseError(`{${RFC_V4.replace(/-/g, '')}}`, 'INVALID_LENGTH', 33);
    expectParseError(`x${RFC_V4.slice(1)}`, 'INVALID_HEX', 0);
    expectParseError(`919108f7_52d1-4320-9bac-f847db4148a8`, 'INVALID_HYPHEN', 8);
    expectParseError(`${RFC_V4}0`, 'INVALID_LENGTH', 36);
  });

  it('points to the first length or wrapper violation', () => {
    expectParseError(RFC_V4.slice(0, -1), 'INVALID_LENGTH', 35);
    expectParseError(`${RFC_V4}00`, 'INVALID_LENGTH', 36);
    expectParseError(`urn:uuid:${RFC_V4.slice(0, -1)}`, 'INVALID_LENGTH', 44);
    expectParseError(`urn:uuid:${RFC_V4}0`, 'INVALID_LENGTH', 45);
    expectParseError(`{${RFC_V4.slice(0, -1)}}`, 'INVALID_LENGTH', 36);
    expectParseError(`{${RFC_V4}0}`, 'INVALID_LENGTH', 37);
    expectParseError(`{${RFC_V4}}x`, 'INVALID_WRAPPER', 38);
  });

  it('rejects non-string input at the API boundary', () => {
    expect(() => parseUuid(42 as unknown as string)).toThrow(TypeError);
  });
});

describe('UUID formatting', () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);

  it.each([
    ['hyphenated', 'lower', '00010203-0405-0607-0809-0a0b0c0d0e0f'],
    ['compact', 'lower', '000102030405060708090a0b0c0d0e0f'],
    ['braced', 'upper', '{00010203-0405-0607-0809-0A0B0C0D0E0F}'],
    ['urn', 'upper', 'urn:uuid:00010203-0405-0607-0809-0A0B0C0D0E0F'],
  ] as const)('formats %s %s output', (format, letterCase, expected) => {
    expect(formatUuid(bytes, format, letterCase)).toBe(expected);
  });

  it('rejects invalid byte arrays and presentation options', () => {
    expect(() => formatUuid(new Uint8Array(15))).toThrow(TypeError);
    expect(() => formatUuid([] as unknown as Uint8Array)).toThrow(TypeError);
    expect(() => formatUuid(bytes, 'binary' as UuidFormat)).toThrow(TypeError);
    expect(() => formatUuid(bytes, 'hyphenated', 'title' as UuidCase)).toThrow(TypeError);
  });

  it('round-trips varied byte values through every accepted presentation', () => {
    const formats: UuidFormat[] = ['hyphenated', 'compact', 'braced', 'urn'];
    const cases: UuidCase[] = ['lower', 'upper'];
    for (let sample = 0; sample < 256; sample += 1) {
      const input = Uint8Array.from({ length: 16 }, (_, index) => (sample * 17 + index * 29) & 0xff);
      for (const format of formats) {
        for (const letterCase of cases) {
          expect(parseUuid(formatUuid(input, format, letterCase)).bytes).toEqual(input);
        }
      }
    }
  });
});

describe('UUID v4 collision estimates', () => {
  it('uses the 122-bit birthday-bound model without losing tiny probabilities', () => {
    expect(estimateUuidV4Collision(1)).toEqual({ probability: 0, expectedPairs: 0 });
    const two = estimateUuidV4Collision(2);
    expect(two.expectedPairs).toBe(1 / 2 ** 122);
    expect(two.probability).toBeCloseTo(two.expectedPairs, 30);

    const billion = estimateUuidV4Collision(1_000_000_000);
    expect(billion.expectedPairs).toBeCloseTo(9.403954797174345e-20, 30);
    expect(billion.probability).toBeCloseTo(billion.expectedPairs, 30);
  });

  it('approaches one half near the birthday-bound median', () => {
    const medianCount = Math.round(Math.sqrt(2 * 2 ** 122 * Math.log(2)));
    expect(estimateUuidV4Collision(medianCount).probability).toBeCloseTo(0.5, 12);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e31])('rejects an invalid count %s', (count) => {
    expect(() => estimateUuidV4Collision(count)).toThrow(RangeError);
  });
});

describe('UUID generation', () => {
  it('sets version and variant bits for deterministic UUID v4', () => {
    expect(generateUuidV4(zeroRandom)).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('sets the RFC version 7 layout around an exact millisecond', () => {
    const generated = generateUuidV7({ now: () => RFC_V7_TIME, randomBytes: zeroRandom });
    expect(generated).toBe('017f22e2-79b0-7000-8000-000000000000');
    expect(parseUuid(generated)).toMatchObject({ version: 7, timestampMs: RFC_V7_TIME });
  });

  it('reproduces the RFC Appendix A.6 v7 vector from its timestamp and random fields', () => {
    const vectorBytes = parseUuid(RFC_V7).bytes;
    expect(generateUuidV7({ now: () => RFC_V7_TIME, randomBytes: () => vectorBytes })).toBe(RFC_V7);
  });

  it('accepts both boundaries of the 48-bit timestamp field', () => {
    const minimum = generateUuidV7({ now: () => 0, randomBytes: zeroRandom });
    const maximum = generateUuidV7({ now: () => 0xffffffffffff, randomBytes: zeroRandom });
    expect(minimum).toBe('00000000-0000-7000-8000-000000000000');
    expect(maximum).toBe('ffffffff-ffff-7000-8000-000000000000');
    expect(parseUuid(minimum).timestampMs).toBe(0);
    expect(parseUuid(maximum).timestampMs).toBe(0xffffffffffff);
  });

  it('does not mutate bytes owned by a custom random source', () => {
    const source = new Uint8Array(16).fill(0xff);
    expect(generateUuidV4(() => source)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(source).toEqual(new Uint8Array(16).fill(0xff));
    generateUuidV7({ now: () => 0, randomBytes: () => source });
    expect(source).toEqual(new Uint8Array(16).fill(0xff));
  });

  it.each([-1, 0.5, Number.NaN, 0x1_0000_0000_0000])('rejects invalid version 7 time %s', (time) => {
    expect(() => generateUuidV7({ now: () => time, randomBytes: zeroRandom })).toThrow(RangeError);
  });

  it('rejects random sources that do not return exactly 16 bytes', () => {
    expect(() => generateUuidV4(() => new Uint8Array(15))).toThrow(TypeError);
    expect(() => generateUuidV7({ randomBytes: () => [] as unknown as Uint8Array })).toThrow(TypeError);
  });

  it('uses Web Crypto by default and fails closed when it is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0));
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      expect(generateUuidV4()).toBe('00000000-0000-4000-8000-000000000000');
      expect(getRandomValues).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }

    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => generateUuidV4()).toThrow('Secure UUID generation requires the Web Cryptography API.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('propagates random-source failures without a weak fallback', () => {
    const failure = new Error('entropy source failed');
    expect(() => generateUuidV4(() => { throw failure; })).toThrow(failure);
    expect(() => generateUuidV7({ randomBytes: () => { throw failure; } })).toThrow(failure);
  });

  it('never consults Math.random', () => {
    const weakRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    try {
      expect(generateUuidV4(zeroRandom)).toHaveLength(36);
      expect(generateUuidV7({ now: () => 0, randomBytes: zeroRandom })).toHaveLength(36);
      expect(weakRandom).not.toHaveBeenCalled();
    } finally {
      weakRandom.mockRestore();
    }
  });
});

describe('UUID batch generation', () => {
  it.each([0, 10_001, 1.5, Number.NaN])('rejects invalid count %s', (count) => {
    expect(() => generateUuidBatch({ version: 4, count, randomBytes: zeroRandom })).toThrow(RangeError);
  });

  it('rejects unsupported batch versions', () => {
    expect(() => generateUuidBatch({ version: 6 as 4, count: 1, randomBytes: zeroRandom })).toThrow(RangeError);
  });

  it('formats deterministic UUID v4 batches without mutating the random source', () => {
    const source = new Uint8Array(16);
    const values = generateUuidBatch({
      version: 4,
      count: 3,
      format: 'braced',
      case: 'upper',
      randomBytes: () => source,
    });
    expect(values).toEqual(Array(3).fill('{00000000-0000-4000-8000-000000000000}'));
    expect(source).toEqual(new Uint8Array(16));
  });

  it('creates 10,000 unique, strictly increasing v7 values in one millisecond', () => {
    const values = generateUuidBatch({
      version: 7,
      count: 10_000,
      now: () => RFC_V7_TIME,
      randomBytes: zeroRandom,
    });

    expect(values).toHaveLength(10_000);
    expect(new Set(values).size).toBe(10_000);
    expect(values[0]).toBe('017f22e2-79b0-7000-8000-000000000000');
    expect(values[values.length - 1]).toBe('017f22e2-79b0-79c3-b000-000000000000');
    for (let index = 0; index < values.length; index += 1) {
      const parsed = parseUuid(values[index]);
      expect(parsed.version).toBe(7);
      expect(parsed.timestampMs).toBe(RFC_V7_TIME);
      if (index > 0) expect(values[index] > values[index - 1]).toBe(true);
    }
  });

  it('holds effective time during rollback and resumes when the clock advances', () => {
    const times = [1002, 1001, 1003];
    let index = 0;
    const values = generateUuidBatch({
      version: 7,
      count: 3,
      now: () => times[index++],
      randomBytes: zeroRandom,
    });

    expect(values.map((value) => parseUuid(value).timestampMs)).toEqual([1002, 1002, 1003]);
    expect(values[0] < values[1]).toBe(true);
    expect(values[1] < values[2]).toBe(true);
  });

  it('reserves enough counter capacity even from the largest random seed', () => {
    const highSeed = (length: number) => {
      const bytes = new Uint8Array(length).fill(0xff);
      bytes[0] = 0x18;
      bytes[1] = 0xf0;
      return bytes;
    };
    const values = generateUuidBatch({
      version: 7,
      count: 10_000,
      now: () => 42,
      randomBytes: highSeed,
    });
    expect(values).toHaveLength(10_000);
    expect(new Set(values).size).toBe(10_000);
    expect(values[0]).toBe('00000000-002a-763c-8fff-ffffffffffff');
    expect(values[values.length - 1]).toBe('00000000-002a-7fff-bfff-ffffffffffff');
    expect(values.every((value, index) => index === 0 || value > values[index - 1])).toBe(true);
  });

  it('rejection-samples an unbiased counter seed', () => {
    let calls = 0;
    const randomBytes = (length: number) => {
      calls += 1;
      const bytes = new Uint8Array(length);
      if (calls === 1) {
        bytes[0] = 0xff;
        bytes[1] = 0xff;
      }
      return bytes;
    };
    const values = generateUuidBatch({ version: 7, count: 10, now: () => 0, randomBytes });
    expect(calls).toBe(11);
    expect(values[0]).toBe('00000000-0000-7000-8000-000000000000');
    expect(values.every((value, index) => index === 0 || value > values[index - 1])).toBe(true);
  });

  it('fails rather than accepting a permanently biased custom source', () => {
    const rejected = (length: number) => new Uint8Array(length).fill(0xff);
    expect(() => generateUuidBatch({ version: 7, count: 10, now: () => 0, randomBytes: rejected }))
      .toThrow('could not produce an unbiased v7 batch counter seed');
  });

  it('supports compact uppercase v7 batch presentation', () => {
    const [value] = generateUuidBatch({
      version: 7,
      count: 1,
      format: 'compact',
      case: 'upper',
      now: () => RFC_V7_TIME,
      randomBytes: zeroRandom,
    });
    expect(value).toBe('017F22E279B070008000000000000000');
    expect(parseUuid(value).version).toBe(7);
  });

  it.each([
    ['hyphenated', 'lower'],
    ['hyphenated', 'upper'],
    ['compact', 'lower'],
    ['compact', 'upper'],
    ['braced', 'lower'],
    ['braced', 'upper'],
    ['urn', 'lower'],
    ['urn', 'upper'],
  ] as const)('keeps %s %s v7 batches lexically increasing', (format, letterCase) => {
    const values = generateUuidBatch({
      version: 7,
      count: 128,
      format,
      case: letterCase,
      now: () => RFC_V7_TIME,
      randomBytes: zeroRandom,
    });
    expect(values.every((value, index) => index === 0 || value > values[index - 1])).toBe(true);
    expect(values.every((value) => parseUuid(value).version === 7)).toBe(true);
  });

  it('calls the random source once per value when no seed retry is needed', () => {
    let v4Calls = 0;
    let v7Calls = 0;
    generateUuidBatch({ version: 4, count: 3, randomBytes: (length) => {
      v4Calls += 1;
      return new Uint8Array(length);
    } });
    generateUuidBatch({ version: 7, count: 3, now: () => 0, randomBytes: (length) => {
      v7Calls += 1;
      return new Uint8Array(length);
    } });
    expect(v4Calls).toBe(3);
    expect(v7Calls).toBe(3);
  });
});
