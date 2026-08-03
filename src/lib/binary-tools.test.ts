import { describe, expect, it } from 'vitest';
import {
  ASCII_TABLE,
  MAX_BINARY_BYTES,
  MAX_BINARY_INPUT_CODE_UNITS,
  MAX_BINARY_TEXT_CODE_UNITS,
  MAX_BIT_WIDTH,
  MAX_HEX_INPUT_CODE_UNITS,
  MAX_RADIX_DIGITS,
  MAX_RADIX_INPUT_CODE_UNITS,
  MAX_RADIX_OUTPUT_DIGITS,
  binaryToUtf8Text,
  decodeTwosComplement,
  encodeTwosComplement,
  formatRadixInteger,
  hexToUtf8Text,
  parseRadixInteger,
  signedRange,
  utf8TextToBinary,
  utf8TextToHex,
} from './binary-tools';

describe('radix integers', () => {
  it.each([
    ['101101', 2, 45n],
    ['755', 8, 493n],
    ['90071992547409931234567890', 10, 90071992547409931234567890n],
    ['DeAdBeEf', 16, 0xdeadbeefn],
    ['Z', 36, 35n],
    ['-101', 2, -5n],
    ['+42', 10, 42n],
    ['-0', 10, 0n],
  ])('parses %s exactly in base %i', (input, radix, expected) => {
    expect(parseRadixInteger(input, radix)).toBe(expected);
  });

  it.each([
    ['0b1010', 2, 10n],
    ['0B1010', 2, 10n],
    ['0o777', 8, 511n],
    ['0O777', 8, 511n],
    ['0xFF', 16, 255n],
    ['-0XFF', 16, -255n],
  ])('accepts the matching conventional prefix in %s', (input, radix, expected) => {
    expect(parseRadixInteger(input, radix)).toBe(expected);
  });

  it('allows only explicit separators between valid digits', () => {
    expect(parseRadixInteger('  1101  0110_1011  ', 2, true)).toBe(0b110101101011n);
    expect(parseRadixInteger('12_345', 10, true)).toBe(12345n);
    for (const input of ['_12', '12_', '1__2', '0x_FF', '1_ 2']) {
      expect(() => parseRadixInteger(input, input.includes('x') ? 16 : 10, true)).toThrow();
    }
    expect(() => parseRadixInteger('1 2', 10, false)).toThrow(/offset/);
  });

  it.each([
    ['', 10], ['   ', 10], ['+', 10], ['0x', 16], ['2', 2], ['8', 8], ['G', 16],
    ['1.5', 10], ['1e3', 10], ['1,000', 10], ['１２', 10], ['١٢', 10],
  ])('rejects malformed or unsupported integer input %s', (input, radix) => {
    expect(() => parseRadixInteger(input, radix)).toThrow();
  });

  it.each([1, 1.5, 37, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid radix %s', (radix) => {
    expect(() => parseRadixInteger('1', radix)).toThrow(/Radix/);
  });

  it.each([
    ['0b101', 8], ['0b101', 16], ['0o77', 10], ['0x10', 2], ['0x10', 36],
  ])('rejects conventional prefix %s when base %i is selected', (input, radix) => {
    expect(() => parseRadixInteger(input, radix)).toThrow(/denotes base/);
  });

  it('enforces both input and digit limits before unbounded work', () => {
    expect(parseRadixInteger('1'.repeat(MAX_RADIX_DIGITS), 2)).toBe((1n << BigInt(MAX_RADIX_DIGITS)) - 1n);
    expect(() => parseRadixInteger('1'.repeat(MAX_RADIX_DIGITS + 1), 2)).toThrow(/at most/);
    expect(() => parseRadixInteger(' '.repeat(MAX_RADIX_INPUT_CODE_UNITS + 1), 10)).toThrow(/limited/);
  });

  it('formats sign, prefixes, case, grouping, and minimum width deterministically', () => {
    expect(formatRadixInteger(255n, 2)).toBe('11111111');
    expect(formatRadixInteger(255n, 16, { uppercase: true, prefix: true })).toBe('0xFF');
    expect(formatRadixInteger(-255n, 16, { uppercase: true, prefix: true })).toBe('-0xFF');
    expect(formatRadixInteger(0xabcdefn, 16, { uppercase: true, groupSize: 2 })).toBe('AB CD EF');
    expect(formatRadixInteger(5n, 2, { minimumDigits: 8, groupSize: 4, prefix: true })).toBe('0b0000 0101');
    expect(formatRadixInteger(35n, 36, { uppercase: true, prefix: true })).toBe('Z');
  });

  it('rejects invalid formatter arguments', () => {
    expect(() => formatRadixInteger(1 as unknown as bigint, 10)).toThrow(/bigint/);
    expect(() => formatRadixInteger(1n, 1)).toThrow(/Radix/);
    expect(() => formatRadixInteger(1n, 10, { groupSize: -1 })).toThrow(/Group/);
    expect(() => formatRadixInteger(1n, 10, { minimumDigits: 0 })).toThrow(/Minimum/);
    expect(() => formatRadixInteger(1n << BigInt(MAX_RADIX_OUTPUT_DIGITS), 2)).toThrow(/Formatted output/);
  });

  it('round-trips deterministic arbitrary-precision values through every radix', () => {
    let state = 0x9e3779b97f4a7c15n;
    for (let sample = 0; sample < 80; sample += 1) {
      state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 256n) - 1n);
      const value = sample % 3 === 0 ? -state : state;
      for (let radix = 2; radix <= 36; radix += 1) {
        const formatted = formatRadixInteger(value, radix, { uppercase: sample % 2 === 0 });
        expect(parseRadixInteger(formatted, radix)).toBe(value);
      }
    }
  });

  it('agrees with native BigInt parsing for the native prefixed radices', () => {
    const value = (1n << 240n) + (1n << 127n) + 0x123456789abcdefn;
    for (const [radix, prefix] of [[2, '0b'], [8, '0o'], [16, '0x']] as const) {
      const digits = formatRadixInteger(value, radix);
      expect(parseRadixInteger(digits, radix)).toBe(BigInt(`${prefix}${digits}`));
    }
    expect(parseRadixInteger(value.toString(10), 10)).toBe(BigInt(value.toString(10)));
  });
});

