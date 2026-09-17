import { describe, expect, it } from 'vitest';
import {
  formatJsonPath,
  getJsonLocation,
  parseLosslessJson,
  serializeLosslessJson,
  type JsonDocument,
  type JsonWarning,
} from './index';

function parse(source: string): JsonDocument {
  const result = parseLosslessJson(source);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.document;
}

function warnings(document: JsonDocument, code: JsonWarning['code']): JsonWarning[] {
  return document.warnings.filter((warning) => warning.code === code);
}

describe('lossless parsing and serialization', () => {
  it.each([
    '9007199254740993',
    '-9007199254740993',
    '1e400',
    '1e-400',
    '0.10000000000000001',
    '-0',
  ])('preserves the exact root number token %s', (source) => {
    const document = parse(source);
    expect(document.root).toMatchObject({ type: 'number', raw: source, start: 0, end: source.length });
    expect(serializeLosslessJson(document, { indent: 0 })).toBe(source);
    expect(serializeLosslessJson(document, { indent: 4 })).toBe(source);
  });

  it('formats and minifies without changing number/string lexemes or duplicate members', () => {
    const source = String.raw` { "id" : 9007199254740993, "a": 1, "\u0061":2, "x":1e400, "s":"a\/b" } `;
    const document = parse(source);

    expect(serializeLosslessJson(document, { indent: 0 })).toBe(
      String.raw`{"id":9007199254740993,"a":1,"\u0061":2,"x":1e400,"s":"a\/b"}`,
    );
    expect(serializeLosslessJson(document, { indent: 2 })).toBe([
      '{',
      '  "id": 9007199254740993,',
      '  "a": 1,',
      String.raw`  "\u0061": 2,`,
      '  "x": 1e400,',
      String.raw`  "s": "a\/b"`,
      '}',
    ].join('\n'));
  });

  it('round-trips a formatted document through the lossless parser', () => {
    const first = parse(String.raw`{"n":1.2300e+4,"x":1,"x":2,"escaped":"\u0041"}`);
    const pretty = serializeLosslessJson(first, { indent: 4 });
    const second = parse(pretty);
    expect(serializeLosslessJson(second, { indent: 0 })).toBe(
      String.raw`{"n":1.2300e+4,"x":1,"x":2,"escaped":"\u0041"}`,
    );
  });

  it('sorts object keys recursively without collapsing duplicates or changing tokens', () => {
    const document = parse(String.raw`{"z":1,"a":{"y":1e400,"b":2},"a":3,"\u0061":4}`);
    expect(serializeLosslessJson(document, { indent: 0, sortKeys: true })).toBe(
      String.raw`{"a":{"b":2,"y":1e400},"a":3,"\u0061":4,"z":1}`,
    );
  });

  it('preserves all duplicate decoded keys and marks every ambiguous member', () => {
    const document = parse(String.raw`{"a":1,"\u0061":2,"a":3}`);
    expect(document.root.type).toBe('object');
    if (document.root.type !== 'object') return;

    expect(document.root.members).toHaveLength(3);
    expect(document.root.members.map((member) => member.key.value)).toEqual(['a', 'a', 'a']);
    expect(document.root.members.map((member) => member.key.raw)).toEqual(['"a"', String.raw`"\u0061"`, '"a"']);
    expect(document.root.members.map((member) => member.occurrence)).toEqual([1, 2, 3]);
    expect(document.root.members.map((member) => member.duplicate)).toEqual([true, true, true]);
    expect(warnings(document, 'duplicate-key')).toHaveLength(2);
    expect(warnings(document, 'duplicate-key').map((warning) => warning.pathText)).toEqual([
      '$["a"]#2',
      '$["a"]#3',
    ]);
  });

  it('scopes duplicate detection to each object and safely accepts special property names', () => {
    const document = parse(String.raw`{"a":1,"nested":{"a":2},"__proto__":3,"constructor":4}`);
    expect(warnings(document, 'duplicate-key')).toHaveLength(0);
    expect(serializeLosslessJson(document, { indent: 0 })).toBe(
      String.raw`{"a":1,"nested":{"a":2},"__proto__":3,"constructor":4}`,
    );
  });

  it('counts duplicate members and their values instead of collapsed native objects', () => {
    const document = parse('{"a":1,"a":2,"items":[true,null,"x"]}');
    expect(document.stats).toEqual({
      objects: 1,
      arrays: 1,
      properties: 3,
      strings: 1,
      numbers: 2,
      booleans: 1,
      nulls: 1,
      characters: 37,
    });
  });
});

