export const MAX_MORSE_INPUT_CODE_UNITS = 200_000;
export const MAX_MORSE_DIAGNOSTICS = 100;
export const MORSE_LETTER_SEPARATOR = ' ';
export const MORSE_WORD_SEPARATOR = ' / ';
export const MORSE_REPLACEMENT_CHARACTER = '\uFFFD';

export type MorseCodeCategory = 'letter' | 'digit' | 'punctuation';

export interface MorseCodeEntry {
  readonly character: string;
  readonly code: string;
  readonly category: MorseCodeCategory;
  readonly name: string;
}

function freezeEntries(entries: MorseCodeEntry[]): readonly MorseCodeEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/**
 * Written characters defined by Recommendation ITU-R M.1677-1. Procedure
 * signals are deliberately excluded because they are not text characters.
 */
export const INTERNATIONAL_MORSE_CODE = freezeEntries([
  { character: 'A', code: '.-', category: 'letter', name: 'A' },
  { character: 'B', code: '-...', category: 'letter', name: 'B' },
  { character: 'C', code: '-.-.', category: 'letter', name: 'C' },
  { character: 'D', code: '-..', category: 'letter', name: 'D' },
  { character: 'E', code: '.', category: 'letter', name: 'E' },
  { character: 'F', code: '..-.', category: 'letter', name: 'F' },
  { character: 'G', code: '--.', category: 'letter', name: 'G' },
  { character: 'H', code: '....', category: 'letter', name: 'H' },
  { character: 'I', code: '..', category: 'letter', name: 'I' },
  { character: 'J', code: '.---', category: 'letter', name: 'J' },
  { character: 'K', code: '-.-', category: 'letter', name: 'K' },
  { character: 'L', code: '.-..', category: 'letter', name: 'L' },
  { character: 'M', code: '--', category: 'letter', name: 'M' },
  { character: 'N', code: '-.', category: 'letter', name: 'N' },
  { character: 'O', code: '---', category: 'letter', name: 'O' },
  { character: 'P', code: '.--.', category: 'letter', name: 'P' },
  { character: 'Q', code: '--.-', category: 'letter', name: 'Q' },
  { character: 'R', code: '.-.', category: 'letter', name: 'R' },
  { character: 'S', code: '...', category: 'letter', name: 'S' },
  { character: 'T', code: '-', category: 'letter', name: 'T' },
  { character: 'U', code: '..-', category: 'letter', name: 'U' },
  { character: 'V', code: '...-', category: 'letter', name: 'V' },
  { character: 'W', code: '.--', category: 'letter', name: 'W' },
  { character: 'X', code: '-..-', category: 'letter', name: 'X' },
  { character: 'Y', code: '-.--', category: 'letter', name: 'Y' },
  { character: 'Z', code: '--..', category: 'letter', name: 'Z' },
  { character: 'É', code: '..-..', category: 'letter', name: 'Accented E' },
  { character: '1', code: '.----', category: 'digit', name: 'One' },
  { character: '2', code: '..---', category: 'digit', name: 'Two' },
  { character: '3', code: '...--', category: 'digit', name: 'Three' },
  { character: '4', code: '....-', category: 'digit', name: 'Four' },
  { character: '5', code: '.....', category: 'digit', name: 'Five' },
  { character: '6', code: '-....', category: 'digit', name: 'Six' },
  { character: '7', code: '--...', category: 'digit', name: 'Seven' },
  { character: '8', code: '---..', category: 'digit', name: 'Eight' },
  { character: '9', code: '----.', category: 'digit', name: 'Nine' },
  { character: '0', code: '-----', category: 'digit', name: 'Zero' },
  { character: '.', code: '.-.-.-', category: 'punctuation', name: 'Full stop' },
  { character: ',', code: '--..--', category: 'punctuation', name: 'Comma' },
  { character: ':', code: '---...', category: 'punctuation', name: 'Colon' },
  { character: '?', code: '..--..', category: 'punctuation', name: 'Question mark' },
  { character: "'", code: '.----.', category: 'punctuation', name: 'Apostrophe' },
  { character: '-', code: '-....-', category: 'punctuation', name: 'Hyphen or dash' },
  { character: '/', code: '-..-.', category: 'punctuation', name: 'Fraction bar' },
  { character: '(', code: '-.--.', category: 'punctuation', name: 'Left parenthesis' },
  { character: ')', code: '-.--.-', category: 'punctuation', name: 'Right parenthesis' },
  { character: '"', code: '.-..-.', category: 'punctuation', name: 'Quotation mark' },
  { character: '=', code: '-...-', category: 'punctuation', name: 'Double hyphen' },
  { character: '+', code: '.-.-.', category: 'punctuation', name: 'Cross or addition sign' },
  { character: '×', code: '-..-', category: 'punctuation', name: 'Multiplication sign' },
  { character: '@', code: '.--.-.', category: 'punctuation', name: 'Commercial at' },
]);

