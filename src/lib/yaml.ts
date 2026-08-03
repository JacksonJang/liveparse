import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  type Document,
  type Node,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import { analyzeJsonNumber, parseLosslessJson, type JsonNode, type JsonWarning } from './lossless-json';
import {
  MAX_YAML_ALIAS_EXPANSION,
  MAX_YAML_DEPTH,
  MAX_YAML_DIAGNOSTICS,
  MAX_YAML_INPUT_CHARACTERS,
  MAX_YAML_NODES,
  MAX_YAML_OUTPUT_CHARACTERS,
  MAX_YAML_VIEWER_ROWS,
  type YamlMode,
  type YamlOptions,
  type YamlVersion,
} from './yaml-config';
import type {
  YamlDiagnostic,
  YamlOperationResult,
  YamlStats,
  YamlViewerRow,
  YamlViewerRowKind,
} from './yaml-worker-protocol';

export class YamlToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'YamlToolError';
  }
}

interface ParsedYamlInput {
  documents: Document.Parsed[];
  diagnostics: YamlDiagnostic[];
  lineCounter: LineCounter;
  stats: YamlStats;
  transformationBlocker?: YamlDiagnostic;
}

interface ScalarResolutionReview {
  diagnostic: YamlDiagnostic;
  blocksTransformation: boolean;
}

const YAML_SCALAR_TAGS = {
  bigint: 'tag:yaml.org,2002:int',
  boolean: 'tag:yaml.org,2002:bool',
  date: 'tag:yaml.org,2002:timestamp',
  null: 'tag:yaml.org,2002:null',
  number: 'tag:yaml.org,2002:float',
  string: 'tag:yaml.org,2002:str',
  symbol: 'tag:yaml.org,2002:merge',
} as const;

function effectiveScalarTag(node: Scalar): string {
  if (node.tag) return node.tag;
  if (node.value === null) return YAML_SCALAR_TAGS.null;
  if (node.value instanceof Date) return YAML_SCALAR_TAGS.date;
  switch (typeof node.value) {
    case 'bigint': return YAML_SCALAR_TAGS.bigint;
    case 'boolean': return YAML_SCALAR_TAGS.boolean;
    case 'number': return YAML_SCALAR_TAGS.number;
    case 'string': return YAML_SCALAR_TAGS.string;
    case 'symbol': return YAML_SCALAR_TAGS.symbol;
    default: return `runtime:${Object.prototype.toString.call(node.value)}`;
  }
}

function canonicalDecimal(source: string | undefined): string | null {
  const normalized = yamlDecimalForAnalysis(source);
  if (!normalized) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(normalized);
  if (!match) return null;
  let digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+/, '');
  if (!digits) return '0';
  const writtenExponent = match[4] ?? '0';
  if (writtenExponent.replace(/^[+-]/, '').length > 100) return null;
  let exponent = BigInt(writtenExponent) - BigInt((match[3] ?? '').length);
  const withoutTrailingZeros = digits.replace(/0+$/, '');
  exponent += BigInt(digits.length - withoutTrailingZeros.length);
  digits = withoutTrailingZeros;
  return `${match[1]}${digits}e${exponent}`;
}

function canonicalFloatScalar(node: Scalar): string | null {
  if (node.format === 'TIME' && node.source) return canonicalSexagesimalFloat(node.source);
  const decimal = canonicalDecimal(node.source);
  if (decimal) return decimal;
  const source = node.source?.replace(/_/g, '').toLowerCase();
  if (source === '.nan' || source === '+.nan' || source === '-.nan') return 'nan';
  if (source === '.inf' || source === '+.inf') return 'inf';
  if (source === '-.inf') return '-inf';
  return null;
}

function canonicalSexagesimalFloat(source: string): string | null {
  if (source.length > 2_000) return null;
  const normalized = source.replace(/_/g, '');
  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^[+-]/, '');
  const parts = unsigned.split(':');
  if (parts.length < 2 || parts.some((part) => !/^\d+(?:\.\d*)?$/.test(part))) return null;
  const last = parts.pop();
  if (!last) return null;
  const [lastWhole, fraction = ''] = last.split('.');
  if (parts.some((part) => part.includes('.'))) return null;
  let whole = 0n;
  for (const part of [...parts, lastWhole]) whole = whole * 60n + BigInt(part);
  const scale = fraction.length ? BigInt(`1${'0'.repeat(fraction.length)}`) : 1n;
  let scaled = whole * scale + BigInt(fraction || '0');
  if (negative) scaled = -scaled;
  if (!fraction.length) return canonicalDecimal(scaled.toString());
  const scaledDigits = (scaled < 0n ? -scaled : scaled).toString().padStart(fraction.length + 1, '0');
  const integerDigits = scaledDigits.slice(0, -fraction.length);
  const fractionDigits = scaledDigits.slice(-fraction.length);
  return canonicalDecimal(`${scaled < 0n ? '-' : ''}${integerDigits}.${fractionDigits}`);
}