describe('number integrity warnings', () => {
  it.each([
    '9007199254740991',
    '-9007199254740991',
    '90071992547409910e-1',
    '0',
    '-0',
  ])('does not mark safe integer %s as unsafe', (source) => {
    expect(warnings(parse(source), 'unsafe-integer')).toHaveLength(0);
  });

  it.each([
    '9007199254740992',
    '-9007199254740992',
    '9.007199254740992e15',
    '90071992547409920e-1',
    '1e20',
  ])('detects unsafe integer %s including exponent forms', (source) => {
    const warning = warnings(parse(source), 'unsafe-integer');
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({ raw: source, range: { start: 0, end: source.length } });
  });

  it('does not apply the safe-integer warning to a mathematically fractional value', () => {
    expect(warnings(parse('9007199254740991.5'), 'unsafe-integer')).toHaveLength(0);
  });

  it.each(['1e400', '-1e400', '9'.repeat(400)])('detects JavaScript Number overflow for %s', (source) => {
    const document = parse(source);
    expect(warnings(document, 'number-overflow')).toHaveLength(1);
    expect(serializeLosslessJson(document, { indent: 0 })).toBe(source);
  });

  it('does not report overflow for zero with an enormous exponent', () => {
    const source = `0e${'9'.repeat(10_000)}`;
    const document = parse(source);
    expect(warnings(document, 'number-overflow')).toHaveLength(0);
    expect(serializeLosslessJson(document, { indent: 0 })).toBe(source);
  });

  it.each([
    ['9007199254740993', '9007199254740992', true],
    ['0.10000000000000001', '0.1', true],
    ['1e-400', '0', true],
    ['-0', '0', true],
    ['1.0', '1', false],
    ['1e3', '1000', false],
  ] as const)('reports observable JavaScript reserialization of %s', (source, canonical, valueChanged) => {
    const matches = warnings(parse(source), 'number-representation-change');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ javascriptRepresentation: canonical, valueChanged });
  });

  it.each(['0.1', '42', '9007199254740991'])('does not report unchanged representation for %s', (source) => {
    expect(warnings(parse(source), 'number-representation-change')).toHaveLength(0);
  });
});

describe('strict JSON grammar', () => {
  it.each([
    ['1', 'number'],
    ['"text"', 'string'],
    ['true', 'boolean'],
    ['false', 'boolean'],
    ['null', 'null'],
    ['[]', 'array'],
    ['{}', 'object'],
  ] as const)('accepts root value %s', (source, type) => {
    expect(parse(source).root.type).toBe(type);
  });

  it.each([
    ['', 'unexpected-end'],
    [' \t\r\n ', 'unexpected-end'],
    ['01', 'invalid-number'],
    ['-01', 'invalid-number'],
    ['-', 'invalid-number'],
    ['1.', 'invalid-number'],
    ['1e', 'invalid-number'],
    ['1e+', 'invalid-number'],
    ['+1', 'unexpected-token'],
    ['.1', 'unexpected-token'],
    ['NaN', 'unexpected-token'],
    ['Infinity', 'unexpected-token'],
    ['True', 'unexpected-token'],
    ['None', 'unexpected-token'],
    ["'text'", 'unexpected-token'],
    ['{"a":1,}', 'trailing-comma'],
    ['[1,]', 'trailing-comma'],
    ['{"a":/* no */1}', 'unexpected-token'],
    ['{a:1}', 'expected-property'],
    ['true false', 'trailing-content'],
    ['[1,,2]', 'unexpected-token'],
    [String.raw`"bad\x20escape"`, 'invalid-escape'],
    [String.raw`"bad\u12"`, 'invalid-unicode-escape'],
    ['"line\nbreak"', 'invalid-string'],
  ])('rejects non-strict input %j with %s', (source, code) => {
    const result = parseLosslessJson(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('preserves string escapes and decodes surrogate code units for key comparison', () => {
    const source = String.raw`{"\uD83D\uDE00":"\uD800","😀":2}`;
    const document = parse(source);
    expect(document.root.type).toBe('object');
    if (document.root.type !== 'object') return;
    expect(document.root.members[0].key.value).toBe('😀');
    expect(document.root.members[0].value).toMatchObject({ type: 'string', value: '\ud800' });
    expect(document.root.members.map((member) => member.duplicate)).toEqual([true, true]);
    expect(serializeLosslessJson(document, { indent: 0 })).toBe(source);
  });

  it('enforces an explicit nesting limit instead of overflowing the call stack', () => {
    const result = parseLosslessJson('[[[0]]]', { maxDepth: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('max-depth-exceeded');
  });
});

describe('diagnostic source locations and paths', () => {
  it('reports one-based CRLF-aware locations for syntax errors', () => {
    const source = '{\r\n  "ok": 1,\r\n  "bad": 01\r\n}';
    const result = parseLosslessJson(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'invalid-number',
      location: { line: 3, column: 10 },
      pathText: '$["bad"]',
    });
    expect(source.slice(result.error.range.start, result.error.range.end)).toBe('01');
  });

  it('reports exact first/current ranges and a duplicate-aware path', () => {
    const source = '{\r\n  "a": 1,\r\n  "\\u0061": 2\r\n}';
    const document = parse(source);
    const warning = warnings(document, 'duplicate-key')[0];
    expect(warning).toMatchObject({
      code: 'duplicate-key',
      key: 'a',
      occurrence: 2,
      location: { line: 3, column: 3 },
      firstLocation: { line: 2, column: 3 },
      pathText: '$["a"]#2',
    });
    if (warning.code !== 'duplicate-key') return;
    expect(source.slice(warning.firstRange.start, warning.firstRange.end)).toBe('"a"');
    expect(source.slice(warning.range.start, warning.range.end)).toBe('"\\u0061"');
  });

  it('reports a number warning at its nested array path', () => {
    const document = parse('{"items":[0,9007199254740993]}');
    const warning = warnings(document, 'unsafe-integer')[0];
    expect(warning).toMatchObject({
      path: [
        { type: 'property', key: 'items', occurrence: 1 },
        { type: 'index', index: 1 },
      ],
      pathText: '$["items"][1]',
      location: { line: 1, column: 13 },
    });
  });

  it('exports reusable location and path helpers', () => {
    expect(getJsonLocation('a\r\nb\nc', 5)).toEqual({ offset: 5, line: 3, column: 1 });
    expect(formatJsonPath([
      { type: 'property', key: 'a/b', occurrence: 1 },
      { type: 'index', index: 2 },
      { type: 'property', key: 'x', occurrence: 2 },
    ])).toBe('$["a/b"][2]["x"]#2');
  });
});
