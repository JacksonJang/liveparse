import {
  parseLosslessJson,
  serializeLosslessJson,
  type JsonNode,
  type JsonObjectNode,
} from './lossless-json';

export type TableDelimiter = ',' | ';' | '\t' | '|';

export interface CsvLocation {
  line: number;
  column: number;
  offset: number;
}

export type CsvParseResult =
  | { ok: true; rows: string[][] }
  | { ok: false; error: { message: string; location: CsvLocation } };

type CsvParseDocumentResult =
  | { ok: true; rows: string[][]; meaningfulRows: boolean[] }
  | { ok: false; error: { message: string; location: CsvLocation } };

export interface JsonToCsvOptions {
  delimiter?: TableDelimiter;
  flattenNestedObjects?: boolean;
  protectSpreadsheetFormulas?: boolean;
  lineEnding?: '\r\n' | '\n';
}

export type JsonToCsvResult =
  | {
      ok: true;
      csv: string;
      rowCount: number;
      columnCount: number;
      warningCount: number;
    }
  | {
      ok: false;
      error: { message: string; line?: number; column?: number };
    };

export interface CsvToJsonOptions {
  delimiter?: TableDelimiter;
  firstRowHeaders?: boolean;
  inferTypes?: boolean;
  indent?: 0 | 2 | 4;
}

export type CsvToJsonResult =
  | {
      ok: true;
      json: string;
      rowCount: number;
      columnCount: number;
    }
  | {
      ok: false;
      error: { message: string; line?: number; column?: number };
    };

interface CsvCell {
  value: string;
  protectFormula: boolean;
}

function csvError(message: string, line: number, column: number, offset: number): Extract<CsvParseDocumentResult, { ok: false }> {
  return { ok: false, error: { message, location: { line, column, offset } } };
}

/**
 * Parse an RFC 4180-style delimited document. Quoted fields may contain the
 * delimiter, escaped double quotes, and physical line breaks.
 */
function parseCsvDocument(source: string, delimiter: TableDelimiter = ','): CsvParseDocumentResult {
  const rows: string[][] = [];
  const meaningfulRows: boolean[] = [];
  let row: string[] = [];
  let field = '';
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let column = 1;
  let inQuotes = false;
  let quoteClosed = false;
  let fieldStarted = false;
  let rowMeaningful = false;

  const pushField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
    quoteClosed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    meaningfulRows.push(rowMeaningful);
    row = [];
    rowMeaningful = false;
  };
  const advanceNewline = (width: number) => {
    index += width;
    line += 1;
    column = 1;
  };

  while (index < source.length) {
    const character = source[index];
    const isCrLf = character === '\r' && source[index + 1] === '\n';
    const isNewline = character === '\n' || character === '\r';

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          column += 2;
        } else {
          inQuotes = false;
          quoteClosed = true;
          index += 1;
          column += 1;
        }
        continue;
      }
      if (isNewline) {
        field += '\n';
        advanceNewline(isCrLf ? 2 : 1);
        continue;
      }
      field += character;
      index += 1;
      column += 1;
      continue;
    }

    if (quoteClosed) {
      if (character === delimiter) {
        pushField();
        index += 1;
        column += 1;
        continue;
      }
      if (isNewline) {
        pushRow();
        advanceNewline(isCrLf ? 2 : 1);
        continue;
      }
      return csvError('Unexpected character after a closing quote.', line, column, index);
    }

    if (character === delimiter) {
      rowMeaningful = true;
      pushField();
      index += 1;
      column += 1;
      continue;
    }
    if (isNewline) {
      pushRow();
      advanceNewline(isCrLf ? 2 : 1);
      continue;
    }
    if (character === '"') {
      if (fieldStarted || field.length > 0) {
        return csvError('A quoted field must start with a double quote.', line, column, index);
      }
      inQuotes = true;
      fieldStarted = true;
      rowMeaningful = true;
      index += 1;
      column += 1;
      continue;
    }

    fieldStarted = true;
    rowMeaningful = true;
    field += character;
    index += 1;
    column += 1;
  }

  if (inQuotes) return csvError('The final quoted field is not closed.', line, column, index);

  const sourceEndsWithNewline = /(?:\r\n|\r|\n)$/.test(source);
  if (!sourceEndsWithNewline || row.length > 0 || field.length > 0 || quoteClosed || fieldStarted) pushRow();
  return { ok: true, rows, meaningfulRows };
}

export function parseCsv(source: string, delimiter: TableDelimiter = ','): CsvParseResult {
  const result = parseCsvDocument(source, delimiter);
  return result.ok ? { ok: true, rows: result.rows } : result;
}

function escapeHeaderSegment(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\./g, '\\.').replace(/#/g, '\\#');
}

function memberHeader(key: string, occurrence: number): string {
  const escaped = escapeHeaderSegment(key);
  return occurrence === 1 ? escaped : `${escaped} #${occurrence}`;
}

function nodeToCell(node: JsonNode): CsvCell {
  switch (node.type) {
    case 'string': return { value: node.value, protectFormula: true };
    case 'number': return { value: node.raw, protectFormula: false };
    case 'boolean': return { value: node.value ? 'true' : 'false', protectFormula: false };
    case 'null': return { value: 'null', protectFormula: false };
    case 'array':
    case 'object': return { value: serializeLosslessJson(node, { indent: 0 }), protectFormula: false };
  }
}

function flattenObject(
  object: JsonObjectNode,
  prefix: string,
  output: Map<string, CsvCell>,
  flattenNestedObjects: boolean,
): void {
  if (object.members.length === 0 && prefix) {
    output.set(prefix, { value: '{}', protectFormula: false });
    return;
  }

  for (const member of object.members) {
    const segment = memberHeader(member.key.value, member.occurrence);
    const header = prefix ? `${prefix}.${segment}` : segment;
    if (flattenNestedObjects && member.value.type === 'object') {
      flattenObject(member.value, header, output, true);
    } else {
      output.set(header, nodeToCell(member.value));
    }
  }
}

