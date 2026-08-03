import { describe, expect, it } from 'vitest';
import {
  Base64DecodeError,
  bytesToHex,
  bytesToUtf8,
  convertBase64Alphabet,
  DataUrlParseError,
  decodeBase64,
  detectSafeRasterMime,
  encodeBase64,
  parseDataUrl,
  utf8ToBytes,
} from './base64';

function decodedText(input: string): string {
  return bytesToUtf8(decodeBase64(input).bytes, { fatal: true });
}

function captureBase64Error(action: () => unknown): Base64DecodeError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Base64DecodeError);
  return caught as Base64DecodeError;
}

function captureDataUrlError(action: () => unknown): DataUrlParseError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DataUrlParseError);
  return caught as DataUrlParseError;
}

describe('RFC 4648 Base64 encoding and decoding', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('matches the RFC 4648 vector for %j', (plainText, encoded) => {
    expect(encodeBase64(utf8ToBytes(plainText))).toBe(encoded);
    expect(bytesToUtf8(decodeBase64(encoded, { padding: 'require' }).bytes)).toBe(plainText);
  });

  it('supports padded and unpadded standard and URL-safe alphabets', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xff]);

    expect(encodeBase64(bytes)).toBe('+///');
    expect(encodeBase64(bytes, { alphabet: 'url' })).toBe('-___');
    expect(Array.from(decodeBase64('-___').bytes)).toEqual(Array.from(bytes));
    expect(encodeBase64(Uint8Array.of(0xfb), { alphabet: 'url' })).toBe('-w');
    expect(encodeBase64(Uint8Array.of(0xfb), { alphabet: 'url', padding: true })).toBe('-w==');
  });

  it('round-trips every possible byte value without relying on binary strings', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const decoded = decodeBase64(encodeBase64(bytes));

    expect(decoded.bytes).toEqual(bytes);
    expect(decoded.normalized).toBe(encodeBase64(bytes));
  });

  it.each([24_575, 24_576, 24_577])(
    'preserves output across the internal encoding chunk boundary for %i bytes',
    (length) => {
      const bytes = new Uint8Array(length);
      const encoded = encodeBase64(bytes);

      expect(encoded).toMatch(/^A*=*$/);
      expect(decodeBase64(encoded).bytes).toEqual(bytes);
    },
  );

  it('encodes Unicode as UTF-8 and decodes it without mojibake', () => {
    const input = 'a Ā 𐀀 文 🦄';
    const encoded = 'YSDEgCDwkICAIOaWhyDwn6aE';

    expect(encodeBase64(utf8ToBytes(input))).toBe(encoded);
    expect(decodedText(encoded)).toBe(input);
  });

  it('can make invalid UTF-8 decoding fatal', () => {
    expect(() => bytesToUtf8(Uint8Array.of(0xc3, 0x28), { fatal: true })).toThrow();
    expect(bytesToUtf8(Uint8Array.of(0xc3, 0x28))).toContain('\ufffd');
  });
});

