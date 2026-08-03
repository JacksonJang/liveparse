import { describe, expect, it } from 'vitest';
import {
  MAX_BASE_URL_CODE_UNITS,
  MAX_PARSED_URL_CODE_UNITS,
  MAX_QUERY_PAIRS,
  MAX_URL_TEXT_CODE_UNITS,
  UrlToolError,
  decodeUrlText,
  encodeUrlText,
  firstLoneSurrogateOffset,
  firstMalformedPercentOffset,
  parseQueryString,
  parseUrl,
  type UrlToolErrorCode,
} from './url-tools';

function expectUrlError(action: () => unknown, code: UrlToolErrorCode): UrlToolError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UrlToolError);
    expect((error as UrlToolError).code).toBe(code);
    return error as UrlToolError;
  }
  throw new Error(`Expected UrlToolError ${code}.`);
}

describe('URL encoding', () => {
  it('keeps the four encoding contexts distinct', () => {
    const input = `a b/c?x=1&y=!'()*~+한😀`;
    expect(encodeUrlText(input, 'component')).toBe("a%20b%2Fc%3Fx%3D1%26y%3D!'()*~%2B%ED%95%9C%F0%9F%98%80");
    expect(encodeUrlText(input, 'rfc3986-component')).toBe('a%20b%2Fc%3Fx%3D1%26y%3D%21%27%28%29%2A~%2B%ED%95%9C%F0%9F%98%80');
    expect(encodeUrlText(input, 'full-uri')).toBe("a%20b/c?x=1&y=!'()*~+%ED%95%9C%F0%9F%98%80");
    expect(encodeUrlText(input, 'form')).toBe('a+b%2Fc%3Fx%3D1%26y%3D%21%27%28%29*%7E%2B%ED%95%9C%F0%9F%98%80');
  });

  it('matches the browser form serializer for scalar-value strings', () => {
    const values = ['', 'hello world', 'a+b&c=d', '한글과 😀', "!'()*~-._"];
    for (const value of values) {
      const expected = new URLSearchParams([['value', value]]).toString().slice('value='.length);
      expect(encodeUrlText(value, 'form')).toBe(expected);
    }
  });

  it('accepts the documented limit and rejects the next code unit', () => {
    expect(encodeUrlText('a'.repeat(MAX_URL_TEXT_CODE_UNITS), 'component')).toHaveLength(MAX_URL_TEXT_CODE_UNITS);
    expectUrlError(
      () => encodeUrlText('a'.repeat(MAX_URL_TEXT_CODE_UNITS + 1), 'component'),
      'INPUT_TOO_LARGE',
    );
  });

  it('rejects unpaired surrogates instead of silently substituting U+FFFD', () => {
    expect(firstLoneSurrogateOffset('A😀B')).toBeNull();
    expect(firstLoneSurrogateOffset(`A\ud800B`)).toBe(1);
    expect(firstLoneSurrogateOffset(`A\udc00B`)).toBe(1);
    const error = expectUrlError(() => encodeUrlText(`ok\ud800`, 'form'), 'LONE_SURROGATE');
    expect(error.offset).toBe(2);
  });
});

describe('URL decoding', () => {
  it('performs one strict component-decoding round', () => {
    expect(decodeUrlText('%ED%95%9C%EA%B8%80%20%F0%9F%98%80', 'component')).toBe('한글 😀');
    expect(decodeUrlText('%252Fadmin%253Frole%253D1', 'component')).toBe('%2Fadmin%3Frole%3D1');
  });

  it('preserves escaped URI delimiters in full-URI mode', () => {
    expect(decodeUrlText('https://example.com/a%2Fb%3Fx%3D1%23part', 'full-uri'))
      .toBe('https://example.com/a%2Fb%3Fx%3D1%23part');
    expect(decodeUrlText('https://example.com/a%20b', 'full-uri')).toBe('https://example.com/a b');
  });

  it('maps plus to space only in form mode', () => {
    expect(decodeUrlText('a+b%2Bc', 'component')).toBe('a+b+c');
    expect(decodeUrlText('a+b%2Bc', 'form')).toBe('a b+c');
  });

  it('reports malformed percent escapes separately from invalid UTF-8', () => {
    expect(firstMalformedPercentOffset('ok%20x')).toBeNull();
    expect(firstMalformedPercentOffset('ok%2')).toBe(2);
    expect(firstMalformedPercentOffset('ok%GG')).toBe(2);
    const malformed = expectUrlError(() => decodeUrlText('ok%2', 'component'), 'MALFORMED_PERCENT_ESCAPE');
    expect(malformed.offset).toBe(2);
    expectUrlError(() => decodeUrlText('%C0%AF', 'component'), 'INVALID_UTF8');
    expectUrlError(() => decodeUrlText('%ED%A0%80', 'component'), 'INVALID_UTF8');
    expectUrlError(() => decodeUrlText('%F4%90%80%80', 'form'), 'INVALID_UTF8');
  });

  it('applies the common text limit to decoding', () => {
    expectUrlError(
      () => decodeUrlText('a'.repeat(MAX_URL_TEXT_CODE_UNITS + 1), 'component'),
      'INPUT_TOO_LARGE',
    );
  });
});

