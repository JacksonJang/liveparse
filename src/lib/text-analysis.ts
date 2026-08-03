export const MAX_TEXT_INPUT_CODE_UNITS = 200_000;

export type TextAnalysisErrorCode =
  | 'INPUT_TOO_LARGE'
  | 'INVALID_LOCALE'
  | 'SEGMENTER_UNAVAILABLE';

export class TextAnalysisError extends Error {
  readonly code: TextAnalysisErrorCode;

  constructor(code: TextAnalysisErrorCode, message: string) {
    super(message);
    this.name = 'TextAnalysisError';
    this.code = code;
  }
}

export type Utf8Policy = 'reject-ill-formed' | 'replace-ill-formed';

export interface TextAnalysisOptions {
  /** A single BCP 47 locale. Defaults to English for deterministic behavior. */
  locale?: string;
  /** How UTF-8 byte counting handles lone UTF-16 surrogates. */
  utf8Policy?: Utf8Policy;
  /** Optional lower input limit; it cannot exceed MAX_TEXT_INPUT_CODE_UNITS. */
  maxCodeUnits?: number;
}

export interface TextAnalysis {
  readonly utf16CodeUnits: number;
  /** JavaScript string-iterator elements, including lone surrogate code units. */
  readonly codePoints: number;
  /** Unicode scalar values; lone surrogates are excluded. */
  readonly unicodeScalars: number;
  readonly loneSurrogates: number;
  /** Zero-based UTF-16 code-unit offsets. */
  readonly loneSurrogateOffsets: readonly number[];
  readonly graphemeClusters: number;
  /** Grapheme clusters that are not made entirely from Unicode White_Space. */
  readonly graphemesWithoutWhitespace: number;
  readonly words: number;
  /** Locale-sensitive sentence segments containing at least one non-whitespace code point. */
  readonly sentences: number;
  /** Runs of nonblank lines, where blank lines delimit blocks. */
  readonly paragraphs: number;
  readonly lineBreaks: number;
  readonly lines: number;
  /** Null only when reject-ill-formed is selected and lone surrogates are present. */
  readonly utf8Bytes: number | null;
  readonly resolvedLocale: string;
}

type SegmentGranularity = 'grapheme' | 'word' | 'sentence';

interface SegmentData {
  readonly segment: string;
  readonly index: number;
  readonly input: string;
  readonly isWordLike?: boolean;
}

interface SegmenterLike {
  segment(input: string): Iterable<SegmentData>;
  resolvedOptions(): { locale: string };
}

interface SegmenterConstructor {
  new (
    locales?: string | readonly string[],
    options?: { granularity?: SegmentGranularity },
  ): SegmenterLike;
}

const HAS_NON_UNICODE_WHITESPACE = /[^\p{White_Space}]/u;
const LINE_BREAK_PATTERN = /\r\n|[\r\n\u0085\u2028\u2029]/u;

function getSegmenterConstructor(): SegmenterConstructor {
  const constructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (typeof constructor !== 'function') {
    throw new TextAnalysisError(
      'SEGMENTER_UNAVAILABLE',
      'This environment does not provide Intl.Segmenter for Unicode text boundaries.',
    );
  }
  return constructor;
}

function canonicalizeLocale(locale: string): string {
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0];
    if (!canonical) throw new RangeError('The locale list is empty.');
    return canonical;
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TextAnalysisError('INVALID_LOCALE', `Invalid locale ${JSON.stringify(locale)}.`);
    }
    throw error;
  }
}

function createSegmenter(
  Segmenter: SegmenterConstructor,
  locale: string,
  granularity: SegmentGranularity,
): SegmenterLike {
  try {
    return new Segmenter(locale, { granularity });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TextAnalysisError('INVALID_LOCALE', `Invalid locale ${JSON.stringify(locale)}.`);
    }
    throw error;
  }
}

function analyzeCodePoints(input: string): {
  codePoints: number;
  unicodeScalars: number;
  loneSurrogateOffsets: number[];
} {
  let codePoints = 0;
  let unicodeScalars = 0;
  const loneSurrogateOffsets: number[] = [];

  for (let offset = 0; offset < input.length;) {
    const first = input.charCodeAt(offset);
    codePoints += 1;

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = input.charCodeAt(offset + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        unicodeScalars += 1;
        offset += 2;
      } else {
        loneSurrogateOffsets.push(offset);
        offset += 1;
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      loneSurrogateOffsets.push(offset);
      offset += 1;
    } else {
      unicodeScalars += 1;
      offset += 1;
    }
  }

  return { codePoints, unicodeScalars, loneSurrogateOffsets };
}

