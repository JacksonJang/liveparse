import {
  Base64DecodeError,
  bytesToUtf8,
  decodeBase64,
} from './base64';
import { parseEpoch, type EpochConversionSuccess } from './epoch';
import {
  parseLosslessJson,
  serializeLosslessJson,
  type JsonDocument,
  type JsonMember,
  type JsonNode,
  type JsonObjectNode,
} from './lossless-json';

export const MAX_JWT_INPUT_CHARACTERS = 262_144;
const DEFAULT_MAX_JSON_DEPTH = 128;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export type JwtSegmentName = 'header' | 'payload' | 'signature';

export type JwtDecodeErrorCode =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LONG'
  | 'WHITESPACE_NOT_ALLOWED'
  | 'INVALID_BEARER_PREFIX'
  | 'INVALID_SEGMENT_COUNT'
  | 'JWE_NOT_SUPPORTED'
  | 'EMPTY_HEADER'
  | 'EMPTY_PAYLOAD'
  | 'INVALID_BASE64URL'
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'HEADER_NOT_OBJECT'
  | 'PAYLOAD_NOT_OBJECT'
  | 'UNENCODED_PAYLOAD_FORBIDDEN'
  | 'INVALID_SIGNATURE';

export class JwtDecodeError extends Error {
  readonly code: JwtDecodeErrorCode;
  readonly segment: JwtSegmentName | null;

  constructor(code: JwtDecodeErrorCode, message: string, segment: JwtSegmentName | null = null) {
    super(message);
    this.name = 'JwtDecodeError';
    this.code = code;
    this.segment = segment;
  }
}

export type JwtIssueCode =
  | 'SIGNATURE_NOT_VERIFIED'
  | 'INPUT_NORMALIZED'
  | 'BEARER_PREFIX_REMOVED'
  | 'DUPLICATE_HEADER'
  | 'DUPLICATE_CLAIM'
  | 'MISSING_ALG'
  | 'INVALID_ALG_TYPE'
  | 'UNSECURED_JWT'
  | 'MISSING_SIGNATURE'
  | 'UNEXPECTED_NONE_SIGNATURE'
  | 'CRITICAL_HEADER_NOT_PROCESSED'
  | 'REMOTE_KEY_REFERENCE_NOT_FOLLOWED';

export interface JwtIssue {
  code: JwtIssueCode;
  severity: 'info' | 'warning' | 'error';
  segment: JwtSegmentName | null;
  message: string;
  path?: string;
}

export interface JwtJsonSegment {
  name: 'header' | 'payload';
  encodedLength: number;
  byteLength: number;
  text: string;
  document: JsonDocument;
  object: JsonObjectNode;
  formatted: string;
}

export interface JwtSignatureSegment {
  name: 'signature';
  encodedLength: number;
  byteLength: number;
  bytes: Uint8Array;
}

export interface DecodedJwt {
  header: JwtJsonSegment;
  payload: JwtJsonSegment;
  signature: JwtSignatureSegment;
  algorithm: string | null;
  tokenType: string | null;
  keyId: string | null;
  unsecured: boolean;
  structureStatus: 'decoded' | 'decoded-with-issues';
  signatureStatus: 'not-verified';
  issues: readonly JwtIssue[];
}

export interface DecodeJwtOptions {
  maxCharacters?: number;
  maxJsonDepth?: number;
}

export type JwtTemporalStatus =
  | 'expired'
  | 'not-yet-active'
  | 'active-by-time-claims'
  | 'no-time-constraints'
  | 'indeterminate';

export type JwtTimeClaimState =
  | 'missing'
  | 'parsed'
  | 'duplicate'
  | 'wrong-type'
  | 'unsupported'
  | 'out-of-range';

export interface JwtTimeClaim {
  name: 'exp' | 'nbf' | 'iat';
  state: JwtTimeClaimState;
  raw: string | null;
  epochNanoseconds: bigint | null;
  iso: string | null;
}

export interface EvaluateJwtTimeOptions {
  nowMilliseconds?: number;
  clockSkewSeconds?: number | string;
}

