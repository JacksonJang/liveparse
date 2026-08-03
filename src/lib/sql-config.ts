export const MAX_SQL_INPUT_CHARACTERS = 50_000;
export const SQL_LARGE_INPUT_WARNING_CHARACTERS = 25_000;
export const MAX_SQL_OUTPUT_CHARACTERS = 200_000;

export const SQL_DIALECTS = [
  { id: 'sql', label: 'Standard SQL', note: 'Generic SQL subset; not automatic detection' },
  { id: 'mysql', label: 'MySQL', note: 'MySQL queries and backtick identifiers' },
  { id: 'mariadb', label: 'MariaDB', note: 'MariaDB-specific keywords and syntax' },
  { id: 'postgresql', label: 'PostgreSQL', note: 'PostgreSQL operators and extensions' },
  { id: 'sqlite', label: 'SQLite', note: 'SQLite statements and functions' },
  { id: 'transactsql', label: 'SQL Server / T-SQL', note: 'Microsoft Transact-SQL' },
  { id: 'bigquery', label: 'Google BigQuery', note: 'GoogleSQL for BigQuery' },
  { id: 'snowflake', label: 'Snowflake', note: 'Snowflake SQL syntax' },
  { id: 'redshift', label: 'Amazon Redshift', note: 'Redshift SQL syntax' },
  { id: 'plsql', label: 'Oracle PL/SQL', note: 'Oracle SQL and PL/SQL' },
  { id: 'duckdb', label: 'DuckDB', note: 'DuckDB SQL syntax' },
  { id: 'clickhouse', label: 'ClickHouse', note: 'ClickHouse SQL syntax' },
  { id: 'spark', label: 'Spark SQL', note: 'Apache Spark SQL' },
  { id: 'trino', label: 'Trino / Presto', note: 'Trino and Presto SQL' },
  { id: 'db2', label: 'IBM DB2', note: 'IBM DB2 SQL' },
] as const;

export type SqlDialectId = (typeof SQL_DIALECTS)[number]['id'];
export type SqlKeywordCase = 'preserve' | 'upper' | 'lower';
export type SqlLogicalOperatorNewline = 'before' | 'after';

export interface SqlFormatOptions {
  dialect: SqlDialectId;
  indentWidth: number;
  useTabs: boolean;
  keywordCase: SqlKeywordCase;
  logicalOperatorNewline: SqlLogicalOperatorNewline;
  expressionWidth: number;
  linesBetweenQueries: number;
  denseOperators: boolean;
  newlineBeforeSemicolon: boolean;
}

export const DEFAULT_SQL_FORMAT_OPTIONS: SqlFormatOptions = {
  dialect: 'sql',
  indentWidth: 2,
  useTabs: false,
  keywordCase: 'upper',
  logicalOperatorNewline: 'before',
  expressionWidth: 80,
  linesBetweenQueries: 2,
  denseOperators: false,
  newlineBeforeSemicolon: false,
};

const DIALECT_IDS = new Set<string>(SQL_DIALECTS.map((dialect) => dialect.id));

export function isSqlDialectId(value: string): value is SqlDialectId {
  return DIALECT_IDS.has(value);
}

export function textLineCount(value: string): number {
  if (value.length === 0) return 0;
  return value.split(/\r\n|\r|\n/).length;
}