function quoteDelimitedField(value: string, delimiter: TableDelimiter, protectFormula: boolean): string {
  const protectedValue = protectFormula && /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (protectedValue.length === 0) return '""';
  if (!protectedValue.includes(delimiter) && !/["\r\n]/.test(protectedValue)) return protectedValue;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function jsonToCsv(source: string, options: JsonToCsvOptions = {}): JsonToCsvResult {
  const parsed = parseLosslessJson(source);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        message: parsed.error.message,
        line: parsed.error.location.line,
        column: parsed.error.location.column,
      },
    };
  }

  const root = parsed.document.root;
  const nodes = root.type === 'array' ? root.elements : [root];
  if (nodes.length === 0) {
    return { ok: false, error: { message: 'The JSON array is empty. Add at least one row to convert.' } };
  }

  const flattenNestedObjects = options.flattenNestedObjects ?? true;
  const records: Map<string, CsvCell>[] = [];
  const headers: string[] = [];
  const seenHeaders = new Set<string>();

  for (const node of nodes) {
    const record = new Map<string, CsvCell>();
    if (node.type === 'object') flattenObject(node, '', record, flattenNestedObjects);
    else record.set('$value', nodeToCell(node));
    for (const header of record.keys()) {
      if (seenHeaders.has(header)) continue;
      seenHeaders.add(header);
      headers.push(header);
    }
    records.push(record);
  }

  if (headers.length === 0) headers.push('$value');
  const delimiter = options.delimiter ?? ',';
  const protectFormula = options.protectSpreadsheetFormulas ?? true;
  const lineEnding = options.lineEnding ?? '\r\n';
  const lines = [headers.map((header) => quoteDelimitedField(header, delimiter, protectFormula)).join(delimiter)];
  for (const record of records) {
    lines.push(headers.map((header) => {
      const cell = record.get(header);
      return quoteDelimitedField(cell?.value ?? '', delimiter, protectFormula && Boolean(cell?.protectFormula));
    }).join(delimiter));
  }

  return {
    ok: true,
    csv: lines.join(lineEnding),
    rowCount: records.length,
    columnCount: headers.length,
    warningCount: parsed.document.warnings.length,
  };
}

function uniqueHeaders(rawHeaders: readonly string[], width: number): string[] {
  const used = new Set<string>();
  const headers: string[] = [];
  for (let index = 0; index < width; index += 1) {
    const preferred = rawHeaders[index]?.trim() || `column_${index + 1}`;
    let candidate = preferred;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${preferred}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    headers.push(candidate);
  }
  return headers;
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function serializeCsvCell(value: string, inferTypes: boolean): string {
  if (!inferTypes) return JSON.stringify(value);
  const trimmed = value.trim();
  if (/^(?:true|false|null)$/.test(trimmed)) return trimmed;
  if (JSON_NUMBER.test(trimmed)) return trimmed;
  return JSON.stringify(value);
}

function serializeObjectRows(rows: readonly string[][], headers: readonly string[], inferTypes: boolean, indent: 0 | 2 | 4): string {
  if (indent === 0) {
    return `[${rows.map((row) => `{${headers.map((header, index) => `${JSON.stringify(header)}:${serializeCsvCell(row[index] ?? '', inferTypes)}`).join(',')}}`).join(',')}]`;
  }
  const outer = ' '.repeat(indent);
  const inner = ' '.repeat(indent * 2);
  const objects = rows.map((row) => [
    `${outer}{`,
    headers.map((header, index) => `${inner}${JSON.stringify(header)}: ${serializeCsvCell(row[index] ?? '', inferTypes)}`).join(',\n'),
    `${outer}}`,
  ].join('\n'));
  return `[\n${objects.join(',\n')}\n]`;
}

function serializeArrayRows(rows: readonly string[][], inferTypes: boolean, indent: 0 | 2 | 4): string {
  if (indent === 0) return `[${rows.map((row) => `[${row.map((cell) => serializeCsvCell(cell, inferTypes)).join(',')}]`).join(',')}]`;
  const outer = ' '.repeat(indent);
  const inner = ' '.repeat(indent * 2);
  return `[\n${rows.map((row) => `${outer}[\n${row.map((cell) => `${inner}${serializeCsvCell(cell, inferTypes)}`).join(',\n')}\n${outer}]`).join(',\n')}\n]`;
}

export function csvToJson(source: string, options: CsvToJsonOptions = {}): CsvToJsonResult {
  const parsed = parseCsvDocument(source, options.delimiter ?? ',');
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        message: parsed.error.message,
        line: parsed.error.location.line,
        column: parsed.error.location.column,
      },
    };
  }

  const rows = parsed.rows.filter((_, index) => parsed.meaningfulRows[index]);
  if (rows.length === 0) return { ok: false, error: { message: 'The CSV input is empty.' } };

  const firstRowHeaders = options.firstRowHeaders ?? true;
  const dataRows = firstRowHeaders ? rows.slice(1) : rows;
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const headers = uniqueHeaders(firstRowHeaders ? rows[0] : [], width);
  const inferTypes = options.inferTypes ?? false;
  const indent = options.indent ?? 2;
  const json = firstRowHeaders
    ? serializeObjectRows(dataRows, headers, inferTypes, indent)
    : serializeArrayRows(dataRows, inferTypes, indent);

  return { ok: true, json, rowCount: dataRows.length, columnCount: width };
}