export interface JwtTimeEvaluation {
  status: JwtTemporalStatus;
  checkedAtIso: string;
  nowEpochNanoseconds: bigint;
  clockSkewNanoseconds: bigint;
  claims: Record<'exp' | 'nbf' | 'iat', JwtTimeClaim>;
  reasons: readonly string[];
  signatureStatus: 'not-verified';
}

function validLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new RangeError('JWT limits must be positive integers.');
  return value;
}

function topLevelMembers(object: JsonObjectNode, key: string): JsonMember[] {
  return object.members.filter((member) => member.key.value === key);
}

function uniqueStringMember(object: JsonObjectNode, key: string): string | null {
  const members = topLevelMembers(object, key);
  return members.length === 1 && members[0].value.type === 'string' ? members[0].value.value : null;
}

function decodeSegmentBytes(segment: string, name: JwtSegmentName): Uint8Array {
  try {
    return decodeBase64(segment, {
      alphabet: 'url',
      whitespace: 'reject',
      padding: 'forbid',
    }).bytes;
  } catch (error) {
    const detail = error instanceof Base64DecodeError ? ` ${error.message}` : '';
    throw new JwtDecodeError(
      'INVALID_BASE64URL',
      `The JWT ${name} is not canonical unpadded Base64URL.${detail}`,
      name,
    );
  }
}

function decodeJsonSegment(
  encoded: string,
  name: 'header' | 'payload',
  maxJsonDepth: number,
): JwtJsonSegment {
  if (encoded.length === 0) {
    throw new JwtDecodeError(
      name === 'header' ? 'EMPTY_HEADER' : 'EMPTY_PAYLOAD',
      `The JWT ${name} segment is empty.`,
      name,
    );
  }

  const bytes = decodeSegmentBytes(encoded, name);
  let text: string;
  try {
    text = bytesToUtf8(bytes, { fatal: true, ignoreBOM: true });
  } catch {
    throw new JwtDecodeError('INVALID_UTF8', `The JWT ${name} is not valid UTF-8.`, name);
  }

  const parsed = parseLosslessJson(text, { maxDepth: maxJsonDepth });
  if (!parsed.ok) {
    throw new JwtDecodeError(
      'INVALID_JSON',
      `The JWT ${name} is not valid JSON: ${parsed.error.message}`,
      name,
    );
  }
  if (parsed.document.root.type !== 'object') {
    throw new JwtDecodeError(
      name === 'header' ? 'HEADER_NOT_OBJECT' : 'PAYLOAD_NOT_OBJECT',
      `The JWT ${name} must be a JSON object.`,
      name,
    );
  }

  return {
    name,
    encodedLength: encoded.length,
    byteLength: bytes.byteLength,
    text,
    document: parsed.document,
    object: parsed.document.root,
    formatted: serializeLosslessJson(parsed.document, { indent: 2 }),
  };
}

function normalizationIssues(input: string, compact: string, bearerRemoved: boolean): JwtIssue[] {
  const issues: JwtIssue[] = [];
  if (input !== input.trim()) {
    issues.push({
      code: 'INPUT_NORMALIZED',
      severity: 'info',
      segment: null,
      message: 'Outer whitespace was removed before decoding.',
    });
  }
  if (bearerRemoved) {
    issues.push({
      code: 'BEARER_PREFIX_REMOVED',
      severity: 'info',
      segment: null,
      message: 'The Bearer scheme prefix was removed before decoding.',
    });
  }
  if (compact !== compact.trim()) {
    throw new JwtDecodeError('WHITESPACE_NOT_ALLOWED', 'Whitespace is not allowed inside a compact JWT.');
  }
  return issues;
}

function duplicateIssues(segment: JwtJsonSegment): JwtIssue[] {
  const code = segment.name === 'header' ? 'DUPLICATE_HEADER' : 'DUPLICATE_CLAIM';
  const label = segment.name === 'header' ? 'header parameter' : 'claim';
  return segment.document.warnings
    .filter((warning) => warning.code === 'duplicate-key')
    .map((warning) => ({
      code,
      severity: 'error' as const,
      segment: segment.name,
      message: `Duplicate ${label} ${JSON.stringify(warning.key)} makes this JWT ambiguous.`,
      path: warning.pathText,
    }));
}

