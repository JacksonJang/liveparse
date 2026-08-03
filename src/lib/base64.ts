const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MIME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BASE64_OUTPUT_CHUNK_SIZE = 32_768;
const HEX_BYTES_PER_CHUNK = 8_192;
const MAX_DATA_URL_METADATA_LENGTH = 8_192;
const ASCII_DECODER = new TextDecoder('ascii');

export type Base64Alphabet = 'standard' | 'url';
export type Base64InputAlphabet = Base64Alphabet | 'auto';
export type Base64WhitespaceMode = 'reject' | 'ignore';
export type Base64PaddingMode = 'require' | 'allow-missing' | 'forbid';

export interface EncodeBase64Options {
  alphabet?: Base64Alphabet;
  padding?: boolean;
}

export interface DecodeBase64Options {
  alphabet?: Base64InputAlphabet;
  whitespace?: Base64WhitespaceMode;
  padding?: Base64PaddingMode;
}

export interface Base64Diagnostics {
  alphabet: Base64Alphabet;
  alphabetWasAmbiguous: boolean;
  hadWhitespace: boolean;
  ignoredWhitespaceCount: number;
  padding: 'present' | 'missing' | 'not-needed';
  addedPadding: number;
  canonical: true;
}

export interface DecodedBase64 {
  bytes: Uint8Array;
  normalized: string;
  diagnostics: Base64Diagnostics;
}

export type Base64DecodeErrorCode =
  | 'INVALID_CHARACTER'
  | 'WHITESPACE_NOT_ALLOWED'
  | 'MIXED_ALPHABET'
  | 'INVALID_LENGTH'
  | 'INVALID_PADDING'
  | 'PADDING_POSITION'
  | 'PADDING_COUNT'
  | 'PADDING_REQUIRED'
  | 'PADDING_FORBIDDEN'
  | 'NON_CANONICAL_PAD_BITS';

export class Base64DecodeError extends Error {
  readonly code: Base64DecodeErrorCode;
  readonly offset: number | null;
  readonly character: string | null;

  constructor(
    code: Base64DecodeErrorCode,
    message: string,
    offset: number | null = null,
    character: string | null = null,
  ) {
    super(message);
    this.name = 'Base64DecodeError';
    this.code = code;
    this.offset = offset;
    this.character = character;
  }
}

export interface Utf8DecodeOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

export interface ConvertBase64AlphabetOptions {
  padding?: boolean;
  whitespace?: Base64WhitespaceMode;
}

export type DataUrlParseErrorCode =
  | 'INVALID_SCHEME'
  | 'MISSING_COMMA'
  | 'INVALID_MEDIA_TYPE'
  | 'INVALID_PARAMETER'
  | 'DUPLICATE_PARAMETER'
  | 'DUPLICATE_BASE64_FLAG'
  | 'BASE64_FLAG_POSITION'
  | 'METADATA_TOO_LONG'
  | 'INVALID_PERCENT_ENCODING';

export class DataUrlParseError extends Error {
  readonly code: DataUrlParseErrorCode;
  readonly offset: number | null;

  constructor(code: DataUrlParseErrorCode, message: string, offset: number | null = null) {
    super(message);
    this.name = 'DataUrlParseError';
    this.code = code;
    this.offset = offset;
  }
}

export interface ParseDataUrlOptions {
  whitespace?: Base64WhitespaceMode;
  padding?: Base64PaddingMode;
}

export interface ParsedDataUrl {
  mediaType: string;
  parameters: Readonly<Record<string, string>>;
  isBase64: boolean;
  bytes: Uint8Array;
  payloadOffset: number;
  base64Diagnostics: Base64Diagnostics | null;
}

export interface BytesToHexOptions {
  limit?: number;
  separator?: string;
  uppercase?: boolean;
}

export type SafeRasterMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

function alphabetFor(kind: Base64Alphabet): string {
  return kind === 'url' ? URL_ALPHABET : STANDARD_ALPHABET;
}

function base64Value(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (character === '+' || character === '-') return 62;
  if (character === '/' || character === '_') return 63;
  return -1;
}

function isCommonAlphabetCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57);
}

