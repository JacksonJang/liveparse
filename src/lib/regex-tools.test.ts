import { describe, expect, it } from 'vitest';
import {
  RegexToolError,
  analyzeRegex,
  javascriptRegexSource,
  normalizeRegexFlags,
  regexHighlightSegments,
} from './regex-tools';

describe('regex analysis', () => {
  it('collects ordered matches and capture groups locally', () => {
    const result = analyzeRegex({
      pattern: '(?<year>\\d{4})-(?<month>\\d{2})',
      flags: 'g',
      text: '2026-09-15 and 2025-12-31',
    });

    expect(result.matchCount).toBe(2);
    expect(result.matches[0]).toMatchObject({ index: 0, end: 7, text: '2026-09' });
    expect(result.matches[0].groups).toEqual([
      { index: 1, name: 'year', text: '2026' },
      { index: 2, name: 'month', text: '09' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('replaces with JavaScript capture syntax and reports every match', () => {
    const result = analyzeRegex({
      pattern: '\\b(\\w+)@(example\\.com)\\b',
      flags: 'gi',
      text: 'ada@example.com and grace@example.com',
      replacement: '$1 at $2',
      maxMatches: 1,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.replacement).toBe('ada at example.com and grace at example.com');
  });

  it('handles zero-length matches without looping', () => {
    const result = analyzeRegex({ pattern: '\\b', flags: 'g', text: 'hi there' });
    expect(result.matchCount).toBe(4);
    expect(result.matches.map((match) => match.index)).toEqual([0, 2, 3, 8]);
  });

  it('normalizes flag order and reports invalid RegExp syntax precisely', () => {
    expect(normalizeRegexFlags(['u', 'i', 'g'])).toBe('giu');
    expect(() => analyzeRegex({ pattern: '(?', flags: '', text: 'x' })).toThrow(RegexToolError);
    expect(() => analyzeRegex({ pattern: 'x', flags: 'gg', text: 'x' })).toThrow(/at most once/);
  });

  it('exports executable JavaScript without breaking escaped slashes', () => {
    const source = javascriptRegexSource('https?://\\S+', 'gi');
    expect(source).toBe('new RegExp("https?://\\\\S+", "gi")');
    const expression = eval(source) as RegExp;
    expect(expression.test('Read https://liveparse.com today')).toBe(true);
  });
});

describe('regex highlighting', () => {
  it('builds non-overlapping highlighted segments', () => {
    const { matches } = analyzeRegex({ pattern: '\\d+', flags: 'g', text: 'abc123def45' });
    expect(regexHighlightSegments('abc123def45', matches).map((segment) => [
      segment.match?.text ?? null,
      segment.text,
    ])).toEqual([
      [null, 'abc'],
      ['123', '123'],
      [null, 'def'],
      ['45', '45'],
    ]);
  });

  it('caps rendering work without changing the selected matches', () => {
    const { matches } = analyzeRegex({ pattern: '\\w', flags: 'g', text: 'abcdef' });
    const segments = regexHighlightSegments('abcdef', matches, 3);
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.text).join('')).toBe('abc');
    expect(segments.every((segment) => segment.match !== null)).toBe(true);
    expect(matches).toHaveLength(6);
  });
});