describe('strict input validation and diagnostics', () => {
  it('rejects whitespace by default and reports its original offset', () => {
    const error = captureBase64Error(() => decodeBase64('Zm 9v'));

    expect(error).toMatchObject({
      code: 'WHITESPACE_NOT_ALLOWED',
      offset: 2,
      character: ' ',
    });
  });

  it('optionally ignores only ASCII whitespace and preserves source offsets', () => {
    const decoded = decodeBase64(' Zm9v\r\n', { whitespace: 'ignore' });
    const error = captureBase64Error(() => decodeBase64('Zm 9$', { whitespace: 'ignore' }));

    expect(bytesToUtf8(decoded.bytes)).toBe('foo');
    expect(decoded.normalized).toBe('Zm9v');
    expect(decoded.diagnostics).toMatchObject({
      hadWhitespace: true,
      ignoredWhitespaceCount: 3,
    });
    expect(error).toMatchObject({ code: 'INVALID_CHARACTER', offset: 4, character: '$' });
    expect(() => decodeBase64(`Zm\u00a09v`, { whitespace: 'ignore' })).toThrow(Base64DecodeError);
  });

  it('enforces a requested alphabet and rejects mixed alphabets in auto mode', () => {
    expect(captureBase64Error(() => decodeBase64('-w==', { alphabet: 'standard' }))).toMatchObject({
      code: 'INVALID_CHARACTER',
      offset: 0,
    });
    expect(captureBase64Error(() => decodeBase64('+w==', { alphabet: 'url' }))).toMatchObject({
      code: 'INVALID_CHARACTER',
      offset: 0,
    });
    expect(captureBase64Error(() => decodeBase64('+_'))).toMatchObject({
      code: 'MIXED_ALPHABET',
      offset: 1,
    });
    expect(decodeBase64('-___').diagnostics).toMatchObject({
      alphabet: 'url',
      alphabetWasAmbiguous: false,
    });
    expect(decodeBase64('Zm9v').diagnostics).toMatchObject({
      alphabet: 'standard',
      alphabetWasAmbiguous: true,
    });
  });

  it('reports missing padding and can require or forbid it', () => {
    const allowed = decodeBase64('Zg');
    const forbidden = decodeBase64('Zg', { padding: 'forbid' });

    expect(bytesToUtf8(allowed.bytes)).toBe('f');
    expect(allowed.normalized).toBe('Zg==');
    expect(allowed.diagnostics).toMatchObject({ padding: 'missing', addedPadding: 2 });
    expect(forbidden.normalized).toBe('Zg');
    expect(forbidden.diagnostics).toMatchObject({ padding: 'missing', addedPadding: 0 });
    expect(captureBase64Error(() => decodeBase64('Zg', { padding: 'require' }))).toMatchObject({
      code: 'PADDING_REQUIRED',
      offset: 2,
    });
    expect(captureBase64Error(() => decodeBase64('Zg==', { padding: 'forbid' }))).toMatchObject({
      code: 'PADDING_FORBIDDEN',
      offset: 2,
    });
  });

  it.each([
    ['A', 'INVALID_LENGTH', 0],
    ['=AAA', 'PADDING_POSITION', 1],
    ['Z=g=', 'PADDING_POSITION', 2],
    ['A===', 'PADDING_COUNT', 3],
    ['Zg=', 'INVALID_PADDING', 2],
    ['Zg===', 'PADDING_COUNT', 4],
    ['Zm9v=', 'INVALID_PADDING', 4],
  ] as const)('rejects malformed padding in %j', (input, code, offset) => {
    expect(captureBase64Error(() => decodeBase64(input))).toMatchObject({ code, offset });
  });

  it.each([
    ['Zh==', 1],
    ['Zh', 1],
    ['Zm9=', 2],
  ] as const)('rejects non-zero unused pad bits in %j', (input, offset) => {
    expect(captureBase64Error(() => decodeBase64(input))).toMatchObject({
      code: 'NON_CANONICAL_PAD_BITS',
      offset,
    });
  });

  it('accepts canonical final quanta', () => {
    expect(decodedText('Zg==')).toBe('f');
    expect(decodedText('Zm8=')).toBe('fo');
    expect(decodedText('Zm9v')).toBe('foo');
  });

  it.each([
    ['=A$', {}, 'INVALID_CHARACTER', 2],
    ['=+_', {}, 'MIXED_ALPHABET', 2],
    ['===A', {}, 'PADDING_POSITION', 3],
    ['A=', { padding: 'forbid' }, 'PADDING_FORBIDDEN', 1],
    ['Zg=', { padding: 'forbid' }, 'PADDING_FORBIDDEN', 2],
    ['Zh', { padding: 'require' }, 'PADDING_REQUIRED', 2],
  ] as const)(
    'preserves lexical and structural error precedence for %j',
    (input, options, code, offset) => {
      expect(captureBase64Error(() => decodeBase64(input, options))).toMatchObject({ code, offset });
    },
  );

  it('reports the original end offset when ignored trailing whitespace precedes missing padding', () => {
    const input = 'Zg \r\n';
    expect(captureBase64Error(() => decodeBase64(input, {
      whitespace: 'ignore',
      padding: 'require',
    }))).toMatchObject({ code: 'PADDING_REQUIRED', offset: input.length });
  });
});

