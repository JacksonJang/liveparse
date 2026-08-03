const UUID_BYTE_LENGTH = 16;
const UUID_HEX_LENGTH = 32;
const UUID_TEXT_LENGTH = 36;
const UUID_V7_TIMESTAMP_MAX = 0xffffffffffff;
const UUID_V7_BATCH_COUNTER_MAX = 0x3fff;
const UUID_GREGORIAN_TO_UNIX_100NS = 0x01b21dd213814000n;
const HUNDRED_NANOSECONDS_PER_MILLISECOND = 10_000n;
const DATE_MAX_MILLISECONDS = 8_640_000_000_000_000;
const UINT16_RANGE = 0x1_0000;
const MAX_COUNTER_SEED_ATTEMPTS = 128;
const HEX = '0123456789abcdef';
const STANDARD_UUID_TEXT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UuidFormat = 'hyphenated' | 'compact' | 'braced' | 'urn';
export type UuidCase = 'lower' | 'upper';
export type UuidVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null;
export type UuidVariant = 'ncs' | 'rfc9562' | 'microsoft' | 'future';
export type UuidParseErrorCode =
  | 'EMPTY_INPUT'
  | 'WHITESPACE_NOT_ALLOWED'
  | 'INVALID_LENGTH'
  | 'INVALID_WRAPPER'
  | 'INVALID_HYPHEN'
  | 'INVALID_HEX';

export interface ParsedUuid {
  bytes: Uint8Array;
  canonical: string;
  version: UuidVersion;
  variant: UuidVariant;
  variantBits: string;
  isNil: boolean;
  isMax: boolean;
  timestampMs: number | null;
  timestampIso: string | null;
  timestampPrecision: '100ns' | 'millisecond' | null;
  gregorianTimestamp100ns: bigint | null;
  clockSequence: number | null;
  node: string | null;
}

export type RandomBytes = (length: number) => Uint8Array;

export interface GenerateUuidV7Options {
  now?: () => number;
  randomBytes?: RandomBytes;
}

export interface GenerateUuidBatchOptions extends GenerateUuidV7Options {
  version: 4 | 7;
  count: number;
  format?: UuidFormat;
  case?: UuidCase;
}

export interface UuidV4CollisionEstimate {
  probability: number;
  expectedPairs: number;
}

export class UuidParseError extends Error {
  readonly code: UuidParseErrorCode;
  readonly offset: number | null;

  constructor(code: UuidParseErrorCode, message: string, offset: number | null = null) {
    super(message);
    this.name = 'UuidParseError';
    this.code = code;
    this.offset = offset;
  }
}

function isAsciiWhitespace(character: string): boolean {
  const code = character.charCodeAt(0);
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

function hexValue(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) throw new RangeError('Random byte length must be a non-negative integer.');
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.getRandomValues) {
    throw new Error('Secure UUID generation requires the Web Cryptography API.');
  }
  const bytes = new Uint8Array(length);
  cryptoObject.getRandomValues(bytes);
  return bytes;
}

function randomBytesFrom(source: RandomBytes | undefined): Uint8Array {
  const generated = (source ?? secureRandomBytes)(UUID_BYTE_LENGTH);
  if (!(generated instanceof Uint8Array) || generated.length !== UUID_BYTE_LENGTH) {
    throw new TypeError('The UUID random source must return exactly 16 bytes.');
  }
  return new Uint8Array(generated);
}

function writeTimestamp(bytes: Uint8Array, timestampMs: number): void {
  let remaining = timestampMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
}

function readTimestamp(bytes: Uint8Array): number {
  let value = 0;
  for (let index = 0; index < 6; index += 1) value = value * 256 + bytes[index];
  return value;
}

function readUnsignedBigInt(bytes: Uint8Array, start: number, end: number): bigint {
  let value = 0n;
  for (let index = start; index < end; index += 1) value = (value << 8n) | BigInt(bytes[index]);
  return value;
}

