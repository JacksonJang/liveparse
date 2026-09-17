export const MAX_REGEX_PATTERN_CODE_UNITS = 2_000;
export const MAX_REGEX_TEXT_CODE_UNITS = 100_000;
export const MAX_REGEX_MATCHES = 500;

export interface RegexCaptureGroup {
  readonly index: number;
  readonly name: string | null;
  readonly text: string | null;
}

export interface RegexMatch {
  readonly index: number;
  readonly end: number;
  readonly text: string;
  readonly groups: readonly RegexCaptureGroup[];
}

export interface RegexAnalysis {
  readonly flags: string;
  readonly matches: readonly RegexMatch[];
  readonly matchCount: number;
  readonly truncated: boolean;
  readonly replacement: string;
}

export type RegexFlag = 'g' | 'i' | 'm' | 's' | 'u' | 'y' | 'd';

export const REGEX_FLAG_DETAILS: Readonly<Record<RegexFlag, { label: string; detail: string }>> = Object.freeze({
  g: { label: 'global', detail: 'Find every non-overlapping match' },
  i: { label: 'ignore case', detail: 'Case-insensitive letters' },
  m: { label: 'multiline', detail: '^ and $ match line boundaries' },
  s: { label: 'dot all', detail: '. also matches newlines' },
  u: { label: 'unicode', detail: 'Unicode-aware escapes and code points' },
  y: { label: 'sticky', detail: 'Match only at lastIndex' },
  d: { label: 'indices', detail: 'Capture group start/end offsets' },
});

const FLAG_ORDER: readonly RegexFlag[] = ['d', 'g', 'i', 'm', 's', 'u', 'y'];

export class RegexToolError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PATTERN_TOO_LARGE'
      | 'TEXT_TOO_LARGE'
      | 'INVALID_FLAGS'
      | 'INVALID_PATTERN'
      | 'INVALID_REPLACEMENT',
  ) {
    super(message);
    this.name = 'RegexToolError';
  }
}

export function normalizeRegexFlags(flags: Iterable<RegexFlag>): string {
  const selected = new Set(flags);
  return FLAG_ORDER.filter((flag) => selected.has(flag)).join('');
}

export function javascriptRegexSource(pattern: string, flags: string): string {
  if (typeof pattern !== 'string' || typeof flags !== 'string') {
    throw new TypeError('Pattern and flags must be strings.');
  }
  if (flags.length > 0 && !/^[dgimsuy]+$/.test(flags)) {
    throw new RangeError('Flags must contain only JavaScript RegExp flag letters.');
  }
  return `new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)})`;
}

function captureGroupNames(pattern: string): ReadonlyMap<number, string> {
  const names = new Map<number, number | string>();
  let groupIndex = 0;
  let inCharacterClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (inCharacterClass) {
      if (character === ']') inCharacterClass = false;
      continue;
    }
    if (character === '[') {
      inCharacterClass = true;
      continue;
    }
    if (character !== '(') continue;

    groupIndex += 1;
    if (pattern[index + 1] !== '?') continue;
    if (pattern[index + 2] !== '<' || pattern[index + 3] === '=' || pattern[index + 3] === '!') continue;

    const nameStart = index + 3;
    const nameEnd = pattern.indexOf('>', nameStart);
    if (nameEnd > nameStart) names.set(groupIndex, pattern.slice(nameStart, nameEnd));
  }

  return new Map([...names].map(([group, name]) => [group, `${name}`]));
}

