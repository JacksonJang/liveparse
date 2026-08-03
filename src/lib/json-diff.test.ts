import { describe, expect, it } from 'vitest';
import {
  compareJson,
  type JsonCompareSuccess,
  type JsonDifferenceKind,
} from './json-diff';

function success(left: string, right: string, options?: Parameters<typeof compareJson>[2]): JsonCompareSuccess {
  const result = compareJson(left, right, options);
  if (!result.ok) {
    throw new Error(result.errors.map(({ side, error }) => `${side}: ${error.code}`).join(', '));
  }
  return result;
}

function kinds(result: JsonCompareSuccess): JsonDifferenceKind[] {
  return result.differences.map((difference) => difference.kind);
}

describe('compareJson object comparison', () => {
  it('ignores object member order and compares decoded keys and strings', () => {
    const result = success(
      String.raw`{"a":"A","nested":{"x":1,"y":2}}`,
      String.raw`{"nested":{"y":2.0,"x":1e0},"\u0061":"\u0041"}`,
    );

    expect(result.summary.totalDifferences).toBe(0);
    expect(result.differences).toEqual([]);
    expect(result.summary).toMatchObject({ returnedDifferences: 0, truncated: false });
  });

  it('reports value, type, property removal, and property addition independently', () => {
    const result = success(
      '{"same":1,"value":"old","gone":true,"type":1}',
      '{"type":"1","added":[2],"value":"new","same":1.0}',
    );

    expect(kinds(result)).toEqual([
      'value-changed',
      'property-removed',
      'type-changed',
      'property-added',
    ]);
    expect(result.differences.map((difference) => difference.pathText)).toEqual([
      '$["value"]',
      '$["gone"]',
      '$["type"]',
      '$["added"]',
    ]);
    expect(result.differences[0]).toMatchObject({
      leftSnippet: '"old"',
      rightSnippet: '"new"',
      leftType: 'string',
      rightType: 'string',
      leftPathText: '$["value"]',
      rightPathText: '$["value"]',
    });
    expect(result.differences[1]).toMatchObject({
      leftSnippet: 'true',
      rightSnippet: null,
      leftPathText: '$["gone"]',
      rightPath: null,
    });
    expect(result.differences[3]).toMatchObject({
      leftSnippet: null,
      rightSnippet: '[2]',
      leftPath: null,
      rightPathText: '$["added"]',
    });
    expect(result.summary).toEqual({
      totalDifferences: 4,
      returnedDifferences: 4,
      truncated: false,
      byKind: {
        'type-changed': 1,
        'value-changed': 1,
        'property-added': 1,
        'property-removed': 1,
        'array-item-added': 0,
        'array-item-removed': 0,
      },
    });
  });

  it('preserves duplicate-key occurrences and emits duplicate-aware paths', () => {
    const result = success(
      String.raw`{"a":1,"other":true,"\u0061":2,"a":3}`,
      '{"a":1,"a":20,"other":true,"new":0}',
    );

    expect(kinds(result)).toEqual(['value-changed', 'property-removed', 'property-added']);
    expect(result.differences.map((difference) => difference.pathText)).toEqual([
      '$["a"]#2',
      '$["a"]#3',
      '$["new"]',
    ]);
    expect(result.differences[0].path).toEqual([{ type: 'property', key: 'a', occurrence: 2 }]);
    expect(result.differences[0]).toMatchObject({ leftSnippet: '2', rightSnippet: '20' });
    expect(result.differences[1]).toMatchObject({ leftSnippet: '3', rightSnippet: null });
  });

  it('uses the exact occurrence for an added duplicate member', () => {
    const result = success('{"id":1}', '{"id":1,"id":9007199254740993}');

    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      kind: 'property-added',
      pathText: '$["id"]#2',
      leftSnippet: null,
      rightSnippet: '9007199254740993',
    });
  });
});

describe('compareJson number modes', () => {
  it('compares unsafe 64-bit-sized integers without Number rounding', () => {
    expect(success('9007199254740993', '9007199254740993').summary.totalDifferences).toBe(0);

    const result = success('9007199254740993', '9007199254740992');
    expect(result.differences).toEqual([
      expect.objectContaining({
        kind: 'value-changed',
        pathText: '$',
        leftSnippet: '9007199254740993',
        rightSnippet: '9007199254740992',
      }),
    ]);
  });

  it('treats equivalent decimal spellings as equal only in semantic mode', () => {
    expect(success('1', '1.0').summary.totalDifferences).toBe(0);
    expect(success('1e3', '1000.00').summary.totalDifferences).toBe(0);
    expect(success('-0', '0').summary.totalDifferences).toBe(0);

    const exact = success('1', '1.0', { numberMode: 'exact' });
    expect(exact.differences[0]).toMatchObject({
      kind: 'value-changed',
      leftSnippet: '1',
      rightSnippet: '1.0',
    });
    expect(success('-0', '0', { numberMode: 'exact' }).summary.totalDifferences).toBe(1);
  });

  it('normalizes enormous exponents exactly without floating-point overflow', () => {
    const hugeExponent = '9'.repeat(200);
    expect(success(`1e${hugeExponent}`, `10e${'9'.repeat(199)}8`).summary.totalDifferences).toBe(0);
    expect(success(`1e${hugeExponent}`, `1e${'9'.repeat(199)}8`).summary.totalDifferences).toBe(1);
  });
});