describe("two's-complement words", () => {
  it.each([
    [-128n, 8, 128n], [-42n, 8, 214n], [-1n, 8, 255n], [0n, 8, 0n], [127n, 8, 127n],
    [-1n, 1, 1n], [0n, 1, 0n],
  ])('encodes %s at %i bits as %s without wrapping', (signed, width, pattern) => {
    expect(encodeTwosComplement(signed, width)).toBe(pattern);
    expect(decodeTwosComplement(pattern, width)).toBe(signed);
  });

  it('reports the exact signed range for explicit widths', () => {
    expect(signedRange(1)).toEqual({ minimum: -1n, maximum: 0n });
    expect(signedRange(8)).toEqual({ minimum: -128n, maximum: 127n });
    expect(signedRange(64)).toEqual({ minimum: -(1n << 63n), maximum: (1n << 63n) - 1n });
  });

  it('rejects overflow instead of applying modulo arithmetic', () => {
    expect(() => encodeTwosComplement(-129n, 8)).toThrow(/does not fit/);
    expect(() => encodeTwosComplement(128n, 8)).toThrow(/does not fit/);
    expect(() => decodeTwosComplement(-1n, 8)).toThrow(/does not fit/);
    expect(() => decodeTwosComplement(256n, 8)).toThrow(/does not fit/);
  });

  it.each([0, -1, 1.5, MAX_BIT_WIDTH + 1, Number.NaN])('rejects invalid width %s', (width) => {
    expect(() => encodeTwosComplement(0n, width)).toThrow(/Bit width/);
    expect(() => decodeTwosComplement(0n, width)).toThrow(/Bit width/);
  });

  it('round-trips representative values across many widths', () => {
    for (const width of [1, 2, 3, 7, 8, 16, 31, 32, 64, 127, 128, 256]) {
      const { minimum, maximum } = signedRange(width);
      for (const value of [minimum, minimum + 1n, -1n, 0n, maximum - (maximum > 0n ? 1n : 0n), maximum]) {
        if (value < minimum || value > maximum) continue;
        expect(decodeTwosComplement(encodeTwosComplement(value, width), width)).toBe(value);
      }
    }
  });
});

