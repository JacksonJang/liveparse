import { analyzeJsonNumber } from './number-analysis';
import { buildLineStarts, formatJsonPath, locationFromLineStarts } from './location';
import { buildJsonStats } from './stats';
import type {
  DuplicateKeyWarning,
  JsonArrayNode,
  JsonBooleanNode,
  JsonDocument,
  JsonMember,
  JsonNode,
  JsonNullNode,
  JsonNumberNode,
  JsonObjectNode,
  JsonParseError,
  JsonParseErrorCode,
  JsonParseOptions,
  JsonParseResult,
  JsonPathSegment,
  JsonSourceRange,
  JsonStringNode,
  JsonWarning,
  NumberOverflowWarning,
  NumberRepresentationChangeWarning,
  UnsafeIntegerWarning,
} from './types';

const DEFAULT_MAX_DEPTH = 512;

class JsonParseFailure extends Error {
  constructor(readonly diagnostic: JsonParseError) {
    super(diagnostic.message);
  }
}

class LosslessJsonParser {
  private index = 0;
  private readonly warnings: JsonWarning[] = [];
  private readonly lineStarts: number[];
  private readonly maxDepth: number;

  constructor(private readonly source: string, options: JsonParseOptions) {
    this.lineStarts = buildLineStarts(source);
    const requestedDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxDepth = Number.isFinite(requestedDepth) ? Math.max(0, Math.floor(requestedDepth)) : DEFAULT_MAX_DEPTH;
  }

  parse(): JsonDocument {
    this.skipWhitespace();
    if (this.index >= this.source.length) {
      this.fail('unexpected-end', 'Expected a JSON value but reached the end of the input.', this.index, this.index, []);
    }

    const root = this.parseValue([], 0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      this.fail('trailing-content', 'Unexpected content after the top-level JSON value.', this.index, this.index + 1, []);
    }

    return {
      source: this.source,
      root,
      warnings: this.warnings,
      stats: buildJsonStats(root, this.source.length),
    };
  }

  private parseValue(path: JsonPathSegment[], depth: number): JsonNode {
    if (depth > this.maxDepth) {
      this.fail(
        'max-depth-exceeded',
        `JSON nesting exceeds the configured maximum depth of ${this.maxDepth}.`,
        this.index,
        Math.min(this.source.length, this.index + 1),
        path,
      );
    }
    if (this.index >= this.source.length) {
      this.fail('unexpected-end', 'Expected a JSON value but reached the end of the input.', this.index, this.index, path);
    }

    const code = this.source.charCodeAt(this.index);
    if (code === 123) return this.parseObject(path, depth); // {
    if (code === 91) return this.parseArray(path, depth); // [
    if (code === 34) return this.parseString(path); // "
    if (code === 45 || (code >= 48 && code <= 57)) return this.parseNumber(path); // - or digit
    if (this.source.startsWith('true', this.index)) return this.parseBoolean(true);
    if (this.source.startsWith('false', this.index)) return this.parseBoolean(false);
    if (this.source.startsWith('null', this.index)) return this.parseNull();

    this.fail(
      'unexpected-token',
      `Unexpected token ${JSON.stringify(this.source[this.index])}; expected a JSON value.`,
      this.index,
      this.index + 1,
      path,
    );
  }

  private parseObject(path: JsonPathSegment[], depth: number): JsonObjectNode {
    const start = this.index;
    this.index += 1;
    this.skipWhitespace();
    const members: JsonMember[] = [];
    const firstMemberByKey = new Map<string, JsonMember>();
    const occurrenceByKey = new Map<string, number>();

    if (this.source.charCodeAt(this.index) === 125) {
      this.index += 1;
      return { type: 'object', members, start, end: this.index };
    }

    while (this.index < this.source.length) {
      if (this.source.charCodeAt(this.index) !== 34) {
        this.fail(
          'expected-property',
          'Expected a double-quoted object property name.',
          this.index,
          Math.min(this.source.length, this.index + 1),
          path,
        );
      }

      const key = this.parseString(path);
      const occurrence = (occurrenceByKey.get(key.value) ?? 0) + 1;
      occurrenceByKey.set(key.value, occurrence);
      const memberPath: JsonPathSegment[] = [...path, { type: 'property', key: key.value, occurrence }];

      this.skipWhitespace();
      if (this.source.charCodeAt(this.index) !== 58) {
        this.fail(
          'expected-colon',
          'Expected a colon after the object property name.',
          this.index,
          Math.min(this.source.length, this.index + 1),
          memberPath,
        );
      }
      this.index += 1;
      this.skipWhitespace();
      const value = this.parseValue(memberPath, depth + 1);
      const firstMember = firstMemberByKey.get(key.value);
      const member: JsonMember = {
        type: 'member',
        key,
        value,
        start: key.start,
        end: value.end,
        occurrence,
        duplicate: firstMember !== undefined,
      };
      members.push(member);

      if (firstMember) {
        firstMember.duplicate = true;
        this.addDuplicateWarning(key, occurrence, firstMember.key, memberPath);
      } else {
        firstMemberByKey.set(key.value, member);
      }

      this.skipWhitespace();
      const delimiter = this.source.charCodeAt(this.index);
      if (delimiter === 125) {
        this.index += 1;
        return { type: 'object', members, start, end: this.index };
      }
      if (delimiter !== 44) {
        if (this.index >= this.source.length) {
          this.fail('unexpected-end', 'Unterminated object; expected a comma or closing brace.', this.index, this.index, path);
        }
        this.fail(
          'expected-comma-or-end',
          'Expected a comma or closing brace after the object member.',
          this.index,
          this.index + 1,
          path,
        );
      }
      this.index += 1;
      this.skipWhitespace();
      if (this.source.charCodeAt(this.index) === 125) {
        this.fail('trailing-comma', 'Trailing commas are not valid JSON.', this.index - 1, this.index, path);
      }
    }

    this.fail('unexpected-end', 'Unterminated object; expected a closing brace.', this.index, this.index, path);
  }

