export const MAX_RADIX_INPUT_CODE_UNITS = 32_768;
export const MAX_RADIX_DIGITS = 16_384;
export const MAX_RADIX_OUTPUT_DIGITS = 100_000;
export const MAX_BIT_WIDTH = 4_096;
export const MAX_BINARY_TEXT_CODE_UNITS = 65_536;
export const MAX_BINARY_BYTES = 65_536;
export const MAX_BINARY_INPUT_CODE_UNITS = 600_000;
export const MAX_HEX_INPUT_CODE_UNITS = 200_000;

const ASCII_WHITESPACE = /^[\t\n\v\f\r ]$/;

export interface RadixFormatOptions {
  uppercase?: boolean;
  prefix?: boolean;
  groupSize?: number;
  minimumDigits?: number;
}

export interface ByteFormatOptions {
  uppercase?: boolean;
}

export interface ByteConversionResult {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly binary: string;
  readonly hex: string;
  readonly byteLength: number;
}

export interface AsciiTableRow {
  readonly code: number;
  readonly dec: string;
  readonly hex: string;
  readonly octal: string;
  readonly binary: string;
  readonly abbr: string;
  readonly display: string;
  readonly label: string;
  readonly name: string;
  readonly control: boolean;
  readonly printable: boolean;
}

function assertRadix(radix: number): void {
  if (!Number.isInteger(radix) || radix < 2 || radix > 36) {
    throw new RangeError('Radix must be a whole number from 2 through 36.');
  }
}

function digitValue(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  if (code >= 97 && code <= 122) return code - 87;
  return -1;
}

function matchingPrefixLength(input: string, start: number, radix: number): number {
  if (input[start] !== '0') return 0;
  const marker = input[start + 1]?.toLowerCase();
  if ((radix === 2 && marker === 'b') || (radix === 8 && marker === 'o') || (radix === 16 && marker === 'x')) {
    return 2;
  }
  return 0;
}

function rejectMismatchedConventionalPrefix(input: string, start: number, radix: number): void {
  if (input[start] !== '0') return;
  const marker = input[start + 1]?.toLowerCase();
  const prefixRadix = marker === 'b' ? 2 : marker === 'o' ? 8 : marker === 'x' ? 16 : null;
  if (prefixRadix !== null && prefixRadix !== radix) {
    throw new Error(`Prefix 0${marker} denotes base ${prefixRadix}, not the selected base ${radix}.`);
  }
}

export function parseRadixInteger(input: string, radix: number, allowSeparators = false): bigint {
  if (typeof input !== 'string') throw new TypeError('Integer input must be a string.');
  assertRadix(radix);
  if (input.length > MAX_RADIX_INPUT_CODE_UNITS) {
    throw new RangeError(`Input is limited to ${MAX_RADIX_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`);
  }

  let start = 0;
  let end = input.length;
  while (start < end && ASCII_WHITESPACE.test(input[start])) start += 1;
  while (end > start && ASCII_WHITESPACE.test(input[end - 1])) end -= 1;
  if (start === end) throw new Error('Enter a whole integer to convert.');

  let negative = false;
  if (input[start] === '+' || input[start] === '-') {
    negative = input[start] === '-';
    start += 1;
  }
  rejectMismatchedConventionalPrefix(input, start, radix);
  start += matchingPrefixLength(input, start, radix);
  if (start === end) throw new Error('The sign or radix prefix must be followed by at least one digit.');

  let value = 0n;
  let digitCount = 0;
  let previousWasDigit = false;
  for (let index = start; index < end;) {
    const character = input[index];
    const digit = digitValue(character);
    if (digit >= 0 && digit < radix) {
      value = value * BigInt(radix) + BigInt(digit);
      digitCount += 1;
      if (digitCount > MAX_RADIX_DIGITS) {
        throw new RangeError(`Use at most ${MAX_RADIX_DIGITS.toLocaleString('en-US')} digits.`);
      }
      previousWasDigit = true;
      index += 1;
      continue;
    }

    if (allowSeparators && character === '_' && previousWasDigit) {
      const nextDigit = digitValue(input[index + 1] ?? '');
      if (nextDigit >= 0 && nextDigit < radix) {
        previousWasDigit = false;
        index += 1;
        continue;
      }
    }

    if (allowSeparators && ASCII_WHITESPACE.test(character) && previousWasDigit) {
      let nextIndex = index;
      while (nextIndex < end && ASCII_WHITESPACE.test(input[nextIndex])) nextIndex += 1;
      const nextDigit = digitValue(input[nextIndex] ?? '');
      if (nextDigit >= 0 && nextDigit < radix) {
        previousWasDigit = false;
        index = nextIndex;
        continue;
      }
    }

    throw new Error(`Character ${JSON.stringify(character)} at offset ${index} is not valid for base ${radix}.`);
  }

  if (digitCount === 0) throw new Error('Enter at least one digit.');
  return negative && value !== 0n ? -value : value;
}