function scalarKeyFingerprint(node: Scalar): string | null {
  const tag = effectiveScalarTag(node);
  if (tag === YAML_SCALAR_TAGS.date) {
    const timestamp = canonicalTimestampSource(node.source ?? '');
    if (timestamp !== null) return `${tag}\0${timestamp}`;
    return typeof node.value === 'string' && node.source !== undefined ? `${tag}\0unresolved:${node.source}` : null;
  }
  if (tag === YAML_SCALAR_TAGS.number) {
    const number = canonicalFloatScalar(node);
    if (number !== null) return `${tag}\0${number}`;
    return typeof node.value === 'string' && node.source !== undefined ? `${tag}\0unresolved:${node.source}` : null;
  }
  const value = node.value;
  if (value instanceof Uint8Array) return `${tag}\0bytes:${Array.from(value).join(',')}`;
  if (value === null) return `${tag}\0null`;
  if (typeof value === 'bigint') return `${tag}\0bigint:${value}`;
  if (typeof value === 'boolean') return `${tag}\0boolean:${value}`;
  if (typeof value === 'string') return `${tag}\0string:${value}`;
  if (typeof value === 'symbol') return `${tag}\0symbol:${String(value)}`;
  return null;
}

function assertUniqueScalarKeys(documents: Document.Parsed[], lineCounter: LineCounter): void {
  for (const document of documents) {
    const anchors = new Map<string, Node>();
    const registerAnchor = (node: Node | null): void => {
      if (node && 'anchor' in node && typeof node.anchor === 'string' && node.anchor) anchors.set(node.anchor, node);
    };
    const visit = (node: Node | null): void => {
      if (!node) return;
      registerAnchor(node);
      if (isMap(node)) {
        const keys = new Set<string>();
        for (const pair of (node as YAMLMap<Node, Node>).items) {
          registerAnchor(pair.key);
          const scalarKey = isScalar(pair.key)
            ? pair.key
            : isAlias(pair.key) && isScalar(anchors.get(pair.key.source))
              ? anchors.get(pair.key.source) as Scalar
              : null;
          if (scalarKey) {
            const fingerprint = scalarKeyFingerprint(scalarKey);
            if (fingerprint !== null) {
              if (keys.has(fingerprint)) {
                const position = nodePosition(pair.key, lineCounter);
                throw new YamlToolError('DUPLICATE_KEY', 'Map keys must be unique.', position.line, position.column);
              }
              keys.add(fingerprint);
            } else if (typeof scalarKey.value === 'number' && scalarKey.source) {
              const position = nodePosition(pair.key, lineCounter);
              throw new YamlToolError(
                'SCALAR_KEY_COMPARISON_LIMIT',
                'A numeric mapping key exceeds the bounded normalization supported for duplicate-key comparison.',
                position.line,
                position.column,
              );
            }
          }
          visit(pair.key);
          visit(pair.value);
        }
      } else if (isSeq(node)) {
        for (const item of (node as YAMLSeq<Node>).items) {
          if (item && typeof item === 'object') visit(item);
        }
      }
    };
    visit(document.contents);
  }
}

function assertInput(input: string, maximumCharacters = MAX_YAML_INPUT_CHARACTERS): void {
  if (!input.trim()) throw new YamlToolError('EMPTY_INPUT', 'Paste a YAML or JSON document before running this tool.');
  if (input.length > maximumCharacters) {
    throw new YamlToolError(
      'INPUT_TOO_LARGE',
      `Input exceeds the ${maximumCharacters.toLocaleString('en-US')} character limit.`,
    );
  }
}

function errorPosition(error: { pos?: [number, number] }, lineCounter: LineCounter): { line?: number; column?: number } {
  const offset = error.pos?.[0];
  if (offset === undefined) return {};
  const position = lineCounter.linePos(offset);
  return { line: position.line, column: position.col };
}

function countComment(value: string | null | undefined): number {
  return value === null || value === undefined || value === '' ? 0 : 1;
}

function limitDiagnostics(diagnostics: YamlDiagnostic[]): YamlDiagnostic[] {
  if (diagnostics.length <= MAX_YAML_DIAGNOSTICS) return diagnostics;
  const retained = diagnostics.slice(0, MAX_YAML_DIAGNOSTICS - 1);
  retained.push({
    code: 'DIAGNOSTICS_TRUNCATED',
    message: `${(diagnostics.length - retained.length).toLocaleString('en-US')} additional diagnostics were omitted to keep the result bounded.`,
  });
  return retained;
}

