import {
  formatJsonPath,
  parseLosslessJson,
  serializeLosslessJson,
  type JsonDocument,
  type JsonNode,
  type JsonParseError,
  type JsonPathSegment,
} from './lossless-json';

export type JsonArrayMode = 'positional' | 'unordered';
export type JsonNumberMode = 'semantic' | 'exact';

export type JsonDifferenceKind =
  | 'type-changed'
  | 'value-changed'
  | 'property-added'
  | 'property-removed'
  | 'array-item-added'
  | 'array-item-removed';

export interface JsonCompareOptions {
  /** Compare array indexes, or compare arrays as multisets. Default: positional. */
  arrayMode?: JsonArrayMode;
  /** Compare mathematical JSON number values, or their exact source tokens. Default: semantic. */
  numberMode?: JsonNumberMode;
  /** Maximum number of detailed differences returned. The total is always counted. Default: 1000. */
  maxDifferences?: number;
  /** Passed to the lossless parser to bound nesting depth. */
  maxDepth?: number;
}

export interface JsonDifference {
  kind: JsonDifferenceKind;
  /** Primary path: the right path for additions, otherwise the left/shared path. */
  path: JsonPathSegment[];
  pathText: string;
  leftPath: JsonPathSegment[] | null;
  leftPathText: string | null;
  rightPath: JsonPathSegment[] | null;
  rightPathText: string | null;
  /** Compact lossless JSON for the value on each side. */
  leftSnippet: string | null;
  rightSnippet: string | null;
  leftType: JsonNode['type'] | null;
  rightType: JsonNode['type'] | null;
}

export interface JsonDiffSummary {
  /** All differences, including details omitted by maxDifferences. */
  totalDifferences: number;
  returnedDifferences: number;
  truncated: boolean;
  byKind: Record<JsonDifferenceKind, number>;
}

export interface JsonCompareInputError {
  side: 'left' | 'right';
  error: JsonParseError;
}

export interface JsonCompareSuccess {
  ok: true;
  left: JsonDocument;
  right: JsonDocument;
  differences: JsonDifference[];
  summary: JsonDiffSummary;
}

export interface JsonCompareFailure {
  ok: false;
  /** Both errors are returned when both documents are invalid. */
  errors: JsonCompareInputError[];
}

export type JsonCompareResult = JsonCompareSuccess | JsonCompareFailure;

export const DEFAULT_MAX_DIFFERENCES = 1_000;
/** A hard UI-safety bound even when a caller supplies an excessively large limit. */
export const MAX_RETURNED_DIFFERENCES = 10_000;

interface ResolvedCompareOptions {
  arrayMode: JsonArrayMode;
  numberMode: JsonNumberMode;
  maxDifferences: number;
}

interface SignedDecimalInteger {
  negative: boolean;
  digits: string;
}

function emptyCounts(): Record<JsonDifferenceKind, number> {
  return {
    'type-changed': 0,
    'value-changed': 0,
    'property-added': 0,
    'property-removed': 0,
    'array-item-added': 0,
    'array-item-removed': 0,
  };
}

function resolveOptions(options: JsonCompareOptions): ResolvedCompareOptions {
  const requestedLimit = options.maxDifferences ?? DEFAULT_MAX_DIFFERENCES;
  const finiteLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.floor(requestedLimit))
    : DEFAULT_MAX_DIFFERENCES;
  return {
    arrayMode: options.arrayMode ?? 'positional',
    numberMode: options.numberMode ?? 'semantic',
    maxDifferences: Math.min(MAX_RETURNED_DIFFERENCES, finiteLimit),
  };
}

function normalizeUnsignedInteger(digits: string): string {
  let index = 0;
  while (index < digits.length - 1 && digits.charCodeAt(index) === 48) index += 1;
  return digits.slice(index);
}

function signedInteger(negative: boolean, digits: string): SignedDecimalInteger {
  const normalized = normalizeUnsignedInteger(digits);
  return { negative: normalized !== '0' && negative, digits: normalized };
}