function floorDivide(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function isoFromMilliseconds(milliseconds: number): string | null {
  if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > DATE_MAX_MILLISECONDS) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readGregorianTimestamp100ns(bytes: Uint8Array, version: 1 | 6): bigint {
  if (version === 1) {
    const timeLow = readUnsignedBigInt(bytes, 0, 4);
    const timeMid = readUnsignedBigInt(bytes, 4, 6);
    const timeHigh = (BigInt(bytes[6] & 0x0f) << 8n) | BigInt(bytes[7]);
    return (timeHigh << 48n) | (timeMid << 32n) | timeLow;
  }

  const timeHighAndMid = readUnsignedBigInt(bytes, 0, 6);
  const timeLow = (BigInt(bytes[6] & 0x0f) << 8n) | BigInt(bytes[7]);
  return (timeHighAndMid << 12n) | timeLow;
}

function nodeText(bytes: Uint8Array): string {
  return Array.from(bytes.slice(10), (byte) => byte.toString(16).padStart(2, '0')).join(':');
}

function timestampFrom(now: (() => number) | undefined): number {
  const value = (now ?? Date.now)();
  if (!Number.isSafeInteger(value) || value < 0 || value > UUID_V7_TIMESTAMP_MAX) {
    throw new RangeError(`UUID v7 time must be a whole Unix millisecond from 0 through ${UUID_V7_TIMESTAMP_MAX}.`);
  }
  return value;
}

function variantFrom(byte: number): { variant: UuidVariant; variantBits: string } {
  if ((byte & 0x80) === 0) return { variant: 'ncs', variantBits: '0' };
  if ((byte & 0xc0) === 0x80) return { variant: 'rfc9562', variantBits: '10' };
  if ((byte & 0xe0) === 0xc0) return { variant: 'microsoft', variantBits: '110' };
  return { variant: 'future', variantBits: '111' };
}

function versionFrom(bytes: Uint8Array, variant: UuidVariant, isSpecial: boolean): UuidVersion {
  if (variant !== 'rfc9562' || isSpecial) return null;
  const version = bytes[6] >>> 4;
  return version >= 1 && version <= 8 ? version as Exclude<UuidVersion, null> : null;
}

function compactHex(bytes: Uint8Array, letterCase: UuidCase): string {
  let output = '';
  for (const byte of bytes) output += HEX[byte >>> 4] + HEX[byte & 0x0f];
  return letterCase === 'upper' ? output.toUpperCase() : output;
}

export function formatUuid(
  bytes: Uint8Array,
  format: UuidFormat = 'hyphenated',
  letterCase: UuidCase = 'lower',
): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== UUID_BYTE_LENGTH) {
    throw new TypeError('A UUID must contain exactly 16 bytes.');
  }
  if (!['hyphenated', 'compact', 'braced', 'urn'].includes(format)) {
    throw new TypeError(`Unsupported UUID format ${JSON.stringify(format)}.`);
  }
  if (letterCase !== 'lower' && letterCase !== 'upper') {
    throw new TypeError(`Unsupported UUID letter case ${JSON.stringify(letterCase)}.`);
  }

  const compact = compactHex(bytes, letterCase);
  if (format === 'compact') return compact;
  const hyphenated = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  if (format === 'braced') return `{${hyphenated}}`;
  if (format === 'urn') return `urn:uuid:${hyphenated}`;
  return hyphenated;
}

interface UnwrappedUuid {
  core: string;
  coreOffset: number;
  compact: boolean;
}

