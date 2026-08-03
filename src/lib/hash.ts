export const HASH_ALGORITHMS = ['SHA-256', 'SHA-384', 'SHA-512', 'MD5'] as const;
export const MAX_HASH_TEXT_CODE_UNITS = 5_000_000;
export const MAX_HASH_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_DIGEST_INPUT_CHARS = 4_096;

export type HashAlgorithm = typeof HASH_ALGORITHMS[number];
export type HashEncoding = 'hex' | 'base64';
export type HashInputEncoding = HashEncoding | 'auto';
export type NewlineStyle = 'none' | 'LF' | 'CRLF' | 'CR' | 'mixed';

export const DIGEST_BYTE_LENGTH: Readonly<Record<HashAlgorithm, number>> = Object.freeze({
  'SHA-256': 32,
  'SHA-384': 48,
  'SHA-512': 64,
  MD5: 16,
});

export interface HashResult {
  algorithm: HashAlgorithm;
  digest: Uint8Array;
  hex: string;
  base64: string;
  inputByteLength: number;
}

export interface TextInputAnalysis {
  isEmpty: boolean;
  codeUnitCount: number;
  codePointCount: number;
  utf8ByteCount: number;
  newlineStyle: NewlineStyle;
  newlineCount: number;
  lineCount: number;
  hasTrailingNewline: boolean;
  hasUtf8BomCharacter: boolean;
  hasNulCharacter: boolean;
}

export interface NormalizedDigest {
  bytes: Uint8Array;
  hex: string;
  base64: string;
  detectedEncoding: HashEncoding;
  declaredAlgorithm: HashAlgorithm | null;
}

export interface DigestComparison {
  matches: boolean;
  actual: NormalizedDigest;
  expected: NormalizedDigest;
}

export interface CompareDigestOptions {
  algorithm?: HashAlgorithm;
  actualEncoding?: HashInputEncoding;
  expectedEncoding?: HashInputEncoding;
}

export type HashInputErrorCode =
  | 'EMPTY_DIGEST'
  | 'INVALID_HEX'
  | 'INVALID_BASE64'
  | 'DIGEST_LENGTH'
  | 'ALGORITHM_MISMATCH';

export class HashInputError extends Error {
  readonly code: HashInputErrorCode;

  constructor(code: HashInputErrorCode, message: string) {
    super(message);
    this.name = 'HashInputError';
    this.code = code;
  }
}

const HEX = '0123456789abcdef';
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;

const MD5_CONSTANTS = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
] as const;

function assertBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Hash input must be a Uint8Array.');
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function writeUint32LittleEndian(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * RFC 1321 MD5, provided for compatibility checksums only. MD5 is not suitable
 * for password storage, signatures, or adversarial integrity verification.
 */
export function md5(bytes: Uint8Array): Uint8Array {
  assertBytes(bytes);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  if (!Number.isSafeInteger(paddedLength)) throw new RangeError('The MD5 input is too large.');

  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;

  let bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    message[paddedLength - 8 + index] = Number(bitLength & 0xffn);
    bitLength >>= 8n;
  }

  let stateA = 0x67452301;
  let stateB = 0xefcdab89;
  let stateC = 0x98badcfe;
  let stateD = 0x10325476;
  const words = new Uint32Array(16);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let word = 0; word < 16; word += 1) {
      const start = offset + word * 4;
      words[word] = (
        message[start]
        | (message[start + 1] << 8)
        | (message[start + 2] << 16)
        | (message[start + 3] << 24)
      ) >>> 0;
    }

    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;

    for (let round = 0; round < 64; round += 1) {
      let mixed: number;
      let wordIndex: number;

      if (round < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = round;
      } else if (round < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * round + 1) % 16;
      } else if (round < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * round + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * round) % 16;
      }

      const previousD = d;
      d = c;
      c = b;
      const sum = (a + mixed + MD5_CONSTANTS[round] + words[wordIndex]) >>> 0;
      b = (b + rotateLeft(sum, MD5_SHIFTS[round])) >>> 0;
      a = previousD;
    }

    stateA = (stateA + a) >>> 0;
    stateB = (stateB + b) >>> 0;
    stateC = (stateC + c) >>> 0;
    stateD = (stateD + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  writeUint32LittleEndian(digest, 0, stateA);
  writeUint32LittleEndian(digest, 4, stateB);
  writeUint32LittleEndian(digest, 8, stateC);
  writeUint32LittleEndian(digest, 12, stateD);
  return digest;
}