export function formatRadixInteger(value: bigint, radix: number, options: RadixFormatOptions = {}): string {
  if (typeof value !== 'bigint') throw new TypeError('Integer value must be a bigint.');
  assertRadix(radix);
  const groupSize = options.groupSize ?? 0;
  const minimumDigits = options.minimumDigits ?? 1;
  if (!Number.isInteger(groupSize) || groupSize < 0 || groupSize > MAX_RADIX_OUTPUT_DIGITS) {
    throw new RangeError(`Group size must be a whole number from 0 through ${MAX_RADIX_OUTPUT_DIGITS.toLocaleString('en-US')}.`);
  }
  if (!Number.isInteger(minimumDigits) || minimumDigits < 1 || minimumDigits > MAX_RADIX_OUTPUT_DIGITS) {
    throw new RangeError(`Minimum digits must be a whole number from 1 through ${MAX_RADIX_OUTPUT_DIGITS.toLocaleString('en-US')}.`);
  }

  const negative = value < 0n;
  let digits = (negative ? -value : value).toString(radix);
  if (digits.length > MAX_RADIX_OUTPUT_DIGITS) {
    throw new RangeError(`Formatted output is limited to ${MAX_RADIX_OUTPUT_DIGITS.toLocaleString('en-US')} digits.`);
  }
  digits = digits.padStart(minimumDigits, '0');
  if (options.uppercase) digits = digits.toUpperCase();
  if (groupSize > 0 && digits.length > groupSize) {
    const firstGroupSize = digits.length % groupSize || groupSize;
    const groups = [digits.slice(0, firstGroupSize)];
    for (let start = firstGroupSize; start < digits.length; start += groupSize) groups.push(digits.slice(start, start + groupSize));
    digits = groups.join(' ');
  }

  const prefix = options.prefix
    ? radix === 2 ? '0b' : radix === 8 ? '0o' : radix === 16 ? '0x' : ''
    : '';
  return `${negative ? '-' : ''}${prefix}${digits}`;
}

function assertBitWidth(width: number): void {
  if (!Number.isInteger(width) || width < 1 || width > MAX_BIT_WIDTH) {
    throw new RangeError(`Bit width must be a whole number from 1 through ${MAX_BIT_WIDTH.toLocaleString('en-US')}.`);
  }
}

export function signedRange(width: number): Readonly<{ minimum: bigint; maximum: bigint }> {
  assertBitWidth(width);
  const half = 1n << BigInt(width - 1);
  return Object.freeze({ minimum: -half, maximum: half - 1n });
}

export function encodeTwosComplement(value: bigint, width: number): bigint {
  if (typeof value !== 'bigint') throw new TypeError('Signed value must be a bigint.');
  assertBitWidth(width);
  const modulus = 1n << BigInt(width);
  const { minimum, maximum } = signedRange(width);
  if (value < minimum || value > maximum) {
    throw new RangeError(`The signed value does not fit in ${width} bits (${minimum} through ${maximum}).`);
  }
  return value < 0n ? modulus + value : value;
}