export function analyzeRegex(options: {
  pattern: string;
  flags: string;
  text: string;
  replacement?: string | null;
  maxMatches?: number;
}): RegexAnalysis {
  const {
    pattern,
    flags: initialFlags,
    text,
    replacement = null,
  } = options;
  let flags = initialFlags;
  const maximum = options.maxMatches ?? MAX_REGEX_MATCHES;

  if (typeof pattern !== 'string' || typeof flags !== 'string' || typeof text !== 'string') {
    throw new TypeError('Pattern, flags, and text must be strings.');
  }
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_REGEX_MATCHES) {
    throw new RangeError(`The match limit must be from 1 through ${MAX_REGEX_MATCHES}.`);
  }
  if (pattern.length > MAX_REGEX_PATTERN_CODE_UNITS) {
    throw new RegexToolError(
      `Patterns are limited to ${MAX_REGEX_PATTERN_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`,
      'PATTERN_TOO_LARGE',
    );
  }
  if (text.length > MAX_REGEX_TEXT_CODE_UNITS) {
    throw new RegexToolError(
      `Test text is limited to ${MAX_REGEX_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`,
      'TEXT_TOO_LARGE',
    );
  }
  if (!/^[dgimsuy]*$/.test(flags) || new Set(flags).size !== flags.length) {
    throw new RegexToolError('Use each JavaScript regex flag at most once.', 'INVALID_FLAGS');
  }
  if (flags.includes('y') && !flags.includes('g')) {
    // JavaScript allows a lone y regex to expose lastIndex, but repeated testing without g is
    // ambiguous in a live UI. Normalize to the equivalent explicit global/sticky behavior.
    flags = `${flags}g`;
  }

  let expression: RegExp;
  try {
    expression = new RegExp(pattern, flags);
  } catch (error) {
    throw new RegexToolError(
      error instanceof Error ? error.message : 'This pattern is not valid in JavaScript RegExp.',
      'INVALID_PATTERN',
    );
  }

  const matches: RegexMatch[] = [];
  const repeated = flags.includes('g');
  expression.lastIndex = 0;
  while (matches.length < maximum) {
    const match = expression.exec(text);
    if (match === null) break;

    const groups: RegexCaptureGroup[] = [];
    const groupNames = captureGroupNames(pattern);
    for (let groupIndex = 1; groupIndex < match.length; groupIndex += 1) {
      const value = match[groupIndex];
      const name = groupNames.get(groupIndex) ?? null;
      groups.push({ index: groupIndex, name, text: value === undefined ? null : value });
    }
    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      text: match[0],
      groups,
    });

    if (!repeated) break;
    if (match[0] === '') expression.lastIndex += 1;
  }

  let replacementText: string | null = null;
  if (replacement !== null) {
    if (replacement.length > MAX_REGEX_TEXT_CODE_UNITS) {
      throw new RegexToolError(
        `Replacement patterns are limited to ${MAX_REGEX_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`,
        'INVALID_REPLACEMENT',
      );
    }
    expression.lastIndex = 0;
    try {
      replacementText = text.replace(expression, replacement);
    } catch (error) {
      throw new RegexToolError(
        error instanceof Error ? error.message : 'The replacement pattern could not be applied.',
        'INVALID_REPLACEMENT',
      );
    }
  }

  return {
    flags,
    matches,
    matchCount: matches.length,
    truncated: repeated && matches.length === maximum && expression.exec(text) !== null,
    replacement: replacementText ?? '',
  };
}

export interface RegexHighlightSegment {
  readonly text: string;
  readonly match: RegexMatch | null;
}

export function regexHighlightSegments(
  text: string,
  matches: readonly RegexMatch[],
  maximumCharacters = 20_000,
): RegexHighlightSegment[] {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new RangeError('The highlight character limit must be a positive integer.');
  }
  const segments: RegexHighlightSegment[] = [];
  let cursor = 0;
  const visibleEnd = Math.min(text.length, maximumCharacters);
  for (const match of matches) {
    if (match.index >= visibleEnd) break;
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), match: null });
    const end = Math.min(match.end, visibleEnd);
    if (end > match.index) segments.push({ text: text.slice(match.index, end), match });
    cursor = Math.max(cursor, end);
  }
  if (cursor < visibleEnd) segments.push({ text: text.slice(cursor, visibleEnd), match: null });
  return segments;
}
