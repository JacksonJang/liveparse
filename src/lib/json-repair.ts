import { parseLosslessJson } from './lossless-json';

export type RepairConfidence = 'high' | 'medium' | 'low';
export type RepairCertainty = 'deterministic' | 'assumption';

export type RepairChangeKind =
  | 'extract-json'
  | 'remove-code-fence'
  | 'convert-single-quoted-string'
  | 'escape-string-character'
  | 'remove-line-comment'
  | 'remove-block-comment'
  | 'replace-python-literal'
  | 'remove-trailing-comma'
  | 'remove-dangling-comma'
  | 'insert-missing-value'
  | 'close-string'
  | 'close-container';

export type RepairLocation = {
  offset: number;
  line: number;
  column: number;
};

export type RepairChange = {
  id: string;
  kind: RepairChangeKind;
  certainty: RepairCertainty;
  message: string;
  before: string;
  after: string;
  location: RepairLocation;
};

export type LosslessWarningSummary = {
  code: string;
  message: string;
  path: string;
  location: RepairLocation;
};

export type DiffFragment = {
  text: string;
  changed: boolean;
};

export type DiffRow = {
  kind: 'equal' | 'delete' | 'insert' | 'replace';
  beforeLine?: number;
  afterLine?: number;
  before: DiffFragment[];
  after: DiffFragment[];
};

type RepairBase = {
  input: string;
  changes: RepairChange[];
  assumptions: string[];
  diff: DiffRow[];
};

export type RepairSuccess = RepairBase & {
  ok: true;
  repaired: string;
  confidence: RepairConfidence;
  confidenceScore: number;
  losslessWarnings: LosslessWarningSummary[];
};

export type RepairFailure = RepairBase & {
  ok: false;
  attempted: string;
  error: string;
  errorLocation?: RepairLocation;
};

export type RepairResult = RepairSuccess | RepairFailure;

type ChangeInput = Omit<RepairChange, 'id' | 'location'> & { offset: number };
type RecordChange = (change: ChangeInput) => void;

type Candidate = {
  text: string;
  start: number;
  end: number;
};

type LineBreak = {
  start: number;
  end: number;
};

const JSON_SCALAR_START = /^(?:"|'|-?\d|true\b|false\b|null\b|True\b|False\b|None\b)/;
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/;

function findLineBreak(source: string, from: number, until = source.length): LineBreak | null {
  for (let index = from; index < until; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 10) return { start: index, end: index + 1 };
    if (code === 13) {
      return {
        start: index,
        end: index + 1 < until && source.charCodeAt(index + 1) === 10 ? index + 2 : index + 1,
      };
    }
  }
  return null;
}

export function repairJson(input: string): RepairResult {
  const changes: RepairChange[] = [];
  const assumptions: string[] = [];
  const lineStarts = buildLineStarts(input);
  const record: RecordChange = (change) => {
    const item: RepairChange = {
      ...change,
      id: `repair-${changes.length + 1}`,
      location: offsetToLocation(input, clamp(change.offset, 0, input.length), lineStarts),
    };
    changes.push(item);
    if (item.certainty === 'assumption' && !assumptions.includes(item.message)) {
      assumptions.push(item.message);
    }
  };

  if (!input.trim()) {
    return failure(input, '', changes, assumptions, 'Paste malformed JSON to begin.');
  }

  const candidate = selectCandidate(input, record);
  if (!candidate) {
    return failure(
      input,
      '',
      changes,
      assumptions,
      'No JSON object, array, string, number, boolean, or null value could be identified.',
    );
  }

  const lexical = repairLexicalSyntax(candidate, input, record);
  if (!lexical.ok) {
    return failure(input, lexical.text, changes, assumptions, lexical.error);
  }

  const completed = completeTruncatedJson(lexical.text, candidate.end, record);
  if (!completed.ok) {
    return failure(input, completed.text, changes, assumptions, completed.error);
  }

  const repaired = completed.text.trim();
  const parsed = parseLosslessJson(repaired);
  if (!parsed.ok) {
    const diagnostic = parsed.error as unknown as {
      message: string;
      location?: { offset?: number; line?: number; column?: number };
    };
    const errorLocation = diagnostic.location
      ? {
          offset: diagnostic.location.offset ?? 0,
          line: diagnostic.location.line ?? 1,
          column: diagnostic.location.column ?? 1,
        }
      : undefined;
    return failure(input, repaired, changes, assumptions, diagnostic.message, errorLocation);
  }

  const losslessWarnings = parsed.document.warnings.map((rawWarning) => {
    const warning = rawWarning as unknown as {
      code: string;
      message: string;
      pathText?: string;
      location?: { offset?: number; line?: number; column?: number };
    };
    return {
      code: warning.code,
      message: warning.message,
      path: warning.pathText || '$',
      location: {
        offset: warning.location?.offset ?? 0,
        line: warning.location?.line ?? 1,
        column: warning.location?.column ?? 1,
      },
    };
  });
  const confidenceScore = calculateConfidence(changes);

  return {
    ok: true,
    input,
    repaired,
    changes,
    assumptions,
    confidenceScore,
    confidence: confidenceLabel(confidenceScore),
    losslessWarnings,
    diff: buildDiffRows(input, repaired),
  };
}

