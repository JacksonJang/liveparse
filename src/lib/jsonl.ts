import {
  parseLosslessJson,
  serializeLosslessJson,
  type JsonDocument,
  type JsonNode,
  type JsonParseErrorCode,
  type JsonSourceRange,
  type JsonWarning,
} from './lossless-json';

export type JsonlDetection = 'empty' | 'jsonl' | 'json' | 'single-record';

export interface JsonlRecord {
  /** Zero-based index among valid records. */
  index: number;
  /** One-based physical source line. */
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  document: JsonDocument;
}

export interface JsonlLineError {
  code: JsonParseErrorCode;
  message: string;
  lineNumber: number;
  /** One-based UTF-16 column within the physical line. */
  column: number;
  /** Global zero-based UTF-16 offset. */
  offset: number;
  localRange: JsonSourceRange;
  globalRange: JsonSourceRange;
  pathText: string;
  sourcePreview: string;
}

export interface JsonlLineWarning {
  code: JsonWarning['code'];
  message: string;
  lineNumber: number;
  column: number;
  offset: number;
  localRange: JsonSourceRange;
  globalRange: JsonSourceRange;
  pathText: string;
}

export interface JsonlSummary {
  detection: JsonlDetection;
  totalLines: number;
  nonEmptyLines: number;
  validLines: number;
  errorLines: number;
  blankLines: number;
  warningCount: number;
  characters: number;
}

export interface JsonlParseResult {
  summary: JsonlSummary;
  records: JsonlRecord[];
  errors: JsonlLineError[];
  warnings: JsonlLineWarning[];
}

export interface JsonlColumn {
  id: string;
  kind: 'property' | 'root';
  label: string;
  key?: string;
  occurrence?: number;
}

export interface JsonlColumnDiscovery {
  columns: JsonlColumn[];
  totalColumns: number;
  truncated: boolean;
}

export interface JsonlTableRow {
  recordIndex: number;
  lineNumber: number;
  warningCount: number;
  cells: string[];
}

export interface JsonlCsvOptions {
  columns?: JsonlColumn[];
  includeHeader?: boolean;
  protectSpreadsheetFormulas?: boolean;
  lineEnding?: '\r\n' | '\n';
}

export type JsonlWorkerRequest =
  | { type: 'parse'; requestId: number; source: string }
  | { type: 'filter'; requestId: number; datasetId: number; query: string }
  | { type: 'page'; requestId: number; datasetId: number; start: number; count: number }
  | {
      type: 'export';
      requestId: number;
      datasetId: number;
      format: 'csv' | 'jsonl';
      scope: 'all' | 'filtered';
      /** The current UI filter, so export never depends on a debounced prior filter request. */
      query: string;
    };

export type JsonlWorkerResponse =
  | {
      type: 'parsed';
      requestId: number;
      datasetId: number;
      summary: JsonlSummary;
      columns: JsonlColumn[];
      totalColumns: number;
      columnsTruncated: boolean;
      errors: JsonlLineError[];
      errorsTruncated: boolean;
      warnings: JsonlLineWarning[];
      warningsTruncated: boolean;
    }
  | {
      type: 'filtered';
      requestId: number;
      datasetId: number;
      query: string;
      totalRecords: number;
    }
  | {
      type: 'page';
      requestId: number;
      datasetId: number;
      start: number;
      totalRecords: number;
      rows: JsonlTableRow[];
    }
  | {
      type: 'exported';
      requestId: number;
      datasetId: number;
      format: 'csv' | 'jsonl';
      scope: 'all' | 'filtered';
      content: string;
      recordCount: number;
    }
  | {
      type: 'failed';
      requestId: number;
      datasetId?: number;
      message: string;
    };

interface PhysicalLine {
  lineNumber: number;
  start: number;
  end: number;
  text: string;
}

function splitPhysicalLines(source: string): PhysicalLine[] {
  if (source.length === 0) return [];
  const lines: PhysicalLine[] = [];
  let lineStart = 0;
  let lineNumber = 1;

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code !== 10 && code !== 13) continue;
    lines.push({
      lineNumber,
      start: lineStart,
      end: index,
      text: source.slice(lineStart, index),
    });
    if (code === 13 && source.charCodeAt(index + 1) === 10) index += 1;
    lineStart = index + 1;
    lineNumber += 1;
  }

  // A final line terminator closes the preceding record; it does not create a
  // phantom blank record. Consecutive terminators still produce real blanks.
  if (lineStart < source.length) {
    lines.push({
      lineNumber,
      start: lineStart,
      end: source.length,
      text: source.slice(lineStart),
    });
  }
  return lines;
}