export function decodeTwosComplement(pattern: bigint, width: number): bigint {
  if (typeof pattern !== 'bigint') throw new TypeError('Bit pattern must be a bigint.');
  assertBitWidth(width);
  const modulus = 1n << BigInt(width);
  if (pattern < 0n || pattern >= modulus) {
    throw new RangeError(`The unsigned pattern does not fit in ${width} bits (0 through ${modulus - 1n}).`);
  }
  const signBit = modulus >> 1n;
  return pattern >= signBit ? pattern - modulus : pattern;
}

function firstLoneSurrogate(input: string): number | null {
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      else return index;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return index;
    }
  }
  return null;
}

function assertByteCount(byteLength: number): void {
  if (byteLength > MAX_BINARY_BYTES) {
    throw new RangeError(`Byte input or output is limited to ${MAX_BINARY_BYTES.toLocaleString('en-US')} bytes.`);
  }
}

function encodeUtf8(text: string): Uint8Array {
  if (typeof text !== 'string') throw new TypeError('Text input must be a string.');
  if (text.length > MAX_BINARY_TEXT_CODE_UNITS) {
    throw new RangeError(`Text is limited to ${MAX_BINARY_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`);
  }
  const loneSurrogate = firstLoneSurrogate(text);
  if (loneSurrogate !== null) {
    throw new Error(`Unpaired UTF-16 surrogate at offset ${loneSurrogate}; exact UTF-8 encoding is not possible.`);
  }
  const bytes = new TextEncoder().encode(text);
  assertByteCount(bytes.byteLength);
  return bytes;
}

function continuation(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

function invalidUtf8(offset: number, detail: string): never {
  throw new Error(`Invalid UTF-8 at byte offset ${offset}: ${detail}. Bytes are not replaced.`);
}

function validateUtf8(bytes: Uint8Array): void {
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first <= 0x7f) {
      index += 1;
      continue;
    }

    let length: number;
    let secondMinimum = 0x80;
    let secondMaximum = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) {
      length = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      length = 3;
      if (first === 0xe0) secondMinimum = 0xa0;
      if (first === 0xed) secondMaximum = 0x9f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      length = 4;
      if (first === 0xf0) secondMinimum = 0x90;
      if (first === 0xf4) secondMaximum = 0x8f;
    } else {
      invalidUtf8(index, `0x${first.toString(16).toUpperCase().padStart(2, '0')} cannot begin a scalar value`);
    }

    if (index + length > bytes.length) invalidUtf8(index, `the ${length}-byte sequence is truncated`);
    const second = bytes[index + 1];
    if (second < secondMinimum || second > secondMaximum) {
      invalidUtf8(index + 1, `0x${second.toString(16).toUpperCase().padStart(2, '0')} is not valid in this sequence`);
    }
    for (let continuationIndex = 2; continuationIndex < length; continuationIndex += 1) {
      const byte = bytes[index + continuationIndex];
      if (!continuation(byte)) {
        invalidUtf8(index + continuationIndex, `0x${byte.toString(16).toUpperCase().padStart(2, '0')} is not a continuation byte`);
      }
    }
    index += length;
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  assertByteCount(bytes.byteLength);
  validateUtf8(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('The byte sequence is not well-formed UTF-8. Bytes are not replaced.');
  }
}

function parseBinaryBytes(input: string): Uint8Array {
  if (typeof input !== 'string') throw new TypeError('Binary byte input must be a string.');
  if (input.length > MAX_BINARY_INPUT_CODE_UNITS) {
    throw new RangeError(`Binary input is limited to ${MAX_BINARY_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`);
  }
  const bits: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '0' || character === '1') bits.push(character);
    else if (!ASCII_WHITESPACE.test(character)) {
      throw new Error(`Binary input contains ${JSON.stringify(character)} at offset ${index}; only 0, 1, and ASCII whitespace are allowed.`);
    }
  }
  if (bits.length % 8 !== 0) {
    throw new Error(`Binary text must contain complete 8-bit bytes; found ${bits.length} significant bits.`);
  }
  const byteLength = bits.length / 8;
  assertByteCount(byteLength);
  const bytes = new Uint8Array(byteLength);
  for (let byteIndex = 0; byteIndex < byteLength; byteIndex += 1) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | Number(bits[byteIndex * 8 + bit]);
    bytes[byteIndex] = byte;
  }
  return bytes;
}