const ENTRIES_BY_CHARACTER = new Map(
  INTERNATIONAL_MORSE_CODE.map((entry) => [entry.character, entry] as const),
);

const ENTRIES_BY_CODE = new Map<string, readonly MorseCodeEntry[]>();
for (const entry of INTERNATIONAL_MORSE_CODE) {
  const existing = ENTRIES_BY_CODE.get(entry.code) ?? [];
  ENTRIES_BY_CODE.set(entry.code, Object.freeze([...existing, entry]));
}

const CHARACTER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '‘': "'",
  '’': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '−': '-',
});

export type MorseDiagnosticSeverity = 'error' | 'warning';

interface MorseDiagnosticBase {
  readonly severity: MorseDiagnosticSeverity;
  readonly message: string;
  /** Zero-based UTF-16 code-unit offset in the original input. */
  readonly offset: number | null;
  readonly length: number;
}

export interface UnsupportedMorseCharacterDiagnostic extends MorseDiagnosticBase {
  readonly code: 'UNSUPPORTED_CHARACTER';
  readonly severity: 'error';
  readonly character: string;
}

export interface NormalizedMorseCharacterDiagnostic extends MorseDiagnosticBase {
  readonly code: 'NORMALIZED_CHARACTER';
  readonly severity: 'warning';
  readonly character: string;
  readonly normalizedCharacter: string;
}

export interface UnknownMorseTokenDiagnostic extends MorseDiagnosticBase {
  readonly code: 'UNKNOWN_TOKEN';
  readonly severity: 'error';
  readonly token: string;
  readonly tokenIndex: number;
}

export interface AmbiguousMorseTokenDiagnostic extends MorseDiagnosticBase {
  readonly code: 'AMBIGUOUS_TOKEN';
  readonly token: string;
  readonly tokenIndex: number;
  readonly candidates: readonly string[];
  readonly resolvedAs: string | null;
}

export interface InvalidMorseWordSeparatorDiagnostic extends MorseDiagnosticBase {
  readonly code: 'INVALID_WORD_SEPARATOR';
  readonly severity: 'error';
  readonly token: '/';
  readonly reason: 'leading' | 'repeated' | 'trailing';
}

export interface TruncatedMorseDiagnostics extends MorseDiagnosticBase {
  readonly code: 'DIAGNOSTICS_TRUNCATED';
  readonly omitted: number;
}

export type MorseDiagnostic =
  | UnsupportedMorseCharacterDiagnostic
  | NormalizedMorseCharacterDiagnostic
  | UnknownMorseTokenDiagnostic
  | AmbiguousMorseTokenDiagnostic
  | InvalidMorseWordSeparatorDiagnostic
  | TruncatedMorseDiagnostics;

export interface MorseConversionResult {
  /** True when the conversion has no error-severity diagnostics. */
  readonly ok: boolean;
  /** Converted text. U+FFFD visibly marks every unresolved input item. */
  readonly output: string;
  /** Canonical Morse spacing; errored results can contain U+FFFD placeholders. */
  readonly normalized: string;
  readonly diagnostics: readonly MorseDiagnostic[];
}

export interface MorseConversionOptions {
  /** Optional lower input limit; it cannot exceed MAX_MORSE_INPUT_CODE_UNITS. */
  readonly maxCodeUnits?: number;
}

export type MorseAmbiguityMode = 'reject' | 'prefer-letter';

export interface DecodeMorseOptions extends MorseConversionOptions {
  /** Defaults to reject. prefer-letter resolves -..- as X while retaining a warning. */
  readonly ambiguity?: MorseAmbiguityMode;
}

export type MorseInputErrorCode = 'INPUT_TOO_LARGE';

export class MorseInputError extends RangeError {
  readonly code: MorseInputErrorCode;
  readonly limit: number;
  readonly actual: number;

  constructor(limit: number, actual: number) {
    super(`Morse input exceeds the ${limit.toLocaleString('en-US')} UTF-16 code-unit limit.`);
    this.name = 'MorseInputError';
    this.code = 'INPUT_TOO_LARGE';
    this.limit = limit;
    this.actual = actual;
  }
}

class DiagnosticCollector {
  private readonly retained: MorseDiagnostic[] = [];
  private omitted = 0;
  private omittedErrors = 0;
  private errorCount = 0;