  private parseArray(path: JsonPathSegment[], depth: number): JsonArrayNode {
    const start = this.index;
    this.index += 1;
    this.skipWhitespace();
    const elements: JsonNode[] = [];

    if (this.source.charCodeAt(this.index) === 93) {
      this.index += 1;
      return { type: 'array', elements, start, end: this.index };
    }

    while (this.index < this.source.length) {
      const elementPath: JsonPathSegment[] = [...path, { type: 'index', index: elements.length }];
      elements.push(this.parseValue(elementPath, depth + 1));
      this.skipWhitespace();
      const delimiter = this.source.charCodeAt(this.index);
      if (delimiter === 93) {
        this.index += 1;
        return { type: 'array', elements, start, end: this.index };
      }
      if (delimiter !== 44) {
        if (this.index >= this.source.length) {
          this.fail('unexpected-end', 'Unterminated array; expected a comma or closing bracket.', this.index, this.index, path);
        }
        this.fail(
          'expected-comma-or-end',
          'Expected a comma or closing bracket after the array element.',
          this.index,
          this.index + 1,
          path,
        );
      }
      this.index += 1;
      this.skipWhitespace();
      if (this.source.charCodeAt(this.index) === 93) {
        this.fail('trailing-comma', 'Trailing commas are not valid JSON.', this.index - 1, this.index, path);
      }
    }

    this.fail('unexpected-end', 'Unterminated array; expected a closing bracket.', this.index, this.index, path);
  }

  private parseString(path: JsonPathSegment[]): JsonStringNode {
    const start = this.index;
    this.index += 1;
    let chunkStart = this.index;
    const decoded: string[] = [];

    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 34) {
        decoded.push(this.source.slice(chunkStart, this.index));
        this.index += 1;
        return {
          type: 'string',
          value: decoded.join(''),
          raw: this.source.slice(start, this.index),
          start,
          end: this.index,
        };
      }
      if (code < 32) {
        this.fail('invalid-string', 'Unescaped control characters are not valid inside JSON strings.', this.index, this.index + 1, path);
      }
      if (code !== 92) {
        this.index += 1;
        continue;
      }

      decoded.push(this.source.slice(chunkStart, this.index));
      const escapeStart = this.index;
      this.index += 1;
      if (this.index >= this.source.length) {
        this.fail('unexpected-end', 'Unterminated escape sequence in JSON string.', escapeStart, this.index, path);
      }

      const escaped = this.source[this.index];
      const simpleEscapes: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (escaped in simpleEscapes) {
        decoded.push(simpleEscapes[escaped]);
        this.index += 1;
        chunkStart = this.index;
        continue;
      }
      if (escaped !== 'u') {
        this.fail('invalid-escape', `Invalid JSON string escape \\${escaped}.`, escapeStart, this.index + 1, path);
      }

