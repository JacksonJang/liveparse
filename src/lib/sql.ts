import {
  bigquery,
  clickhouse,
  db2,
  duckdb,
  formatDialect,
  mariadb,
  mysql,
  plsql,
  postgresql,
  redshift,
  snowflake,
  spark,
  sql,
  sqlite,
  transactsql,
  trino,
  type DialectOptions,
} from 'sql-formatter';
import {
  DEFAULT_SQL_FORMAT_OPTIONS,
  isSqlDialectId,
  MAX_SQL_INPUT_CHARACTERS,
  MAX_SQL_OUTPUT_CHARACTERS,
  type SqlDialectId,
  type SqlFormatOptions,
  type SqlKeywordCase,
  type SqlLogicalOperatorNewline,
} from './sql-config';

const MAX_FORMAT_ERROR_CHARACTERS = 300;
export const MAX_SQL_STRUCTURE_DEPTH = 128;
export const MAX_SQL_LAYOUT_COST = 150_000;

export type SqlFormatErrorCode =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'INPUT_TOO_COMPLEX'
  | 'OUTPUT_TOO_LARGE'
  | 'INVALID_DIALECT'
  | 'INVALID_OPTIONS'
  | 'FORMAT_FAILED';

export class SqlFormatError extends Error {
  readonly code: SqlFormatErrorCode;

  constructor(code: SqlFormatErrorCode, message: string) {
    super(message);
    this.name = 'SqlFormatError';
    this.code = code;
  }
}

const DIALECTS: Record<SqlDialectId, DialectOptions> = {
  sql,
  mysql,
  mariadb,
  postgresql,
  sqlite,
  transactsql,
  bigquery,
  snowflake,
  redshift,
  plsql,
  duckdb,
  clickhouse,
  spark,
  trino,
  db2,
};

const KEYWORD_CASES = new Set<SqlKeywordCase>(['preserve', 'upper', 'lower']);
const LOGICAL_NEWLINES = new Set<SqlLogicalOperatorNewline>(['before', 'after']);

function isSqlIdentifierCharacter(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || character === '_'
    || character === '$'
    || character === '#'
    || character === '@'
    || code >= 128;
}