describe('WHATWG URL parsing', () => {
  it('returns normalized components, credentials, ASCII IDN host, and ordered query pairs', () => {
    const result = parseUrl('HTTPS://User:pa%20ss@BÜCHER.example:443/a/../b?q=one&q=&bare#frag');
    expect(result.href).toBe('https://User:pa%20ss@xn--bcher-kva.example/b?q=one&q=&bare#frag');
    expect(result.origin).toBe('https://xn--bcher-kva.example');
    expect(result.protocol).toBe('https:');
    expect(result.username).toBe('User');
    expect(result.password).toBe('pa%20ss');
    expect(result.hostname).toBe('xn--bcher-kva.example');
    expect(result.port).toBe('');
    expect(result.pathname).toBe('/b');
    expect(result.search).toBe('?q=one&q=&bare');
    expect(result.hash).toBe('#frag');
    expect(result.hasCredentials).toBe(true);
    expect(result.hasIdnAsciiLabel).toBe(true);
    expect(result.queryPairs.map(({ name, value, hadEquals }) => ({ name, value, hadEquals }))).toEqual([
      { name: 'q', value: 'one', hadEquals: true },
      { name: 'q', value: '', hadEquals: true },
      { name: 'bare', value: '', hadEquals: false },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'CREDENTIALS_PRESENT',
      'IDN_ASCII_HOST',
      'INPUT_NORMALIZED',
    ]));
  });

  it('resolves a relative reference only with an explicit absolute base', () => {
    const result = parseUrl('../api/items?tag=a&tag=b#row', 'https://example.com/docs/start/');
    expect(result.href).toBe('https://example.com/docs/api/items?tag=a&tag=b#row');
    expect(result.usedBase).toBe(true);
    expect(result.queryPairs.map((pair) => pair.value)).toEqual(['a', 'b']);
    expectUrlError(() => parseUrl('../api/items'), 'INVALID_URL');
    expectUrlError(() => parseUrl('../api/items', '/relative/base'), 'INVALID_BASE_URL');
  });

  it('ignores an optional base when the input is already absolute', () => {
    const result = parseUrl('HTTPS://EXAMPLE.COM:443/a/../b', 'not a usable base');
    expect(result.href).toBe('https://example.com/b');
    expect(result.usedBase).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'BASE_IGNORED',
      'INPUT_NORMALIZED',
    ]));
  });

  it('parses non-HTTP URLs as inert text and warns about opaque origins', () => {
    const result = parseUrl('data:text/plain,hello%20world');
    expect(result.protocol).toBe('data:');
    expect(result.origin).toBe('null');
    expect(result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'NON_HTTP_SCHEME',
      'OPAQUE_ORIGIN',
    ]));
  });

  it('warns when control characters are normalized', () => {
    const result = parseUrl(' https://example.com/a b ');
    expect(result.href).toBe('https://example.com/a%20b');
    expect(result.warnings.map((warning) => warning.code)).toContain('CONTROL_CHARACTERS_NORMALIZED');
  });

  it('rejects malformed escapes, invalid UTF-8, lone surrogates, and invalid bases', () => {
    expectUrlError(() => parseUrl('https://example.com/%'), 'MALFORMED_PERCENT_ESCAPE');
    expectUrlError(() => parseUrl('https://example.com/%C0%AF'), 'INVALID_UTF8');
    expectUrlError(() => parseUrl(`https://example.com/\ud800`), 'LONE_SURROGATE');
    expectUrlError(() => parseUrl('/relative', 'https://example.com/%GG'), 'MALFORMED_PERCENT_ESCAPE');
  });

  it('enforces independent URL and base limits', () => {
    expectUrlError(() => parseUrl(`https://example.com/${'a'.repeat(MAX_PARSED_URL_CODE_UNITS)}`), 'INPUT_TOO_LARGE');
    expectUrlError(
      () => parseUrl('/x', `https://example.com/${'a'.repeat(MAX_BASE_URL_CODE_UNITS)}`),
      'INPUT_TOO_LARGE',
    );
    expectUrlError(
      () => parseUrl('https://example.com/', 'a'.repeat(MAX_BASE_URL_CODE_UNITS + 1)),
      'INPUT_TOO_LARGE',
    );
  });
});