function isAsciiWhitespace(character: string): boolean {
  const code = character.charCodeAt(0);
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

export function encodeBase64(bytes: Uint8Array, options: EncodeBase64Options = {}): string {
  const alphabetKind = options.alphabet ?? 'standard';
  const includePadding = options.padding ?? alphabetKind === 'standard';
  const alphabet = alphabetFor(alphabetKind);
  const chunks: string[] = [];
  const outputBuffer = new Uint8Array(BASE64_OUTPUT_CHUNK_SIZE);
  let outputLength = 0;

  const flush = () => {
    if (outputLength === 0) return;
    chunks.push(ASCII_DECODER.decode(outputBuffer.subarray(0, outputLength)));
    outputLength = 0;
  };

  for (let index = 0; index < bytes.length; index += 3) {
    if (outputLength > outputBuffer.length - 4) flush();
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;

    outputBuffer[outputLength] = alphabet.charCodeAt((value >>> 18) & 63);
    outputBuffer[outputLength + 1] = alphabet.charCodeAt((value >>> 12) & 63);
    outputLength += 2;
    if (hasSecond) {
      outputBuffer[outputLength] = alphabet.charCodeAt((value >>> 6) & 63);
      outputLength += 1;
    } else if (includePadding) {
      outputBuffer[outputLength] = 0x3d;
      outputLength += 1;
    }
    if (hasThird) {
      outputBuffer[outputLength] = alphabet.charCodeAt(value & 63);
      outputLength += 1;
    } else if (includePadding) {
      outputBuffer[outputLength] = 0x3d;
      outputLength += 1;
    }
  }

  flush();
  return chunks.join('');
}

export function decodeBase64(input: string, options: DecodeBase64Options = {}): DecodedBase64 {
  const requestedAlphabet = options.alphabet ?? 'auto';
  const whitespaceMode = options.whitespace ?? 'reject';
  const paddingMode = options.padding ?? 'allow-missing';
  let ignoredWhitespaceCount = 0;
  let sawStandardOnlyCharacter = false;
  let sawUrlOnlyCharacter = false;
  let significantLength = 0;
  let firstPaddingIndex = -1;
  let firstPaddingOffset: number | null = null;
  let thirdPaddingOffset: number | null = null;
  let dataAfterPaddingOffset: number | null = null;
  let dataAfterPaddingCharacter: string | null = null;
  let lastDataOffset: number | null = null;
  let lastDataCharacter: string | null = null;
  let lastDataValue = -1;

  for (let offset = 0; offset < input.length; offset += 1) {
    const character = input[offset];
    if (isAsciiWhitespace(character)) {
      if (whitespaceMode === 'reject') {
        throw new Base64DecodeError(
          'WHITESPACE_NOT_ALLOWED',
          `Whitespace is not allowed in strict Base64 input at offset ${offset}.`,
          offset,
          character,
        );
      }
      ignoredWhitespaceCount += 1;
      continue;
    }

    if (character === '=') {
      if (firstPaddingIndex === -1) {
        firstPaddingIndex = significantLength;
        firstPaddingOffset = offset;
      }
      if (significantLength === firstPaddingIndex + 2) thirdPaddingOffset = offset;
      significantLength += 1;
      continue;
    }

    if (!isCommonAlphabetCharacter(character)) {
      const isStandardOnly = character === '+' || character === '/';
      const isUrlOnly = character === '-' || character === '_';
      if (!isStandardOnly && !isUrlOnly) {
        throw new Base64DecodeError(
          'INVALID_CHARACTER',
          `Invalid Base64 character ${JSON.stringify(character)} at offset ${offset}.`,
          offset,
          character,
        );
      }

      if ((requestedAlphabet === 'standard' && isUrlOnly)
          || (requestedAlphabet === 'url' && isStandardOnly)) {
        throw new Base64DecodeError(
          'INVALID_CHARACTER',
          `Character ${JSON.stringify(character)} does not belong to the ${requestedAlphabet} Base64 alphabet at offset ${offset}.`,
          offset,
          character,
        );
      }

      if ((isStandardOnly && sawUrlOnlyCharacter) || (isUrlOnly && sawStandardOnlyCharacter)) {
        throw new Base64DecodeError(
          'MIXED_ALPHABET',
          `Standard and URL-safe Base64 alphabet characters are mixed at offset ${offset}.`,
          offset,
          character,
        );
      }

      sawStandardOnlyCharacter ||= isStandardOnly;
      sawUrlOnlyCharacter ||= isUrlOnly;
    }

    if (firstPaddingIndex === -1) {
      lastDataOffset = offset;
      lastDataCharacter = character;
      lastDataValue = base64Value(character);
    } else if (dataAfterPaddingOffset === null) {
      dataAfterPaddingOffset = offset;
      dataAfterPaddingCharacter = character;
    }
    significantLength += 1;
  }

  const dataLength = firstPaddingIndex === -1 ? significantLength : firstPaddingIndex;
  const paddingCount = firstPaddingIndex === -1 ? 0 : significantLength - firstPaddingIndex;

  if (firstPaddingIndex !== -1) {
    if (dataAfterPaddingOffset !== null) {
      throw new Base64DecodeError(
        'PADDING_POSITION',
        `Base64 padding must appear only at the end of the input (offset ${dataAfterPaddingOffset}).`,
        dataAfterPaddingOffset,
        dataAfterPaddingCharacter,
      );
    }
    if (paddingCount > 2) {
      const offset = thirdPaddingOffset ?? firstPaddingOffset;
      throw new Base64DecodeError(
        'PADDING_COUNT',
        `Base64 permits at most two padding characters; the excess padding starts at offset ${offset}.`,
        offset,
        '=',
      );
    }
    if (paddingMode === 'forbid') {
      throw new Base64DecodeError(
        'PADDING_FORBIDDEN',
        `Padding is forbidden for this Base64 input (offset ${firstPaddingOffset}).`,
        firstPaddingOffset,
        '=',
      );
    }
  }

  const remainder = dataLength % 4;
  if (remainder === 1) {
    const offset = dataLength === 0 ? 0 : lastDataOffset;
    throw new Base64DecodeError(
      'INVALID_LENGTH',
      'A Base64 value cannot contain exactly one data character in its final four-character quantum.',
      offset,
      dataLength === 0 ? null : lastDataCharacter,
    );
  }

  const requiredPadding = remainder === 2 ? 2 : remainder === 3 ? 1 : 0;
  if (paddingCount > 0) {
    if (significantLength % 4 !== 0 || paddingCount !== requiredPadding) {
      throw new Base64DecodeError(
        'INVALID_PADDING',
        `Base64 padding at offset ${firstPaddingOffset} does not match the final data quantum.`,
        firstPaddingOffset,
        '=',
      );
    }
  } else if (requiredPadding > 0 && paddingMode === 'require') {
    throw new Base64DecodeError(
      'PADDING_REQUIRED',
      `This Base64 value is missing ${requiredPadding} required padding character${requiredPadding === 1 ? '' : 's'}.`,
      input.length,
    );
  }

  if (dataLength > 0 && (remainder === 2 || remainder === 3)) {
    const unusedBitMask = remainder === 2 ? 0b1111 : 0b11;
    if ((lastDataValue & unusedBitMask) !== 0) {
      throw new Base64DecodeError(
        'NON_CANONICAL_PAD_BITS',
        `The Base64 character at offset ${lastDataOffset} has non-zero unused pad bits.`,
        lastDataOffset,
        lastDataCharacter,
      );
    }
  }

  const bytes = new Uint8Array(Math.floor((dataLength * 6) / 8));
  let accumulator = 0;
  let availableBits = 0;
  let outputIndex = 0;
  let decodedCharacters = 0;
  for (let offset = 0; offset < input.length && decodedCharacters < dataLength; offset += 1) {
    const character = input[offset];
    if (isAsciiWhitespace(character)) continue;
    accumulator = (accumulator << 6) | base64Value(character);
    decodedCharacters += 1;
    availableBits += 6;
    if (availableBits >= 8) {
      availableBits -= 8;
      bytes[outputIndex] = (accumulator >>> availableBits) & 0xff;
      outputIndex += 1;
      accumulator &= availableBits === 0 ? 0 : (1 << availableBits) - 1;
    }
  }

  const alphabet: Base64Alphabet = requestedAlphabet === 'auto'
    ? (sawUrlOnlyCharacter ? 'url' : 'standard')
    : requestedAlphabet;
  const alphabetWasAmbiguous = requestedAlphabet === 'auto'
    && !sawStandardOnlyCharacter
    && !sawUrlOnlyCharacter;
  const addedPadding = paddingCount === 0 && paddingMode !== 'forbid' ? requiredPadding : 0;
  const normalized = encodeBase64(bytes, {
    alphabet,
    padding: paddingMode !== 'forbid',
  });

  return {
    bytes,
    normalized,
    diagnostics: {
      alphabet,
      alphabetWasAmbiguous,
      hadWhitespace: ignoredWhitespaceCount > 0,
      ignoredWhitespaceCount,
      padding: paddingCount > 0 ? 'present' : requiredPadding > 0 ? 'missing' : 'not-needed',
      addedPadding,
      canonical: true,
    },
  };
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array, options: Utf8DecodeOptions = {}): string {
  return new TextDecoder('utf-8', {
    fatal: options.fatal ?? false,
    ignoreBOM: options.ignoreBOM ?? false,
  }).decode(bytes);
}

export function convertBase64Alphabet(
  input: string,
  to: Base64Alphabet,
  options: ConvertBase64AlphabetOptions = {},
): string {
  const decoded = decodeBase64(input, {
    alphabet: 'auto',
    whitespace: options.whitespace ?? 'reject',
    padding: 'allow-missing',
  });
  return encodeBase64(decoded.bytes, {
    alphabet: to,
    padding: options.padding ?? to === 'standard',
  });
}

function hexValue(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function percentDecodeToBytes(input: string, absoluteOffset: number): Uint8Array {
  let outputLength = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '%') {
      if (index + 2 >= input.length) {
        throw new DataUrlParseError(
          'INVALID_PERCENT_ENCODING',
          `Incomplete percent escape at offset ${absoluteOffset + index}.`,
          absoluteOffset + index,
        );
      }
      const high = hexValue(input[index + 1]);
      const low = hexValue(input[index + 2]);
      if (high === -1 || low === -1) {
        throw new DataUrlParseError(
          'INVALID_PERCENT_ENCODING',
          `Invalid percent escape at offset ${absoluteOffset + index}.`,
          absoluteOffset + index,
        );
      }
      outputLength += 1;
      index += 2;
      continue;
    }

    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) continue;
    outputLength += utf8ByteLength(codePoint);
    if (codePoint > 0xffff) index += 1;
  }

  const output = new Uint8Array(outputLength);
  let outputIndex = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '%') {
      output[outputIndex] = (hexValue(input[index + 1]) << 4) | hexValue(input[index + 2]);
      outputIndex += 1;
      index += 2;
      continue;
    }

    let codePoint = input.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
    if (codePoint <= 0x7f) {
      output[outputIndex] = codePoint;
      outputIndex += 1;
    } else if (codePoint <= 0x7ff) {
      output[outputIndex] = 0xc0 | (codePoint >>> 6);
      output[outputIndex + 1] = 0x80 | (codePoint & 0x3f);
      outputIndex += 2;
    } else if (codePoint <= 0xffff) {
      output[outputIndex] = 0xe0 | (codePoint >>> 12);
      output[outputIndex + 1] = 0x80 | ((codePoint >>> 6) & 0x3f);
      output[outputIndex + 2] = 0x80 | (codePoint & 0x3f);
      outputIndex += 3;
    } else {
      output[outputIndex] = 0xf0 | (codePoint >>> 18);
      output[outputIndex + 1] = 0x80 | ((codePoint >>> 12) & 0x3f);
      output[outputIndex + 2] = 0x80 | ((codePoint >>> 6) & 0x3f);
      output[outputIndex + 3] = 0x80 | (codePoint & 0x3f);
      outputIndex += 4;
      index += 1;
    }
  }
  return output;
}