function failure(
  input: string,
  attempted: string,
  changes: RepairChange[],
  assumptions: string[],
  error: string,
  errorLocation?: RepairLocation,
): RepairFailure {
  return {
    ok: false,
    input,
    attempted,
    changes,
    assumptions,
    error,
    errorLocation,
    diff: buildDiffRows(input, attempted),
  };
}

function selectCandidate(input: string, record: RecordChange): Candidate | null {
  const fenced = findFencedRegion(input);
  const regionStart = fenced?.start ?? 0;
  const regionEnd = fenced?.end ?? input.length;
  const bounds = findJsonBounds(input, regionStart, regionEnd);
  if (!bounds) return null;

  const removedPrefix = input.slice(0, bounds.start);
  const removedSuffix = input.slice(bounds.end);
  const removedNonWhitespace = Boolean(`${removedPrefix}${removedSuffix}`.trim());

  if (fenced) {
    record({
      kind: 'remove-code-fence',
      certainty: fenced.closed ? 'deterministic' : 'assumption',
      message: fenced.closed
        ? 'Removed the Markdown code fence and text outside the JSON value.'
        : 'Assumed an unclosed Markdown fence continued to the end of the input.',
      before: `${removedPrefix}${removedSuffix}`,
      after: '',
      offset: fenced.openOffset,
    });
  } else if (removedNonWhitespace) {
    record({
      kind: 'extract-json',
      certainty: 'assumption',
      message: 'Assumed the first JSON-looking value was the intended payload and removed surrounding prose.',
      before: `${removedPrefix}${removedSuffix}`,
      after: '',
      offset: 0,
    });
  }

  return {
    text: input.slice(bounds.start, bounds.end),
    start: bounds.start,
    end: bounds.end,
  };
}

function findFencedRegion(input: string): { start: number; end: number; openOffset: number; closed: boolean } | null {
  let searchFrom = 0;
  while (searchFrom < input.length) {
    const openOffset = input.indexOf('```', searchFrom);
    if (openOffset < 0) return null;
    const afterTicks = openOffset + 3;
    const lineBreak = findLineBreak(input, afterTicks);
    const openingLineEnd = lineBreak?.start ?? input.length;
    const label = input.slice(afterTicks, openingLineEnd).trim().toLowerCase();
    const contentStart = lineBreak?.end ?? afterTicks;
    const closeOffset = input.indexOf('```', contentStart);
    const contentEnd = closeOffset < 0 ? input.length : closeOffset;
    const content = input.slice(contentStart, contentEnd).trimStart();
    const labelLooksRelevant = !label || /^(?:json|jsonc|javascript|js|typescript|ts)$/.test(label);
    if (labelLooksRelevant && looksLikeJsonContent(content)) {
      return { start: contentStart, end: contentEnd, openOffset, closed: closeOffset >= 0 };
    }
    searchFrom = closeOffset < 0 ? input.length : closeOffset + 3;
  }
  return null;
}