function skipQuotedValue(input: string, start: number, quote: string, backslashEscapes: boolean): number {
  let cursor = start + 1;
  while (cursor < input.length) {
    if (backslashEscapes && input[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (input[cursor] === quote) {
      if (input[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return input.length;
}

function skipBracketIdentifier(input: string, start: number): number {
  let cursor = start + 1;
  while (cursor < input.length) {
    if (input[cursor] === ']') {
      if (input[cursor + 1] === ']') {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return input.length;
}

function skipBlockComment(input: string, start: number): number {
  let cursor = start + 2;
  let depth = 1;
  while (cursor < input.length && depth > 0) {
    if (input[cursor] === '/' && input[cursor + 1] === '*') {
      depth += 1;
      cursor += 2;
    } else if (input[cursor] === '*' && input[cursor + 1] === '/') {
      depth -= 1;
      cursor += 2;
    } else {
      cursor += 1;
    }
  }
  return cursor;
}

function skipPostgresqlDollarQuote(input: string, start: number): number | null {
  let delimiterEnd = start + 1;
  if (input[delimiterEnd] !== '$') {
    const firstTagCharacter = input[delimiterEnd];
    if (!firstTagCharacter
        || !((firstTagCharacter >= 'A' && firstTagCharacter <= 'Z')
          || (firstTagCharacter >= 'a' && firstTagCharacter <= 'z')
          || firstTagCharacter === '_')) {
      return null;
    }
    delimiterEnd += 1;
    while (delimiterEnd < input.length) {
      const character = input[delimiterEnd];
      const isTagCharacter = (character >= 'A' && character <= 'Z')
        || (character >= 'a' && character <= 'z')
        || (character >= '0' && character <= '9')
        || character === '_';
      if (!isTagCharacter) break;
      delimiterEnd += 1;
    }
    if (input[delimiterEnd] !== '$') return null;
  }

  const delimiter = input.slice(start, delimiterEnd + 1);
  const closingStart = input.indexOf(delimiter, delimiterEnd + 1);
  return closingStart === -1 ? null : closingStart + delimiter.length;
}

function assertSqlStructureWithinLimits(input: string, options: SqlFormatOptions): void {
  let parenthesisDepth = 0;
  let caseDepth = 0;
  let layoutCost = 0;
  let cursor = 0;
  const effectiveIndentWidth = options.useTabs ? 1 : options.indentWidth;
  const backslashStringEscapes = options.dialect === 'mysql'
    || options.dialect === 'mariadb'
    || options.dialect === 'bigquery'
    || options.dialect === 'clickhouse'
    || options.dialect === 'spark';
  const usesBracketIdentifiers = options.dialect === 'transactsql' || options.dialect === 'sqlite';

  const recordStructure = (closing: boolean, kind: 'parenthesis' | 'case'): void => {
    if (!closing) {
      if (kind === 'parenthesis') parenthesisDepth += 1;
      else caseDepth += 1;
    }

    const combinedDepth = parenthesisDepth + caseDepth;
    if (combinedDepth > MAX_SQL_STRUCTURE_DEPTH) {
      throw new SqlFormatError(
        'INPUT_TOO_COMPLEX',
        `SQL structure is limited to ${MAX_SQL_STRUCTURE_DEPTH} nested parentheses and CASE expressions to keep formatting memory bounded.`,
      );
    }
    layoutCost += combinedDepth * effectiveIndentWidth;
    if (layoutCost > MAX_SQL_LAYOUT_COST) {
      throw new SqlFormatError(
        'INPUT_TOO_COMPLEX',
        'SQL structure would require too much nested indentation to format safely. Split the query at verified statement boundaries.',
      );
    }

    if (closing) {
      if (kind === 'parenthesis') parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      else caseDepth = Math.max(0, caseDepth - 1);
    }
  };

  while (cursor < input.length) {
    const character = input[cursor];
    const nextCharacter = input[cursor + 1];

    if (character === "'") {
      cursor = skipQuotedValue(input, cursor, character, backslashStringEscapes);
      continue;
    }
    if (character === '"' || character === '`') {
      cursor = skipQuotedValue(input, cursor, character, character === '`' && backslashStringEscapes);
      continue;
    }
    if (usesBracketIdentifiers && character === '[') {
      cursor = skipBracketIdentifier(input, cursor);
      continue;
    }
    if (character === '-' && nextCharacter === '-') {
      const lineEnd = input.indexOf('\n', cursor + 2);
      cursor = lineEnd === -1 ? input.length : lineEnd + 1;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      cursor = skipBlockComment(input, cursor);
      continue;
    }
    if (options.dialect === 'postgresql' && character === '$') {
      const dollarQuoteEnd = skipPostgresqlDollarQuote(input, cursor);
      if (dollarQuoteEnd !== null) {
        cursor = dollarQuoteEnd;
        continue;
      }
    }
    if (character === '(') {
      recordStructure(false, 'parenthesis');
      cursor += 1;
      continue;
    }
    if (character === ')') {
      if (parenthesisDepth > 0) recordStructure(true, 'parenthesis');
      cursor += 1;
      continue;
    }
    if (isSqlIdentifierCharacter(character)) {
      const wordStart = cursor;
      cursor += 1;
      while (isSqlIdentifierCharacter(input[cursor])) cursor += 1;
      const word = input.slice(wordStart, cursor).toUpperCase();
      if (word === 'CASE') recordStructure(false, 'case');
      else if (word === 'END' && caseDepth > 0) recordStructure(true, 'case');
      continue;
    }
    cursor += 1;
  }
}

function integerInRange(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SqlFormatError('INVALID_OPTIONS', `${label} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function normalizeSqlFormatOptions(options: Partial<SqlFormatOptions> = {}): SqlFormatOptions {
  const normalized = { ...DEFAULT_SQL_FORMAT_OPTIONS, ...options };
  if (!isSqlDialectId(normalized.dialect)) {
    throw new SqlFormatError('INVALID_DIALECT', `Unsupported SQL dialect: ${String(normalized.dialect)}.`);
  }
  if (!KEYWORD_CASES.has(normalized.keywordCase)) {
    throw new SqlFormatError('INVALID_OPTIONS', 'Keyword case must be preserve, upper, or lower.');
  }
  if (!LOGICAL_NEWLINES.has(normalized.logicalOperatorNewline)) {
    throw new SqlFormatError('INVALID_OPTIONS', 'Logical operator newline must be before or after.');
  }
  if (typeof normalized.useTabs !== 'boolean'
      || typeof normalized.denseOperators !== 'boolean'
      || typeof normalized.newlineBeforeSemicolon !== 'boolean') {
    throw new SqlFormatError('INVALID_OPTIONS', 'Formatting switches must be boolean values.');
  }
  return {
    ...normalized,
    indentWidth: integerInRange(normalized.indentWidth, 1, 8, 'Indent width'),
    expressionWidth: integerInRange(normalized.expressionWidth, 20, 200, 'Expression width'),
    linesBetweenQueries: integerInRange(normalized.linesBetweenQueries, 1, 5, 'Lines between queries'),
  };
}

export function formatSqlText(input: string, options: Partial<SqlFormatOptions> = {}): string {
  if (typeof input !== 'string') {
    throw new SqlFormatError('INVALID_OPTIONS', 'SQL input must be text.');
  }
  if (input.trim().length === 0) {
    throw new SqlFormatError('EMPTY_INPUT', 'Paste a SQL query before formatting.');
  }
  if (input.length > MAX_SQL_INPUT_CHARACTERS) {
    throw new SqlFormatError(
      'INPUT_TOO_LARGE',
      `SQL input is limited to ${MAX_SQL_INPUT_CHARACTERS.toLocaleString('en-US')} characters to keep the browser responsive.`,
    );
  }

  const normalized = normalizeSqlFormatOptions(options);
  assertSqlStructureWithinLimits(input, normalized);
  try {
    const output = formatDialect(input, {
      dialect: DIALECTS[normalized.dialect],
      tabWidth: normalized.indentWidth,
      useTabs: normalized.useTabs,
      keywordCase: normalized.keywordCase,
      dataTypeCase: 'preserve',
      functionCase: 'preserve',
      identifierCase: 'preserve',
      logicalOperatorNewline: normalized.logicalOperatorNewline,
      expressionWidth: normalized.expressionWidth,
      linesBetweenQueries: normalized.linesBetweenQueries,
      denseOperators: normalized.denseOperators,
      newlineBeforeSemicolon: normalized.newlineBeforeSemicolon,
    });
    if (output.length > MAX_SQL_OUTPUT_CHARACTERS) {
      throw new SqlFormatError(
        'OUTPUT_TOO_LARGE',
        `Formatted output exceeded ${MAX_SQL_OUTPUT_CHARACTERS.toLocaleString('en-US')} characters and was discarded to keep the browser responsive.`,
      );
    }
    return output;
  } catch (error) {
    if (error instanceof SqlFormatError) throw error;
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim().split(/\r?\n/, 1)[0].slice(0, MAX_FORMAT_ERROR_CHARACTERS).replace(/\s+/g, ' ')
      : 'The selected formatter could not tokenize this input.';
    throw new SqlFormatError(
      'FORMAT_FAILED',
      `Formatting failed for the selected dialect. ${detail}`,
    );
  }
}