function yamlDecimalForAnalysis(source: string | undefined): string | null {
  if (!source) return null;
  let normalized = source.replace(/_/g, '');
  if (normalized.startsWith('+')) normalized = normalized.slice(1);
  normalized = normalized.replace(/^(-?)\./, '$10.');
  normalized = normalized.replace(/\.(?=[eE]|$)/, '.0');
  return /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized) ? normalized : null;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const YAML_TIMESTAMP_PATTERN = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\.[0-9]+)?)(?:[ \t]*(Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)?$/;

function canonicalTimestampSource(source: string): string | null {
  const match = YAML_TIMESTAMP_PATTERN.exec(source);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number((match[6] ?? '0').split('.')[0]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null;

  const timezone = match[8];
  let offsetMinutes = 0;
  if (timezone && timezone !== 'Z') {
    const timezoneMatch = /^([+-])([0-9]{1,2})(?::([0-9]{2}))?$/.exec(timezone);
    if (!timezoneMatch) return null;
    const offsetHours = Number(timezoneMatch[2]);
    const offsetRemainder = Number(timezoneMatch[3] ?? 0);
    if (offsetHours > 23 || offsetRemainder > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetRemainder) * (timezoneMatch[1] === '-' ? -1 : 1);
  }

  const base = new Date(0);
  base.setUTCFullYear(year, month - 1, day);
  base.setUTCHours(hour, minute, second, 0);
  const fraction = (match[7]?.slice(1) ?? '').replace(/0+$/, '');
  return `${base.getTime() - offsetMinutes * 60_000}:${fraction}`;
}

function reviewTimestampScalar(node: Scalar<Date>, lineCounter: LineCounter): ScalarResolutionReview | null {
  const source = node.source ?? '';
  const match = YAML_TIMESTAMP_PATTERN.exec(source);
  const position = nodePosition(node, lineCounter);
  if (!match) {
    throw new YamlToolError('INVALID_TIMESTAMP', 'The YAML timestamp does not match the supported date or date-time syntax.', position.line, position.column);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number((match[6] ?? '0').split('.')[0]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
    throw new YamlToolError('INVALID_TIMESTAMP', `YAML timestamp ${JSON.stringify(source)} contains an out-of-range date or time field.`, position.line, position.column);
  }

  const timezone = match[8];
  let offsetMinutes = 0;
  if (timezone && timezone !== 'Z') {
    const timezoneMatch = /^([+-])([0-9]{1,2})(?::([0-9]{2}))?$/.exec(timezone);
    const offsetHours = Number(timezoneMatch?.[2] ?? 0);
    const offsetRemainder = Number(timezoneMatch?.[3] ?? 0);
    if (!timezoneMatch || offsetHours > 23 || offsetRemainder > 59) {
      throw new YamlToolError('INVALID_TIMESTAMP', `YAML timestamp ${JSON.stringify(source)} contains an out-of-range UTC offset.`, position.line, position.column);
    }
    offsetMinutes = (offsetHours * 60 + offsetRemainder) * (timezoneMatch[1] === '-' ? -1 : 1);
  }

  const fractionDigits = match[7]?.slice(1) ?? '';
  const milliseconds = Number((fractionDigits + '000').slice(0, 3));
  const corrected = new Date(0);
  corrected.setUTCFullYear(year, month - 1, day);
  corrected.setUTCHours(hour, minute, second, milliseconds);
  node.value = new Date(corrected.getTime() - offsetMinutes * 60_000);

  if (fractionDigits.length > 3 && /[1-9]/.test(fractionDigits.slice(3))) {
    return {
      blocksTransformation: true,
      diagnostic: {
        code: 'TIMESTAMP_PRECISION_LOSS',
        message: `Timestamp ${JSON.stringify(source)} has sub-millisecond digits that this YAML runtime cannot preserve during formatting or JSON conversion.`,
        ...position,
      },
    };
  }
  return null;
}

function reviewScalarResolution(node: Scalar, lineCounter: LineCounter): ScalarResolutionReview | null {
  if (node.value instanceof Date) return reviewTimestampScalar(node as Scalar<Date>, lineCounter);
  if (typeof node.value !== 'number') return null;
  const position = nodePosition(node, lineCounter);
  const normalized = yamlDecimalForAnalysis(node.source);
  if (!normalized) {
    if (!Number.isFinite(node.value)) return null;
    return {
      blocksTransformation: true,
      diagnostic: {
        code: 'NUMERIC_PRECISION_LOSS',
        message: `Numeric scalar ${JSON.stringify(node.source ?? String(node.value))} uses a YAML representation that cannot be safely reserialized through a JavaScript Number.`,
        ...position,
      },
    };
  }
  const analysis = analyzeJsonNumber(normalized);
  if (node.format === 'TIME' || analysis.overflow || analysis.valueChanged) {
    return {
      blocksTransformation: true,
      diagnostic: {
        code: 'NUMERIC_PRECISION_LOSS',
        message: `Numeric scalar ${JSON.stringify(node.source ?? normalized)} would resolve to ${analysis.javascriptRepresentation ?? String(node.value)} and lose its written value during formatting or JSON conversion.`,
        ...position,
      },
    };
  }
  if (analysis.representationChanged) {
    return {
      blocksTransformation: false,
      diagnostic: {
        code: 'NUMBER_SPELLING_NORMALIZED',
        message: `Numeric scalar ${JSON.stringify(node.source ?? normalized)} may be reserialized with the equivalent spelling ${analysis.javascriptRepresentation}.`,
        ...position,
      },
    };
  }
  return null;
}

function documentVersion(document: Document.Parsed, fallback: YamlVersion): YamlVersion {
  const declared = document.directives?.yaml.version;
  return declared === '1.1' || declared === '1.2' ? declared : fallback;
}

function buildYamlStats(documents: Document.Parsed[], fallbackVersion: YamlVersion, lineCounter: LineCounter): {
  stats: YamlStats;
  diagnostics: YamlDiagnostic[];
  transformationBlocker?: YamlDiagnostic;
} {
  const stats: YamlStats = {
    documents: documents.length,
    mappings: 0,
    sequences: 0,
    scalars: 0,
    aliases: 0,
    anchors: 0,
    comments: 0,
    nodes: 0,
    maxDepth: 0,
    versions: [],
  };
  const versions = new Set<YamlVersion>();
  const diagnostics: YamlDiagnostic[] = [];
  let transformationBlocker: YamlDiagnostic | undefined;

  for (const document of documents) {
    const earlierAnchors = new Set<string>();
    versions.add(documentVersion(document, fallbackVersion));
    stats.comments += countComment(document.commentBefore) + countComment(document.comment);
    const stack: Array<{ node: Node | null; depth: number }> = [{ node: document.contents, depth: 0 }];

    while (stack.length) {
      const current = stack.pop();
      if (!current?.node) continue;
      const { node, depth } = current;
      stats.nodes += 1;
      if (stats.nodes > MAX_YAML_NODES) {
        throw new YamlToolError('NODE_LIMIT', `YAML contains more than ${MAX_YAML_NODES.toLocaleString('en-US')} nodes.`);
      }
      if (depth > MAX_YAML_DEPTH) {
        throw new YamlToolError('DEPTH_LIMIT', `YAML nesting exceeds the supported depth of ${MAX_YAML_DEPTH}.`);
      }
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      stats.comments += countComment(node.commentBefore) + countComment(node.comment);

      if ('anchor' in node && typeof node.anchor === 'string' && node.anchor) {
        stats.anchors += 1;
        earlierAnchors.add(node.anchor);
      }
      if (isAlias(node)) {
        if (!earlierAnchors.has(node.source)) {
          const position = nodePosition(node, lineCounter);
          throw new YamlToolError(
            'UNRESOLVED_ALIAS',
            `Alias *${node.source} does not resolve to an earlier anchor in this YAML document.`,
            position.line,
            position.column,
          );
        }
        stats.aliases += 1;
      } else if (isScalar(node)) {
        stats.scalars += 1;
        const review = reviewScalarResolution(node, lineCounter);
        if (review) {
          diagnostics.push(review.diagnostic);
          if (review.blocksTransformation && !transformationBlocker) transformationBlocker = review.diagnostic;
        }
      } else if (isMap(node)) {
        stats.mappings += 1;
        const items = (node as YAMLMap<Node, Node>).items;
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const pair = items[index] as Pair<Node, Node>;
          if (pair.value) stack.push({ node: pair.value, depth: depth + 1 });
          if (pair.key) stack.push({ node: pair.key, depth: depth + 1 });
        }
      } else if (isSeq(node)) {
        stats.sequences += 1;
        const items = (node as YAMLSeq<Node>).items;
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const item = items[index];
          if (item && typeof item === 'object') stack.push({ node: item as Node, depth: depth + 1 });
        }
      }
    }
  }

  stats.versions = [...versions].sort();
  return { stats, diagnostics, transformationBlocker };
}

function parseYamlInput(input: string, options: YamlOptions): ParsedYamlInput {
  assertInput(input);
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(input, {
    version: options.version,
    intAsBigInt: true,
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: false,
    merge: false,
    resolveKnownTags: false,
  }) as Document.Parsed[];

  if (documents.length === 0) throw new YamlToolError('EMPTY_STREAM', 'The input does not contain a YAML document.');
  for (const document of documents) {
    const error = document.errors[0];
    if (error) {
      const position = errorPosition(error, lineCounter);
      throw new YamlToolError(error.code || 'YAML_PARSE_ERROR', error.message, position.line, position.column);
    }
  }
  assertUniqueScalarKeys(documents, lineCounter);

  const parserDiagnostics: YamlDiagnostic[] = documents.flatMap((document) => document.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    ...errorPosition(warning, lineCounter),
  })));
  const review = buildYamlStats(documents, options.version, lineCounter);
  return {
    documents,
    diagnostics: limitDiagnostics([...parserDiagnostics, ...review.diagnostics]),
    lineCounter,
    stats: review.stats,
    transformationBlocker: review.transformationBlocker,
  };
}