describe('query-string parsing', () => {
  it('preserves order, duplicates, empty values, missing equals, plus semantics, and raw spellings', () => {
    const result = parseQueryString('?a=1&a=2&empty=&bare&plus=a+b&literal=%2B&=value');
    expect(result.sourceKind).toBe('question-mark-query');
    expect(result.pairs).toEqual([
      { index: 0, name: 'a', value: '1', rawName: 'a', rawValue: '1', hadEquals: true },
      { index: 1, name: 'a', value: '2', rawName: 'a', rawValue: '2', hadEquals: true },
      { index: 2, name: 'empty', value: '', rawName: 'empty', rawValue: '', hadEquals: true },
      { index: 3, name: 'bare', value: '', rawName: 'bare', rawValue: '', hadEquals: false },
      { index: 4, name: 'plus', value: 'a b', rawName: 'plus', rawValue: 'a+b', hadEquals: true },
      { index: 5, name: 'literal', value: '+', rawName: 'literal', rawValue: '%2B', hadEquals: true },
      { index: 6, name: '', value: 'value', rawName: '', rawValue: 'value', hadEquals: true },
    ]);
    expect(result.map).toEqual({
      a: ['1', '2'],
      empty: [''],
      bare: [''],
      plus: ['a b'],
      literal: ['+'],
      '': ['value'],
    });
    expect(result.rebuiltQuery).toBe('a=1&a=2&empty=&bare=&plus=a+b&literal=%2B&=value');
  });

  it('extracts only the query from an absolute URL and ignores its fragment', () => {
    const result = parseQueryString('https://example.com/path?q=hello+world&q=%ED%95%9C#not-a-pair=1');
    expect(result.sourceKind).toBe('absolute-url');
    expect(result.rawQuery).toBe('q=hello+world&q=%ED%95%9C');
    expect(result.pairs.map((pair) => pair.value)).toEqual(['hello world', '한']);
  });

  it('retains the supplied query spelling when extracting from an absolute URL', () => {
    const result = parseQueryString('https://example.com/path?q=café tea&bare#ignored');
    expect(result.rawQuery).toBe('q=café tea&bare');
    expect(result.pairs[0]).toMatchObject({ name: 'q', value: 'café tea', rawValue: 'café tea' });
    expect(result.pairs[1]).toMatchObject({ name: 'bare', value: '', rawValue: '', hadEquals: false });
    expect(result.rebuiltQuery).toBe('q=caf%C3%A9+tea&bare=');
  });

  it('recognizes an absolute URL with no query as an empty query source', () => {
    const result = parseQueryString('https://example.com/path#fragment');
    expect(result.sourceKind).toBe('absolute-url');
    expect(result.rawQuery).toBe('');
    expect(result.pairs).toEqual([]);
    expect(result.rebuiltQuery).toBe('');
  });

  it('does not mistake a raw redirect parameter for a full URL', () => {
    const result = parseQueryString('redirect=https%3A%2F%2Fexample.com%2F%3Fa%3Db&ok=true');
    expect(result.sourceKind).toBe('raw-query');
    expect(result.pairs[0].value).toBe('https://example.com/?a=b');
  });

  it('keeps an ambiguous scheme-shaped value in raw-query mode without an authority marker', () => {
    const result = parseQueryString('foo:bar=baz&x=y');
    expect(result.sourceKind).toBe('raw-query');
    expect(result.pairs.map(({ name, value }) => [name, value])).toEqual([
      ['foo:bar', 'baz'],
      ['x', 'y'],
    ]);
  });

  it('uses canonical form serialization for the rebuilt query', () => {
    const result = parseQueryString('space=%20&tilde=~&star=*&no-equals');
    expect(result.rebuiltQuery).toBe('space=+&tilde=%7E&star=*&no-equals=');
    expect(result.pairs[3].hadEquals).toBe(false);
  });

  it('ignores empty ampersand segments like URLSearchParams while reporting their count', () => {
    const result = parseQueryString('&a=1&&b=2&');
    expect(result.pairs.map((pair) => pair.name)).toEqual(['a', 'b']);
    expect(result.ignoredEmptySegments).toBe(3);
  });

  it('handles prototype-looking keys without mutating an object prototype', () => {
    const result = parseQueryString('__proto__=first&constructor=second&__proto__=third');
    expect(Object.getPrototypeOf(result.map)).toBeNull();
    expect(result.map.__proto__).toEqual(['first', 'third']);
    expect(result.map.constructor).toEqual(['second']);
  });

  it('rejects malformed and non-UTF-8 query fields instead of replacement decoding', () => {
    expectUrlError(() => parseQueryString('a=%'), 'MALFORMED_PERCENT_ESCAPE');
    expectUrlError(() => parseQueryString('a=%GG'), 'MALFORMED_PERCENT_ESCAPE');
    expectUrlError(() => parseQueryString('a=%C0%AF'), 'INVALID_UTF8');
    expectUrlError(() => parseQueryString(`a=\ud800`), 'LONE_SURROGATE');
  });

  it('enforces pair and input limits before building large outputs', () => {
    const tooManyPairs = Array.from({ length: MAX_QUERY_PAIRS + 1 }, () => 'a').join('&');
    expectUrlError(() => parseQueryString(tooManyPairs), 'TOO_MANY_QUERY_PAIRS');
    expectUrlError(() => parseQueryString('a'.repeat(MAX_URL_TEXT_CODE_UNITS + 1)), 'INPUT_TOO_LARGE');
  });
});