function isBlankLine(text: string): boolean {
  return /^[\t ]*$/.test(text);
}

function previewLine(text: string, limit = 180): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

export function parseJsonl(source: string): JsonlParseResult {
  const lines = splitPhysicalLines(source);
  const records: JsonlRecord[] = [];
  const errors: JsonlLineError[] = [];
  const warnings: JsonlLineWarning[] = [];
  let blankLines = 0;

  for (const line of lines) {
    if (isBlankLine(line.text)) {
      blankLines += 1;
      continue;
    }

    const parsed = parseLosslessJson(line.text);
    if (!parsed.ok) {
      errors.push({
        code: parsed.error.code,
        message: parsed.error.message,
        lineNumber: line.lineNumber,
        column: parsed.error.location.column,
        offset: line.start + parsed.error.location.offset,
        localRange: parsed.error.range,
        globalRange: {
          start: line.start + parsed.error.range.start,
          end: line.start + parsed.error.range.end,
        },
        pathText: parsed.error.pathText,
        sourcePreview: previewLine(line.text),
      });
      continue;
    }

    const record: JsonlRecord = {
      index: records.length,
      lineNumber: line.lineNumber,
      startOffset: line.start,
      endOffset: line.end,
      document: parsed.document,
    };
    records.push(record);
    for (const warning of parsed.document.warnings) {
      warnings.push({
        code: warning.code,
        message: warning.message,
        lineNumber: line.lineNumber,
        column: warning.location.column,
        offset: line.start + warning.location.offset,
        localRange: warning.range,
        globalRange: {
          start: line.start + warning.range.start,
          end: line.start + warning.range.end,
        },
        pathText: warning.pathText,
      });
    }
  }

  const nonEmptyLines = lines.length - blankLines;
  let detection: JsonlDetection;
  if (nonEmptyLines === 0) {
    detection = 'empty';
  } else if (nonEmptyLines === 1 && records.length === 1) {
    detection = 'single-record';
  } else {
    const wholeDocument = parseLosslessJson(source);
    detection = wholeDocument.ok ? 'json' : 'jsonl';
  }

  return {
    summary: {
      detection,
      totalLines: lines.length,
      nonEmptyLines,
      validLines: records.length,
      errorLines: errors.length,
      blankLines,
      warningCount: warnings.length,
      characters: source.length,
    },
    records,
    errors,
    warnings,
  };
}

function propertyColumnId(key: string, occurrence: number): string {
  return `property:${JSON.stringify([key, occurrence])}`;
}

const ROOT_COLUMN_ID = 'root:$value';

function uniqueColumnLabel(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let suffix = 2;
  let candidate = `${preferred} (${suffix})`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${preferred} (${suffix})`;
  }
  used.add(candidate);
  return candidate;
}

export function discoverJsonlColumns(
  records: readonly JsonlRecord[],
  maxColumns = Number.POSITIVE_INFINITY,
): JsonlColumnDiscovery {
  const columns: JsonlColumn[] = [];
  const seen = new Set<string>();
  const usedLabels = new Set<string>();

  for (const record of records) {
    const root = record.document.root;
    if (root.type !== 'object') {
      if (!seen.has(ROOT_COLUMN_ID)) {
        seen.add(ROOT_COLUMN_ID);
        columns.push({
          id: ROOT_COLUMN_ID,
          kind: 'root',
          label: uniqueColumnLabel('$value', usedLabels),
        });
      }
      continue;
    }
    for (const member of root.members) {
      const id = propertyColumnId(member.key.value, member.occurrence);
      if (seen.has(id)) continue;
      seen.add(id);
      columns.push({
        id,
        kind: 'property',
        key: member.key.value,
        occurrence: member.occurrence,
        label: uniqueColumnLabel(
          member.occurrence === 1 ? member.key.value : `${member.key.value} #${member.occurrence}`,
          usedLabels,
        ),
      });
    }
  }

  if (columns.length === 0) {
    columns.push({ id: ROOT_COLUMN_ID, kind: 'root', label: uniqueColumnLabel('$value', usedLabels) });
  }
  const safeLimit = Number.isFinite(maxColumns) ? Math.max(0, Math.floor(maxColumns)) : columns.length;
  return {
    columns: columns.slice(0, safeLimit),
    totalColumns: columns.length,
    truncated: columns.length > safeLimit,
  };
}