function findJsonBounds(input: string, regionStart: number, regionEnd: number): { start: number; end: number } | null {
  let start = regionStart;
  while (start < regionEnd && isWhitespace(input[start])) start += 1;
  let trimmedEnd = regionEnd;
  while (trimmedEnd > start && isWhitespace(input[trimmedEnd - 1])) trimmedEnd -= 1;
  if (start >= trimmedEnd) return null;

  if (!looksLikeJsonContent(input.slice(start, trimmedEnd))) {
    const objectStart = findFirstContainerStart(input, start, trimmedEnd);
    if (objectStart < 0) return null;
    start = objectStart;
  }

  const first = input[start];
  if (first === '{' || first === '[') {
    const balancedEnd = findBalancedEnd(input, start, trimmedEnd);
    return { start, end: balancedEnd ?? trimmedEnd };
  }
  return { start, end: trimmedEnd };
}

function looksLikeJsonContent(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || JSON_SCALAR_START.test(trimmed);
}

function findFirstContainerStart(input: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (input[index] === '{' || input[index] === '[') return index;
  }
  return -1;
}

function findBalancedEnd(input: string, start: number, end: number): number | null {
  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start; index < end; index += 1) {
    const character = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote && (quote === '"' || isLikelySingleQuoteTerminator(input, index))) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && input[index + 1] === '/') {
      const lineBreak = findLineBreak(input, index + 2, end);
      index = lineBreak ? lineBreak.end - 1 : end;
      continue;
    }
    if (character === '/' && input[index + 1] === '*') {
      const close = input.indexOf('*/', index + 2);
      index = close < 0 ? end : close + 1;
      continue;
    }
    if (character === '{' || character === '[') stack.push(character);
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expected) return null;
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }
  return null;
}

function repairLexicalSyntax(
  candidate: Candidate,
  original: string,
  record: RecordChange,
): { ok: true; text: string } | { ok: false; text: string; error: string } {
  const source = candidate.text;
  let output = '';
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const absoluteOffset = candidate.start + index;

    if (character === '"') {
      const stringResult = copyDoubleQuotedString(source, index, absoluteOffset, record);
      output += stringResult.text;
      index = stringResult.end;
      continue;
    }

    if (character === "'") {
      const stringResult = convertSingleQuotedString(source, index, absoluteOffset, record);
      output += stringResult.text;
      index = stringResult.end;
      continue;
    }

    if (character === '/' && source[index + 1] === '/') {
      const lineBreak = findLineBreak(source, index + 2);
      const end = lineBreak?.start ?? source.length;
      const before = source.slice(index, end);
      record({
        kind: 'remove-line-comment',
        certainty: 'deterministic',
        message: 'Removed a line comment, which strict JSON does not allow.',
        before,
        after: '',
        offset: absoluteOffset,
      });
      index = end;
      continue;
    }

    if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close < 0 ? source.length : close + 2;
      const before = source.slice(index, end);
      const lineBreaks = before.match(/\r\n|\r|\n/g)?.length ?? 0;
      const after = lineBreaks > 0 ? '\n'.repeat(lineBreaks) : ' ';
      record({
        kind: 'remove-block-comment',
        certainty: close < 0 ? 'assumption' : 'deterministic',
        message: close < 0
          ? 'Assumed an unterminated block comment continued to the end of the input.'
          : 'Removed a block comment, which strict JSON does not allow.',
        before,
        after,
        offset: absoluteOffset,
      });
      output += after;
      index = end;
      continue;
    }

    if (character === ',' && isTrailingComma(source, index + 1)) {
      record({
        kind: 'remove-trailing-comma',
        certainty: 'deterministic',
        message: 'Removed a comma immediately before a closing bracket or brace.',
        before: ',',
        after: '',
        offset: absoluteOffset,
      });
      index += 1;
      continue;
    }

    const python = pythonLiteralAt(source, index);
    if (python) {
      record({
        kind: 'replace-python-literal',
        certainty: 'deterministic',
        message: `Converted Python ${python.before} to JSON ${python.after}.`,
        before: python.before,
        after: python.after,
        offset: absoluteOffset,
      });
      output += python.after;
      index += python.before.length;
      continue;
    }

    output += character;
    index += 1;
  }

  if (!output.trim()) return { ok: false, text: output, error: 'The candidate contained no JSON after comments were removed.' };
  return { ok: true, text: output };
}

