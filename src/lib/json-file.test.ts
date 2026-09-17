import { describe, expect, it } from 'vitest';
import { isLikelyJsonFile, selectJsonDropFile } from './json-file';

function file(name: string, type = ''): File {
  return new File(['{}'], name, { type });
}

describe('JSON file opening', () => {
  it('accepts JSON extensions and JSON or text MIME types', () => {
    expect(isLikelyJsonFile(file('data.JSON'))).toBe(true);
    expect(isLikelyJsonFile(file('events.jsonl'))).toBe(true);
    expect(isLikelyJsonFile(file('response', 'application/json'))).toBe(true);
    expect(isLikelyJsonFile(file('payload.yml', 'application/x-yaml'))).toBe(false);
  });

  it('allows one likely JSON drop and rejects ambiguous multiple drops', () => {
    expect(selectJsonDropFile(null)).toBeNull();
    expect(selectJsonDropFile([file('api.json')])).toBeInstanceOf(File);
    expect(selectJsonDropFile([file('a.json'), file('b.json')])).toBeInstanceOf(Error);
  });

  it('explains rejection without exposing the full path', () => {
    const error = selectJsonDropFile([file('image.png', 'image/png')]);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('image.png');
  });
});