function verifyGeneratedYaml(input: string, options: YamlOptions): void {
  assertInput(input, MAX_YAML_OUTPUT_CHARACTERS);
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(input, {
    version: options.version,
    intAsBigInt: true,
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: false,
    merge: false,
    resolveKnownTags: false,
  }) as Document.Parsed[];
  const error = documents.flatMap((document) => document.errors)[0];
  if (error) {
    const position = errorPosition(error, lineCounter);
    throw new YamlToolError('INTERNAL_YAML_RESULT', `Generated YAML failed its internal syntax check: ${error.message}`, position.line, position.column);
  }
  assertUniqueScalarKeys(documents, lineCounter);
}

function ensureOutputLimit(output: string): string {
  if (output.length > MAX_YAML_OUTPUT_CHARACTERS) {
    throw new YamlToolError(
      'OUTPUT_TOO_LARGE',
      `Result exceeds the ${MAX_YAML_OUTPUT_CHARACTERS.toLocaleString('en-US')} character output limit.`,
    );
  }
  return output;
}

function scalarValueType(node: Scalar): string {
  if (node.value === null) return 'null';
  if (node.value instanceof Date) return 'timestamp';
  if (typeof node.value === 'bigint') return 'integer';
  if (typeof node.value === 'number') return Number.isInteger(node.value) ? 'integer' : 'number';
  if (typeof node.value === 'string') return 'string';
  return typeof node.value;
}