  add(diagnostic: MorseDiagnostic): void {
    if (diagnostic.severity === 'error') this.errorCount += 1;
    if (this.retained.length < MAX_MORSE_DIAGNOSTICS - 1) {
      this.retained.push(Object.freeze(diagnostic));
      return;
    }
    this.omitted += 1;
    if (diagnostic.severity === 'error') this.omittedErrors += 1;
  }

  get hasErrors(): boolean {
    return this.errorCount > 0;
  }

  finish(): readonly MorseDiagnostic[] {
    if (this.omitted > 0) {
      this.retained.push(Object.freeze({
        code: 'DIAGNOSTICS_TRUNCATED',
        severity: this.omittedErrors > 0 ? 'error' : 'warning',
        message: `${this.omitted.toLocaleString('en-US')} additional diagnostic${this.omitted === 1 ? ' was' : 's were'} omitted.`,
        offset: null,
        length: 0,
        omitted: this.omitted,
      }));
    }
    return Object.freeze(this.retained.slice());
  }
}

function assertInput(input: string, options: MorseConversionOptions): number {
  if (typeof input !== 'string') throw new TypeError('Morse input must be a string.');
  if (typeof options !== 'object' || options === null) throw new TypeError('Morse options must be an object.');
  const limit = options.maxCodeUnits ?? MAX_MORSE_INPUT_CODE_UNITS;
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_MORSE_INPUT_CODE_UNITS) {
    throw new RangeError(
      `maxCodeUnits must be a whole number from 0 through ${MAX_MORSE_INPUT_CODE_UNITS.toLocaleString('en-US')}.`,
    );
  }
  if (input.length > limit) throw new MorseInputError(limit, input.length);
  return limit;
}

function isUnicodeWhitespace(character: string): boolean {
  return /^\p{White_Space}$/u.test(character);
}

function canonicalTextCharacter(character: string): string {
  const alias = CHARACTER_ALIASES[character];
  if (alias !== undefined) return alias;
  const code = character.charCodeAt(0);
  if (character.length === 1 && code >= 0x61 && code <= 0x7a) {
    return String.fromCharCode(code - 0x20);
  }
  if (character === 'é') return 'É';
  return character;
}

function valuePreview(value: string): string {
  const characters = Array.from(value);
  const preview = characters.length > 24 ? `${characters.slice(0, 24).join('')}…` : value;
  return JSON.stringify(preview);
}

function joinMorseWords(words: readonly (readonly string[])[]): string {
  return words.map((word) => word.join(MORSE_LETTER_SEPARATOR)).join(MORSE_WORD_SEPARATOR);
}

function makeResult(
  output: string,
  normalized: string,
  collector: DiagnosticCollector,
): MorseConversionResult {
  return Object.freeze({
    ok: !collector.hasErrors,
    output,
    normalized,
    diagnostics: collector.finish(),
  });
}

/** Encode written text without silently dropping unsupported characters. */
export function encodeMorse(
  input: string,
  options: MorseConversionOptions = {},
): MorseConversionResult {
  assertInput(input, options);
  const words: string[][] = [[]];
  const collector = new DiagnosticCollector();
  let pendingWordBoundary = false;

  for (let offset = 0; offset < input.length;) {
    const codePoint = input.codePointAt(offset);
    const character = codePoint === undefined ? '' : String.fromCodePoint(codePoint);
    const length = character.length;

    if (isUnicodeWhitespace(character)) {
      if (words[words.length - 1].length > 0) pendingWordBoundary = true;
      offset += length;
      continue;
    }

    if (pendingWordBoundary) {
      words.push([]);
      pendingWordBoundary = false;
    }

    const canonical = canonicalTextCharacter(character);
    if (canonical !== character && CHARACTER_ALIASES[character] !== undefined) {
      collector.add({
        code: 'NORMALIZED_CHARACTER',
        severity: 'warning',
        message: `Character ${valuePreview(character)} at UTF-16 offset ${offset} was normalized to ${valuePreview(canonical)} before Morse encoding.`,
        offset,
        length,
        character,
        normalizedCharacter: canonical,
      });
    }
    const entry = ENTRIES_BY_CHARACTER.get(canonical);
    if (entry) {
      words[words.length - 1].push(entry.code);
    } else {
      words[words.length - 1].push(MORSE_REPLACEMENT_CHARACTER);
      collector.add({
        code: 'UNSUPPORTED_CHARACTER',
        severity: 'error',
        message: `Character ${valuePreview(character)} at UTF-16 offset ${offset} is not defined as a written character by ITU-R M.1677-1.`,
        offset,
        length,
        character,
      });
    }
    offset += length;
  }

  const normalized = words[0].length === 0 ? '' : joinMorseWords(words);
  return makeResult(normalized, normalized, collector);
}

