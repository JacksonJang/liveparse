import { describe, expect, it } from 'vitest';
import {
  formatSqlText,
  MAX_SQL_STRUCTURE_DEPTH,
  normalizeSqlFormatOptions,
  SqlFormatError,
} from './sql';
import {
  DEFAULT_SQL_FORMAT_OPTIONS,
  isSqlDialectId,
  MAX_SQL_INPUT_CHARACTERS,
  SQL_DIALECTS,
  textLineCount,
} from './sql-config';

describe('formatSqlText', () => {
  it('formats a common SQL query with deterministic uppercase keywords', () => {
    const output = formatSqlText('select id,name from users where active=true order by name;', {
      dialect: 'sql',
      keywordCase: 'upper',
      indentWidth: 2,
    });

    expect(output).toContain('SELECT');
    expect(output).toMatch(/FROM\s+users/);
    expect(output).toMatch(/WHERE\s+active = TRUE/);
    expect(output).toContain('ORDER BY');
  });

  it.each([
    ['mysql', 'select `order`,json_extract(payload,"$.id") from `events` limit 5;'],
    ['postgresql', 'select id,total from orders where payload @> \'{"paid":true}\'::jsonb;'],
    ['bigquery', 'select user_id,count(*) from `demo.events` group by user_id qualify row_number() over(order by user_id)=1;'],
    ['transactsql', 'select top (10) [OrderID] from [Sales].[Orders] order by [OrderID] desc;'],
  ] as const)('formats %s without changing dialect-specific quoted text', (dialect, input) => {
    const output = formatSqlText(input, { dialect });
    expect(output.length).toBeGreaterThan(input.length / 2);
    if (dialect === 'mysql') expect(output).toContain('`order`');
    if (dialect === 'postgresql') expect(output).toContain('jsonb');
    if (dialect === 'bigquery') expect(output).toContain('`demo.events`');
    if (dialect === 'transactsql') expect(output).toContain('[OrderID]');
  });

  it.each(SQL_DIALECTS)('formats idempotently with the $label profile', ({ id }) => {
    const once = formatSqlText('select id,count(*) as total from events group by id order by total desc;', { dialect: id });
    const twice = formatSqlText(once, { dialect: id });
    expect(twice).toBe(once);
  });

  it('preserves comments and quoted whitespace while reformatting layout', () => {
    const output = formatSqlText("select 'a  b' as value,-- keep this\ncount(*) from logs;", { dialect: 'sql' });
    expect(output).toContain("'a  b'");
    expect(output).toContain('-- keep this');
  });

  it('rejects empty and oversized input before invoking the formatter', () => {
    expect(() => formatSqlText('   ')).toThrowError(SqlFormatError);
    expect(() => formatSqlText('x'.repeat(MAX_SQL_INPUT_CHARACTERS + 1))).toThrow(/limited/i);
  });

  it('allows 128 nested structures and rejects the 129th before formatting', () => {
    const allowed = `select ${'('.repeat(MAX_SQL_STRUCTURE_DEPTH)}1${')'.repeat(MAX_SQL_STRUCTURE_DEPTH)};`;
    expect(() => formatSqlText(allowed, { indentWidth: 8, expressionWidth: 20 })).not.toThrow();

    const rejected = `select ${'('.repeat(MAX_SQL_STRUCTURE_DEPTH + 1)}1${')'.repeat(MAX_SQL_STRUCTURE_DEPTH + 1)};`;
    try {
      formatSqlText(rejected);
      throw new Error('Expected excessive SQL nesting to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(SqlFormatError);
      expect((error as SqlFormatError).code).toBe('INPUT_TOO_COMPLEX');
    }
  });

  it('rejects parenthesis and CASE output amplifiers before invoking the formatter', () => {
    const parenthesisAmplifier = `select ${'('.repeat(750)}1${')'.repeat(750)};`;
    const caseAmplifier = `select ${'case when 1=1 then '.repeat(1_000)}1${' end'.repeat(1_000)};`;

    for (const input of [parenthesisAmplifier, caseAmplifier]) {
      try {
        formatSqlText(input, { indentWidth: 4, expressionWidth: 40 });
        throw new Error('Expected amplified SQL structure to be rejected.');
      } catch (error) {
        expect(error).toBeInstanceOf(SqlFormatError);
        expect((error as SqlFormatError).code).toBe('INPUT_TOO_COMPLEX');
      }
    }
  });

  it('applies the cumulative nested-layout budget across separate expressions', () => {
    const group = `${'('.repeat(MAX_SQL_STRUCTURE_DEPTH)}1${')'.repeat(MAX_SQL_STRUCTURE_DEPTH)}`;
    expect(() => formatSqlText(`select ${group},${group};`, {
      indentWidth: 8,
      expressionWidth: 20,
    })).toThrowError(expect.objectContaining({ code: 'INPUT_TOO_COMPLEX' }));
  });

  it('ignores parentheses inside strings, quoted identifiers, comments, and PostgreSQL dollar quotes', () => {
    const ignored = '('.repeat(MAX_SQL_STRUCTURE_DEPTH + 20);
    const statements: Array<[string, Parameters<typeof formatSqlText>[1]]> = [
      [`select '${ignored}' as value;`, { dialect: 'sql' }],
      [`select "${ignored}" from records;`, { dialect: 'postgresql' }],
      [`select \`${ignored}\` from records;`, { dialect: 'mysql' }],
      [`select [${ignored}] from records;`, { dialect: 'transactsql' }],
      [`-- ${ignored}\nselect 1; /* ${ignored} */`, { dialect: 'sql' }],
      [`select $payload$${ignored}$payload$ as value;`, { dialect: 'postgresql' }],
    ];

    for (const [input, options] of statements) {
      expect(() => formatSqlText(input, options)).not.toThrow();
    }
  });

  it('caps amplified upstream parser errors before they reach the UI', () => {
    expect.assertions(2);
    try {
      formatSqlText(`SELECT (${Array.from({ length: 90 }, () => '(').join('')}`);
    } catch (error) {
      expect(error).toBeInstanceOf(SqlFormatError);
      expect((error as Error).message.length).toBeLessThanOrEqual(380);
    }
  });

  it('rejects unsupported dialects and out-of-range controls', () => {
    expect(isSqlDialectId('postgresql')).toBe(true);
    expect(isSqlDialectId('oracle')).toBe(false);
    expect(() => normalizeSqlFormatOptions({ dialect: 'oracle' as never })).toThrow(/unsupported/i);
    expect(() => normalizeSqlFormatOptions({ indentWidth: 0 })).toThrow(/indent width/i);
    expect(() => normalizeSqlFormatOptions({ expressionWidth: 201 })).toThrow(/expression width/i);
  });

  it('does not mutate the shared default options', () => {
    const normalized = normalizeSqlFormatOptions({ dialect: 'mysql', keywordCase: 'lower' });
    expect(normalized.dialect).toBe('mysql');
    expect(DEFAULT_SQL_FORMAT_OPTIONS.dialect).toBe('sql');
    expect(DEFAULT_SQL_FORMAT_OPTIONS.keywordCase).toBe('upper');
  });
});

describe('textLineCount', () => {
  it('handles empty, LF, CRLF, and trailing lines consistently', () => {
    expect(textLineCount('')).toBe(0);
    expect(textLineCount('one')).toBe(1);
    expect(textLineCount('one\ntwo')).toBe(2);
    expect(textLineCount('one\r\ntwo\r\n')).toBe(3);
  });
});