function compareUnsigned(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function addUnsigned(left: string, right: string): string {
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;
  let carry = 0;
  const reversed: string[] = [];
  while (leftIndex >= 0 || rightIndex >= 0 || carry !== 0) {
    const leftDigit = leftIndex >= 0 ? left.charCodeAt(leftIndex) - 48 : 0;
    const rightDigit = rightIndex >= 0 ? right.charCodeAt(rightIndex) - 48 : 0;
    const sum = leftDigit + rightDigit + carry;
    reversed.push(String(sum % 10));
    carry = Math.floor(sum / 10);
    leftIndex -= 1;
    rightIndex -= 1;
  }
  return reversed.reverse().join('');
}

/** Subtracts right from left. left must be greater than or equal to right. */
function subtractUnsigned(left: string, right: string): string {
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;
  let borrow = 0;
  const reversed: string[] = [];
  while (leftIndex >= 0) {
    let digit = left.charCodeAt(leftIndex) - 48 - borrow;
    const rightDigit = rightIndex >= 0 ? right.charCodeAt(rightIndex) - 48 : 0;
    if (digit < rightDigit) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    reversed.push(String(digit - rightDigit));
    leftIndex -= 1;
    rightIndex -= 1;
  }
  return normalizeUnsignedInteger(reversed.reverse().join(''));
}

function addSigned(left: SignedDecimalInteger, right: SignedDecimalInteger): SignedDecimalInteger {
  if (left.negative === right.negative) {
    return signedInteger(left.negative, addUnsigned(left.digits, right.digits));
  }
  const comparison = compareUnsigned(left.digits, right.digits);
  if (comparison === 0) return signedInteger(false, '0');
  if (comparison > 0) return signedInteger(left.negative, subtractUnsigned(left.digits, right.digits));
  return signedInteger(right.negative, subtractUnsigned(right.digits, left.digits));
}

function smallSignedInteger(value: number): SignedDecimalInteger {
  return signedInteger(value < 0, String(Math.abs(value)));
}

function formatSignedInteger(value: SignedDecimalInteger): string {
  return `${value.negative ? '-' : ''}${value.digits}`;
}

/**
 * Creates an exact canonical decimal key without converting through Number.
 * It consequently handles unsafe integers and arbitrarily large exponents.
 */
function semanticNumberKey(raw: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?)(\d+))?$/.exec(raw);
  if (!match) throw new Error(`Cannot compare invalid JSON number: ${raw}`);

  const fraction = match[3] ?? '';
  let digits = `${match[2]}${fraction}`;
  let firstNonZero = 0;
  while (firstNonZero < digits.length && digits.charCodeAt(firstNonZero) === 48) firstNonZero += 1;
  if (firstNonZero === digits.length) return '0';
  digits = digits.slice(firstNonZero);

  let trailingZeroes = 0;
  while (digits.charCodeAt(digits.length - 1 - trailingZeroes) === 48) trailingZeroes += 1;
  if (trailingZeroes > 0) digits = digits.slice(0, -trailingZeroes);

  const exponentDigits = match[5] ?? '0';
  const exponent = signedInteger(match[4] === '-', exponentDigits);
  const adjustedExponent = addSigned(exponent, smallSignedInteger(trailingZeroes - fraction.length));
  return `${match[1] === '-' ? '-' : ''}${digits}e${formatSignedInteger(adjustedExponent)}`;
}

function encodeFingerprintPart(value: string): string {
  return `${value.length}:${value}`;
}

class DifferenceCollector {
  readonly differences: JsonDifference[] = [];
  readonly byKind = emptyCounts();
  totalDifferences = 0;

  constructor(private readonly maxDifferences: number) {}

  add(
    kind: JsonDifferenceKind,
    leftPath: readonly JsonPathSegment[] | null,
    rightPath: readonly JsonPathSegment[] | null,
    left: JsonNode | null,
    right: JsonNode | null,
  ): void {
    this.totalDifferences += 1;
    this.byKind[kind] += 1;
    if (this.differences.length >= this.maxDifferences) return;

    const copiedLeftPath = leftPath ? [...leftPath] : null;
    const copiedRightPath = rightPath ? [...rightPath] : null;
    const primaryPath = copiedRightPath ?? copiedLeftPath ?? [];
    this.differences.push({
      kind,
      path: [...primaryPath],
      pathText: formatJsonPath(primaryPath),
      leftPath: copiedLeftPath,
      leftPathText: copiedLeftPath ? formatJsonPath(copiedLeftPath) : null,
      rightPath: copiedRightPath,
      rightPathText: copiedRightPath ? formatJsonPath(copiedRightPath) : null,
      leftSnippet: left ? serializeLosslessJson(left, { indent: 0 }) : null,
      rightSnippet: right ? serializeLosslessJson(right, { indent: 0 }) : null,
      leftType: left?.type ?? null,
      rightType: right?.type ?? null,
    });
  }

  summary(): JsonDiffSummary {
    return {
      totalDifferences: this.totalDifferences,
      returnedDifferences: this.differences.length,
      truncated: this.totalDifferences > this.differences.length,
      byKind: { ...this.byKind },
    };
  }
}

class JsonDiffer {
  private readonly leftFingerprints = new WeakMap<JsonNode, string>();
  private readonly rightFingerprints = new WeakMap<JsonNode, string>();