function copyDoubleQuotedString(source: string, start: number, absoluteOffset: number, record: RecordChange) {
  let output = '"';
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') {
      output += character;
      return { text: output, end: index + 1 };
    }
    if (character === '\\') {
      if (index + 1 >= source.length) {
        output += '\\\\';
        record({
          kind: 'escape-string-character',
          certainty: 'assumption',
          message: 'Assumed a final backslash in a truncated string was literal text.',
          before: '\\',
          after: '\\\\',
          offset: absoluteOffset + index - start,
        });
        index += 1;
        break;
      }
      output += `${character}${source[index + 1]}`;
      index += 2;
      continue;
    }
    if (character === '\n' || character === '\r' || character.charCodeAt(0) < 0x20) {
      const escaped = escapeControlCharacter(character);
      output += escaped;
      record({
        kind: 'escape-string-character',
        certainty: 'assumption',
        message: 'Escaped an unescaped control character inside a string.',
        before: character,
        after: escaped,
        offset: absoluteOffset + index - start,
      });
      index += 1;
      continue;
    }
    output += character;
    index += 1;
  }
  output += '"';
  record({
    kind: 'close-string',
    certainty: 'assumption',
    message: 'Assumed a truncated double-quoted string ended at the end of the available text.',
    before: '',
    after: '"',
    offset: absoluteOffset + source.length - start,
  });
  return { text: output, end: source.length };
}

function convertSingleQuotedString(source: string, start: number, absoluteOffset: number, record: RecordChange) {
  let output = '"';
  let index = start + 1;
  let ambiguous = false;
  let closed = false;

  while (index < source.length) {
    const character = source[index];
    if (character === "'" && isLikelySingleQuoteTerminator(source, index)) {
      output += '"';
      index += 1;
      closed = true;
      break;
    }
    if (character === "'") {
      output += character;
      ambiguous = true;
      index += 1;
      continue;
    }
    if (character === '\\') {
      const next = source[index + 1];
      if (next === undefined) {
        output += '\\\\';
        ambiguous = true;
        index += 1;
        break;
      }
      if (next === "'") output += "'";
      else if (next === '"') output += '\\"';
      else if (/^[\\/bfnrtu]$/.test(next)) output += `\\${next}`;
      else {
        output += `\\\\${next}`;
        ambiguous = true;
      }
      index += 2;
      continue;
    }
    if (character === '"') output += '\\"';
    else if (character === '\n' || character === '\r' || character.charCodeAt(0) < 0x20) {
      output += escapeControlCharacter(character);
      ambiguous = true;
    } else output += character;
    index += 1;
  }

  if (!closed) output += '"';
  const before = source.slice(start, index);
  record({
    kind: 'convert-single-quoted-string',
    certainty: ambiguous || !closed ? 'assumption' : 'deterministic',
    message: !closed
      ? 'Converted a single-quoted string and assumed it ended with the available input.'
      : ambiguous
        ? 'Converted a single-quoted string while treating an internal apostrophe or unusual escape as text.'
        : 'Converted a single-quoted key or string to strict JSON double quotes.',
    before,
    after: output,
    offset: absoluteOffset,
  });
  return { text: output, end: index };
}

function isLikelySingleQuoteTerminator(source: string, quoteIndex: number): boolean {
  let index = quoteIndex + 1;
  while (index < source.length && isWhitespace(source[index])) index += 1;
  if (index >= source.length) return true;
  if (source[index] === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) return true;
  return /[:,}\]]/.test(source[index]);
}

