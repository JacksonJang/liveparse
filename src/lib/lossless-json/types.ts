export type JsonIndent = 0 | 2 | 4;

export interface JsonSourceRange {
  /** Zero-based UTF-16 offset, inclusive. */
  start: number;
  /** Zero-based UTF-16 offset, exclusive. */
  end: number;
}

export interface JsonSourceLocation {
  /** Zero-based UTF-16 offset. */
  offset: number;
  /** One-based line number. */
  line: number;
  /** One-based UTF-16 column number. */
  column: number;
}

export type JsonPathSegment =
  | { type: 'property'; key: string; occurrence: number }
  | { type: 'index'; index: number };

export interface JsonObjectNode extends JsonSourceRange {
  type: 'object';
  /** Members remain ordered and duplicates are never collapsed. */
  members: JsonMember[];
}

export interface JsonMember extends JsonSourceRange {
  type: 'member';
  key: JsonStringNode;
  value: JsonNode;
  /** One-based occurrence of this decoded key in its containing object. */
  occurrence: number;
  duplicate: boolean;
}

export interface JsonArrayNode extends JsonSourceRange {
  type: 'array';
  elements: JsonNode[];
}

export interface JsonStringNode extends JsonSourceRange {
  type: 'string';
  /** Decoded JavaScript string value. Numeric values are deliberately not decoded. */
  value: string;
  /** Exact token text, including quotes and escapes. */
  raw: string;
}

export interface JsonNumberNode extends JsonSourceRange {
  type: 'number';
  /** Exact JSON number token. This is the authoritative value representation. */
  raw: string;
}

export interface JsonBooleanNode extends JsonSourceRange {
  type: 'boolean';
  value: boolean;
}

export interface JsonNullNode extends JsonSourceRange {
  type: 'null';
}

export type JsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonBooleanNode
  | JsonNullNode;

export interface JsonStats {
  objects: number;
  arrays: number;
  properties: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  characters: number;
}

interface JsonDiagnosticBase {
  code: string;
  message: string;
  range: JsonSourceRange;
  location: JsonSourceLocation;
  path: JsonPathSegment[];
  /** Human-readable, duplicate-aware path such as $["items"][0]["id"]#2. */
  pathText: string;
}

export interface UnsafeIntegerWarning extends JsonDiagnosticBase {
  code: 'unsafe-integer';
  raw: string;
}

export interface NumberOverflowWarning extends JsonDiagnosticBase {
  code: 'number-overflow';
  raw: string;
}

export interface NumberRepresentationChangeWarning extends JsonDiagnosticBase {
  code: 'number-representation-change';
  raw: string;
  javascriptRepresentation: string;
  /** False when only equivalent spelling is normalized, for example 1.0 to 1. */
  valueChanged: boolean;
}

export interface DuplicateKeyWarning extends JsonDiagnosticBase {
  code: 'duplicate-key';
  key: string;
  occurrence: number;
  firstRange: JsonSourceRange;
  firstLocation: JsonSourceLocation;
}

export type JsonWarning =
  | UnsafeIntegerWarning
  | NumberOverflowWarning
  | NumberRepresentationChangeWarning
  | DuplicateKeyWarning;

export type JsonParseErrorCode =
  | 'unexpected-end'
  | 'unexpected-token'
  | 'trailing-content'
  | 'expected-property'
  | 'expected-colon'
  | 'expected-comma-or-end'
  | 'trailing-comma'
  | 'invalid-string'
  | 'invalid-escape'
  | 'invalid-unicode-escape'
  | 'invalid-number'
  | 'max-depth-exceeded';

export interface JsonParseError extends JsonDiagnosticBase {
  code: JsonParseErrorCode;
}

export interface JsonDocument {
  source: string;
  root: JsonNode;
  warnings: JsonWarning[];
  stats: JsonStats;
}

export type JsonParseResult =
  | { ok: true; document: JsonDocument }
  | { ok: false; error: JsonParseError };

export interface JsonParseOptions {
  /** Protects the UI from stack exhaustion on hostile input. Default: 512. */
  maxDepth?: number;
}

export interface JsonSerializeOptions {
  /** Zero minifies; 2 and 4 pretty-print. Default: 2. */
  indent?: JsonIndent;
}