function countGraphemes(input: string, segmenter: SegmenterLike): {
  graphemeClusters: number;
  graphemesWithoutWhitespace: number;
} {
  let graphemeClusters = 0;
  let graphemesWithoutWhitespace = 0;

  for (const { segment } of segmenter.segment(input)) {
    graphemeClusters += 1;
    if (HAS_NON_UNICODE_WHITESPACE.test(segment)) graphemesWithoutWhitespace += 1;
  }

  return { graphemeClusters, graphemesWithoutWhitespace };
}

function countWords(input: string, segmenter: SegmenterLike): number {
  let words = 0;
  for (const segment of segmenter.segment(input)) {
    if (segment.isWordLike === true) words += 1;
  }
  return words;
}

function countSentences(input: string, segmenter: SegmenterLike): number {
  let sentences = 0;
  for (const { segment } of segmenter.segment(input)) {
    if (HAS_NON_UNICODE_WHITESPACE.test(segment)) sentences += 1;
  }
  return sentences;
}

function countLineBreaks(input: string): number {
  let lineBreaks = 0;
  for (let offset = 0; offset < input.length; offset += 1) {
    const code = input.charCodeAt(offset);
    if (code === 0x0d) {
      lineBreaks += 1;
      if (input.charCodeAt(offset + 1) === 0x0a) offset += 1;
    } else if (code === 0x0a || code === 0x85 || code === 0x2028 || code === 0x2029) {
      lineBreaks += 1;
    }
  }
  return lineBreaks;
}

function countParagraphs(input: string): number {
  if (input.length === 0) return 0;

  let paragraphs = 0;
  let insideParagraph = false;
  for (const line of input.split(LINE_BREAK_PATTERN)) {
    const isBlank = !HAS_NON_UNICODE_WHITESPACE.test(line);
    if (isBlank) {
      insideParagraph = false;
    } else if (!insideParagraph) {
      paragraphs += 1;
      insideParagraph = true;
    }
  }
  return paragraphs;
}

/**
 * Analyze text exactly as supplied. The input is never normalized, stored, or
 * sent anywhere. Word and sentence boundaries follow the host's locale data.
 */
export function analyzeText(input: string, options: TextAnalysisOptions = {}): TextAnalysis {
  if (typeof input !== 'string') throw new TypeError('Text input must be a string.');
  const maxCodeUnits = options.maxCodeUnits ?? MAX_TEXT_INPUT_CODE_UNITS;
  if (!Number.isInteger(maxCodeUnits) || maxCodeUnits < 0 || maxCodeUnits > MAX_TEXT_INPUT_CODE_UNITS) {
    throw new TypeError(
      `Maximum code units must be a whole number from 0 through ${MAX_TEXT_INPUT_CODE_UNITS.toLocaleString('en-US')}.`,
    );
  }
  if (input.length > maxCodeUnits) {
    throw new TextAnalysisError(
      'INPUT_TOO_LARGE',
      `Text input is limited to ${maxCodeUnits.toLocaleString('en-US')} UTF-16 code units.`,
    );
  }

  const utf8Policy = options.utf8Policy ?? 'reject-ill-formed';
  if (utf8Policy !== 'reject-ill-formed' && utf8Policy !== 'replace-ill-formed') {
    throw new TypeError(`Unsupported UTF-8 policy ${JSON.stringify(utf8Policy)}.`);
  }

  const Segmenter = getSegmenterConstructor();
  const locale = canonicalizeLocale(options.locale ?? 'en');
  const graphemeSegmenter = createSegmenter(Segmenter, locale, 'grapheme');
  const wordSegmenter = createSegmenter(Segmenter, locale, 'word');
  const sentenceSegmenter = createSegmenter(Segmenter, locale, 'sentence');

  const { codePoints, unicodeScalars, loneSurrogateOffsets } = analyzeCodePoints(input);
  const { graphemeClusters, graphemesWithoutWhitespace } = countGraphemes(input, graphemeSegmenter);
  const lineBreaks = countLineBreaks(input);
  const loneSurrogates = loneSurrogateOffsets.length;
  const utf8Bytes = utf8Policy === 'reject-ill-formed' && loneSurrogates > 0
    ? null
    : new TextEncoder().encode(input).byteLength;

  return {
    utf16CodeUnits: input.length,
    codePoints,
    unicodeScalars,
    loneSurrogates,
    loneSurrogateOffsets,
    graphemeClusters,
    graphemesWithoutWhitespace,
    words: countWords(input, wordSegmenter),
    sentences: countSentences(input, sentenceSegmenter),
    paragraphs: countParagraphs(input),
    lineBreaks,
    lines: input.length === 0 ? 0 : lineBreaks + 1,
    utf8Bytes,
    resolvedLocale: wordSegmenter.resolvedOptions().locale,
  };
}