  constructor(
    private readonly options: ResolvedCompareOptions,
    private readonly collector: DifferenceCollector,
  ) {}

  compare(left: JsonNode, right: JsonNode): void {
    this.diffNode(left, right, [], []);
  }

  private diffNode(
    left: JsonNode,
    right: JsonNode,
    leftPath: readonly JsonPathSegment[],
    rightPath: readonly JsonPathSegment[],
  ): void {
    if (left.type !== right.type) {
      this.collector.add('type-changed', leftPath, rightPath, left, right);
      return;
    }

    switch (left.type) {
      case 'null':
        return;
      case 'boolean':
        if (left.value !== (right as typeof left).value) {
          this.collector.add('value-changed', leftPath, rightPath, left, right);
        }
        return;
      case 'string':
        if (left.value !== (right as typeof left).value) {
          this.collector.add('value-changed', leftPath, rightPath, left, right);
        }
        return;
      case 'number': {
        const rightNumber = right as typeof left;
        const equal = this.options.numberMode === 'exact'
          ? left.raw === rightNumber.raw
          : semanticNumberKey(left.raw) === semanticNumberKey(rightNumber.raw);
        if (!equal) this.collector.add('value-changed', leftPath, rightPath, left, right);
        return;
      }
      case 'object':
        this.diffObject(left, right as typeof left, leftPath, rightPath);
        return;
      case 'array':
        this.diffArray(left, right as typeof left, leftPath, rightPath);
        return;
    }
  }

  private diffObject(
    left: Extract<JsonNode, { type: 'object' }>,
    right: Extract<JsonNode, { type: 'object' }>,
    leftPath: readonly JsonPathSegment[],
    rightPath: readonly JsonPathSegment[],
  ): void {
    const leftGroups = new Map<string, typeof left.members>();
    const rightGroups = new Map<string, typeof right.members>();
    for (const member of left.members) {
      const group = leftGroups.get(member.key.value);
      if (group) group.push(member);
      else leftGroups.set(member.key.value, [member]);
    }
    for (const member of right.members) {
      const group = rightGroups.get(member.key.value);
      if (group) group.push(member);
      else rightGroups.set(member.key.value, [member]);
    }

    for (const [key, leftMembers] of leftGroups) {
      const rightMembers = rightGroups.get(key) ?? [];
      const sharedCount = Math.min(leftMembers.length, rightMembers.length);
      for (let index = 0; index < sharedCount; index += 1) {
        const occurrence = index + 1;
        this.diffNode(
          leftMembers[index].value,
          rightMembers[index].value,
          [...leftPath, { type: 'property', key, occurrence }],
          [...rightPath, { type: 'property', key, occurrence }],
        );
      }
      for (let index = sharedCount; index < leftMembers.length; index += 1) {
        const path = [...leftPath, { type: 'property' as const, key, occurrence: index + 1 }];
        this.collector.add('property-removed', path, null, leftMembers[index].value, null);
      }
      for (let index = sharedCount; index < rightMembers.length; index += 1) {
        const path = [...rightPath, { type: 'property' as const, key, occurrence: index + 1 }];
        this.collector.add('property-added', null, path, null, rightMembers[index].value);
      }
    }

    for (const [key, rightMembers] of rightGroups) {
      if (leftGroups.has(key)) continue;
      for (let index = 0; index < rightMembers.length; index += 1) {
        const path = [...rightPath, { type: 'property' as const, key, occurrence: index + 1 }];
        this.collector.add('property-added', null, path, null, rightMembers[index].value);
      }
    }
  }

  private diffArray(
    left: Extract<JsonNode, { type: 'array' }>,
    right: Extract<JsonNode, { type: 'array' }>,
    leftPath: readonly JsonPathSegment[],
    rightPath: readonly JsonPathSegment[],
  ): void {
    if (this.options.arrayMode === 'unordered') {
      this.diffUnorderedArray(left, right, leftPath, rightPath);
      return;
    }

    const sharedCount = Math.min(left.elements.length, right.elements.length);
    for (let index = 0; index < sharedCount; index += 1) {
      this.diffNode(
        left.elements[index],
        right.elements[index],
        [...leftPath, { type: 'index', index }],
        [...rightPath, { type: 'index', index }],
      );
    }
    for (let index = sharedCount; index < left.elements.length; index += 1) {
      const path = [...leftPath, { type: 'index' as const, index }];
      this.collector.add('array-item-removed', path, null, left.elements[index], null);
    }
    for (let index = sharedCount; index < right.elements.length; index += 1) {
      const path = [...rightPath, { type: 'index' as const, index }];
      this.collector.add('array-item-added', null, path, null, right.elements[index]);
    }
  }