export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToHex(bytes: Uint8Array): string {
  assertBytes(bytes);
  let output = '';
  for (const byte of bytes) output += HEX[byte >>> 4] + HEX[byte & 0x0f];
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  assertBytes(bytes);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    output += BASE64[(value >>> 18) & 63];
    output += BASE64[(value >>> 12) & 63];
    output += hasSecond ? BASE64[(value >>> 6) & 63] : '=';
    output += hasThird ? BASE64[value & 63] : '=';
  }
  return output;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
    && bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function digestBytes(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<HashResult> {
  assertBytes(bytes);
  if (!HASH_ALGORITHMS.includes(algorithm)) {
    throw new TypeError(`Unsupported hash algorithm ${JSON.stringify(algorithm)}.`);
  }

  let digest: Uint8Array;
  if (algorithm === 'MD5') {
    digest = md5(bytes);
  } else {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error(`${algorithm} hashing requires the Web Cryptography API.`);
    const buffer = await subtle.digest(algorithm, copyToArrayBuffer(bytes));
    digest = new Uint8Array(buffer);
  }

  return {
    algorithm,
    digest,
    hex: bytesToHex(digest),
    base64: bytesToBase64(digest),
    inputByteLength: bytes.byteLength,
  };
}

export async function digestText(input: string, algorithm: HashAlgorithm): Promise<HashResult> {
  if (input.length > MAX_HASH_TEXT_CODE_UNITS) {
    throw new RangeError(`Text hash input cannot exceed ${MAX_HASH_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`);
  }
  return digestBytes(utf8ToBytes(input), algorithm);
}

export async function digestBlob(blob: Blob, algorithm: HashAlgorithm): Promise<HashResult> {
  if (!(blob instanceof Blob)) throw new TypeError('File hash input must be a Blob or File.');
  if (blob.size > MAX_HASH_FILE_BYTES) {
    throw new RangeError('Choose a file no larger than 64 MiB. The browser digest APIs buffer the complete input in memory.');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return digestBytes(bytes, algorithm);
}

export function analyzeTextInput(input: string): TextInputAnalysis {
  let lfCount = 0;
  let crlfCount = 0;
  let crCount = 0;
  let codePointCount = 0;
  let utf8ByteCount = 0;

  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '\r') {
      if (input[index + 1] === '\n') {
        crlfCount += 1;
        index += 1;
      } else {
        crCount += 1;
      }
    } else if (input[index] === '\n') {
      lfCount += 1;
    }
  }

  const kinds = Number(lfCount > 0) + Number(crlfCount > 0) + Number(crCount > 0);
  const newlineStyle: NewlineStyle = kinds === 0 ? 'none'
    : kinds > 1 ? 'mixed'
      : crlfCount > 0 ? 'CRLF'
        : crCount > 0 ? 'CR'
          : 'LF';
  const newlineCount = lfCount + crlfCount + crCount;

  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    codePointCount += 1;
    if (codeUnit <= 0x7f) {
      utf8ByteCount += 1;
    } else if (codeUnit <= 0x7ff) {
      utf8ByteCount += 2;
    } else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < input.length
      && input.charCodeAt(index + 1) >= 0xdc00
      && input.charCodeAt(index + 1) <= 0xdfff
    ) {
      utf8ByteCount += 4;
      index += 1;
    } else {
      // BMP code points and unpaired surrogates both become three UTF-8 bytes;
      // TextEncoder replaces an unpaired surrogate with U+FFFD.
      utf8ByteCount += 3;
    }
  }

  return {
    isEmpty: input.length === 0,
    codeUnitCount: input.length,
    codePointCount,
    utf8ByteCount,
    newlineStyle,
    newlineCount,
    lineCount: input.length === 0 ? 0 : newlineCount + 1,
    hasTrailingNewline: /(?:\r\n|\r|\n)$/.test(input),
    hasUtf8BomCharacter: input.charCodeAt(0) === 0xfeff,
    hasNulCharacter: input.includes('\u0000'),
  };
}

