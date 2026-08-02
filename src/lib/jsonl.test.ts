import { describe, expect, it } from 'vitest';
import {
  createJsonlTableRows,
  discoverJsonlColumns,
  filterJsonlRecords,
  getJsonlCell,
  jsonlRecordsToCsv,
  parseJsonl,
  protectSpreadsheetFormula,
  quoteCsvField,
  serializeJsonlRecords,
} from './jsonl';

describe('parseJsonl', () => {
  it('parses physical lines independently and reports exact global errors', () => {
    const source = [
      '{"id":9007199254740993}',
      '  ',
      '{"bad":1,}',
      '{"a":1,"\\u0061":2}',
      '',
    ].join('\r\n');
    const result = parseJsonl(source);

    expect(result.summary).toEqual({
      detection: 'jsonl',
      totalLines: 4,
      nonEmptyLines: 3,
      validLines: 2,
      errorLines: 1,
      blankLines: 1,
      warningCount: 3,
      characters: source.length,
    });
    expect(result.errors[0]).toMatchObject({
      code: 'trailing-comma',
      lineNumber: 3,
      column: 9,
      pathText: '$',
    });
    expect(result.errors[0].offset).toBe(source.indexOf(',}'));
    expect(source.slice(result.errors[0].globalRange.start, result.errors[0].globalRange.end)).toBe(',');
    expect(result.warnings.map((warning) => [warning.code, warning.lineNumber])).toEqual([
      ['unsafe-integer', 1],
      ['number-representation-change', 1],
      ['duplicate-key', 4],
    ]);
    expect(result.records[0].document.root).toMatchObject({ type: 'object' });
  });

  it('recognizes JSONL, a regular multi-line JSON document, one record, and empty input', () => {
    expect(parseJsonl('{"a":1}\n{"a":2}').summary.detection).toBe('jsonl');
    expect(parseJsonl('{\n  "a": 1\n}').summary.detection).toBe('json');
    expect(parseJsonl('{"a":1}').summary.detection).toBe('single-record');
    expect(parseJsonl(' \n\t\n').summary.detection).toBe('empty');
  });

  it('does not treat non-JSON Unicode whitespace as a blank line', () => {
    const result = parseJsonl('\u00a0');
    expect(result.summary.blankLines).toBe(0);
    expect(result.summary.errorLines).toBe(1);
    expect(result.errors[0].code).toBe('unexpected-token');
  });

  it('keeps each valid record serialized with exact numeric and duplicate lexemes', () => {
    const source = [
      '{"snowflake":9007199254740993,"overflow":1e400}',
      '{"a":1,"a":2}',
    ].join('\n');
    const result = parseJsonl(source);
    expect(serializeJsonlRecords(result.records)).toBe(source);
    expect(result.summary.warningCount).toBe(4);
  });
});

