import { describe, expect, it } from 'vitest';
import { parseLosslessJson, type JsonDocument } from './lossless-json';
import {
  buildTreeIndex,
  findTreeMatches,
  getContainerNodeIds,
  getKeyboardAnchorId,
  getRawNodeText,
  getTreePathInfo,
  getVisibleNodeIds,
  revealNodeAncestors,
} from './tree-utils';

function parse(source: string): JsonDocument {
  const result = parseLosslessJson(source);
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

describe('tree-utils', () => {
  const source = '{"a/b":{"~key":9007199254740993},"dup":1,"dup":2,"arr":[true,null]}';
  const index = buildTreeIndex(parse(source));

  it('builds an iterative preorder index with contiguous subtree ranges', () => {
    expect(index.entries).toHaveLength(8);
    expect(index.entries[0]).toMatchObject({ positionInSet: 1, setSize: 1 });
    expect(index.entries[1]).toMatchObject({ parentId: 0, depth: 1, positionInSet: 1, setSize: 4, subtreeEnd: 3 });
    expect(index.entries[2]).toMatchObject({ parentId: 1, depth: 2, positionInSet: 1, setSize: 1, subtreeEnd: 3 });
    expect(index.entries[5]).toMatchObject({ parentId: 0, depth: 1, positionInSet: 4, setSize: 4, subtreeEnd: 8 });
  });

  it('keeps only the root expanded by default and can expose all indexed rows', () => {
    expect(getVisibleNodeIds(index, new Set([index.rootId]))).toEqual([0, 1, 3, 4, 5]);
    expect(getVisibleNodeIds(index, getContainerNodeIds(index))).toHaveLength(index.entries.length);
  });

  it('creates RFC-safe JSONPath and JSON Pointer strings', () => {
    expect(getTreePathInfo(index, 2)).toEqual({
      jsonPath: '$["a/b"]["~key"]',
      pointer: '/a~1b/~0key',
      ambiguous: false,
    });
  });

  it('marks every occurrence of a duplicate path as ambiguous', () => {
    expect(getTreePathInfo(index, 3).ambiguous).toBe(true);
    expect(getTreePathInfo(index, 4).ambiguous).toBe(true);
  });

  it('copies the exact raw node span without coercing large numbers', () => {
    expect(getRawNodeText(index, 2)).toBe('9007199254740993');
  });

  it('searches decoded keys and scalar values by scope', () => {
    expect(findTreeMatches(index, 'dup', 'keys')).toEqual([3, 4]);
    expect(findTreeMatches(index, '9007199254740993', 'values')).toEqual([2]);
    expect(findTreeMatches(index, 'dup', 'values')).toEqual([]);
  });

  it('reveals only the ancestor chain for a match', () => {
    expect(revealNodeAncestors(index, 2, new Set())).toEqual(new Set([0, 1]));
  });

  it('keeps a rendered row in the keyboard tab order when selection is offscreen', () => {
    expect(getKeyboardAnchorId(20, [20, 21, 22])).toBe(20);
    expect(getKeyboardAnchorId(2, [20, 21, 22])).toBe(20);
    expect(getKeyboardAnchorId(2, [])).toBeUndefined();
  });
});