function hexValue(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function decodeHex(value: string): Uint8Array {
  const compact = value.replace(/^0x/i, '').replace(/[\t\n\f\r :]/g, '').replace(/-/g, '');
  if (!compact || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) {
    throw new HashInputError('INVALID_HEX', 'Hex digests need an even number of hexadecimal characters.');
  }

  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < compact.length; index += 2) {
    bytes[index / 2] = (hexValue(compact[index]) << 4) | hexValue(compact[index + 1]);
  }
  return bytes;
}

function base64Value(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (character === '+') return 62;
  if (character === '/') return 63;
  return -1;
}

function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/[\t\n\f\r ]/g, '');
  if (!compact || /[^A-Za-z0-9+/_=-]/.test(compact)) {
    throw new HashInputError('INVALID_BASE64', 'Enter a standard or URL-safe Base64 digest.');
  }
  if ((compact.includes('+') || compact.includes('/')) && (compact.includes('-') || compact.includes('_'))) {
    throw new HashInputError('INVALID_BASE64', 'Do not mix standard and URL-safe Base64 alphabets.');
  }

  const standard = compact.replace(/-/g, '+').replace(/_/g, '/');
  const firstPadding = standard.indexOf('=');
  const unpadded = firstPadding === -1 ? standard : standard.slice(0, firstPadding);
  const suppliedPadding = firstPadding === -1 ? '' : standard.slice(firstPadding);
  if ((suppliedPadding && !/^={1,2}$/.test(suppliedPadding)) || (suppliedPadding && standard.length % 4 !== 0)) {
    throw new HashInputError('INVALID_BASE64', 'Base64 padding must contain one or two trailing = characters.');
  }
  if (unpadded.length % 4 === 1) {
    throw new HashInputError('INVALID_BASE64', 'The Base64 digest has an impossible length.');
  }

  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
  const outputLength = (padded.length / 4) * 3 - (padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(outputLength);
  let outputOffset = 0;

  for (let offset = 0; offset < padded.length; offset += 4) {
    const secondPadding = padded[offset + 2] === '=';
    const thirdPadding = padded[offset + 3] === '=';
    const a = base64Value(padded[offset]);
    const b = base64Value(padded[offset + 1]);
    const c = secondPadding ? 0 : base64Value(padded[offset + 2]);
    const d = thirdPadding ? 0 : base64Value(padded[offset + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0 || (secondPadding && !thirdPadding)) {
      throw new HashInputError('INVALID_BASE64', 'The Base64 digest contains invalid padding or characters.');
    }
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputOffset < outputLength) bytes[outputOffset] = (combined >>> 16) & 0xff;
    if (outputOffset + 1 < outputLength) bytes[outputOffset + 1] = (combined >>> 8) & 0xff;
    if (outputOffset + 2 < outputLength) bytes[outputOffset + 2] = combined & 0xff;
    outputOffset += 3;
  }

  if (bytesToBase64(bytes).replace(/=+$/, '') !== unpadded) {
    throw new HashInputError('INVALID_BASE64', 'The Base64 digest uses non-canonical unused bits.');
  }
  return bytes;
}

function parseDeclaredAlgorithm(value: string): { value: string; algorithm: HashAlgorithm | null } {
  const match = value.match(/^\s*(sha-?256|sha-?384|sha-?512|md5)\s*(?::|=)\s*([\s\S]*)$/i);
  if (!match) return { value: value.trim(), algorithm: null };
  const compact = match[1].replace('-', '').toUpperCase();
  const algorithm: HashAlgorithm = compact === 'SHA256' ? 'SHA-256'
    : compact === 'SHA384' ? 'SHA-384'
      : compact === 'SHA512' ? 'SHA-512'
        : 'MD5';
  return { value: match[2].trim(), algorithm };
}

function looksLikeHex(value: string): boolean {
  const withoutPrefix = value.replace(/^0x/i, '');
  if (/^(?:[0-9a-f]{2}[:-])+(?:[0-9a-f]{2})$/i.test(withoutPrefix)) return true;
  return /^[0-9a-f\s:]+$/i.test(withoutPrefix)
    && withoutPrefix.replace(/[\s:]/g, '').length % 2 === 0;
}