/**
 * Decode the JSON portions of a compact JWS/JWT without verifying its signature.
 * No key URL, certificate URL, or JWKS location is ever fetched.
 */
export function decodeJwtCompact(input: string, options: DecodeJwtOptions = {}): DecodedJwt {
  if (typeof input !== 'string') throw new TypeError('JWT input must be a string.');
  const maxCharacters = validLimit(options.maxCharacters, MAX_JWT_INPUT_CHARACTERS);
  const maxJsonDepth = validLimit(options.maxJsonDepth, DEFAULT_MAX_JSON_DEPTH);
  if (input.length === 0 || input.trim().length === 0) {
    throw new JwtDecodeError('EMPTY_INPUT', 'Enter a compact JWT to decode.');
  }
  if (input.length > maxCharacters) {
    throw new JwtDecodeError(
      'INPUT_TOO_LONG',
      `JWT input exceeds the ${maxCharacters.toLocaleString('en-US')}-character safety limit.`,
    );
  }

  const trimmed = input.trim();
  let compact = trimmed;
  let bearerRemoved = false;
  const bearerMatch = /^Bearer[\t ]+/i.exec(trimmed);
  if (bearerMatch) {
    compact = trimmed.slice(bearerMatch[0].length);
    bearerRemoved = true;
  } else if (/^Bearer/i.test(trimmed)) {
    throw new JwtDecodeError(
      'INVALID_BEARER_PREFIX',
      'A Bearer prefix must be followed by at least one space before the compact JWT.',
    );
  }
  if (/\s/u.test(compact)) {
    throw new JwtDecodeError('WHITESPACE_NOT_ALLOWED', 'Whitespace is not allowed inside a compact JWT.');
  }

  const segments = compact.split('.');
  if (segments.length === 5) {
    throw new JwtDecodeError(
      'JWE_NOT_SUPPORTED',
      'This input has the five-part compact JWE shape. It may contain encrypted claims, but this decoder does not validate or decrypt JWE.',
    );
  }
  if (segments.length !== 3) {
    throw new JwtDecodeError(
      'INVALID_SEGMENT_COUNT',
      `A compact signed JWT/JWS must contain exactly three segments; found ${segments.length}.`,
    );
  }

  const issues = normalizationIssues(input, compact, bearerRemoved);
  const header = decodeJsonSegment(segments[0], 'header', maxJsonDepth);
  const b64Members = topLevelMembers(header.object, 'b64');
  if (b64Members.length > 1 || (b64Members.length === 1
      && (b64Members[0].value.type !== 'boolean' || b64Members[0].value.value === false))) {
    throw new JwtDecodeError(
      'UNENCODED_PAYLOAD_FORBIDDEN',
      'JWTs must not use b64:false, and any explicit JWS b64 header parameter must be the boolean true.',
      'header',
    );
  }

  const payload = decodeJsonSegment(segments[1], 'payload', maxJsonDepth);
  const signatureBytes = decodeSegmentBytes(segments[2], 'signature');
  issues.push(...duplicateIssues(header), ...duplicateIssues(payload));

  const algMembers = topLevelMembers(header.object, 'alg');
  let algorithm: string | null = null;
  if (algMembers.length === 0) {
    issues.push({
      code: 'MISSING_ALG',
      severity: 'error',
      segment: 'header',
      message: 'The protected header has no alg parameter.',
    });
  } else if (algMembers.length === 1 && algMembers[0].value.type === 'string') {
    algorithm = algMembers[0].value.value;
  } else if (algMembers.length === 1) {
    issues.push({
      code: 'INVALID_ALG_TYPE',
      severity: 'error',
      segment: 'header',
      message: 'The protected header alg parameter must be a string.',
    });
  }

  const unsecured = algorithm === 'none';
  if (unsecured) {
    if (signatureBytes.byteLength !== 0) {
      issues.push({
        code: 'UNEXPECTED_NONE_SIGNATURE',
        severity: 'error',
        segment: 'header',
        message: 'An alg:none unsecured JWT must have an empty signature segment.',
      });
    }
    issues.push({
      code: 'UNSECURED_JWT',
      severity: 'warning',
      segment: 'header',
      message: 'This is an unsecured alg:none JWT. It provides no integrity protection.',
    });
  } else if (signatureBytes.byteLength === 0) {
    issues.push({
      code: 'MISSING_SIGNATURE',
      severity: 'error',
      segment: 'signature',
      message: 'The signature segment is empty for a token that does not declare alg:none.',
    });
  }

  if (topLevelMembers(header.object, 'crit').length > 0) {
    issues.push({
      code: 'CRITICAL_HEADER_NOT_PROCESSED',
      severity: 'warning',
      segment: 'header',
      message: 'Critical header parameters are displayed but are not processed by this decoder.',
    });
  }
  if (topLevelMembers(header.object, 'jku').length > 0 || topLevelMembers(header.object, 'x5u').length > 0) {
    issues.push({
      code: 'REMOTE_KEY_REFERENCE_NOT_FOLLOWED',
      severity: 'warning',
      segment: 'header',
      message: 'Remote key and certificate URLs are displayed only and are never requested.',
    });
  }
  issues.push({
    code: 'SIGNATURE_NOT_VERIFIED',
    severity: 'warning',
    segment: null,
    message: 'Decoded only. The signature, issuer, audience, and authorization policy were not verified.',
  });

  return {
    header,
    payload,
    signature: {
      name: 'signature',
      encodedLength: segments[2].length,
      byteLength: signatureBytes.byteLength,
      bytes: signatureBytes,
    },
    algorithm,
    tokenType: uniqueStringMember(header.object, 'typ'),
    keyId: uniqueStringMember(header.object, 'kid'),
    unsecured,
    structureStatus: issues.some((issue) => issue.severity === 'error') ? 'decoded-with-issues' : 'decoded',
    signatureStatus: 'not-verified',
    issues,
  };
}

