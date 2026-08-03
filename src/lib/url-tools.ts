export const MAX_URL_TEXT_CODE_UNITS = 200_000;
export const MAX_PARSED_URL_CODE_UNITS = 32_768;
export const MAX_BASE_URL_CODE_UNITS = 32_768;
export const MAX_QUERY_PAIRS = 10_000;

export type UrlEncodeMode = 'component' | 'rfc3986-component' | 'full-uri' | 'form';
export type UrlDecodeMode = 'component' | 'full-uri' | 'form';

export type UrlToolErrorCode =
  | 'INPUT_TOO_LARGE'
  | 'LONE_SURROGATE'
  | 'MALFORMED_PERCENT_ESCAPE'
  | 'INVALID_UTF8'
  | 'INVALID_URL'
  | 'INVALID_BASE_URL'
  | 'TOO_MANY_QUERY_PAIRS';

export class UrlToolError extends Error {
  readonly code: UrlToolErrorCode;
  readonly offset: number | null;

  constructor(code: UrlToolErrorCode, message: string, offset: number | null = null) {
    super(message);
    this.name = 'UrlToolError';
    this.code = code;
    this.offset = offset;
  }
}

export interface QueryPair {
  index: number;
  name: string;
  value: string;
  rawName: string;
  rawValue: string;
  hadEquals: boolean;
}

export type QuerySourceKind = 'raw-query' | 'question-mark-query' | 'absolute-url';

export interface ParsedQueryString {
  sourceKind: QuerySourceKind;
  rawQuery: string;
  pairs: QueryPair[];
  map: Record<string, string[]>;
  rebuiltQuery: string;
  ignoredEmptySegments: number;
}

export type ParsedUrlWarningCode =
  | 'CREDENTIALS_PRESENT'
  | 'BASE_IGNORED'
  | 'IDN_ASCII_HOST'
  | 'NON_HTTP_SCHEME'
  | 'OPAQUE_ORIGIN'
  | 'INPUT_NORMALIZED'
  | 'CONTROL_CHARACTERS_NORMALIZED';

export interface ParsedUrlWarning {
  code: ParsedUrlWarningCode;
  message: string;
}

export interface ParsedUrl {
  href: string;
  origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  hasCredentials: boolean;
  hasIdnAsciiLabel: boolean;
  usedBase: boolean;
  queryPairs: QueryPair[];
  warnings: ParsedUrlWarning[];
}

interface InputValidationOptions {
  label: string;
  maximumCodeUnits: number;
  validatePercentUtf8?: boolean;
}

function inputLabel(label: string): string {
  return label.trim() || 'Input';
}

function assertInputLength(input: string, options: InputValidationOptions): void {
  if (input.length <= options.maximumCodeUnits) return;
  throw new UrlToolError(
    'INPUT_TOO_LARGE',
    `${inputLabel(options.label)} exceeds the ${options.maximumCodeUnits.toLocaleString('en-US')} UTF-16 code-unit limit.`,
    options.maximumCodeUnits,
  );
}

export function firstLoneSurrogateOffset(input: string): number | null {
  for (let offset = 0; offset < input.length; offset += 1) {
    const codeUnit = input.charCodeAt(offset);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = input.charCodeAt(offset + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        offset += 1;
        continue;
      }
      return offset;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return offset;
  }
  return null;
}

function assertWellFormedUnicode(input: string, label: string): void {
  const offset = firstLoneSurrogateOffset(input);
  if (offset === null) return;
  throw new UrlToolError(
    'LONE_SURROGATE',
    `${inputLabel(label)} contains an unpaired UTF-16 surrogate at code-unit offset ${offset}. Replace or remove it before UTF-8 processing.`,
    offset,
  );
}

function isAsciiHexDigit(character: string | undefined): boolean {
  return character !== undefined && /^[0-9A-Fa-f]$/.test(character);
}