function decodeParameterComponent(value: string, absoluteOffset: number): string {
  const bytes = percentDecodeToBytes(value, absoluteOffset);
  try {
    return bytesToUtf8(bytes, { fatal: true });
  } catch {
    throw new DataUrlParseError(
      'INVALID_PARAMETER',
      `A Data URL parameter contains invalid UTF-8 at offset ${absoluteOffset}.`,
      absoluteOffset,
    );
  }
}

function percentDecodeBase64Payload(
  payload: string,
  payloadOffset: number,
): string {
  if (!payload.includes('%')) return payload;

  const chunks: string[] = [];
  let pieces: string[] = [];
  let literalStart = 0;
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== '%') continue;
    if (index + 2 >= payload.length) {
      throw new DataUrlParseError(
        'INVALID_PERCENT_ENCODING',
        `Incomplete percent escape at offset ${payloadOffset + index}.`,
        payloadOffset + index,
      );
    }
    const high = hexValue(payload[index + 1]);
    const low = hexValue(payload[index + 2]);
    if (high === -1 || low === -1) {
      throw new DataUrlParseError(
        'INVALID_PERCENT_ENCODING',
        `Invalid percent escape at offset ${payloadOffset + index}.`,
        payloadOffset + index,
      );
    }
    const value = (high << 4) | low;
    if (value > 0x7f) {
      throw new Base64DecodeError(
        'INVALID_CHARACTER',
        `Percent-encoded non-ASCII byte at offset ${payloadOffset + index} is not valid Base64 text.`,
        payloadOffset + index,
        payload.slice(index, index + 3),
      );
    }

    if (literalStart < index) pieces.push(payload.slice(literalStart, index));
    pieces.push(String.fromCharCode(value));
    if (pieces.length >= 8_192) {
      chunks.push(pieces.join(''));
      pieces = [];
    }
    index += 2;
    literalStart = index + 1;
  }
  if (literalStart < payload.length) pieces.push(payload.slice(literalStart));
  if (pieces.length > 0) chunks.push(pieces.join(''));
  return chunks.join('');
}

