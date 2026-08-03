import { describe, expect, it, vi } from 'vitest';
import { encodeBase64, utf8ToBytes } from './base64';
import {
  decodeJwtCompact,
  evaluateJwtTimeClaims,
  JwtDecodeError,
  MAX_JWT_INPUT_CHARACTERS,
  type JwtDecodeErrorCode,
} from './jwt';

function encodeJson(source: string): string {
  return encodeBase64(utf8ToBytes(source), { alphabet: 'url', padding: false });
}

function token(
  header = '{"alg":"HS256","typ":"JWT"}',
  payload = '{"sub":"1234567890","name":"John Doe","iat":1516239022}',
  signature = Uint8Array.of(1, 2, 3, 4),
): string {
  return `${encodeJson(header)}.${encodeJson(payload)}.${encodeBase64(signature, { alphabet: 'url', padding: false })}`;
}

function unsecuredToken(payload: string): string {
  return `${encodeJson('{"alg":"none","typ":"JWT"}')}.${encodeJson(payload)}.`;
}

function expectDecodeError(input: string, code: JwtDecodeErrorCode): JwtDecodeError {
  try {
    decodeJwtCompact(input);
    throw new Error('Expected JWT decoding to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(JwtDecodeError);
    expect(error).toMatchObject({ code });
    return error as JwtDecodeError;
  }
}

describe('compact JWT decoding', () => {
  it('decodes a signed three-part JWT without claiming verification', () => {
    const decoded = decodeJwtCompact(token());
    expect(decoded.header.formatted).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect(decoded.payload.formatted).toContain('"name": "John Doe"');
    expect(decoded.algorithm).toBe('HS256');
    expect(decoded.tokenType).toBe('JWT');
    expect(decoded.signature.byteLength).toBe(4);
    expect(decoded.signatureStatus).toBe('not-verified');
    expect(decoded.issues).toContainEqual(expect.objectContaining({ code: 'SIGNATURE_NOT_VERIFIED' }));
  });

  it('preserves Unicode and exact JSON numbers beyond Number safe integer range', () => {
    const decoded = decodeJwtCompact(token(
      undefined,
      '{"name":"안녕하세요 🌍","account":9007199254740993}',
    ));
    expect(decoded.payload.formatted).toContain('안녕하세요 🌍');
    expect(decoded.payload.formatted).toContain('9007199254740993');
  });

  it('accepts outer whitespace and a Bearer prefix while reporting normalization', () => {
    const decoded = decodeJwtCompact(` \nBearer\t${token()} \r\n`);
    expect(decoded.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'INPUT_NORMALIZED',
      'BEARER_PREFIX_REMOVED',
      'SIGNATURE_NOT_VERIFIED',
    ]));
  });

  it('rejects an invalid Bearer prefix and whitespace inside the compact value', () => {
    expectDecodeError(`Bearer${token()}`, 'INVALID_BEARER_PREFIX');
    expectDecodeError(token().replace('.', '.\n'), 'WHITESPACE_NOT_ALLOWED');
  });

  it.each([
    ['', 'EMPTY_INPUT'],
    ['   ', 'EMPTY_INPUT'],
    ['one.two', 'INVALID_SEGMENT_COUNT'],
    ['one.two.three.four', 'INVALID_SEGMENT_COUNT'],
    ['one.two.three.four.five.six', 'INVALID_SEGMENT_COUNT'],
    ['a.b.c.d.e', 'JWE_NOT_SUPPORTED'],
  ] as const)('classifies structural input %j', (input, code) => {
    expectDecodeError(input, code);
  });

  it('distinguishes encrypted five-part JWE input from malformed segment counts', () => {
    const error = expectDecodeError('a.b.c.d.e', 'JWE_NOT_SUPPORTED');
    expect(error.message).toContain('compact JWE shape');
    expect(error.message).toContain('does not validate or decrypt');
  });

  it('rejects Base64URL padding, standard alphabet characters, and non-canonical pad bits', () => {
    const valid = token();
    const [header, payload, signature] = valid.split('.');
    expectDecodeError(`${header}=.${payload}.${signature}`, 'INVALID_BASE64URL');
    expectDecodeError(`${header}.${payload}.+w`, 'INVALID_BASE64URL');
    expectDecodeError(`${header}.${payload}._x`, 'INVALID_BASE64URL');
  });

  it('rejects invalid UTF-8 and invalid JSON in either JSON segment', () => {
    const invalidUtf8 = encodeBase64(Uint8Array.of(0xc3, 0x28), { alphabet: 'url', padding: false });
    expectDecodeError(`${invalidUtf8}.${encodeJson('{}')}.`, 'INVALID_UTF8');
    expectDecodeError(`${encodeJson('{')}.${encodeJson('{}')}.`, 'INVALID_JSON');
    expectDecodeError(`${encodeJson('{}')}.${encodeJson('{')}.`, 'INVALID_JSON');
  });

  it('requires object values for the header and claims set', () => {
    expectDecodeError(`${encodeJson('[]')}.${encodeJson('{}')}.`, 'HEADER_NOT_OBJECT');
    expectDecodeError(`${encodeJson('{}')}.${encodeJson('[]')}.`, 'PAYLOAD_NOT_OBJECT');
  });

  it('keeps duplicate decoded property names visible and marks them as ambiguous', () => {
    const decoded = decodeJwtCompact(token(
      '{"alg":"HS256","\\u0061lg":"RS256"}',
      '{"exp":1700000000,"\\u0065xp":1800000000,"role":"user","role":"admin"}',
    ));
    expect(decoded.algorithm).toBeNull();
    expect(decoded.structureStatus).toBe('decoded-with-issues');
    expect(decoded.issues.filter((issue) => issue.code === 'DUPLICATE_HEADER')).toHaveLength(1);
    expect(decoded.issues.filter((issue) => issue.code === 'DUPLICATE_CLAIM')).toHaveLength(2);
    const evaluation = evaluateJwtTimeClaims(decoded, { nowMilliseconds: 0 });
    expect(evaluation.status).toBe('indeterminate');
    expect(evaluation.claims.exp.state).toBe('duplicate');
  });

  it('rejects b64:false and duplicate b64 values instead of decoding an unencoded payload', () => {
    expectDecodeError(token('{"alg":"HS256","b64":false}'), 'UNENCODED_PAYLOAD_FORBIDDEN');
    expectDecodeError(token('{"alg":"HS256","b64":"false"}'), 'UNENCODED_PAYLOAD_FORBIDDEN');
    expectDecodeError(token('{"alg":"HS256","b64":true,"b64":true}'), 'UNENCODED_PAYLOAD_FORBIDDEN');
    expect(decodeJwtCompact(token('{"alg":"HS256","b64":true}')).algorithm).toBe('HS256');
  });

  it('labels alg:none as unsecured and requires its signature segment to be empty', () => {
    const decoded = decodeJwtCompact(unsecuredToken('{"sub":"public example"}'));
    expect(decoded.unsecured).toBe(true);
    expect(decoded.signature.byteLength).toBe(0);
    expect(decoded.issues).toContainEqual(expect.objectContaining({ code: 'UNSECURED_JWT' }));

    const unexpected = decodeJwtCompact(token('{"alg":"none"}'));
    expect(unexpected.issues).toContainEqual(expect.objectContaining({
      code: 'UNEXPECTED_NONE_SIGNATURE',
      severity: 'error',
    }));
  });

  it('reports an empty signature for signed algorithms and missing or mistyped alg', () => {
    const missingSignature = decodeJwtCompact(`${encodeJson('{"alg":"RS256"}')}.${encodeJson('{}')}.`);
    expect(missingSignature.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_SIGNATURE' }));

    expect(decodeJwtCompact(token('{}')).issues).toContainEqual(expect.objectContaining({ code: 'MISSING_ALG' }));
    expect(decodeJwtCompact(token('{"alg":42}')).issues).toContainEqual(expect.objectContaining({ code: 'INVALID_ALG_TYPE' }));
  });

  it('never follows remote key references and flags unprocessed critical parameters', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const decoded = decodeJwtCompact(token(
        '{"alg":"RS256","kid":"key-1","jku":"https://example.test/jwks","x5u":"https://example.test/cert","crit":["custom"]}',
      ));
      expect(decoded.keyId).toBe('key-1');
      expect(decoded.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
        'REMOTE_KEY_REFERENCE_NOT_FOLLOWED',
        'CRITICAL_HEADER_NOT_PROCESSED',
      ]));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('treats prototype-looking claim names as plain lossless AST data', () => {
    const decoded = decodeJwtCompact(token(undefined, '{"__proto__":{"polluted":true},"constructor":"data"}'));
    expect(decoded.payload.object.members.map((member) => member.key.value)).toEqual(['__proto__', 'constructor']);
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('enforces input and JSON depth limits', () => {
    expectDecodeError('x'.repeat(MAX_JWT_INPUT_CHARACTERS + 1), 'INPUT_TOO_LONG');
    const deeplyNested = `{"value":${'['.repeat(12)}0${']'.repeat(12)}}`;
    expect(() => decodeJwtCompact(token(undefined, deeplyNested), { maxJsonDepth: 4 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }));
    expect(() => decodeJwtCompact(token(), { maxCharacters: 0 })).toThrow(RangeError);
  });
});

describe('JWT NumericDate evaluation', () => {
  it('expires exactly at exp and remains active immediately before it', () => {
    const decoded = decodeJwtCompact(unsecuredToken('{"exp":1700000000}'));
    expect(evaluateJwtTimeClaims(decoded, { nowMilliseconds: 1_699_999_999_999 }).status)
      .toBe('active-by-time-claims');
    expect(evaluateJwtTimeClaims(decoded, { nowMilliseconds: 1_700_000_000_000 }).status)
      .toBe('expired');
  });

  it('becomes active exactly at nbf and is not active one millisecond before', () => {
    const decoded = decodeJwtCompact(unsecuredToken('{"nbf":1700000000}'));
    expect(evaluateJwtTimeClaims(decoded, { nowMilliseconds: 1_699_999_999_999 }).status)
      .toBe('not-yet-active');
    expect(evaluateJwtTimeClaims(decoded, { nowMilliseconds: 1_700_000_000_000 }).status)
      .toBe('active-by-time-claims');
  });

  it('applies explicit clock skew symmetrically at exact boundaries', () => {
    const exp = decodeJwtCompact(unsecuredToken('{"exp":100}'));
    expect(evaluateJwtTimeClaims(exp, { nowMilliseconds: 104_999, clockSkewSeconds: 5 }).status)
      .toBe('active-by-time-claims');
    expect(evaluateJwtTimeClaims(exp, { nowMilliseconds: 105_000, clockSkewSeconds: 5 }).status)
      .toBe('expired');

    const nbf = decodeJwtCompact(unsecuredToken('{"nbf":100}'));
    expect(evaluateJwtTimeClaims(nbf, { nowMilliseconds: 94_999, clockSkewSeconds: '5' }).status)
      .toBe('not-yet-active');
    expect(evaluateJwtTimeClaims(nbf, { nowMilliseconds: 95_000, clockSkewSeconds: '5' }).status)
      .toBe('active-by-time-claims');
  });

  it('preserves fractional and exponent NumericDate values without Number conversion', () => {
    const decoded = decodeJwtCompact(unsecuredToken('{"exp":1.7000000005e9,"nbf":1699999999.000000001,"iat":1.7e9}'));
    const evaluation = evaluateJwtTimeClaims(decoded, { nowMilliseconds: 1_700_000_000_000 });
    expect(evaluation.claims.exp).toMatchObject({
      state: 'parsed',
      raw: '1.7000000005e9',
      epochNanoseconds: 1_700_000_000_500_000_000n,
    });
    expect(evaluation.claims.nbf.epochNanoseconds).toBe(1_699_999_999_000_000_001n);
    expect(evaluation.claims.iat.epochNanoseconds).toBe(1_700_000_000_000_000_000n);
    expect(evaluation.status).toBe('active-by-time-claims');
  });

  it('reports unsupported precision, out-of-range values, and wrong types as indeterminate', () => {
    const tooPrecise = decodeJwtCompact(unsecuredToken('{"exp":1.1234567891}'));
    expect(evaluateJwtTimeClaims(tooPrecise, { nowMilliseconds: 0 })).toMatchObject({
      status: 'indeterminate',
      claims: { exp: { state: 'unsupported' } },
    });

    const outOfRange = decodeJwtCompact(unsecuredToken('{"exp":1e100}'));
    expect(evaluateJwtTimeClaims(outOfRange, { nowMilliseconds: 0 })).toMatchObject({
      status: 'indeterminate',
      claims: { exp: { state: 'out-of-range' } },
    });

    const wrongType = decodeJwtCompact(unsecuredToken('{"exp":"1700000000"}'));
    expect(evaluateJwtTimeClaims(wrongType, { nowMilliseconds: 0 })).toMatchObject({
      status: 'indeterminate',
      claims: { exp: { state: 'wrong-type' } },
    });
  });

  it('does not let iat alone create a time-window pass or fail', () => {
    const decoded = decodeJwtCompact(unsecuredToken('{"iat":4102444800}'));
    const evaluation = evaluateJwtTimeClaims(decoded, { nowMilliseconds: 0 });
    expect(evaluation.status).toBe('no-time-constraints');
    expect(evaluation.claims.iat.state).toBe('parsed');
  });

  it('keeps a malformed or duplicate iat time result indeterminate', () => {
    const wrongType = decodeJwtCompact(unsecuredToken('{"exp":100,"iat":"99"}'));
    expect(evaluateJwtTimeClaims(wrongType, { nowMilliseconds: 0 }).status).toBe('indeterminate');

    const duplicate = decodeJwtCompact(unsecuredToken('{"exp":100,"iat":98,"iat":99}'));
    expect(evaluateJwtTimeClaims(duplicate, { nowMilliseconds: 0 })).toMatchObject({
      status: 'indeterminate',
      claims: { iat: { state: 'duplicate' } },
    });
  });

  it('reports no time constraints when exp and nbf are absent', () => {
    const evaluation = evaluateJwtTimeClaims(decodeJwtCompact(unsecuredToken('{"sub":"abc"}')), {
      nowMilliseconds: 0,
    });
    expect(evaluation.status).toBe('no-time-constraints');
    expect(evaluation.checkedAtIso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('rejects invalid clocks and negative or imprecise clock skew', () => {
    const decoded = decodeJwtCompact(unsecuredToken('{"exp":100}'));
    expect(() => evaluateJwtTimeClaims(decoded, { nowMilliseconds: 0.5 })).toThrow(RangeError);
    expect(() => evaluateJwtTimeClaims(decoded, { nowMilliseconds: Number.NaN })).toThrow(RangeError);
    expect(() => evaluateJwtTimeClaims(decoded, { clockSkewSeconds: -1 })).toThrow(RangeError);
    expect(() => evaluateJwtTimeClaims(decoded, { clockSkewSeconds: '0.0000000001' })).toThrow(RangeError);
  });
});