export function firstMalformedPercentOffset(input: string): number | null {
  for (let offset = 0; offset < input.length; offset += 1) {
    if (input[offset] !== '%') continue;
    if (!isAsciiHexDigit(input[offset + 1]) || !isAsciiHexDigit(input[offset + 2])) return offset;
    offset += 2;
  }
  return null;
}

function assertValidPercentEscapes(input: string, label: string): void {
  const offset = firstMalformedPercentOffset(input);
  if (offset === null) return;
  throw new UrlToolError(
    'MALFORMED_PERCENT_ESCAPE',
    `${inputLabel(label)} has a percent sign at code-unit offset ${offset} that is not followed by exactly two hexadecimal digits.`,
    offset,
  );
}

function assertValidPercentEncodedUtf8(input: string, label: string): void {
  assertValidPercentEscapes(input, label);
  try {
    // This call is only a strict UTF-8 validation pass. Its decoded value is
    // deliberately discarded so reserved URL delimiters retain their meaning.
    decodeURIComponent(input);
  } catch {
    throw new UrlToolError(
      'INVALID_UTF8',
      `${inputLabel(label)} contains percent-encoded bytes that are not a valid UTF-8 sequence.`,
    );
  }
}

function validateInput(input: string, options: InputValidationOptions): void {
  assertInputLength(input, options);
  assertWellFormedUnicode(input, options.label);
  if (options.validatePercentUtf8) assertValidPercentEncodedUtf8(input, options.label);
}