function base64PayloadSourceOffset(
  payload: string,
  payloadOffset: number,
  decodedOffset: number,
): number {
  let currentDecodedOffset = 0;
  for (let index = 0; index < payload.length; index += 1) {
    if (currentDecodedOffset === decodedOffset) return payloadOffset + index;
    if (payload[index] === '%') index += 2;
    currentDecodedOffset += 1;
  }
  return payloadOffset + payload.length;
}

export function parseDataUrl(input: string, options: ParseDataUrlOptions = {}): ParsedDataUrl {
  if (input.slice(0, 5).toLowerCase() !== 'data:') {
    throw new DataUrlParseError('INVALID_SCHEME', 'A Data URL must start with the data: scheme.', 0);
  }
  const commaIndex = input.indexOf(',', 5);
  if (commaIndex === -1) {
    throw new DataUrlParseError('MISSING_COMMA', 'A Data URL must contain a comma before its payload.', input.length);
  }
  const metadataLength = commaIndex - 5;
  if (metadataLength > MAX_DATA_URL_METADATA_LENGTH) {
    const offset = 5 + MAX_DATA_URL_METADATA_LENGTH;
    throw new DataUrlParseError(
      'METADATA_TOO_LONG',
      `Data URL metadata exceeds the ${MAX_DATA_URL_METADATA_LENGTH.toLocaleString('en-US')}-character limit at offset ${offset}.`,
      offset,
    );
  }

  const metadata = input.slice(5, commaIndex);
  const segments: Array<{ value: string; offset: number }> = [];
  let segmentStart = 0;
  for (let index = 0; index <= metadata.length; index += 1) {
    if (index === metadata.length || metadata[index] === ';') {
      segments.push({ value: metadata.slice(segmentStart, index), offset: 5 + segmentStart });
      segmentStart = index + 1;
    }
  }

  const rawMediaType = segments[0]?.value ?? '';
  let mediaType = 'text/plain';
  if (rawMediaType) {
    const slashIndex = rawMediaType.indexOf('/');
    const type = slashIndex === -1 ? '' : rawMediaType.slice(0, slashIndex);
    const subtype = slashIndex === -1 ? '' : rawMediaType.slice(slashIndex + 1);
    if (!MIME_TOKEN.test(type) || !MIME_TOKEN.test(subtype) || subtype.includes('/')) {
      throw new DataUrlParseError(
        'INVALID_MEDIA_TYPE',
        `Invalid Data URL media type at offset ${segments[0].offset}.`,
        segments[0].offset,
      );
    }
    mediaType = `${type.toLowerCase()}/${subtype.toLowerCase()}`;
  }

  const parameterValues: Record<string, string> = Object.create(null) as Record<string, string>;
  const parameterNames = new Set<string>();
  let isBase64 = false;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.value.toLowerCase() === 'base64') {
      if (isBase64) {
        throw new DataUrlParseError(
          'DUPLICATE_BASE64_FLAG',
          `The Data URL repeats the base64 flag at offset ${segment.offset}.`,
          segment.offset,
        );
      }
      if (index !== segments.length - 1) {
        throw new DataUrlParseError(
          'BASE64_FLAG_POSITION',
          `The Data URL base64 flag must follow all media-type parameters (offset ${segment.offset}).`,
          segment.offset,
        );
      }
      isBase64 = true;
      continue;
    }

    const equalsIndex = segment.value.indexOf('=');
    if (equalsIndex <= 0) {
      throw new DataUrlParseError(
        'INVALID_PARAMETER',
        `Invalid Data URL parameter at offset ${segment.offset}.`,
        segment.offset,
      );
    }
    const rawName = segment.value.slice(0, equalsIndex);
    const rawValue = segment.value.slice(equalsIndex + 1);
    const name = decodeParameterComponent(rawName, segment.offset).toLowerCase();
    if (!MIME_TOKEN.test(name)) {
      throw new DataUrlParseError(
        'INVALID_PARAMETER',
        `Invalid Data URL parameter name at offset ${segment.offset}.`,
        segment.offset,
      );
    }
    if (parameterNames.has(name)) {
      throw new DataUrlParseError(
        'DUPLICATE_PARAMETER',
        `Duplicate Data URL parameter ${JSON.stringify(name)} at offset ${segment.offset}.`,
        segment.offset,
      );
    }
    parameterNames.add(name);
    parameterValues[name] = decodeParameterComponent(
      rawValue,
      segment.offset + equalsIndex + 1,
    );
  }

  if (!rawMediaType && !parameterNames.has('charset')) {
    parameterValues.charset = 'US-ASCII';
  }

  const payloadOffset = commaIndex + 1;
  const payload = input.slice(payloadOffset);
  let bytes: Uint8Array;
  let base64Diagnostics: Base64Diagnostics | null = null;
  if (isBase64) {
    const decodedPayload = percentDecodeBase64Payload(payload, payloadOffset);
    try {
      const decoded = decodeBase64(decodedPayload, {
        alphabet: 'standard',
        whitespace: options.whitespace ?? 'reject',
        padding: options.padding ?? 'allow-missing',
      });
      bytes = decoded.bytes;
      base64Diagnostics = decoded.diagnostics;
    } catch (error) {
      if (!(error instanceof Base64DecodeError) || error.offset === null) throw error;
      const absoluteOffset = base64PayloadSourceOffset(payload, payloadOffset, error.offset);
      const relativeOffsetText = `offset ${error.offset}`;
      const absoluteOffsetText = `offset ${absoluteOffset}`;
      const message = error.message.includes(relativeOffsetText)
        ? error.message.replace(relativeOffsetText, absoluteOffsetText)
        : `${error.message} Data URL ${absoluteOffsetText}.`;
      throw new Base64DecodeError(error.code, message, absoluteOffset, error.character);
    }
  } else {
    bytes = percentDecodeToBytes(payload, payloadOffset);
  }

  return {
    mediaType,
    parameters: Object.freeze({ ...parameterValues }),
    isBase64,
    bytes,
    payloadOffset,
    base64Diagnostics,
  };
}