describe('compareJson array modes', () => {
  it('compares indexes and reports positional additions and removals', () => {
    const added = success('[1,{"x":2}]', '[1,{"x":3},9007199254740993]');
    expect(kinds(added)).toEqual(['value-changed', 'array-item-added']);
    expect(added.differences.map((difference) => difference.pathText)).toEqual([
      '$[1]["x"]',
      '$[2]',
    ]);
    expect(added.differences[1]).toMatchObject({
      leftPath: null,
      rightPathText: '$[2]',
      rightSnippet: '9007199254740993',
    });

    const removed = success('[1,2]', '[1]');
    expect(removed.differences[0]).toMatchObject({
      kind: 'array-item-removed',
      pathText: '$[1]',
      leftSnippet: '2',
      rightSnippet: null,
    });
  });

  it('compares unordered arrays as duplicate-preserving multisets', () => {
    const reordered = success(
      '[1,{"a":2,"b":[3,4]},1]',
      '[1.0,1,{"b":[4.0,3],"a":2.0}]',
      { arrayMode: 'unordered' },
    );
    expect(reordered.summary.totalDifferences).toBe(0);

    const multiplicity = success('[1,1,2]', '[1,2,2,3]', { arrayMode: 'unordered' });
    expect(kinds(multiplicity)).toEqual([
      'array-item-removed',
      'array-item-added',
      'array-item-added',
    ]);
    expect(multiplicity.differences.map((difference) => difference.pathText)).toEqual([
      '$[1]',
      '$[2]',
      '$[3]',
    ]);
    expect(multiplicity.differences.map(({ leftSnippet, rightSnippet }) => [leftSnippet, rightSnippet])).toEqual([
      ['1', null],
      [null, '2'],
      [null, '3'],
    ]);
  });

  it('honors exact number lexemes while matching unordered elements', () => {
    const result = success('[1,1]', '[1,1.0]', { arrayMode: 'unordered', numberMode: 'exact' });
    expect(kinds(result)).toEqual(['array-item-removed', 'array-item-added']);
    expect(result.differences[0]).toMatchObject({ leftSnippet: '1', rightSnippet: null });
    expect(result.differences[1]).toMatchObject({ leftSnippet: null, rightSnippet: '1.0' });
  });
});

describe('compareJson validation and result limits', () => {
  it('returns precise parse diagnostics for either or both invalid inputs', () => {
    const both = compareJson('{"x":}', '[1,]');
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.errors.map(({ side, error }) => [side, error.code, error.pathText])).toEqual([
      ['left', 'unexpected-token', '$["x"]'],
      ['right', 'trailing-comma', '$'],
    ]);

    const rightOnly = compareJson('{}', '{');
    expect(rightOnly.ok).toBe(false);
    if (!rightOnly.ok) expect(rightOnly.errors.map(({ side }) => side)).toEqual(['right']);
  });

  it('caps detailed results while still counting every difference by kind', () => {
    const result = success(
      '{"a":0,"b":0,"c":0,"d":0,"e":0}',
      '{"a":1,"b":1,"c":1,"d":1,"e":1}',
      { maxDifferences: 2 },
    );

    expect(result.differences.map((difference) => difference.pathText)).toEqual(['$["a"]', '$["b"]']);
    expect(result.summary).toMatchObject({
      totalDifferences: 5,
      returnedDifferences: 2,
      truncated: true,
      byKind: { 'value-changed': 5 },
    });
  });

  it('supports a zero detail limit without losing summary data', () => {
    const result = success('[0,0,0]', '[1,1,1]', { maxDifferences: -10 });
    expect(result.differences).toEqual([]);
    expect(result.summary).toMatchObject({
      totalDifferences: 3,
      returnedDifferences: 0,
      truncated: true,
      byKind: { 'value-changed': 3 },
    });
  });

  it('passes the configured parser depth bound to both documents', () => {
    const result = compareJson('[[0]]', '[[0]]', { maxDepth: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map(({ side, error }) => [side, error.code])).toEqual([
        ['left', 'max-depth-exceeded'],
        ['right', 'max-depth-exceeded'],
      ]);
    }
  });
});