describe('JSONL table and filtering helpers', () => {
  const dataset = parseJsonl([
    '{"id":9007199254740993,"profile":{"name":"Ada"},"status":"active"}',
    '{"id":2,"id":3,"tags":["billing","priority"],"status":"paused"}',
    'true',
  ].join('\n'));

  it('discovers ordered columns without collapsing duplicate keys', () => {
    const discovery = discoverJsonlColumns(dataset.records);
    expect(discovery.columns.map((column) => column.label)).toEqual([
      'id',
      'profile',
      'status',
      'id #2',
      'tags',
      '$value',
    ]);
    expect(discovery.totalColumns).toBe(6);
    expect(discovery.truncated).toBe(false);

    const limited = discoverJsonlColumns(dataset.records, 3);
    expect(limited.columns).toHaveLength(3);
    expect(limited).toMatchObject({ totalColumns: 6, truncated: true });
  });

  it('keeps table and CSV header labels unique when real keys resemble generated labels', () => {
    const collisionDataset = parseJsonl([
      '{"id":1,"id":2,"id #2":3,"$value":"member"}',
      'true',
    ].join('\n'));
    const columns = discoverJsonlColumns(collisionDataset.records).columns;
    const labels = columns.map((column) => column.label);

    expect(labels).toEqual(['id', 'id #2', 'id #2 (2)', '$value', '$value (2)']);
    expect(new Set(labels).size).toBe(labels.length);
    expect(jsonlRecordsToCsv(collisionDataset.records).split('\r\n')[0]).toBe(labels.join(','));
  });

  it('uses exact number lexemes and lossless compact JSON for nested cells', () => {
    const columns = discoverJsonlColumns(dataset.records).columns;
    const id = columns.find((column) => column.label === 'id')!;
    const profile = columns.find((column) => column.label === 'profile')!;
    const duplicateId = columns.find((column) => column.label === 'id #2')!;
    expect(getJsonlCell(dataset.records[0], id)).toBe('9007199254740993');
    expect(getJsonlCell(dataset.records[0], profile)).toBe('{"name":"Ada"}');
    expect(getJsonlCell(dataset.records[1], duplicateId)).toBe('3');
  });

  it('filters case-insensitive decoded keys, values, raw number tokens, and nested values', () => {
    expect(filterJsonlRecords(dataset.records, 'PROFILE').map((record) => record.lineNumber)).toEqual([1]);
    expect(filterJsonlRecords(dataset.records, 'ada').map((record) => record.lineNumber)).toEqual([1]);
    expect(filterJsonlRecords(dataset.records, '9007199254740993').map((record) => record.lineNumber)).toEqual([1]);
    expect(filterJsonlRecords(dataset.records, 'priority').map((record) => record.lineNumber)).toEqual([2]);
    expect(filterJsonlRecords(dataset.records, 'true').map((record) => record.lineNumber)).toEqual([3]);
    expect(filterJsonlRecords(dataset.records, 'missing')).toEqual([]);
  });

  it('creates only the requested row window for virtualized rendering', () => {
    const columns = discoverJsonlColumns(dataset.records).columns;
    const rows = createJsonlTableRows(dataset.records, columns, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recordIndex: 1, lineNumber: 2, warningCount: 1 });
  });
});

describe('safe CSV export', () => {
  it.each([
    ['=2+3', "'=2+3"],
    ['  @SUM(A1:A2)', "'  @SUM(A1:A2)"],
    ['-42', "'-42"],
    ['plain', 'plain'],
  ])('protects spreadsheet formula input %j', (value, expected) => {
    expect(protectSpreadsheetFormula(value)).toBe(expected);
  });

  it('uses RFC-style field quoting', () => {
    expect(quoteCsvField('plain')).toBe('plain');
    expect(quoteCsvField('a,b')).toBe('"a,b"');
    expect(quoteCsvField('a"b')).toBe('"a""b"');
    expect(quoteCsvField('a\nb')).toBe('"a\nb"');
  });

  it('exports decoded strings, exact numbers, and lossless nested JSON safely', () => {
    const result = parseJsonl([
      String.raw`{"name":"=2+3","id":9007199254740993,"nested":{"n":1e400},"note":"a,b"}`,
      String.raw`{"name":"Ada","id":2,"nested":{"a":1,"a":2},"note":"line\nbreak"}`,
    ].join('\n'));
    const csv = jsonlRecordsToCsv(result.records);
    expect(csv).toBe([
      'name,id,nested,note',
      "'=2+3,9007199254740993,\"{\"\"n\"\":1e400}\",\"a,b\"",
      'Ada,2,"{""a"":1,""a"":2}","line\nbreak"',
    ].join('\r\n'));
  });

  it('can export only a filtered record set and uses LF when requested', () => {
    const result = parseJsonl('{"kind":"keep"}\n{"kind":"drop"}');
    const filtered = filterJsonlRecords(result.records, 'keep');
    expect(jsonlRecordsToCsv(filtered, { lineEnding: '\n' })).toBe('kind\nkeep');
  });
});