function escapeControlCharacter(character: string): string {
  if (character === '\n') return '\\n';
  if (character === '\r') return '\\r';
  if (character === '\t') return '\\t';
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

function isTrailingComma(source: string, from: number): boolean {
  const next = nextNonTrivia(source, from);
  return next < source.length && (source[next] === '}' || source[next] === ']');
}

function nextNonTrivia(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    if (isWhitespace(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      const lineBreak = findLineBreak(source, index + 2);
      return lineBreak ? nextNonTrivia(source, lineBreak.end) : source.length;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      return close < 0 ? source.length : nextNonTrivia(source, close + 2);
    }
    return index;
  }
  return index;
}

function pythonLiteralAt(source: string, index: number): { before: string; after: string } | null {
  const options = [
    { before: 'False', after: 'false' },
    { before: 'True', after: 'true' },
    { before: 'None', after: 'null' },
  ];
  for (const option of options) {
    if (!source.startsWith(option.before, index)) continue;
    const beforeCharacter = source[index - 1];
    const afterCharacter = source[index + option.before.length];
    if ((beforeCharacter && IDENTIFIER_CHARACTER.test(beforeCharacter)) || (afterCharacter && IDENTIFIER_CHARACTER.test(afterCharacter))) {
      continue;
    }
    return option;
  }
  return null;
}

function completeTruncatedJson(
  source: string,
  originalEnd: number,
  record: RecordChange,
): { ok: true; text: string } | { ok: false; text: string; error: string } {
  let text = source;
  const trimmedEnd = text.trimEnd();
  if (trimmedEnd.endsWith(',')) {
    const commaOffset = trimmedEnd.length - 1;
    text = `${trimmedEnd.slice(0, -1)}${text.slice(trimmedEnd.length)}`;
    record({
      kind: 'remove-dangling-comma',
      certainty: 'assumption',
      message: 'Assumed a final comma belonged to a value that was cut off.',
      before: ',',
      after: '',
      offset: Math.max(0, originalEnd - (source.length - commaOffset)),
    });
  }

  if (text.trimEnd().endsWith(':')) {
    const insertion = ' null';
    text = `${text.trimEnd()}${insertion}${text.slice(text.trimEnd().length)}`;
    record({
      kind: 'insert-missing-value',
      certainty: 'assumption',
      message: 'Assumed a property whose value was cut off should contain null.',
      before: '',
      after: insertion,
      offset: originalEnd,
    });
  }

  const structure = openContainers(text);
  if (!structure.ok) return { ok: false, text, error: structure.error };
  if (structure.stack.length > 0) {
    const closers = structure.stack.reverse().map((opening) => (opening === '{' ? '}' : ']')).join('');
    text = `${text.trimEnd()}${closers}${text.slice(text.trimEnd().length)}`;
    record({
      kind: 'close-container',
      certainty: 'assumption',
      message: `Assumed the truncated JSON ended with ${structure.stack.length} missing closing delimiter${structure.stack.length === 1 ? '' : 's'}.`,
      before: '',
      after: closers,
      offset: originalEnd,
    });
  }
  return { ok: true, text };
}

function openContainers(source: string): { ok: true; stack: string[] } | { ok: false; error: string } {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') stack.push(character);
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      const opening = stack.pop();
      if (opening !== expected) {
        return { ok: false, error: `A closing ${character} does not match the currently open JSON container.` };
      }
    }
  }
  if (inString) return { ok: false, error: 'A string remained unterminated after repair.' };
  return { ok: true, stack };
}

function calculateConfidence(changes: RepairChange[]): number {
  let score = 100;
  for (const change of changes) {
    if (change.certainty === 'deterministic') score -= 1;
    else if (change.kind === 'extract-json' || change.kind === 'remove-code-fence') score -= 12;
    else if (change.kind === 'close-container' || change.kind === 'close-string') score -= 22;
    else score -= 18;
  }
  return clamp(score, 20, 100);
}