describe('strict UTF-8 byte translation', () => {
  it.each([
    ['Hello', '48 65 6C 6C 6F', '01001000 01100101 01101100 01101100 01101111'],
    ['한', 'ED 95 9C', '11101101 10010101 10011100'],
    ['😀', 'F0 9F 98 80', '11110000 10011111 10011000 10000000'],
    ['A\u0000B', '41 00 42', '01000001 00000000 01000010'],
    ['', '', ''],
  ])('encodes and decodes %j as exact UTF-8 bytes', (text, hex, binary) => {
    expect(utf8TextToHex(text)).toMatchObject({ text, hex, binary, byteLength: hex ? hex.split(' ').length : 0 });
    expect(utf8TextToBinary(text)).toMatchObject({ text, hex, binary });
    expect(hexToUtf8Text(hex)).toMatchObject({ text, hex, binary });
    expect(binaryToUtf8Text(binary)).toMatchObject({ text, hex, binary });
  });

  it('accepts complete pairs in documented hex-byte styles without mixing them', () => {
    for (const input of ['48 65 6c 6c 6f', '48656c6c6f', '48:65:6c:6c:6f', '48-65-6c-6c-6f', '0x48 0x65 0x6c 0x6c 0x6f', '\\x48\\x65\\x6c\\x6c\\x6f']) {
      expect(hexToUtf8Text(input).text).toBe('Hello');
    }
    expect(binaryToUtf8Text('01001000\n01101001').text).toBe('Hi');
    for (const input of ['4 1', '4:1', '0x4 0x1', '41,42', '41:42-43', '0x41 42', '\\x41 42']) {
      expect(() => hexToUtf8Text(input)).toThrow(/complete pairs/);
    }
    for (const input of ['01000001_01000010', '0b01000001', '0100000x']) expect(() => binaryToUtf8Text(input)).toThrow(/only 0, 1/);
  });

  it('requires complete bytes', () => {
    expect(() => hexToUtf8Text('F')).toThrow(/two digits per byte/);
    expect(() => binaryToUtf8Text('0100000')).toThrow(/complete 8-bit bytes/);
  });

  it.each([
    ['80', 0],
    ['C0 80', 0],
    ['E0 80 80', 1],
    ['ED A0 80', 1],
    ['F0 80 80 80', 1],
    ['F4 90 80 80', 1],
    ['F5 80 80 80', 0],
    ['E2 82', 0],
    ['E2 28 A1', 1],
  ])('rejects malformed UTF-8 %s at a useful byte offset', (hex, offset) => {
    expect(() => hexToUtf8Text(hex)).toThrow(new RegExp(`byte offset ${offset}`));
  });

  it('preserves a leading UTF-8 BOM as U+FEFF for byte round trips', () => {
    const decoded = hexToUtf8Text('EF BB BF 41');
    expect(decoded.text).toBe('\uFEFFA');
    expect(utf8TextToHex(decoded.text).hex).toBe('EF BB BF 41');
  });

  it.each(['\uD800', '\uDC00', `A\uD800B`])('rejects lone UTF-16 surrogate input %j', (text) => {
    expect(() => utf8TextToHex(text)).toThrow(/Unpaired UTF-16 surrogate/);
    expect(() => utf8TextToBinary(text)).toThrow(/Unpaired UTF-16 surrogate/);
  });

  it('supports deterministic hex case without changing bytes', () => {
    expect(utf8TextToHex('ÿ', { uppercase: false }).hex).toBe('c3 bf');
    expect(hexToUtf8Text('c3 bf', { uppercase: false }).hex).toBe('c3 bf');
    expect(hexToUtf8Text('c3 bf', { uppercase: true }).hex).toBe('C3 BF');
  });

  it('enforces input and decoded-byte limits', () => {
    expect(() => binaryToUtf8Text(' '.repeat(MAX_BINARY_INPUT_CODE_UNITS + 1))).toThrow(/limited/);
    expect(() => hexToUtf8Text(' '.repeat(MAX_HEX_INPUT_CODE_UNITS + 1))).toThrow(/limited/);
    expect(() => utf8TextToHex('a'.repeat(MAX_BINARY_TEXT_CODE_UNITS + 1))).toThrow(/limited/);
    expect(() => utf8TextToHex('😀'.repeat(Math.floor(MAX_BINARY_BYTES / 4) + 1))).toThrow(/Byte input or output/);
  });

  it('returns independent byte arrays rather than shared mutable state', () => {
    const first = utf8TextToHex('A');
    first.bytes[0] = 0;
    const second = utf8TextToHex('A');
    expect(second.bytes).toEqual(new Uint8Array([0x41]));
    expect(first.hex).toBe('41');
  });
});

describe('standard ASCII table', () => {
  it('contains exactly one immutable row for every code from 0 through 127', () => {
    expect(ASCII_TABLE).toHaveLength(128);
    expect(ASCII_TABLE.map((row) => row.code)).toEqual(Array.from({ length: 128 }, (_, code) => code));
    expect(new Set(ASCII_TABLE.map((row) => row.code)).size).toBe(128);
    expect(Object.isFrozen(ASCII_TABLE)).toBe(true);
    expect(ASCII_TABLE.every((row) => Object.isFrozen(row))).toBe(true);
  });

  it('formats every representation with fixed reference widths', () => {
    for (const row of ASCII_TABLE) {
      expect(row.dec).toBe(String(row.code));
      expect(row.hex).toBe(row.code.toString(16).toUpperCase().padStart(2, '0'));
      expect(row.octal).toBe(row.code.toString(8).padStart(3, '0'));
      expect(row.binary).toBe(row.code.toString(2).padStart(8, '0'));
    }
  });

  it('uses safe labels for controls and exact printable characters', () => {
    expect(ASCII_TABLE[0]).toMatchObject({ abbr: 'NUL', label: '<NUL>', name: 'Null', display: '', control: true, printable: false });
    expect(ASCII_TABLE[10]).toMatchObject({ abbr: 'LF', label: '<LF>', name: 'Line Feed', display: '', control: true });
    expect(ASCII_TABLE[32]).toMatchObject({ abbr: 'SP', label: '<SP>', name: 'Space', display: ' ', control: false, printable: true });
    expect(ASCII_TABLE[65]).toMatchObject({ label: 'A', name: 'Latin Capital Letter A', display: 'A', hex: '41', binary: '01000001' });
    expect(ASCII_TABLE[97]).toMatchObject({ label: 'a', name: 'Latin Small Letter A', display: 'a' });
    expect(ASCII_TABLE[127]).toMatchObject({ abbr: 'DEL', label: '<DEL>', name: 'Delete', display: '', control: true, printable: false });
    expect(ASCII_TABLE.slice(0, 32).every((row) => row.display === '')).toBe(true);
  });
});