function parseHexBytes(input: string): Uint8Array {
  if (typeof input !== 'string') throw new TypeError('Hex byte input must be a string.');
  if (input.length > MAX_HEX_INPUT_CODE_UNITS) {
    throw new RangeError(`Hex input is limited to ${MAX_HEX_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`);
  }
  const source = input.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  if (source === '') return new Uint8Array();

  let pairs: string[] | null = null;
  if (/^(?:\\x[\da-f]{2})(?:[\t\n\v\f\r ]*\\x[\da-f]{2})*$/i.test(source)) {
    pairs = [...source.matchAll(/\\x([\da-f]{2})/gi)].map((match) => match[1]);
  } else if (/^0x[\da-f]{2}(?:[\t\n\v\f\r ]+0x[\da-f]{2})*$/i.test(source)) {
    pairs = source.split(/[\t\n\v\f\r ]+/).map((token) => token.slice(2));
  } else if (/^[\da-f]{2}(?::[\da-f]{2})+$/i.test(source)) {
    pairs = source.split(':');
  } else if (/^[\da-f]{2}(?:-[\da-f]{2})+$/i.test(source)) {
    pairs = source.split('-');
  } else if (/^[\da-f]{2}(?:[\t\n\v\f\r ]+[\da-f]{2})+$/i.test(source)) {
    pairs = source.split(/[\t\n\v\f\r ]+/);
  } else if (/^[\da-f]+$/i.test(source)) {
    if (source.length % 2 !== 0) {
      throw new Error(`Hex byte input needs two digits per byte; found ${source.length} significant digits.`);
    }
    pairs = source.match(/[\da-f]{2}/gi) ?? [];
  }

  if (pairs === null) {
    throw new Error('Hex bytes must use complete pairs: compact hex, two-digit whitespace/colon/hyphen tokens, 0xNN tokens, or \\xNN escapes. Formats cannot be mixed.');
  }

  const byteLength = pairs.length;
  assertByteCount(byteLength);
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = digitValue(pairs[index][0]) * 16 + digitValue(pairs[index][1]);
  }
  return bytes;
}

function formatBinary(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(2).padStart(8, '0')).join(' ');
}

function formatHex(bytes: Uint8Array, uppercase: boolean): string {
  const output = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return uppercase ? output.toUpperCase() : output;
}

function conversionResult(bytesInput: Uint8Array, text: string, options: ByteFormatOptions = {}): ByteConversionResult {
  const bytes = Uint8Array.from(bytesInput);
  return Object.freeze({
    bytes,
    text,
    binary: formatBinary(bytes),
    hex: formatHex(bytes, options.uppercase ?? true),
    byteLength: bytes.byteLength,
  });
}

export function binaryToUtf8Text(input: string): ByteConversionResult {
  const bytes = parseBinaryBytes(input);
  return conversionResult(bytes, decodeUtf8(bytes));
}

export function utf8TextToBinary(text: string): ByteConversionResult {
  const bytes = encodeUtf8(text);
  return conversionResult(bytes, text);
}

export function hexToUtf8Text(input: string, options: ByteFormatOptions = {}): ByteConversionResult {
  const bytes = parseHexBytes(input);
  return conversionResult(bytes, decodeUtf8(bytes), options);
}

export function utf8TextToHex(text: string, options: ByteFormatOptions = {}): ByteConversionResult {
  const bytes = encodeUtf8(text);
  return conversionResult(bytes, text, options);
}

