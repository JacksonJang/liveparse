import { describe, expect, it } from 'vitest';
import { repairJson } from './json-repair';

function repaired(input: string) {
  const result = repairJson(input);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('JSON repair', () => {
  it('removes trailing commas from objects and arrays', () => {
    const result = repaired('{"items":[1,2,],"ok":true,}');
    expect(result.repaired).toBe('{"items":[1,2],"ok":true}');
    expect(result.changes.filter((change) => change.kind === 'remove-trailing-comma')).toHaveLength(2);
  });

  it('converts single-quoted keys and strings without losing apostrophes', () => {
    const result = repaired("{'message': 'don\'t stop', 'quote': 'say \"hi\"'}");
    expect(result.repaired).toBe('{"message": "don\'t stop", "quote": "say \\"hi\\""}');
    expect(result.assumptions.some((message) => message.includes('apostrophe'))).toBe(true);
  });

  it('removes line and block comments outside strings', () => {
    const result = repaired('{\n  // enabled\n  "ok": true, /* keep the URL */\n  "url": "https://example.com/x//y"\n}');
    expect(result.repaired).toMatch(/"ok": true/);
    expect(result.repaired).toMatch(/https:\/\/example\.com\/x\/\/y/);
    expect(result.changes.some((change) => change.kind === 'remove-line-comment')).toBe(true);
    expect(result.changes.some((change) => change.kind === 'remove-block-comment')).toBe(true);
  });

  it('ends line comments at LF, CRLF, or a standalone CR without deleting the next member', () => {
    for (const lineBreak of ['\n', '\r\n', '\r']) {
      const result = repaired(`{${lineBreak}// comment${lineBreak}"a":1${lineBreak}}`);
      expect(result.repaired).toContain('"a":1');
      const commentChanges = result.changes.filter((change) => change.kind === 'remove-line-comment');
      expect(commentChanges).toHaveLength(1);
      expect(commentChanges[0].location).toMatchObject({ line: 2, column: 1 });
      expect(result.diff.length).toBeGreaterThan(1);
    }
  });

  it('extracts a fenced JSON payload that uses standalone CR line endings', () => {
    const result = repaired('Result:\r```json\r{\r// comment\r"a": True,\r}\r```');
    expect(result.repaired).toContain('"a": true');
    expect(result.changes.some((change) => change.kind === 'remove-code-fence')).toBe(true);
    expect(result.changes.find((change) => change.kind === 'remove-line-comment')?.location.line).toBe(4);
    expect(result.diff.length).toBeGreaterThan(1);
  });

  it('replaces Python literals only outside strings', () => {
    const result = repaired("{'active': True, 'missing': None, 'disabled': False, 'label': 'True'}");
    expect(result.repaired).toBe('{"active": true, "missing": null, "disabled": false, "label": "True"}');
    expect(result.changes.filter((change) => change.kind === 'replace-python-literal')).toHaveLength(3);
  });

  it('extracts fenced JSON from prose and closes a truncated payload', () => {
    const result = repaired('Here is the tool result:\n```json\n{"answer":"ready","ids":[9007199254740993, 1e400,\n');
    expect(result.repaired).toBe('{"answer":"ready","ids":[9007199254740993, 1e400]}');
    expect(result.confidence).toBe('low');
    expect(result.assumptions.length).toBeGreaterThanOrEqual(2);
    expect(result.changes.some((change) => change.kind === 'close-container')).toBe(true);
  });

  it('removes a complete Markdown fence and prose around valid JSON', () => {
    const result = repaired('Result follows:\n```json\n{"ok": True,}\n```\nUse it carefully.');
    expect(result.repaired).toBe('{"ok": true}');
    expect(result.changes.some((change) => change.kind === 'remove-code-fence')).toBe(true);
    expect(result.changes.some((change) => change.kind === 'replace-python-literal')).toBe(true);
  });

  it('repairs the full nested LLM example used by the page', () => {
    const result = repaired(`Here is the JSON you requested:
\`\`\`json
{
  'request_id': 9007199254740993,
  'ok': True,
  'items': [
    {'name': 'alpha', 'score': 1e400},
    {'name': 'beta', 'score': 42},
  ],
  'metadata': {'source': 'assistant'`);
    expect(result.repaired).toContain('"request_id": 9007199254740993');
    expect(result.repaired).toContain('"metadata": {"source": "assistant"}}');
    expect(result.losslessWarnings.some((warning) => warning.code === 'unsafe-integer')).toBe(true);
    expect(result.losslessWarnings.some((warning) => warning.code === 'number-overflow')).toBe(true);
  });

  it('preserves numeric lexemes and duplicate members through lossless validation', () => {
    const result = repaired('{"id":9007199254740993,"huge":1e400,"a":1,"a":2,}');
    expect(result.repaired).toContain('9007199254740993');
    expect(result.repaired).toContain('1e400');
    expect(result.repaired).toContain('"a":1,"a":2');
    expect(result.losslessWarnings.some((warning) => warning.code === 'unsafe-integer')).toBe(true);
    expect(result.losslessWarnings.some((warning) => warning.code === 'number-overflow')).toBe(true);
    expect(result.losslessWarnings.some((warning) => warning.code === 'duplicate-key')).toBe(true);
  });

  it('marks an ambiguous missing value as low confidence', () => {
    const result = repaired('{"status":');
    expect(result.repaired).toBe('{"status": null}');
    expect(result.confidence).toBe('low');
    expect(result.changes.some((change) => change.kind === 'insert-missing-value')).toBe(true);
  });

  it('rejects malformed content it cannot repair', () => {
    const result = repairJson('{"a": 1 "b": 2}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/comma|unexpected|expected/i);
  });

  it('does not execute JavaScript expressions', () => {
    const scope = globalThis as typeof globalThis & { __liveParseRepairExecuted?: boolean };
    scope.__liveParseRepairExecuted = false;
    const result = repairJson('{"value": (globalThis.__liveParseRepairExecuted = true)}');
    expect(result.ok).toBe(false);
    expect(scope.__liveParseRepairExecuted).toBe(false);
    delete scope.__liveParseRepairExecuted;
  });

  it('returns a before-and-after diff with changed fragments', () => {
    const result = repaired('{\n  "ok": True,\n}');
    expect(result.diff.some((row) => row.kind !== 'equal')).toBe(true);
    expect(result.diff.some((row) => [...row.before, ...row.after].some((fragment) => fragment.changed))).toBe(true);
  });

  it('rejects prose with no identifiable JSON value', () => {
    const result = repairJson('The model did not return structured data this time.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No JSON/);
  });
});