export function bytesToHex(bytes: Uint8Array, options: BytesToHexOptions = {}): string {
  const limit = options.limit ?? bytes.length;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('Hex preview limit must be a non-negative safe integer.');
  }
  const separator = options.separator ?? ' ';
  const uppercase = options.uppercase ?? false;
  const hex = uppercase ? '0123456789ABCDEF' : '0123456789abcdef';
  const end = Math.min(bytes.length, limit);
  let separatorIsAscii = separator.length + 2 <= BASE64_OUTPUT_CHUNK_SIZE;
  for (let index = 0; index < separator.length && separatorIsAscii; index += 1) {
    separatorIsAscii = separator.charCodeAt(index) <= 0x7f;
  }

  if (separatorIsAscii) {
    if (end === 0) return '';
    const outputBuffer = new Uint8Array((end * 2) + ((end - 1) * separator.length));
    let outputLength = 0;

    for (let index = 0; index < end; index += 1) {
      if (index > 0) {
        for (let separatorIndex = 0; separatorIndex < separator.length; separatorIndex += 1) {
          outputBuffer[outputLength] = separator.charCodeAt(separatorIndex);
          outputLength += 1;
        }
      }
      const value = bytes[index];
      outputBuffer[outputLength] = hex.charCodeAt(value >>> 4);
      outputBuffer[outputLength + 1] = hex.charCodeAt(value & 15);
      outputLength += 2;
    }
    return ASCII_DECODER.decode(outputBuffer);
  }

  const chunks: string[] = [];
  let pieces: string[] = [];
  for (let index = 0; index < end; index += 1) {
    const value = bytes[index];
    pieces.push(`${index === 0 ? '' : separator}${hex[value >>> 4]}${hex[value & 15]}`);
    if (pieces.length === HEX_BYTES_PER_CHUNK) {
      chunks.push(pieces.join(''));
      pieces = [];
    }
  }
  if (pieces.length > 0) chunks.push(pieces.join(''));
  return chunks.join('');
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

export function detectSafeRasterMime(bytes: Uint8Array): SafeRasterMime | null {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  if (bytes.length >= 12
      && startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes[8] === 0x57
      && bytes[9] === 0x45
      && bytes[10] === 0x42
      && bytes[11] === 0x50) return 'image/webp';
  return null;
}