function confidenceLabel(score: number): RepairConfidence {
  if (score >= 85) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

export function buildDiffRows(beforeText: string, afterText: string): DiffRow[] {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  if (beforeLines.length * afterLines.length > 160_000) return coarseDiff(beforeLines, afterLines);

  const table = Array.from({ length: beforeLines.length + 1 }, () => new Uint32Array(afterLines.length + 1));
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? table[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    if (beforeIndex < beforeLines.length && afterIndex < afterLines.length && beforeLines[beforeIndex] === afterLines[afterIndex]) {
      rows.push(equalRow(beforeLines[beforeIndex], beforeIndex, afterIndex));
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const deleted: Array<{ text: string; line: number }> = [];
    const inserted: Array<{ text: string; line: number }> = [];
    while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
      if (beforeIndex < beforeLines.length && afterIndex < afterLines.length && beforeLines[beforeIndex] === afterLines[afterIndex]) break;
      if (afterIndex >= afterLines.length || (beforeIndex < beforeLines.length && table[beforeIndex + 1][afterIndex] >= table[beforeIndex][afterIndex + 1])) {
        deleted.push({ text: beforeLines[beforeIndex], line: beforeIndex + 1 });
        beforeIndex += 1;
      } else {
        inserted.push({ text: afterLines[afterIndex], line: afterIndex + 1 });
        afterIndex += 1;
      }
    }
    const paired = Math.min(deleted.length, inserted.length);
    for (let index = 0; index < paired; index += 1) rows.push(replaceRow(deleted[index], inserted[index]));
    for (let index = paired; index < deleted.length; index += 1) {
      rows.push({ kind: 'delete', beforeLine: deleted[index].line, before: [{ text: deleted[index].text, changed: true }], after: [] });
    }
    for (let index = paired; index < inserted.length; index += 1) {
      rows.push({ kind: 'insert', afterLine: inserted[index].line, before: [], after: [{ text: inserted[index].text, changed: true }] });
    }
  }
  return rows;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n|\r/g, '\n').split('\n');
}

function equalRow(text: string, beforeIndex: number, afterIndex: number): DiffRow {
  return {
    kind: 'equal',
    beforeLine: beforeIndex + 1,
    afterLine: afterIndex + 1,
    before: [{ text, changed: false }],
    after: [{ text, changed: false }],
  };
}

function replaceRow(
  before: { text: string; line: number },
  after: { text: string; line: number },
): DiffRow {
  let prefix = 0;
  while (prefix < before.text.length && prefix < after.text.length && before.text[prefix] === after.text[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.text.length - prefix
    && suffix < after.text.length - prefix
    && before.text[before.text.length - 1 - suffix] === after.text[after.text.length - 1 - suffix]
  ) suffix += 1;

  return {
    kind: 'replace',
    beforeLine: before.line,
    afterLine: after.line,
    before: fragmentsForReplacement(before.text, prefix, suffix),
    after: fragmentsForReplacement(after.text, prefix, suffix),
  };
}

function fragmentsForReplacement(text: string, prefix: number, suffix: number): DiffFragment[] {
  const fragments: DiffFragment[] = [];
  if (prefix > 0) fragments.push({ text: text.slice(0, prefix), changed: false });
  const changedEnd = suffix > 0 ? text.length - suffix : text.length;
  if (changedEnd > prefix) fragments.push({ text: text.slice(prefix, changedEnd), changed: true });
  if (suffix > 0) fragments.push({ text: text.slice(text.length - suffix), changed: false });
  return fragments;
}

function coarseDiff(before: string[], after: string[]): DiffRow[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const rows: DiffRow[] = [];
  for (let index = 0; index < prefix; index += 1) rows.push(equalRow(before[index], index, index));
  const beforeMiddle = before.slice(prefix, before.length - suffix);
  const afterMiddle = after.slice(prefix, after.length - suffix);
  const paired = Math.min(beforeMiddle.length, afterMiddle.length);
  for (let index = 0; index < paired; index += 1) {
    rows.push(replaceRow({ text: beforeMiddle[index], line: prefix + index + 1 }, { text: afterMiddle[index], line: prefix + index + 1 }));
  }
  for (let index = paired; index < beforeMiddle.length; index += 1) {
    rows.push({ kind: 'delete', beforeLine: prefix + index + 1, before: [{ text: beforeMiddle[index], changed: true }], after: [] });
  }
  for (let index = paired; index < afterMiddle.length; index += 1) {
    rows.push({ kind: 'insert', afterLine: prefix + index + 1, before: [], after: [{ text: afterMiddle[index], changed: true }] });
  }
  for (let index = suffix; index > 0; index -= 1) {
    const beforeIndex = before.length - index;
    const afterIndex = after.length - index;
    rows.push(equalRow(before[beforeIndex], beforeIndex, afterIndex));
  }
  return rows;
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (code === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLocation(source: string, offset: number, lineStarts = buildLineStarts(source)): RepairLocation {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { offset, line: low + 1, column: offset - lineStarts[low] + 1 };
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