      const hexStart = this.index + 1;
      const hexEnd = hexStart + 4;
      const hex = this.source.slice(hexStart, hexEnd);
      if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        this.fail(
          'invalid-unicode-escape',
          'A JSON Unicode escape must contain exactly four hexadecimal digits.',
          escapeStart,
          Math.min(this.source.length, hexEnd),
          path,
        );
      }
      decoded.push(String.fromCharCode(Number.parseInt(hex, 16)));
      this.index = hexEnd;
      chunkStart = this.index;
    }

    this.fail('unexpected-end', 'Unterminated JSON string.', start, this.index, path);
  }

  private parseNumber(path: JsonPathSegment[]): JsonNumberNode {
    const start = this.index;
    if (this.source.charCodeAt(this.index) === 45) {
      this.index += 1;
      if (this.index >= this.source.length) {
        this.fail('invalid-number', 'A minus sign must be followed by a JSON number.', start, this.index, path);
      }
    }

    const firstDigit = this.source.charCodeAt(this.index);
    if (firstDigit === 48) {
      this.index += 1;
      const next = this.source.charCodeAt(this.index);
      if (next >= 48 && next <= 57) {
        this.fail('invalid-number', 'Leading zeroes are not valid in JSON numbers.', start, this.index + 1, path);
      }
    } else if (firstDigit >= 49 && firstDigit <= 57) {
      this.index += 1;
      while (this.isDigit(this.source.charCodeAt(this.index))) this.index += 1;
    } else {
      this.fail('invalid-number', 'Expected a decimal digit in the JSON number.', start, Math.min(this.source.length, this.index + 1), path);
    }

    if (this.source.charCodeAt(this.index) === 46) {
      this.index += 1;
      const fractionStart = this.index;
      while (this.isDigit(this.source.charCodeAt(this.index))) this.index += 1;
      if (fractionStart === this.index) {
        this.fail('invalid-number', 'A decimal point must be followed by at least one digit.', start, this.index, path);
      }
    }

    const exponentMarker = this.source.charCodeAt(this.index);
    if (exponentMarker === 69 || exponentMarker === 101) {
      this.index += 1;
      const sign = this.source.charCodeAt(this.index);
      if (sign === 43 || sign === 45) this.index += 1;
      const exponentStart = this.index;
      while (this.isDigit(this.source.charCodeAt(this.index))) this.index += 1;
      if (exponentStart === this.index) {
        this.fail('invalid-number', 'An exponent must contain at least one digit.', start, this.index, path);
      }
    }

    const raw = this.source.slice(start, this.index);
    const node: JsonNumberNode = { type: 'number', raw, start, end: this.index };
    this.addNumberWarnings(node, path);
    return node;
  }

  private parseBoolean(value: boolean): JsonBooleanNode {
    const start = this.index;
    this.index += value ? 4 : 5;
    return { type: 'boolean', value, start, end: this.index };
  }

  private parseNull(): JsonNullNode {
    const start = this.index;
    this.index += 4;
    return { type: 'null', start, end: this.index };
  }

  private addNumberWarnings(node: JsonNumberNode, path: JsonPathSegment[]): void {
    const analysis = analyzeJsonNumber(node.raw);
    const range: JsonSourceRange = { start: node.start, end: node.end };
    const common = {
      range,
      location: locationFromLineStarts(this.lineStarts, node.start),
      path: [...path],
      pathText: formatJsonPath(path),
      raw: node.raw,
    };

    if (analysis.overflow) {
      const warning: NumberOverflowWarning = {
        ...common,
        code: 'number-overflow',
        message: `${node.raw} exceeds the finite JavaScript Number range and would serialize as null.`,
      };
      this.warnings.push(warning);
      return;
    }
    if (analysis.unsafeInteger) {
      const warning: UnsafeIntegerWarning = {
        ...common,
        code: 'unsafe-integer',
        message: `${node.raw} is outside JavaScript's safe integer range and may lose precision in Number conversions.`,
      };
      this.warnings.push(warning);
    }
    if (analysis.representationChanged && analysis.javascriptRepresentation !== undefined) {
      const warning: NumberRepresentationChangeWarning = {
        ...common,
        code: 'number-representation-change',
        message: `JavaScript Number serialization would change ${node.raw} to ${analysis.javascriptRepresentation}.`,
        javascriptRepresentation: analysis.javascriptRepresentation,
        valueChanged: analysis.valueChanged,
      };
      this.warnings.push(warning);
    }
  }

  private addDuplicateWarning(
    key: JsonStringNode,
    occurrence: number,
    firstKey: JsonStringNode,
    path: JsonPathSegment[],
  ): void {
    const warning: DuplicateKeyWarning = {
      code: 'duplicate-key',
      message: `Object key ${JSON.stringify(key.value)} appears more than once; all occurrences are preserved.`,
      key: key.value,
      occurrence,
      range: { start: key.start, end: key.end },
      location: locationFromLineStarts(this.lineStarts, key.start),
      firstRange: { start: firstKey.start, end: firstKey.end },
      firstLocation: locationFromLineStarts(this.lineStarts, firstKey.start),
      path: [...path],
      pathText: formatJsonPath(path),
    };
    this.warnings.push(warning);
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return;
      this.index += 1;
    }
  }

  private isDigit(code: number): boolean {
    return code >= 48 && code <= 57;
  }

  private fail(
    code: JsonParseErrorCode,
    message: string,
    start: number,
    end: number,
    path: JsonPathSegment[],
  ): never {
    const boundedStart = Math.max(0, Math.min(this.source.length, start));
    const boundedEnd = Math.max(boundedStart, Math.min(this.source.length, end));
    throw new JsonParseFailure({
      code,
      message,
      range: { start: boundedStart, end: boundedEnd },
      location: locationFromLineStarts(this.lineStarts, boundedStart),
      path: [...path],
      pathText: formatJsonPath(path),
    });
  }
}

export function parseLosslessJson(source: string, options: JsonParseOptions = {}): JsonParseResult {
  try {
    return { ok: true, document: new LosslessJsonParser(source, options).parse() };
  } catch (error) {
    if (error instanceof JsonParseFailure) return { ok: false, error: error.diagnostic };
    throw error;
  }
}