  private diffUnorderedArray(
    left: Extract<JsonNode, { type: 'array' }>,
    right: Extract<JsonNode, { type: 'array' }>,
    leftPath: readonly JsonPathSegment[],
    rightPath: readonly JsonPathSegment[],
  ): void {
    const rightBuckets = new Map<string, number[]>();
    for (let index = 0; index < right.elements.length; index += 1) {
      const fingerprint = this.fingerprint(right.elements[index], this.rightFingerprints);
      const bucket = rightBuckets.get(fingerprint);
      if (bucket) bucket.push(index);
      else rightBuckets.set(fingerprint, [index]);
    }

    const bucketOffsets = new Map<string, number>();
    const matchedLeft = new Uint8Array(left.elements.length);
    const matchedRight = new Uint8Array(right.elements.length);
    for (let index = 0; index < left.elements.length; index += 1) {
      const fingerprint = this.fingerprint(left.elements[index], this.leftFingerprints);
      const bucket = rightBuckets.get(fingerprint);
      const offset = bucketOffsets.get(fingerprint) ?? 0;
      if (!bucket || offset >= bucket.length) continue;
      matchedLeft[index] = 1;
      matchedRight[bucket[offset]] = 1;
      bucketOffsets.set(fingerprint, offset + 1);
    }

    for (let index = 0; index < left.elements.length; index += 1) {
      if (matchedLeft[index] !== 0) continue;
      const path = [...leftPath, { type: 'index' as const, index }];
      this.collector.add('array-item-removed', path, null, left.elements[index], null);
    }
    for (let index = 0; index < right.elements.length; index += 1) {
      if (matchedRight[index] !== 0) continue;
      const path = [...rightPath, { type: 'index' as const, index }];
      this.collector.add('array-item-added', null, path, null, right.elements[index]);
    }
  }

  private fingerprint(node: JsonNode, cache: WeakMap<JsonNode, string>): string {
    const cached = cache.get(node);
    if (cached !== undefined) return cached;

    let result: string;
    switch (node.type) {
      case 'null':
        result = 'z';
        break;
      case 'boolean':
        result = node.value ? 'b1' : 'b0';
        break;
      case 'string':
        result = `s${encodeFingerprintPart(node.value)}`;
        break;
      case 'number': {
        const number = this.options.numberMode === 'exact' ? node.raw : semanticNumberKey(node.raw);
        result = `n${encodeFingerprintPart(number)}`;
        break;
      }
      case 'array': {
        const elements = node.elements.map((element) => this.fingerprint(element, cache));
        if (this.options.arrayMode === 'unordered') elements.sort();
        result = `a${elements.length}:${elements.map(encodeFingerprintPart).join('')}`;
        break;
      }
      case 'object': {
        const groups = new Map<string, JsonNode[]>();
        for (const member of node.members) {
          const group = groups.get(member.key.value);
          if (group) group.push(member.value);
          else groups.set(member.key.value, [member.value]);
        }
        const keys = [...groups.keys()].sort();
        const members = keys.map((key) => {
          const values = groups.get(key)!;
          const encodedValues = values
            .map((value) => encodeFingerprintPart(this.fingerprint(value, cache)))
            .join('');
          return `${encodeFingerprintPart(key)}${values.length}:${encodedValues}`;
        });
        result = `o${keys.length}:${members.map(encodeFingerprintPart).join('')}`;
        break;
      }
    }
    cache.set(node, result);
    return result;
  }
}

/** Parse and compare two strict JSON documents without converting through native JSON values. */
export function compareJson(
  leftSource: string,
  rightSource: string,
  options: JsonCompareOptions = {},
): JsonCompareResult {
  const parseOptions = options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth };
  const leftResult = parseLosslessJson(leftSource, parseOptions);
  const rightResult = parseLosslessJson(rightSource, parseOptions);
  const errors: JsonCompareInputError[] = [];
  if (!leftResult.ok) errors.push({ side: 'left', error: leftResult.error });
  if (!rightResult.ok) errors.push({ side: 'right', error: rightResult.error });
  if (!leftResult.ok || !rightResult.ok) return { ok: false, errors };

  const resolvedOptions = resolveOptions(options);
  const collector = new DifferenceCollector(resolvedOptions.maxDifferences);
  const differ = new JsonDiffer(resolvedOptions, collector);
  differ.compare(leftResult.document.root, rightResult.document.root);
  return {
    ok: true,
    left: leftResult.document,
    right: rightResult.document,
    differences: collector.differences,
    summary: collector.summary(),
  };
}