function scalarPreview(node: Scalar): string {
  if (node.value === null) return 'null';
  if (typeof node.value === 'bigint') return node.value.toString();
  if (typeof node.value === 'number' || node.value instanceof Date) return node.source ?? String(node.value);
  return String(node.value);
}

function keyLabel(node: Node | null, index: number): string {
  if (!node) return `(empty key ${index + 1})`;
  if (isScalar(node)) {
    const value = scalarPreview(node);
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  if (isAlias(node)) return `*${node.source}`;
  return `[complex key ${index + 1}]`;
}

function nodePosition(node: Node, lineCounter: LineCounter): { line?: number; column?: number } {
  const offset = node.range?.[0];
  if (offset === undefined) return {};
  const position = lineCounter.linePos(offset);
  return { line: position.line, column: position.col };
}

function buildViewerRows(documents: Document.Parsed[], lineCounter: LineCounter): { rows: YamlViewerRow[]; truncated: boolean } {
  const rows: YamlViewerRow[] = [];
  let nextId = 1;
  let truncated = false;

  const addRow = (row: Omit<YamlViewerRow, 'id'>): boolean => {
    if (rows.length >= MAX_YAML_VIEWER_ROWS) {
      truncated = true;
      return false;
    }
    rows.push({ id: nextId, ...row });
    nextId += 1;
    return true;
  };

  const walk = (node: Node | null, label: string, depth: number): void => {
    if (truncated) return;
    if (!node) {
      addRow({ depth, kind: 'empty', label, value: 'null', valueType: 'null' });
      return;
    }
    const base = {
      depth,
      label,
      anchor: 'anchor' in node && typeof node.anchor === 'string' ? node.anchor : undefined,
      tag: node.tag,
      ...nodePosition(node, lineCounter),
    };
    if (isAlias(node)) {
      addRow({ ...base, kind: 'alias', value: `*${node.source}`, valueType: 'alias' });
      return;
    }
    if (isScalar(node)) {
      const preview = scalarPreview(node);
      addRow({
        ...base,
        kind: 'scalar',
        value: preview.length > 1_000 ? `${preview.slice(0, 997)}…` : preview,
        valueType: scalarValueType(node),
      });
      return;
    }
    if (isMap(node)) {
      if (!addRow({ ...base, kind: 'mapping', value: `${node.items.length.toLocaleString('en-US')} entries`, valueType: 'mapping' })) return;
      (node as YAMLMap<Node, Node>).items.forEach((pair, index) => {
        const keyHasVisibleStructure = Boolean(
          pair.key && (
            !isScalar(pair.key)
            || typeof pair.key.value !== 'string'
            || ('anchor' in pair.key && pair.key.anchor)
            || pair.key.tag
          ),
        );
        if (keyHasVisibleStructure) {
          walk(pair.key, `Key ${index + 1}`, depth + 1);
          walk(pair.value, `Value for ${keyLabel(pair.key, index)}`, depth + 1);
        } else {
          walk(pair.value, keyLabel(pair.key, index), depth + 1);
        }
      });
      return;
    }
    if (isSeq(node)) {
      if (!addRow({ ...base, kind: 'sequence', value: `${node.items.length.toLocaleString('en-US')} items`, valueType: 'sequence' })) return;
      (node as YAMLSeq<Node>).items.forEach((item, index) => walk(item && typeof item === 'object' ? item : null, `[${index}]`, depth + 1));
    }
  };

  documents.forEach((document, index) => {
    if (!addRow({ depth: 0, kind: 'document', label: `Document ${index + 1}`, valueType: 'document' })) return;
    walk(document.contents, '$', 1);
  });
  return { rows, truncated };
}

function yamlWarning(code: string, message: string): YamlDiagnostic {
  return { code, message };
}

function findYaml11MergeKey(documents: Document.Parsed[], lineCounter: LineCounter): { line?: number; column?: number } | null {
  for (const document of documents) {
    const stack: Array<Node | null> = [document.contents];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (isMap(node)) {
        for (const pair of (node as YAMLMap<Node, Node>).items) {
          if (isScalar(pair.key) && typeof pair.key.value === 'symbol') return nodePosition(pair.key, lineCounter);
          if (pair.value) stack.push(pair.value);
          if (pair.key) stack.push(pair.key);
        }
      } else if (isSeq(node)) {
        for (const item of (node as YAMLSeq<Node>).items) {
          if (item && typeof item === 'object') stack.push(item);
        }
      }
    }
  }
  return null;
}

const JSON_SAFE_EXPLICIT_YAML_TAGS = new Set([
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:timestamp',
]);

function jsonPropertyKeyFromScalar(node: Scalar, lineCounter: LineCounter): string {
  const position = nodePosition(node, lineCounter);
  const value = node.value;
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new YamlToolError('NON_JSON_KEY', 'YAML mapping contains a non-finite numeric key that JSON cannot represent.', position.line, position.column);
    }
    return String(value);
  }
  throw new YamlToolError('COMPLEX_KEY_UNSUPPORTED', 'YAML contains a mapping key that cannot be represented as a JSON object-property string.', position.line, position.column);
}

