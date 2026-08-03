import { describe, expect, it } from 'vitest';
import {
  analyzeTextInput,
  bytesToBase64,
  bytesToHex,
  compareDigests,
  constantTimeEqual,
  digestBlob,
  digestBytes,
  digestText,
  HashInputError,
  MAX_HASH_FILE_BYTES,
  MAX_HASH_TEXT_CODE_UNITS,
  MAX_DIGEST_INPUT_CHARS,
  md5,
  normalizeDigest,
  utf8ToBytes,
  type HashAlgorithm,
} from './hash';

describe('RFC 1321 MD5 compatibility vectors', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ])('matches the published vector for %j', (input, expected) => {
    expect(bytesToHex(md5(utf8ToBytes(input)))).toBe(expected);
  });

  it('does not confuse a byte subarray with its backing buffer', () => {
    const source = utf8ToBytes('xxabczz');
    expect(bytesToHex(md5(source.subarray(2, 5)))).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});

describe('NIST SHA-2 vectors through Web Crypto', () => {
  it.each([
    ['SHA-256', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['SHA-256', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['SHA-256', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['SHA-384', '', '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b'],
    ['SHA-384', 'abc', 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'],
    ['SHA-512', '', 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'],
    ['SHA-512', 'abc', 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'],
  ] as const)('matches %s for %j', async (algorithm, input, expected) => {
    const result = await digestText(input, algorithm);
    expect(result.hex).toBe(expected);
    expect(result.digest.byteLength * 2).toBe(expected.length);
    expect(result.inputByteLength).toBe(utf8ToBytes(input).byteLength);
  });

  it('hashes the exact raw bytes of a Blob', async () => {
    const result = await digestBlob(new Blob(['abc']), 'SHA-256');
    expect(result.hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(result.inputByteLength).toBe(3);
  });

  it('formats digest bytes as canonical padded Base64', async () => {
    const result = await digestText('abc', 'SHA-256');
    expect(result.base64).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    expect(bytesToBase64(result.digest)).toBe(result.base64);
  });

  it('rejects unsupported algorithm names even when TypeScript is bypassed', async () => {
    await expect(digestBytes(new Uint8Array(), 'SHA-1' as HashAlgorithm)).rejects.toThrow('Unsupported');
  });

  it('rejects text and files that exceed the explicit in-memory limits', async () => {
    await expect(digestText('x'.repeat(MAX_HASH_TEXT_CODE_UNITS + 1), 'SHA-256')).rejects.toThrow(/cannot exceed/);
    const oversized = new Blob([]);
    Object.defineProperty(oversized, 'size', { value: MAX_HASH_FILE_BYTES + 1 });
    await expect(digestBlob(oversized, 'SHA-256')).rejects.toThrow(/64 MiB/);
  });
});

describe('UTF-8 and newline diagnostics', () => {
  it('distinguishes code units, code points, and encoded bytes', () => {
    expect(analyzeTextInput('A🦄é')).toMatchObject({
      isEmpty: false,
      codeUnitCount: 4,
      codePointCount: 3,
      utf8ByteCount: 7,
      newlineStyle: 'none',
      newlineCount: 0,
      lineCount: 1,
    });
  });

  it('describes empty input without treating it as missing', () => {
    expect(analyzeTextInput('')).toEqual({
      isEmpty: true,
      codeUnitCount: 0,
      codePointCount: 0,
      utf8ByteCount: 0,
      newlineStyle: 'none',
      newlineCount: 0,
      lineCount: 0,
      hasTrailingNewline: false,
      hasUtf8BomCharacter: false,
      hasNulCharacter: false,
    });
  });

  it('reports LF, CRLF, CR, mixed, and final-newline state exactly', () => {
    expect(analyzeTextInput('one\ntwo\n')).toMatchObject({ newlineStyle: 'LF', newlineCount: 2, lineCount: 3, hasTrailingNewline: true });
    expect(analyzeTextInput('one\r\ntwo')).toMatchObject({ newlineStyle: 'CRLF', newlineCount: 1, lineCount: 2, hasTrailingNewline: false });
    expect(analyzeTextInput('one\rtwo')).toMatchObject({ newlineStyle: 'CR' });
    expect(analyzeTextInput('one\r\ntwo\n')).toMatchObject({ newlineStyle: 'mixed', newlineCount: 2 });
  });

  it('surfaces a leading BOM character and embedded NUL', () => {
    expect(analyzeTextInput('\ufeffa\u0000')).toMatchObject({
      hasUtf8BomCharacter: true,
      hasNulCharacter: true,
      utf8ByteCount: 5,
    });
  });
});

describe('digest normalization and timing-resistant comparison', () => {
  const SHA_256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('normalizes uppercase, prefixes, spaces, colons, and byte separators', () => {
    const colonHex = SHA_256_ABC.match(/../g)!.join(':').toUpperCase();
    const spacedHex = SHA_256_ABC.match(/../g)!.join(' ');
    expect(normalizeDigest(`SHA256: ${colonHex}`, 'auto', 'SHA-256')).toMatchObject({
      hex: SHA_256_ABC,
      detectedEncoding: 'hex',
      declaredAlgorithm: 'SHA-256',
    });
    expect(normalizeDigest(spacedHex, 'hex', 'SHA-256').hex).toBe(SHA_256_ABC);
    expect(normalizeDigest(SHA_256_ABC.match(/../g)!.join('-'), 'auto', 'SHA-256').hex).toBe(SHA_256_ABC);
  });

  it('accepts padded, unpadded, and URL-safe Base64', () => {
    const standard = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';
    const url = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(normalizeDigest(standard, 'auto', 'SHA-256').hex).toBe(SHA_256_ABC);
    expect(normalizeDigest(url, 'auto', 'SHA-256').hex).toBe(SHA_256_ABC);
  });

  it('uses the selected algorithm to disambiguate hex-only unpadded Base64', () => {
    const md5Base64 = `${'a'.repeat(21)}A`;
    const sha384Base64 = 'a'.repeat(64);
    expect(normalizeDigest(md5Base64, 'auto', 'MD5')).toMatchObject({
      detectedEncoding: 'base64',
      bytes: { byteLength: 16 },
    });
    expect(normalizeDigest(sha384Base64, 'auto', 'SHA-384')).toMatchObject({
      detectedEncoding: 'base64',
      bytes: { byteLength: 48 },
    });
  });

  it('compares different encodings without returning early on string differences', () => {
    const comparison = compareDigests(
      SHA_256_ABC.toUpperCase(),
      'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
      { algorithm: 'SHA-256' },
    );
    expect(comparison.matches).toBe(true);
    expect(comparison.actual.detectedEncoding).toBe('hex');
    expect(comparison.expected.detectedEncoding).toBe('base64');
  });

  it('detects unequal bytes and unequal lengths', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 0))).toBe(false);
    expect(compareDigests(SHA_256_ABC, `${SHA_256_ABC.slice(0, -1)}c`, { algorithm: 'SHA-256' }).matches).toBe(false);
  });

  it('rejects wrong algorithms, digest lengths, and non-canonical Base64', () => {
    expect(() => normalizeDigest(`MD5: ${SHA_256_ABC}`, 'auto', 'SHA-256')).toThrow(HashInputError);
    expect(() => normalizeDigest('deadbeef', 'hex', 'SHA-256')).toThrow(/32 bytes/);
    expect(() => normalizeDigest('Zh==', 'base64')).toThrow(/non-canonical/i);
    expect(() => normalizeDigest('')).toThrow(/Enter a digest/);
    expect(() => normalizeDigest('a'.repeat(MAX_DIGEST_INPUT_CHARS + 1))).toThrow(/cannot exceed/);
    expect(() => compareDigests(
      'MD5: d41d8cd98f00b204e9800998ecf8427e',
      'SHA256: d41d8cd98f00b204e9800998ecf8427e',
    )).toThrow(/different algorithms/);
  });
});