function detectDigestEncoding(value: string, algorithm?: HashAlgorithm): HashEncoding {
  if (!looksLikeHex(value)) return 'base64';
  if (!algorithm) return 'hex';

  const hexBytes = decodeHex(value);
  if (hexBytes.length === DIGEST_BYTE_LENGTH[algorithm]) return 'hex';

  // A valid unpadded Base64 digest can consist entirely of hexadecimal
  // characters. Prefer it only when it has the selected algorithm's exact
  // byte length; otherwise retain the clearer wrong-length hex diagnostic.
  try {
    if (decodeBase64(value).length === DIGEST_BYTE_LENGTH[algorithm]) return 'base64';
  } catch {
    // The value remains a syntactically valid hex digest.
  }
  return 'hex';
}

export function normalizeDigest(
  input: string,
  encoding: HashInputEncoding = 'auto',
  algorithm?: HashAlgorithm,
): NormalizedDigest {
  if (typeof input !== 'string') throw new TypeError('Digest input must be a string.');
  if (input.length > MAX_DIGEST_INPUT_CHARS) {
    throw new HashInputError(
      'DIGEST_LENGTH',
      `Digest input cannot exceed ${MAX_DIGEST_INPUT_CHARS.toLocaleString('en-US')} characters.`,
    );
  }
  const declared = parseDeclaredAlgorithm(input);
  if (!declared.value) throw new HashInputError('EMPTY_DIGEST', 'Enter a digest to compare.');
  if (algorithm && declared.algorithm && declared.algorithm !== algorithm) {
    throw new HashInputError(
      'ALGORITHM_MISMATCH',
      `The pasted ${declared.algorithm} label does not match the selected ${algorithm} algorithm.`,
    );
  }

  const effectiveAlgorithm = algorithm ?? declared.algorithm ?? undefined;

  const detectedEncoding: HashEncoding = encoding === 'auto'
    ? detectDigestEncoding(declared.value, effectiveAlgorithm)
    : encoding;
  const bytes = detectedEncoding === 'hex' ? decodeHex(declared.value) : decodeBase64(declared.value);
  if (effectiveAlgorithm && bytes.length !== DIGEST_BYTE_LENGTH[effectiveAlgorithm]) {
    throw new HashInputError(
      'DIGEST_LENGTH',
      `${effectiveAlgorithm} digests contain ${DIGEST_BYTE_LENGTH[effectiveAlgorithm]} bytes; this value contains ${bytes.length}.`,
    );
  }

  return {
    bytes,
    hex: bytesToHex(bytes),
    base64: bytesToBase64(bytes),
    detectedEncoding,
    declaredAlgorithm: declared.algorithm,
  };
}

/**
 * Compares every byte without an early exit. JavaScript engines do not promise
 * strict constant-time execution, so this is timing-resistant normalization for
 * a browser UI, not a replacement for a server-side cryptographic verifier.
 */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  assertBytes(left);
  assertBytes(right);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function compareDigests(
  actualInput: string,
  expectedInput: string,
  options: CompareDigestOptions = {},
): DigestComparison {
  const actualDeclaredAlgorithm = parseDeclaredAlgorithm(actualInput).algorithm;
  const expectedDeclaredAlgorithm = parseDeclaredAlgorithm(expectedInput).algorithm;
  if (
    actualDeclaredAlgorithm
    && expectedDeclaredAlgorithm
    && actualDeclaredAlgorithm !== expectedDeclaredAlgorithm
  ) {
    throw new HashInputError(
      'ALGORITHM_MISMATCH',
      `The pasted ${actualDeclaredAlgorithm} and ${expectedDeclaredAlgorithm} labels name different algorithms.`,
    );
  }
  const actual = normalizeDigest(actualInput, options.actualEncoding ?? 'auto', options.algorithm);
  const expected = normalizeDigest(expectedInput, options.expectedEncoding ?? 'auto', options.algorithm);
  return {
    matches: constantTimeEqual(actual.bytes, expected.bytes),
    actual,
    expected,
  };
}