function invalidSeparatorMessage(reason: InvalidMorseWordSeparatorDiagnostic['reason'], offset: number): string {
  if (reason === 'leading') return `Word separator / at UTF-16 offset ${offset} appears before any Morse token.`;
  if (reason === 'repeated') return `Word separator / at UTF-16 offset ${offset} repeats an unresolved word separator.`;
  return `Word separator / at UTF-16 offset ${offset} is not followed by a Morse token.`;
}

/**
 * Decode explicit Morse tokens. Whitespace separates letters and `/` separates
 * words; an unseparated run is one token and is never guessed or segmented.
 */
export function decodeMorse(
  input: string,
  options: DecodeMorseOptions = {},
): MorseConversionResult {
  assertInput(input, options);
  const ambiguity = options.ambiguity ?? 'reject';
  if (ambiguity !== 'reject' && ambiguity !== 'prefer-letter') {
    throw new TypeError(`Unsupported Morse ambiguity mode: ${String(ambiguity)}.`);
  }

  const outputWords: string[][] = [[]];
  const normalizedWords: string[][] = [[]];
  const collector = new DiagnosticCollector();
  let tokenIndex = 0;
  let sawToken = false;
  let pendingWordSeparatorOffset: number | null = null;

  for (let offset = 0; offset < input.length;) {
    const character = input[offset];
    if (isUnicodeWhitespace(character)) {
      offset += 1;
      continue;
    }

    if (character === '/') {
      let reason: InvalidMorseWordSeparatorDiagnostic['reason'] | null = null;
      if (!sawToken) reason = 'leading';
      else if (pendingWordSeparatorOffset !== null) reason = 'repeated';
      else pendingWordSeparatorOffset = offset;

      if (reason !== null) {
        collector.add({
          code: 'INVALID_WORD_SEPARATOR',
          severity: 'error',
          message: invalidSeparatorMessage(reason, offset),
          offset,
          length: 1,
          token: '/',
          reason,
        });
      }
      offset += 1;
      continue;
    }

    const start = offset;
    while (offset < input.length && input[offset] !== '/' && !isUnicodeWhitespace(input[offset])) offset += 1;
    const token = input.slice(start, offset);

    if (pendingWordSeparatorOffset !== null) {
      outputWords.push([]);
      normalizedWords.push([]);
      pendingWordSeparatorOffset = null;
    }

    const entries = ENTRIES_BY_CODE.get(token);
    let decoded = MORSE_REPLACEMENT_CHARACTER;
    let normalizedToken = MORSE_REPLACEMENT_CHARACTER;
    if (!entries) {
      collector.add({
        code: 'UNKNOWN_TOKEN',
        severity: 'error',
        message: `Morse token ${valuePreview(token)} at UTF-16 offset ${start} is unknown. Unseparated runs are not auto-segmented.`,
        offset: start,
        length: token.length,
        token,
        tokenIndex,
      });
    } else if (entries.length === 1) {
      decoded = entries[0].character;
      normalizedToken = token;
    } else {
      normalizedToken = token;
      const candidates = Object.freeze(entries.map((entry) => entry.character));
      const preferred = ambiguity === 'prefer-letter'
        ? entries.find((entry) => entry.category === 'letter') ?? null
        : null;
      if (preferred) decoded = preferred.character;
      collector.add({
        code: 'AMBIGUOUS_TOKEN',
        severity: preferred ? 'warning' : 'error',
        message: preferred
          ? `Morse token ${valuePreview(token)} at UTF-16 offset ${start} can mean ${candidates.join(' or ')}; prefer-letter resolved it as ${preferred.character}.`
          : `Morse token ${valuePreview(token)} at UTF-16 offset ${start} can mean ${candidates.join(' or ')}; strict mode emitted U+FFFD.`,
        offset: start,
        length: token.length,
        token,
        tokenIndex,
        candidates,
        resolvedAs: preferred?.character ?? null,
      });
    }

    outputWords[outputWords.length - 1].push(decoded);
    normalizedWords[normalizedWords.length - 1].push(normalizedToken);
    tokenIndex += 1;
    sawToken = true;
  }

  if (pendingWordSeparatorOffset !== null) {
    collector.add({
      code: 'INVALID_WORD_SEPARATOR',
      severity: 'error',
      message: invalidSeparatorMessage('trailing', pendingWordSeparatorOffset),
      offset: pendingWordSeparatorOffset,
      length: 1,
      token: '/',
      reason: 'trailing',
    });
  }

  const output = outputWords[0].length === 0 ? '' : outputWords.map((word) => word.join('')).join(' ');
  const normalized = normalizedWords[0].length === 0 ? '' : joinMorseWords(normalizedWords);
  return makeResult(output, normalized, collector);
}