function preflightYamlToJson(documents: Document.Parsed[], lineCounter: LineCounter): void {
  for (const document of documents) {
    const stack: Array<Node | null> = [document.contents];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.tag && !JSON_SAFE_EXPLICIT_YAML_TAGS.has(node.tag)) {
        const position = nodePosition(node, lineCounter);
        throw new YamlToolError(
          'CUSTOM_TAG_UNSUPPORTED',
          `YAML tag ${JSON.stringify(node.tag)} has semantics that this JSON converter does not discard or guess.`,
          position.line,
          position.column,
        );
      }
      if (isMap(node)) {
        const keys = new Set<string>();
        for (const pair of (node as YAMLMap<Node, Node>).items) {
          if (isAlias(pair.key)) {
            const position = nodePosition(pair.key, lineCounter);
            throw new YamlToolError(
              'ALIAS_KEY_UNSUPPORTED',
              'An alias is used as a mapping key. JSON conversion stops before alias resolution can collapse or overwrite a property.',
              position.line,
              position.column,
            );
          }
          if (pair.key && !isScalar(pair.key)) {
            const position = nodePosition(pair.key, lineCounter);
            throw new YamlToolError(
              'COMPLEX_KEY_UNSUPPORTED',
              'YAML contains a sequence or mapping as a key, which cannot be represented as a JSON object property.',
              position.line,
              position.column,
            );
          }
          if (pair.key) {
            const key = jsonPropertyKeyFromScalar(pair.key, lineCounter);
            if (keys.has(key)) {
              const position = nodePosition(pair.key, lineCounter);
              throw new YamlToolError(
                'JSON_KEY_COLLISION',
                `Multiple YAML mapping keys convert to the JSON property ${JSON.stringify(key)}.`,
                position.line,
                position.column,
              );
            }
            keys.add(key);
          }
          if (pair.value) stack.push(pair.value);
          if (pair.key) stack.push(pair.key);
        }
      } else if (isSeq(node)) {
        for (const item of (node as YAMLSeq<Node>).items) {
          if (item && typeof item === 'object') stack.push(item);
        }
      }
    }
  }
}

function formatYaml(input: string, options: YamlOptions): YamlOperationResult {
  const parsed = parseYamlInput(input, options);
  if (parsed.transformationBlocker) {
    const blocker = parsed.transformationBlocker;
    throw new YamlToolError(blocker.code, blocker.message, blocker.line, blocker.column);
  }
  const output = ensureOutputLimit(parsed.documents.map((document) => document.toString({
    indent: options.indent,
    lineWidth: 0,
  })).join(''));
  return {
    mode: 'format',
    output,
    stats: parsed.stats,
    diagnostics: limitDiagnostics([
      ...parsed.diagnostics,
      yamlWarning(
        'RESERIALIZED_PRESENTATION',
        'Formatting parses and reserializes YAML. Review changes to quoting, scalar style, flow/block style, numeric spelling, comments, and whitespace before replacing source.',
      ),
    ]),
  };
}

function validateYaml(input: string, options: YamlOptions): YamlOperationResult {
  const parsed = parseYamlInput(input, options);
  return { mode: 'validate', stats: parsed.stats, diagnostics: parsed.diagnostics };
}

function viewYaml(input: string, options: YamlOptions): YamlOperationResult {
  const parsed = parseYamlInput(input, options);
  const view = buildViewerRows(parsed.documents, parsed.lineCounter);
  return { mode: 'view', rows: view.rows, truncated: view.truncated, stats: parsed.stats, diagnostics: parsed.diagnostics };
}

function normalizeMapKey(key: unknown, diagnostics: YamlDiagnostic[]): string {
  if (typeof key === 'string') return key;
  if (key === null || typeof key === 'number' || typeof key === 'bigint' || typeof key === 'boolean') {
    if (typeof key === 'number' && !Number.isFinite(key)) {
      throw new YamlToolError('NON_JSON_KEY', 'YAML mapping contains a non-finite numeric key that JSON cannot represent.');
    }
    diagnostics.push(yamlWarning('NON_STRING_KEY_COERCED', 'A non-string YAML mapping key was converted to a JSON object-property string.'));
    return String(key);
  }
  throw new YamlToolError('COMPLEX_KEY_UNSUPPORTED', 'YAML contains a complex mapping key that cannot be represented as a JSON object property.');
}

interface OutputBudget {
  remaining: number;
}

function consumeOutputBudget(budget: OutputBudget, characters: number): void {
  budget.remaining -= characters;
  if (budget.remaining < 0) {
    throw new YamlToolError(
      'OUTPUT_TOO_LARGE',
      `Result exceeds the ${MAX_YAML_OUTPUT_CHARACTERS.toLocaleString('en-US')} character output limit.`,
    );
  }
}