export function jsonNodeToCell(node: JsonNode): string {
  switch (node.type) {
    case 'string': return node.value;
    case 'number': return node.raw;
    case 'boolean': return node.value ? 'true' : 'false';
    case 'null': return 'null';
    case 'array':
    case 'object': return serializeLosslessJson(node, { indent: 0 });
  }
}

export function getJsonlCell(record: JsonlRecord, column: JsonlColumn): string {
  const root = record.document.root;
  if (column.kind === 'root') return root.type === 'object' ? '' : jsonNodeToCell(root);
  if (root.type !== 'object') return '';
  const member = root.members.find(
    (candidate) => candidate.key.value === column.key && candidate.occurrence === column.occurrence,
  );
  return member ? jsonNodeToCell(member.value) : '';
}

export function createJsonlTableRows(
  records: readonly JsonlRecord[],
  columns: readonly JsonlColumn[],
  start = 0,
  count = records.length,
): JsonlTableRow[] {
  const boundedStart = Math.max(0, Math.min(records.length, Math.floor(start)));
  const boundedCount = Math.max(0, Math.floor(count));
  return records.slice(boundedStart, boundedStart + boundedCount).map((record) => ({
    recordIndex: record.index,
    lineNumber: record.lineNumber,
    warningCount: record.document.warnings.length,
    cells: columns.map((column) => getJsonlCell(record, column)),
  }));
}

function nodeContainsText(root: JsonNode, query: string): boolean {
  const stack: JsonNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.type) {
      case 'object':
        for (let index = node.members.length - 1; index >= 0; index -= 1) {
          const member = node.members[index];
          if (member.key.value.toLowerCase().includes(query) || member.key.raw.toLowerCase().includes(query)) return true;
          stack.push(member.value);
        }
        break;
      case 'array':
        for (let index = node.elements.length - 1; index >= 0; index -= 1) stack.push(node.elements[index]);
        break;
      case 'string':
        if (node.value.toLowerCase().includes(query) || node.raw.toLowerCase().includes(query)) return true;
        break;
      case 'number':
        if (node.raw.toLowerCase().includes(query)) return true;
        break;
      case 'boolean':
        if ((node.value ? 'true' : 'false').includes(query)) return true;
        break;
      case 'null':
        if ('null'.includes(query)) return true;
        break;
    }
  }
  return false;
}

export function filterJsonlRecords(records: readonly JsonlRecord[], query: string): JsonlRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...records];
  return records.filter((record) => nodeContainsText(record.document.root, normalized));
}

export function protectSpreadsheetFormula(value: string): string {
  // Spreadsheets may execute cells beginning with =, +, -, or @, including
  // after whitespace/control characters. A leading apostrophe forces text.
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function quoteCsvField(value: string, protectFormula = true): string {
  const protectedValue = protectFormula ? protectSpreadsheetFormula(value) : value;
  if (!/[",\r\n]/.test(protectedValue)) return protectedValue;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function jsonlRecordsToCsv(
  records: readonly JsonlRecord[],
  options: JsonlCsvOptions = {},
): string {
  const columns = options.columns ?? discoverJsonlColumns(records).columns;
  const includeHeader = options.includeHeader ?? true;
  const protectFormula = options.protectSpreadsheetFormulas ?? true;
  const lineEnding = options.lineEnding ?? '\r\n';
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(columns.map((column) => quoteCsvField(column.label, protectFormula)).join(','));
  }
  for (const record of records) {
    lines.push(columns.map((column) => quoteCsvField(getJsonlCell(record, column), protectFormula)).join(','));
  }
  return lines.join(lineEnding);
}

export function serializeJsonlRecords(records: readonly JsonlRecord[]): string {
  return records.map((record) => serializeLosslessJson(record.document, { indent: 0 })).join('\n');
}