describe('Base64 alphabet conversion', () => {
  it('converts through validated bytes and applies alphabet-specific padding defaults', () => {
    expect(convertBase64Alphabet('+w==', 'url')).toBe('-w');
    expect(convertBase64Alphabet('-w', 'standard')).toBe('+w==');
    expect(convertBase64Alphabet('+w==', 'url', { padding: true })).toBe('-w==');
    expect(convertBase64Alphabet(' +w==\n', 'url', { whitespace: 'ignore' })).toBe('-w');
  });

  it('does not silently convert mixed alphabets or non-canonical values', () => {
    expect(() => convertBase64Alphabet('+_', 'url')).toThrow(Base64DecodeError);
    expect(() => convertBase64Alphabet('Zh==', 'url')).toThrow(Base64DecodeError);
  });
});

describe('Data URL parsing', () => {
  it('applies the RFC 2397 default media type and percent-decodes bytes', () => {
    const parsed = parseDataUrl('data:,Hello%2C%20World%21');

    expect(parsed.mediaType).toBe('text/plain');
    expect(parsed.parameters).toEqual({ charset: 'US-ASCII' });
    expect(parsed.isBase64).toBe(false);
    expect(parsed.payloadOffset).toBe(6);
    expect(bytesToUtf8(parsed.bytes)).toBe('Hello, World!');
    expect(parsed.base64Diagnostics).toBeNull();
  });

  it('normalizes media types, decodes parameters, and parses Base64 payloads', () => {
    const input = 'DATA:IMAGE/PNG;name=hello%20world;base64,iVBORw0KGgo=';
    const parsed = parseDataUrl(input);

    expect(parsed.mediaType).toBe('image/png');
    expect(parsed.parameters).toEqual({ name: 'hello world' });
    expect(parsed.isBase64).toBe(true);
    expect(parsed.payloadOffset).toBe(input.indexOf(',') + 1);
    expect(parsed.base64Diagnostics).toMatchObject({
      alphabet: 'standard',
      padding: 'present',
    });
    expect(detectSafeRasterMime(parsed.bytes)).toBe('image/png');
  });

  it('accepts URL-escaped Base64 padding and optional missing padding', () => {
    const escaped = parseDataUrl('data:application/octet-stream;base64,Zg%3D%3D');
    const unpadded = parseDataUrl('data:text/plain;charset=UTF-8;base64,4pyT');
    const restoredPadding = parseDataUrl('data:text/plain;base64,Zg');

    expect(bytesToUtf8(escaped.bytes)).toBe('f');
    expect(bytesToUtf8(unpadded.bytes)).toBe('✓');
    expect(unpadded.parameters).toEqual({ charset: 'UTF-8' });
    expect(unpadded.base64Diagnostics).toMatchObject({ padding: 'not-needed' });
    expect(bytesToUtf8(restoredPadding.bytes)).toBe('f');
    expect(restoredPadding.base64Diagnostics).toMatchObject({ padding: 'missing', addedPadding: 2 });
  });

  it('reports malformed percent escapes and Base64 characters at absolute offsets', () => {
    expect(captureDataUrlError(() => parseDataUrl('data:,abc%2'))).toMatchObject({
      code: 'INVALID_PERCENT_ENCODING',
      offset: 9,
    });

    const input = 'data:text/plain;base64,Zm$=';
    const error = captureBase64Error(() => parseDataUrl(input));
    expect(error).toMatchObject({
      code: 'INVALID_CHARACTER',
      offset: input.indexOf('$'),
      character: '$',
    });
    expect(error.message).toBe(`Invalid Base64 character "$" at offset ${input.indexOf('$')}.`);

    const escapedInput = 'data:text/plain;base64,Zm%24=';
    const escapedError = captureBase64Error(() => parseDataUrl(escapedInput));
    expect(escapedError).toMatchObject({
      code: 'INVALID_CHARACTER',
      offset: escapedInput.indexOf('%'),
      character: '$',
    });
    expect(escapedError.message).toBe(
      `Invalid Base64 character "$" at offset ${escapedInput.indexOf('%')}.`,
    );
  });

  it('UTF-8 encodes raw Unicode and lone surrogates in non-Base64 payloads', () => {
    const payload = 'plain ✓ 🦄 \ud800';
    const parsed = parseDataUrl(`data:,${payload}`);

    expect(parsed.bytes).toEqual(utf8ToBytes(payload));
  });

  it('rejects malformed metadata, duplicate parameters, and misplaced Base64 flags', () => {
    expect(captureDataUrlError(() => parseDataUrl('https:text/plain,hello'))).toMatchObject({
      code: 'INVALID_SCHEME',
      offset: 0,
    });
    expect(captureDataUrlError(() => parseDataUrl('data:text/plain'))).toMatchObject({
      code: 'MISSING_COMMA',
    });
    expect(captureDataUrlError(() => parseDataUrl(`data:${'a'.repeat(8_193)},x`))).toMatchObject({
      code: 'METADATA_TOO_LONG',
      offset: 8_197,
    });
    expect(captureDataUrlError(() => parseDataUrl('data:text;base64,AA=='))).toMatchObject({
      code: 'INVALID_MEDIA_TYPE',
    });
    expect(captureDataUrlError(() => parseDataUrl('data:text/plain;a=1;A=2,x'))).toMatchObject({
      code: 'DUPLICATE_PARAMETER',
    });
    expect(captureDataUrlError(() => parseDataUrl('data:text/plain;base64;charset=utf-8,x'))).toMatchObject({
      code: 'BASE64_FLAG_POSITION',
      offset: 16,
    });
    expect(captureDataUrlError(() => parseDataUrl('data:text/plain;base64;base64,x'))).toMatchObject({
      code: 'BASE64_FLAG_POSITION',
      offset: 16,
    });
  });
});