function stringifyJsonValue(
  value: unknown,
  indent: 2 | 4,
  depth: number,
  active: Set<object>,
  diagnostics: YamlDiagnostic[],
  budget: OutputBudget,
): string {
  if (depth > MAX_YAML_DEPTH) {
    throw new YamlToolError('DEPTH_LIMIT', `Alias-expanded JSON nesting exceeds the supported depth of ${MAX_YAML_DEPTH}.`);
  }
  if (value === null) {
    consumeOutputBudget(budget, 4);
    return 'null';
  }
  if (typeof value === 'string') {
    const output = JSON.stringify(value);
    consumeOutputBudget(budget, output.length);
    return output;
  }
  if (typeof value === 'boolean') {
    const output = value ? 'true' : 'false';
    consumeOutputBudget(budget, output.length);
    return output;
  }
  if (typeof value === 'bigint') {
    const output = value.toString();
    consumeOutputBudget(budget, output.length);
    return output;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new YamlToolError('NON_FINITE_NUMBER', 'YAML contains .inf or .nan, which JSON cannot represent.');
    const output = Object.is(value, -0) ? '-0' : JSON.stringify(value);
    consumeOutputBudget(budget, output.length);
    return output;
  }
  if (typeof value !== 'object') {
    throw new YamlToolError('UNSUPPORTED_JSON_VALUE', `YAML resolved to ${typeof value}, which JSON cannot represent.`);
  }
  if (value instanceof Date) {
    diagnostics.push(yamlWarning('TIMESTAMP_TO_STRING', 'A YAML timestamp was converted to an ISO 8601 JSON string.'));
    const output = JSON.stringify(value.toISOString());
    consumeOutputBudget(budget, output.length);
    return output;
  }
  if (active.has(value)) throw new YamlToolError('CYCLIC_ALIAS', 'YAML aliases form a cycle that JSON text cannot represent.');
  active.add(value);
  const padding = ' '.repeat(indent * depth);
  const childPadding = ' '.repeat(indent * (depth + 1));
  let output: string;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      consumeOutputBudget(budget, 2);
      output = '[]';
    } else {
      consumeOutputBudget(budget, 2 + value.length * childPadding.length + (value.length - 1) * 2 + 2 + padding.length);
      output = `[\n${value.map((item) => `${childPadding}${stringifyJsonValue(item, indent, depth + 1, active, diagnostics, budget)}`).join(',\n')}\n${padding}]`;
    }
  } else if (value instanceof Map) {
    const keys = new Set<string>();
    const members: string[] = [];
    for (const [rawKey, item] of value.entries()) {
      const key = normalizeMapKey(rawKey, diagnostics);
      if (keys.has(key)) throw new YamlToolError('JSON_KEY_COLLISION', `Multiple YAML mapping keys convert to the JSON property ${JSON.stringify(key)}.`);
      keys.add(key);
      const serializedKey = JSON.stringify(key);
      consumeOutputBudget(budget, childPadding.length + serializedKey.length + 2);
      members.push(`${childPadding}${serializedKey}: ${stringifyJsonValue(item, indent, depth + 1, active, diagnostics, budget)}`);
    }
    if (members.length) {
      consumeOutputBudget(budget, 2 + (members.length - 1) * 2 + 2 + padding.length);
      output = `{\n${members.join(',\n')}\n${padding}}`;
    } else {
      consumeOutputBudget(budget, 2);
      output = '{}';
    }
  } else {
    throw new YamlToolError('UNSUPPORTED_YAML_TYPE', 'YAML resolved to an application-specific type that this JSON converter does not serialize.');
  }
  active.delete(value);
  return output;
}

function yamlToJson(input: string, options: YamlOptions): YamlOperationResult {
  const parsed = parseYamlInput(input, options);
  if (parsed.transformationBlocker) {
    const blocker = parsed.transformationBlocker;
    throw new YamlToolError(blocker.code, blocker.message, blocker.line, blocker.column);
  }
  const mergeKeyPosition = findYaml11MergeKey(parsed.documents, parsed.lineCounter);
  if (mergeKeyPosition) {
    throw new YamlToolError(
      'MERGE_KEY_UNSUPPORTED',
      'A YAML 1.1 merge key was found. JSON conversion was stopped because LiveParse does not apply merge-key expansion.',
      mergeKeyPosition.line,
      mergeKeyPosition.column,
    );
  }
  preflightYamlToJson(parsed.documents, parsed.lineCounter);
  const unresolvedTag = parsed.diagnostics.find((diagnostic) => diagnostic.code === 'TAG_RESOLVE_FAILED');
  if (unresolvedTag) {
    throw new YamlToolError(
      'CUSTOM_TAG_UNSUPPORTED',
      'YAML contains an unresolved or application-specific tag. JSON conversion was stopped instead of discarding its meaning.',
      unresolvedTag.line,
      unresolvedTag.column,
    );
  }

  const diagnostics = [...parsed.diagnostics];
  const values = parsed.documents.map((document) => {
    try {
      return document.toJS({ mapAsMap: true, maxAliasCount: MAX_YAML_ALIAS_EXPANSION });
    } catch (error) {
      throw new YamlToolError('ALIAS_LIMIT', error instanceof Error ? error.message : 'YAML alias expansion exceeded the safety limit.');
    }
  });
  if (parsed.stats.comments > 0) diagnostics.push(yamlWarning('COMMENTS_DROPPED', 'JSON has no comments, so YAML comments are omitted from the converted data.'));
  if (parsed.stats.aliases > 0) diagnostics.push(yamlWarning('ALIASES_EXPANDED', `YAML aliases were expanded with a maximum alias count of ${MAX_YAML_ALIAS_EXPANSION} per YAML document.`));
  if (values.length > 1) diagnostics.push(yamlWarning('DOCUMENT_STREAM_TO_ARRAY', 'Multiple YAML documents were converted to one top-level JSON array in document order.'));
  const value = values.length === 1 ? values[0] : values;
  const budget: OutputBudget = { remaining: MAX_YAML_OUTPUT_CHARACTERS - 1 };
  const output = ensureOutputLimit(`${stringifyJsonValue(value, options.jsonIndent, 0, new Set(), diagnostics, budget)}\n`);
  const verification = parseLosslessJson(output, { maxDepth: MAX_YAML_DEPTH });
  if (!verification.ok) throw new YamlToolError('INTERNAL_JSON_RESULT', 'The generated JSON did not pass the internal strict JSON check.');
  return { mode: 'yaml-to-json', output, stats: parsed.stats, diagnostics: limitDiagnostics(diagnostics) };
}