function uppercasePercentEscape(character: string): string {
  return `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

export function encodeUrlText(input: string, mode: UrlEncodeMode): string {
  validateInput(input, {
    label: 'Text to encode',
    maximumCodeUnits: MAX_URL_TEXT_CODE_UNITS,
  });

  if (mode === 'component') return encodeURIComponent(input);
  if (mode === 'rfc3986-component') {
    return encodeURIComponent(input).replace(/[!'()*]/g, uppercasePercentEscape);
  }
  if (mode === 'full-uri') return encodeURI(input);
  if (mode === 'form') {
    return encodeURIComponent(input)
      .replace(/[!'()~]/g, uppercasePercentEscape)
      .replace(/%20/g, '+');
  }
  const exhaustive: never = mode;
  throw new TypeError(`Unsupported URL encode mode: ${String(exhaustive)}`);
}

export function decodeUrlText(input: string, mode: UrlDecodeMode): string {
  validateInput(input, {
    label: 'Text to decode',
    maximumCodeUnits: MAX_URL_TEXT_CODE_UNITS,
    validatePercentUtf8: true,
  });

  try {
    if (mode === 'component') return decodeURIComponent(input);
    if (mode === 'full-uri') return decodeURI(input);
    if (mode === 'form') return decodeURIComponent(input.replace(/\+/g, ' '));
  } catch {
    // validateInput has already separated malformed escapes and invalid UTF-8.
    // This fallback protects the public error contract if a browser engine
    // rejects another URI edge case.
    throw new UrlToolError('INVALID_UTF8', 'The encoded input could not be decoded as one strict UTF-8 round.');
  }
  const exhaustive: never = mode;
  throw new TypeError(`Unsupported URL decode mode: ${String(exhaustive)}`);
}

function rawQuerySegments(rawQuery: string): { segments: string[]; ignoredEmptySegments: number } {
  if (!rawQuery) return { segments: [], ignoredEmptySegments: 0 };
  const allSegments = rawQuery.split('&');
  const segments = allSegments.filter((segment) => segment !== '');
  return { segments, ignoredEmptySegments: allSegments.length - segments.length };
}

function validateQuerySegments(segments: string[]): void {
  for (const segment of segments) {
    const equals = segment.indexOf('=');
    const rawName = equals < 0 ? segment : segment.slice(0, equals);
    const rawValue = equals < 0 ? '' : segment.slice(equals + 1);
    assertValidPercentEncodedUtf8(rawName.replace(/\+/g, ' '), 'Query parameter name');
    assertValidPercentEncodedUtf8(rawValue.replace(/\+/g, ' '), 'Query parameter value');
  }
}

function queryPairs(rawQuery: string): { pairs: QueryPair[]; ignoredEmptySegments: number } {
  const { segments, ignoredEmptySegments } = rawQuerySegments(rawQuery);
  if (segments.length > MAX_QUERY_PAIRS) {
    throw new UrlToolError(
      'TOO_MANY_QUERY_PAIRS',
      `The query contains ${segments.length.toLocaleString('en-US')} non-empty fields; at most ${MAX_QUERY_PAIRS.toLocaleString('en-US')} are processed.`,
    );
  }
  validateQuerySegments(segments);

  const decoded = Array.from(new URLSearchParams(rawQuery).entries());
  if (decoded.length !== segments.length) {
    // Both algorithms intentionally implement the WHATWG form parser. Keeping
    // this guard makes an unexpected platform divergence fail closed instead
    // of attaching raw spellings to the wrong decoded pair.
    throw new UrlToolError('INVALID_URL', 'The browser returned an inconsistent query-parameter result.');
  }

  return {
    ignoredEmptySegments,
    pairs: decoded.map(([name, value], index) => {
      const segment = segments[index];
      const equals = segment.indexOf('=');
      return {
        index,
        name,
        value,
        rawName: equals < 0 ? segment : segment.slice(0, equals),
        rawValue: equals < 0 ? '' : segment.slice(equals + 1),
        hadEquals: equals >= 0,
      };
    }),
  };
}

function pairsToMap(pairs: readonly QueryPair[]): Record<string, string[]> {
  const map = Object.create(null) as Record<string, string[]>;
  for (const pair of pairs) {
    const current = Object.prototype.hasOwnProperty.call(map, pair.name) ? map[pair.name] : undefined;
    if (current) current.push(pair.value);
    else map[pair.name] = [pair.value];
  }
  return map;
}

const HIERARCHICAL_ABSOLUTE_URL = /^[A-Za-z][A-Za-z\d+.-]*:\/\//;

function queryFromAbsoluteUrl(input: string): string | null {
  // Requiring the authority marker keeps an ambiguous raw query such as
  // `foo:bar=baz&x=y` in raw-query mode while still recognizing web-style
  // absolute URLs, including an absolute URL that has no query at all.
  if (!HIERARCHICAL_ABSOLUTE_URL.test(input)) return null;
  try {
    new URL(input);
  } catch {
    return null;
  }

  // Extract from the supplied spelling instead of URL.search so pair JSON can
  // retain raw Unicode, spaces, percent-escape casing, and missing equals.
  const queryOffset = input.indexOf('?');
  const fragmentOffset = input.indexOf('#');
  if (queryOffset < 0 || (fragmentOffset >= 0 && fragmentOffset < queryOffset)) return '';
  return input.slice(queryOffset + 1, fragmentOffset >= 0 ? fragmentOffset : input.length);
}

export function parseQueryString(input: string): ParsedQueryString {
  validateInput(input, {
    label: 'Query input',
    maximumCodeUnits: MAX_URL_TEXT_CODE_UNITS,
  });

  let sourceKind: QuerySourceKind;
  let rawQuery: string;
  if (input.startsWith('?')) {
    sourceKind = 'question-mark-query';
    rawQuery = input.slice(1);
  } else {
    const fromUrl = queryFromAbsoluteUrl(input);
    if (fromUrl !== null) {
      sourceKind = 'absolute-url';
      rawQuery = fromUrl;
    } else {
      sourceKind = 'raw-query';
      rawQuery = input;
    }
  }

  const { pairs, ignoredEmptySegments } = queryPairs(rawQuery);
  const searchParams = new URLSearchParams();
  for (const pair of pairs) searchParams.append(pair.name, pair.value);

  return {
    sourceKind,
    rawQuery,
    pairs,
    map: pairsToMap(pairs),
    rebuiltQuery: searchParams.toString(),
    ignoredEmptySegments,
  };
}

function controlCharacterWarning(input: string): boolean {
  return /[\u0000-\u0020\u007f]/.test(input);
}

function normalizedInputForComparison(input: string): string {
  return input.replace(/^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g, '');
}

function parsedUrlWarnings(input: string, url: URL, usedBase: boolean, baseIgnored: boolean): ParsedUrlWarning[] {
  const warnings: ParsedUrlWarning[] = [];
  const hasCredentials = url.username !== '' || url.password !== '';
  const hasIdnAsciiLabel = /(?:^|\.)xn--/i.test(url.hostname);
  if (hasCredentials) {
    warnings.push({
      code: 'CREDENTIALS_PRESENT',
      message: 'The URL contains username or password data. Treat it as a credential and avoid copying, logging, or sharing it.',
    });
  }
  if (baseIgnored) {
    warnings.push({
      code: 'BASE_IGNORED',
      message: 'The input is already absolute, so the supplied base URL was not used.',
    });
  }
  if (hasIdnAsciiLabel) {
    warnings.push({
      code: 'IDN_ASCII_HOST',
      message: 'The hostname contains an xn-- IDN label. The ASCII serialization is shown; visually similar Unicode domains can identify different hosts.',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    warnings.push({
      code: 'NON_HTTP_SCHEME',
      message: `${url.protocol || 'This'} scheme was parsed as text only. LiveParse never opens, fetches, or executes the parsed URL.`,
    });
  }
  if (url.origin === 'null') {
    warnings.push({
      code: 'OPAQUE_ORIGIN',
      message: 'This URL has an opaque origin serialized as “null”; that string is not a trustworthy host or security origin.',
    });
  }
  if (controlCharacterWarning(input)) {
    warnings.push({
      code: 'CONTROL_CHARACTERS_NORMALIZED',
      message: 'The input contains a control or space character. The browser URL parser may remove, encode, or otherwise normalize it.',
    });
  }
  if (!usedBase && url.href !== normalizedInputForComparison(input)) {
    warnings.push({
      code: 'INPUT_NORMALIZED',
      message: 'The serialized URL differs from the supplied text because the WHATWG parser normalized one or more components.',
    });
  }
  return warnings;
}

export function parseUrl(input: string, base = ''): ParsedUrl {
  validateInput(input, {
    label: 'URL input',
    maximumCodeUnits: MAX_PARSED_URL_CODE_UNITS,
    validatePercentUtf8: true,
  });
  if (!input) throw new UrlToolError('INVALID_URL', 'Enter an absolute URL or a relative reference with an absolute base URL.');

  const baseProvided = base !== '';
  if (baseProvided) {
    // The field limit and Unicode contract apply even when an already-absolute
    // input makes the base semantically unnecessary.
    validateInput(base, {
      label: 'Base URL',
      maximumCodeUnits: MAX_BASE_URL_CODE_UNITS,
    });
  }
  let usedBase = false;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    if (!baseProvided) {
      throw new UrlToolError(
        'INVALID_URL',
        'The input is not an absolute WHATWG URL. Supply an absolute base URL to resolve a relative reference.',
      );
    }

    validateInput(base, {
      label: 'Base URL',
      maximumCodeUnits: MAX_BASE_URL_CODE_UNITS,
      validatePercentUtf8: true,
    });
    let parsedBase: URL;
    try {
      parsedBase = new URL(base);
    } catch {
      throw new UrlToolError('INVALID_BASE_URL', 'The base URL must be an absolute URL that the browser can parse.');
    }
    try {
      url = new URL(input, parsedBase);
      usedBase = true;
    } catch {
      throw new UrlToolError('INVALID_URL', 'The URL reference could not be resolved against the supplied base URL.');
    }
  }

  const rawQuery = url.search.slice(1);
  const { pairs: parsedPairs } = queryPairs(rawQuery);
  const hasCredentials = url.username !== '' || url.password !== '';
  const hasIdnAsciiLabel = /(?:^|\.)xn--/i.test(url.hostname);

  return {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    hasCredentials,
    hasIdnAsciiLabel,
    usedBase,
    queryPairs: parsedPairs,
    warnings: parsedUrlWarnings(input, url, usedBase, baseProvided && !usedBase),
  };
}
