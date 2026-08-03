import { describe, expect, it } from 'vitest';
import { csvToJson, jsonToCsv, parseCsv } from './tabular';

describe('parseCsv', () => {
  it('parses quoted delimiters, escaped quotes, and multiline cells', () => {
    const result = parseCsv('name,note\r\nAda,"hello, ""world"""\r\nLin,"two\r\nlines"');
    expect(result).toEqual({
      ok: true,
      rows: [
        ['name', 'note'],
        ['Ada', 'hello, "world"'],
        ['Lin', 'two\nlines'],
      ],
    });
  });

  it('reports an unclosed quoted field with its location', () => {
    const result = parseCsv('name,note\nAda,"broken');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not closed');
      expect(result.error.location.line).toBe(2);
    }
  });
});

describe('jsonToCsv', () => {
  it('flattens objects, preserves number tokens, and quotes CSV safely', () => {
    const result = jsonToCsv(`[
      {"id":9007199254740993,"name":"Ada","address":{"city":"Seoul"}},
      {"id":1.2300,"name":"Lin, Jr.","address":{"city":"Busan"}}
    ]`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv).toBe([
      'id,name,address.city',
      '9007199254740993,Ada,Seoul',
      '1.2300,"Lin, Jr.",Busan',
    ].join('\r\n'));
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('keeps duplicate keys in separate columns and protects formulas', () => {
    const result = jsonToCsv('{"code":"=1+1","code":"safe"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv).toBe("code,code #2\r\n'=1+1,safe");
  });

  it('keeps literal hash-suffix keys distinct from duplicate-key columns', () => {
    const result = jsonToCsv('{"code #2":"literal","code":"first","code":"second"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv).toBe('code \\#2,code,code #2\r\nliteral,first,second');
  });

  it('protects formula-like strings without changing negative JSON numbers', () => {
    const result = jsonToCsv('[{"debit":-1,"text":"-1"}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv).toBe("debit,text\r\n-1,'-1");
  });

  it('supports semicolon-delimited output', () => {
    const result = jsonToCsv('[{"value":"a;b"}]', { delimiter: ';' });
    expect(result.ok && result.csv).toBe('value\r\n"a;b"');
  });

  it('quotes a one-column empty value so a CSV round trip keeps the row', () => {
    const exported = jsonToCsv('[""]');
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.csv).toBe('$value\r\n""');

    const imported = csvToJson(exported.csv);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(JSON.parse(imported.json)).toEqual([{ $value: '' }]);
  });
});

describe('csvToJson', () => {
  it('uses unique headers and keeps cells as strings by default', () => {
    const result = csvToJson('id,id,\n9007199254740993,2,hello');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual([
      { id: '9007199254740993', id_2: '2', column_3: 'hello' },
    ]);
  });

  it('can infer JSON literals without changing their token spelling', () => {
    const result = csvToJson('active,count,ratio,empty\ntrue,9007199254740993,1.2300,', { inferTypes: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.json).toContain('"active": true');
    expect(result.json).toContain('"count": 9007199254740993');
    expect(result.json).toContain('"ratio": 1.2300');
    expect(result.json).toContain('"empty": ""');
  });

  it('preserves rows made entirely of empty cells', () => {
    const result = csvToJson('first,second,third\n,,');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual([{ first: '', second: '', third: '' }]);
  });

  it('distinguishes a quoted empty record from a blank physical line', () => {
    const result = csvToJson('value\n\n""\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual([{ value: '' }]);
  });
});
