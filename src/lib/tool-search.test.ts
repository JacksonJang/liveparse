import { describe, expect, it } from 'vitest';
import { filterTools, normalizeToolSearchQuery, toolMatchesQuery } from './tool-search';

const tools = [
  { id: 'json', text: 'JSON Formatter validate format browser' },
  { id: 'yaml', text: 'YAML Formatter validate convert browser' },
  { id: 'timestamp', text: 'Unix Timestamp Converter epoch milliseconds' },
];

describe('homepage tool search', () => {
  it('matches all whitespace-separated terms and ignores case', () => {
    expect(toolMatchesQuery(tools[0], ' JSON validate ')).toBe(true);
    expect(toolMatchesQuery(tools[0], 'json xml')).toBe(false);
  });

  it('returns the complete catalog for an empty query', () => {
    expect(filterTools(tools, '   ').matches).toEqual(tools);
  });

  it('narrows to relevant tools while preserving source order', () => {
    const result = filterTools(tools, 'converter epoch');
    expect(result.matches.map((tool) => tool.id)).toEqual(['timestamp']);
    expect(result.query).toBe('converter epoch');
  });

  it('normalizes repeated separators into search terms', () => {
    expect(normalizeToolSearchQuery('  YAML\t\nFORMATTER  ')).toEqual(['yaml', 'formatter']);
  });
});