function unwrapUuid(input: string): UnwrappedUuid {
  if (input.length === 0) throw new UuidParseError('EMPTY_INPUT', 'Enter a UUID value.', 0);
  for (let offset = 0; offset < input.length; offset += 1) {
    if (isAsciiWhitespace(input[offset])) {
      throw new UuidParseError('WHITESPACE_NOT_ALLOWED', `Whitespace is not allowed at offset ${offset}.`, offset);
    }
  }

  if (input.slice(0, 9).toLowerCase() === 'urn:uuid:') {
    const core = input.slice(9);
    if (core.length !== UUID_TEXT_LENGTH) {
      throw new UuidParseError(
        'INVALID_LENGTH',
        `A UUID URN must contain a ${UUID_TEXT_LENGTH}-character hyphenated UUID.`,
        9 + Math.min(core.length, UUID_TEXT_LENGTH),
      );
    }
    return { core, coreOffset: 9, compact: false };
  }

  const beginsBrace = input.startsWith('{');
  const endsBrace = input.endsWith('}');
  if (beginsBrace || endsBrace) {
    if (!beginsBrace || !endsBrace) {
      if (beginsBrace) {
        const closingOffset = input.indexOf('}', 1);
        const coreLength = closingOffset < 0 ? input.length - 1 : closingOffset - 1;
        const offset = coreLength === UUID_TEXT_LENGTH && closingOffset >= 0
          ? closingOffset + 1
          : 1 + Math.min(coreLength, UUID_TEXT_LENGTH);
        throw new UuidParseError(
          'INVALID_WRAPPER',
          closingOffset >= 0
            ? 'A closing brace must end the braced UUID with no trailing data.'
            : 'A braced UUID is missing its closing brace.',
          offset,
        );
      }

      const withoutClosingBrace = input.slice(0, -1);
      const offset = STANDARD_UUID_TEXT_PATTERN.test(withoutClosingBrace) ? input.length - 1 : 0;
      throw new UuidParseError(
        'INVALID_WRAPPER',
        offset === 0 ? 'A braced UUID is missing its opening brace.' : 'An unwrapped UUID must not have a trailing closing brace.',
        offset,
      );
    }
    const core = input.slice(1, -1);
    if (core.length !== UUID_TEXT_LENGTH) {
      throw new UuidParseError(
        'INVALID_LENGTH',
        `Braces must contain a ${UUID_TEXT_LENGTH}-character hyphenated UUID.`,
        1 + Math.min(core.length, UUID_TEXT_LENGTH),
      );
    }
    return { core, coreOffset: 1, compact: false };
  }

  if (input.length === UUID_HEX_LENGTH) return { core: input, coreOffset: 0, compact: true };
  if (input.length === UUID_TEXT_LENGTH) return { core: input, coreOffset: 0, compact: false };
  const expectedLength = input.includes('-') ? UUID_TEXT_LENGTH : UUID_HEX_LENGTH;
  throw new UuidParseError(
    'INVALID_LENGTH',
    `A UUID must contain ${UUID_HEX_LENGTH} hexadecimal digits, normally in a ${UUID_TEXT_LENGTH}-character hyphenated form.`,
    Math.min(input.length, expectedLength),
  );
}

function parseCore({ core, coreOffset, compact }: UnwrappedUuid): Uint8Array {
  let hex = '';
  const hyphenPositions = new Set([8, 13, 18, 23]);

  for (let index = 0; index < core.length; index += 1) {
    const character = core[index];
    if (!compact && hyphenPositions.has(index)) {
      if (character !== '-') {
        throw new UuidParseError('INVALID_HYPHEN', `Expected a hyphen at offset ${coreOffset + index}.`, coreOffset + index);
      }
      continue;
    }
    if (!compact && character === '-') {
      throw new UuidParseError('INVALID_HYPHEN', `Unexpected hyphen at offset ${coreOffset + index}.`, coreOffset + index);
    }
    if (hexValue(character) < 0) {
      throw new UuidParseError('INVALID_HEX', `Invalid hexadecimal character ${JSON.stringify(character)} at offset ${coreOffset + index}.`, coreOffset + index);
    }
    hex += character;
  }

  if (hex.length !== UUID_HEX_LENGTH) {
    throw new UuidParseError('INVALID_LENGTH', `A UUID must contain exactly ${UUID_HEX_LENGTH} hexadecimal digits.`, coreOffset + core.length);
  }

  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  for (let index = 0; index < UUID_BYTE_LENGTH; index += 1) {
    bytes[index] = (hexValue(hex[index * 2]) << 4) | hexValue(hex[index * 2 + 1]);
  }
  return bytes;
}

export function parseUuid(input: string): ParsedUuid {
  if (typeof input !== 'string') throw new TypeError('UUID input must be a string.');
  const bytes = parseCore(unwrapUuid(input));
  const isNil = bytes.every((byte) => byte === 0);
  const isMax = bytes.every((byte) => byte === 0xff);
  const { variant, variantBits } = variantFrom(bytes[8]);
  const version = versionFrom(bytes, variant, isNil || isMax);
  let timestampMs: number | null = null;
  let timestampIso: string | null = null;
  let timestampPrecision: ParsedUuid['timestampPrecision'] = null;
  let gregorianTimestamp100ns: bigint | null = null;
  let clockSequence: number | null = null;
  let node: string | null = null;

  if (version === 7) {
    timestampMs = readTimestamp(bytes);
    timestampIso = isoFromMilliseconds(timestampMs);
    timestampPrecision = 'millisecond';
  } else if (version === 1 || version === 6) {
    gregorianTimestamp100ns = readGregorianTimestamp100ns(bytes, version);
    const unixTimestamp100ns = gregorianTimestamp100ns - UUID_GREGORIAN_TO_UNIX_100NS;
    const unixMilliseconds = floorDivide(unixTimestamp100ns, HUNDRED_NANOSECONDS_PER_MILLISECOND);
    const numericMilliseconds = Number(unixMilliseconds);
    if (Number.isSafeInteger(numericMilliseconds)) {
      timestampMs = numericMilliseconds;
      timestampIso = isoFromMilliseconds(numericMilliseconds);
    }
    timestampPrecision = '100ns';
    clockSequence = ((bytes[8] & 0x3f) << 8) | bytes[9];
    node = nodeText(bytes);
  }

  return {
    bytes,
    canonical: formatUuid(bytes),
    version,
    variant,
    variantBits,
    isNil,
    isMax,
    timestampMs,
    timestampIso,
    timestampPrecision,
    gregorianTimestamp100ns,
    clockSequence,
    node,
  };
}