function jsonWarningDiagnostic(warning: JsonWarning): YamlDiagnostic {
  const details: Record<JsonWarning['code'], string> = {
    'unsafe-integer': 'The exact JSON integer token was preserved in YAML; JavaScript Number consumers may still lose precision.',
    'number-overflow': 'The exact JSON number token was preserved in YAML even though it overflows JavaScript Number.',
    'number-representation-change': 'The exact JSON number spelling was preserved in YAML.',
    'duplicate-key': 'Duplicate JSON object keys cannot be converted to a unique-key YAML mapping.',
  };
  return {
    code: warning.code.toUpperCase().replace(/-/g, '_'),
    message: details[warning.code],
    line: warning.location.line,
    column: warning.location.column,
  };
}

function inlineJsonNode(node: JsonNode): string | null {
  switch (node.type) {
    case 'string': return node.raw;
    case 'number': return node.raw;
    case 'boolean': return node.value ? 'true' : 'false';
    case 'null': return 'null';
    case 'array': return node.elements.length === 0 ? '[]' : null;
    case 'object': return node.members.length === 0 ? '{}' : null;
  }
}

function jsonNodeToYaml(node: JsonNode, indent: 2 | 4, depth: number): string {
  const inline = inlineJsonNode(node);
  if (inline !== null) return inline;
  const padding = ' '.repeat(indent * depth);
  if (node.type === 'array') {
    return node.elements.map((item) => {
      const childInline = inlineJsonNode(item);
      return childInline !== null
        ? `${padding}- ${childInline}`
        : `${padding}-\n${jsonNodeToYaml(item, indent, depth + 1)}`;
    }).join('\n');
  }
  if (node.type === 'object') {
    return node.members.map((member) => {
      const childInline = inlineJsonNode(member.value);
      const useExplicitKey = member.key.raw.length > 1_000;
      if (useExplicitKey) {
        return childInline !== null
          ? `${padding}? ${member.key.raw}\n${padding}: ${childInline}`
          : `${padding}? ${member.key.raw}\n${padding}:\n${jsonNodeToYaml(member.value, indent, depth + 1)}`;
      }
      return childInline !== null
        ? `${padding}${member.key.raw}: ${childInline}`
        : `${padding}${member.key.raw}:\n${jsonNodeToYaml(member.value, indent, depth + 1)}`;
    }).join('\n');
  }
  return inline ?? '';
}

function jsonToYaml(input: string, options: YamlOptions): YamlOperationResult {
  assertInput(input);
  const parsed = parseLosslessJson(input, { maxDepth: MAX_YAML_DEPTH });
  if (!parsed.ok) {
    throw new YamlToolError(parsed.error.code.toUpperCase().replace(/-/g, '_'), parsed.error.message, parsed.error.location.line, parsed.error.location.column);
  }
  const duplicate = parsed.document.warnings.find((warning) => warning.code === 'duplicate-key');
  if (duplicate) {
    throw new YamlToolError('DUPLICATE_JSON_KEY', duplicate.message, duplicate.location.line, duplicate.location.column);
  }
  const diagnostics = limitDiagnostics(parsed.document.warnings.map(jsonWarningDiagnostic));
  const output = ensureOutputLimit(`${jsonNodeToYaml(parsed.document.root, options.indent, 0)}\n`);
  const verificationOptions: YamlOptions = { ...options, version: '1.2' };
  verifyGeneratedYaml(output, verificationOptions);
  return { mode: 'json-to-yaml', output, jsonStats: parsed.document.stats, diagnostics };
}

export function runYamlOperation(mode: YamlMode, input: string, options: YamlOptions): YamlOperationResult {
  if (options.indent !== 2 && options.indent !== 4) throw new YamlToolError('INVALID_OPTIONS', 'YAML indentation must be 2 or 4 spaces.');
  if (options.jsonIndent !== 2 && options.jsonIndent !== 4) throw new YamlToolError('INVALID_OPTIONS', 'JSON indentation must be 2 or 4 spaces.');
  if (options.version !== '1.2' && options.version !== '1.1') throw new YamlToolError('INVALID_OPTIONS', 'YAML version must be 1.2 or 1.1.');
  switch (mode) {
    case 'format': return formatYaml(input, options);
    case 'validate': return validateYaml(input, options);
    case 'view': return viewYaml(input, options);
    case 'yaml-to-json': return yamlToJson(input, options);
    case 'json-to-yaml': return jsonToYaml(input, options);
  }
}