describe('binary previews and safe raster detection', () => {
  it('formats bounded hexadecimal previews', () => {
    const bytes = Uint8Array.of(0x00, 0x0f, 0xff);

    expect(bytesToHex(bytes)).toBe('00 0f ff');
    expect(bytesToHex(bytes, { uppercase: true, separator: '', limit: 2 })).toBe('000F');
    expect(bytesToHex(bytes, { separator: '·🦄' })).toBe('00·🦄0f·🦄ff');
    expect(bytesToHex(bytes, { limit: 0 })).toBe('');
    expect(() => bytesToHex(bytes, { limit: -1 })).toThrow(RangeError);
  });

  it('preserves separators across internal hexadecimal chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 8_200 }, (_, index) => index & 0xff);
    const expected = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(':');

    expect(bytesToHex(bytes, { separator: ':' })).toBe(expected);
  });

  it.each([
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [utf8ToBytes('GIF87a'), 'image/gif'],
    [utf8ToBytes('GIF89a'), 'image/gif'],
    [Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp'],
  ] as const)('recognizes a safe raster signature', (bytes, expected) => {
    expect(detectSafeRasterMime(bytes)).toBe(expected);
  });

  it('never treats textual or active formats as preview-safe raster images', () => {
    expect(detectSafeRasterMime(utf8ToBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectSafeRasterMime(utf8ToBytes('%PDF-1.7'))).toBeNull();
    expect(detectSafeRasterMime(Uint8Array.of(0x89, 0x50, 0x4e))).toBeNull();
  });
});