export function estimateUuidV4Collision(count: number): UuidV4CollisionEstimate {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1 || count > 1e30) {
    throw new RangeError('UUID v4 collision count must be a whole number from 1 through 1e30.');
  }
  const expectedPairs = count * (count - 1) / (2 * 2 ** 122);
  const probability = expectedPairs > 50 ? 1 : -Math.expm1(-expectedPairs);
  return { probability, expectedPairs };
}

export function generateUuidV4(randomBytes?: RandomBytes): string {
  const bytes = randomBytesFrom(randomBytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function generateUuidV7(options: GenerateUuidV7Options = {}): string {
  const bytes = randomBytesFrom(options.randomBytes);
  writeTimestamp(bytes, timestampFrom(options.now));
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function batchCounterSeed(bytes: Uint8Array, remainingCount: number, randomBytes: RandomBytes | undefined): number {
  const largestSeed = UUID_V7_BATCH_COUNTER_MAX - (remainingCount - 1);
  const bound = largestSeed + 1;
  const rejectionLimit = Math.floor(UINT16_RANGE / bound) * bound;
  // These bytes are replaced by the timestamp, so the counter seed does not
  // reduce or correlate with the 60 random payload bits that remain in output.
  let seedBytes = bytes;
  for (let attempt = 0; attempt < MAX_COUNTER_SEED_ATTEMPTS; attempt += 1) {
    const randomWord = (seedBytes[0] << 8) | seedBytes[1];
    if (randomWord < rejectionLimit) return randomWord % bound;
    seedBytes = randomBytesFrom(randomBytes);
  }
  throw new Error('The UUID random source could not produce an unbiased v7 batch counter seed.');
}

function writeBatchCounter(bytes: Uint8Array, counter: number): void {
  const highTwelve = counter >>> 2;
  bytes[6] = 0x70 | ((highTwelve >>> 8) & 0x0f);
  bytes[7] = highTwelve & 0xff;
  bytes[8] = 0x80 | ((counter & 0x03) << 4) | (bytes[8] & 0x0f);
}

export function generateUuidBatch(options: GenerateUuidBatchOptions): string[] {
  const { version, count, format = 'hyphenated', case: letterCase = 'lower' } = options;
  if (version !== 4 && version !== 7) throw new RangeError('UUID batch version must be 4 or 7.');
  if (!Number.isInteger(count) || count < 1 || count > 10_000) {
    throw new RangeError('UUID batch count must be a whole number from 1 through 10000.');
  }

  if (version === 4) {
    return Array.from({ length: count }, () => {
      const bytes = parseUuid(generateUuidV4(options.randomBytes)).bytes;
      return formatUuid(bytes, format, letterCase);
    });
  }

  const output: string[] = [];
  let effectiveTimestamp: number | null = null;
  let counter = 0;

  for (let index = 0; index < count; index += 1) {
    const observedTimestamp = timestampFrom(options.now);
    const bytes = randomBytesFrom(options.randomBytes);
    if (effectiveTimestamp === null || observedTimestamp > effectiveTimestamp) {
      effectiveTimestamp = observedTimestamp;
      counter = batchCounterSeed(bytes, count - index, options.randomBytes);
    } else {
      counter += 1;
      if (counter > UUID_V7_BATCH_COUNTER_MAX) {
        throw new Error('UUID v7 batch counter capacity was exceeded within one effective millisecond.');
      }
    }

    writeTimestamp(bytes, effectiveTimestamp);
    writeBatchCounter(bytes, counter);
    output.push(formatUuid(bytes, format, letterCase));
  }
  return output;
}