const CONTROL_NAMES: readonly (readonly [abbr: string, name: string])[] = [
  ['NUL', 'Null'], ['SOH', 'Start of Heading'], ['STX', 'Start of Text'], ['ETX', 'End of Text'],
  ['EOT', 'End of Transmission'], ['ENQ', 'Enquiry'], ['ACK', 'Acknowledge'], ['BEL', 'Bell'],
  ['BS', 'Backspace'], ['HT', 'Horizontal Tab'], ['LF', 'Line Feed'], ['VT', 'Vertical Tab'],
  ['FF', 'Form Feed'], ['CR', 'Carriage Return'], ['SO', 'Shift Out'], ['SI', 'Shift In'],
  ['DLE', 'Data Link Escape'], ['DC1', 'Device Control 1'], ['DC2', 'Device Control 2'], ['DC3', 'Device Control 3'],
  ['DC4', 'Device Control 4'], ['NAK', 'Negative Acknowledge'], ['SYN', 'Synchronous Idle'], ['ETB', 'End of Transmission Block'],
  ['CAN', 'Cancel'], ['EM', 'End of Medium'], ['SUB', 'Substitute'], ['ESC', 'Escape'],
  ['FS', 'File Separator'], ['GS', 'Group Separator'], ['RS', 'Record Separator'], ['US', 'Unit Separator'],
];

const PUNCTUATION_NAMES = new Map<number, string>([
  [32, 'Space'], [33, 'Exclamation Mark'], [34, 'Quotation Mark'], [35, 'Number Sign'],
  [36, 'Dollar Sign'], [37, 'Percent Sign'], [38, 'Ampersand'], [39, 'Apostrophe'],
  [40, 'Left Parenthesis'], [41, 'Right Parenthesis'], [42, 'Asterisk'], [43, 'Plus Sign'],
  [44, 'Comma'], [45, 'Hyphen-Minus'], [46, 'Full Stop'], [47, 'Solidus'],
  [58, 'Colon'], [59, 'Semicolon'], [60, 'Less-Than Sign'], [61, 'Equals Sign'],
  [62, 'Greater-Than Sign'], [63, 'Question Mark'], [64, 'Commercial At'],
  [91, 'Left Square Bracket'], [92, 'Reverse Solidus'], [93, 'Right Square Bracket'], [94, 'Circumflex Accent'],
  [95, 'Low Line'], [96, 'Grave Accent'], [123, 'Left Curly Bracket'], [124, 'Vertical Line'],
  [125, 'Right Curly Bracket'], [126, 'Tilde'],
]);

const DIGIT_NAMES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'] as const;

function printableName(code: number): string {
  if (code >= 48 && code <= 57) return `Digit ${DIGIT_NAMES[code - 48]}`;
  if (code >= 65 && code <= 90) return `Latin Capital Letter ${String.fromCharCode(code)}`;
  if (code >= 97 && code <= 122) return `Latin Small Letter ${String.fromCharCode(code).toUpperCase()}`;
  return PUNCTUATION_NAMES.get(code) ?? 'Printable Character';
}

function asciiRow(code: number): AsciiTableRow {
  const control = code < 32 || code === 127;
  const printable = code >= 32 && code <= 126;
  const [abbr, name] = code < 32
    ? CONTROL_NAMES[code]
    : code === 127 ? ['DEL', 'Delete'] as const
      : [code === 32 ? 'SP' : '', printableName(code)] as const;
  const display = printable ? String.fromCharCode(code) : '';
  return Object.freeze({
    code,
    dec: String(code),
    hex: code.toString(16).toUpperCase().padStart(2, '0'),
    octal: code.toString(8).padStart(3, '0'),
    binary: code.toString(2).padStart(8, '0'),
    abbr,
    display,
    label: control ? `<${abbr}>` : code === 32 ? '<SP>' : display,
    name,
    control,
    printable,
  });
}

export const ASCII_TABLE: readonly AsciiTableRow[] = Object.freeze(
  Array.from({ length: 128 }, (_, code) => asciiRow(code)),
);