function normalizeNumericDate(raw: string):
  | { ok: true; value: string }
  | { ok: false; state: 'unsupported' | 'out-of-range' } {
  if (raw.length > 80) return { ok: false, state: 'unsupported' };
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return { ok: false, state: 'unsupported' };

  const sign = match[1];
  const integerDigits = match[2];
  const fractionDigits = match[3] ?? '';
  const exponentText = match[4] ?? '0';
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    return { ok: false, state: 'unsupported' };
  }

  const digits = `${integerDigits}${fractionDigits}`;
  const decimalIndex = integerDigits.length + exponent;
  let whole: string;
  let fraction: string;
  if (decimalIndex <= 0) {
    whole = '0';
    fraction = `${'0'.repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    whole = `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
    fraction = '';
  } else {
    whole = digits.slice(0, decimalIndex);
    fraction = digits.slice(decimalIndex);
  }

  whole = whole.replace(/^0+(?=\d)/, '');
  if (fraction.length > 9) {
    if (!/^0*$/.test(fraction.slice(9))) return { ok: false, state: 'unsupported' };
    fraction = fraction.slice(0, 9);
  }
  fraction = fraction.replace(/0+$/, '');
  const normalized = `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
  if (normalized.length > 80) return { ok: false, state: 'out-of-range' };
  return { ok: true, value: normalized };
}

function parseTimeClaim(object: JsonObjectNode, name: 'exp' | 'nbf' | 'iat'): JwtTimeClaim {
  const members = topLevelMembers(object, name);
  if (members.length === 0) return { name, state: 'missing', raw: null, epochNanoseconds: null, iso: null };
  if (members.length > 1) return { name, state: 'duplicate', raw: null, epochNanoseconds: null, iso: null };
  const value = members[0].value;
  if (value.type !== 'number') {
    return { name, state: 'wrong-type', raw: serializeLosslessJson(value, { indent: 0 }), epochNanoseconds: null, iso: null };
  }

  const normalized = normalizeNumericDate(value.raw);
  if (!normalized.ok) {
    return { name, state: normalized.state, raw: value.raw, epochNanoseconds: null, iso: null };
  }
  const parsed = parseEpoch(normalized.value, 'seconds');
  if (!parsed.ok) {
    return {
      name,
      state: parsed.code === 'date-out-of-range' ? 'out-of-range' : 'unsupported',
      raw: value.raw,
      epochNanoseconds: null,
      iso: null,
    };
  }
  return {
    name,
    state: 'parsed',
    raw: value.raw,
    epochNanoseconds: parsed.epochNanoseconds,
    iso: parsed.iso,
  };
}

function parseClockSkew(value: number | string | undefined): EpochConversionSuccess {
  const raw = value === undefined ? '0' : String(value).trim();
  if (raw.startsWith('-')) throw new RangeError('Clock skew must be zero or a positive number of seconds.');
  const normalized = normalizeNumericDate(raw);
  if (!normalized.ok) throw new RangeError('Clock skew must be a decimal number with at most nanosecond precision.');
  const parsed = parseEpoch(normalized.value, 'seconds');
  if (!parsed.ok) throw new RangeError(`Clock skew is invalid: ${parsed.error}`);
  return parsed;
}

/** Evaluate only exp and nbf against an explicit clock; this never verifies a signature. */
export function evaluateJwtTimeClaims(
  decoded: DecodedJwt,
  options: EvaluateJwtTimeOptions = {},
): JwtTimeEvaluation {
  const nowMilliseconds = options.nowMilliseconds ?? Date.now();
  if (!Number.isFinite(nowMilliseconds) || !Number.isInteger(nowMilliseconds)) {
    throw new RangeError('nowMilliseconds must be a finite integer.');
  }
  const nowDate = new Date(nowMilliseconds);
  if (Number.isNaN(nowDate.getTime())) throw new RangeError('nowMilliseconds is outside the supported Date range.');

  const nowEpochNanoseconds = BigInt(nowMilliseconds) * NANOSECONDS_PER_MILLISECOND;
  const clockSkewNanoseconds = parseClockSkew(options.clockSkewSeconds).epochNanoseconds;
  const claims = {
    exp: parseTimeClaim(decoded.payload.object, 'exp'),
    nbf: parseTimeClaim(decoded.payload.object, 'nbf'),
    iat: parseTimeClaim(decoded.payload.object, 'iat'),
  };
  const reasons: string[] = [];

  const timeClaims = [claims.exp, claims.nbf, claims.iat];
  const invalidTimeClaim = timeClaims.find(
    (claim) => claim.state !== 'missing' && claim.state !== 'parsed',
  );
  let status: JwtTemporalStatus;
  if (invalidTimeClaim) {
    status = 'indeterminate';
    reasons.push(`${invalidTimeClaim.name} could not be evaluated because its state is ${invalidTimeClaim.state}.`);
  } else if (claims.exp.state === 'parsed'
      && nowEpochNanoseconds >= claims.exp.epochNanoseconds! + clockSkewNanoseconds) {
    status = 'expired';
    reasons.push('The checking time is at or after exp plus the configured clock skew.');
  } else if (claims.nbf.state === 'parsed'
      && nowEpochNanoseconds < claims.nbf.epochNanoseconds! - clockSkewNanoseconds) {
    status = 'not-yet-active';
    reasons.push('The checking time is before nbf minus the configured clock skew.');
  } else if (claims.exp.state === 'parsed' || claims.nbf.state === 'parsed') {
    status = 'active-by-time-claims';
    reasons.push('The supplied exp and nbf constraints pass at the checking time.');
  } else {
    status = 'no-time-constraints';
    reasons.push('No exp or nbf claim is present, so there is no time window to evaluate.');
  }

  if (claims.iat.state === 'parsed') reasons.push('iat is displayed for context and is not itself a time-window constraint.');
  reasons.push('Signature, issuer, audience, subject, and application authorization were not verified.');

  return {
    status,
    checkedAtIso: nowDate.toISOString(),
    nowEpochNanoseconds,
    clockSkewNanoseconds,
    claims,
    reasons,
    signatureStatus: 'not-verified',
  };
}

export function jwtJsonValueText(node: JsonNode): string {
  return serializeLosslessJson(node, { indent: 0 });
}
