import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_INPUT_CODE_UNITS,
  TextAnalysisError,
  analyzeText,
  type TextAnalysis,
} from './text-analysis';

function expectError(
  callback: () => unknown,
  code: TextAnalysisError['code'],
): TextAnalysisError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(TextAnalysisError);
    expect((error as TextAnalysisError).code).toBe(code);
    return error as TextAnalysisError;
  }
  throw new Error(`Expected ${code}.`);
}

function expectCoreInvariants(input: string, analysis: TextAnalysis): void {
  expect(analysis.utf16CodeUnits).toBe(input.length);
  expect(analysis.unicodeScalars + analysis.loneSurrogates).toBe(analysis.codePoints);
  expect(analysis.loneSurrogateOffsets).toHaveLength(analysis.loneSurrogates);
  expect(analysis.codePoints).toBeLessThanOrEqual(analysis.utf16CodeUnits);
  expect(analysis.graphemeClusters).toBeLessThanOrEqual(analysis.codePoints);
  expect(analysis.graphemesWithoutWhitespace).toBeLessThanOrEqual(analysis.graphemeClusters);
  expect(analysis.words).toBeLessThanOrEqual(analysis.graphemeClusters);
  expect(analysis.sentences).toBeLessThanOrEqual(analysis.graphemeClusters);
  expect(analysis.lines).toBe(input.length === 0 ? 0 : analysis.lineBreaks + 1);
}

describe('Unicode representations', () => {
  it('does not normalize canonically equivalent NFC and NFD input', () => {
    const nfc = analyzeText('\u00e9');
    const nfd = analyzeText('e\u0301');

    expect(nfc).toMatchObject({
      utf16CodeUnits: 1,
      codePoints: 1,
      unicodeScalars: 1,
      graphemeClusters: 1,
      words: 1,
      utf8Bytes: 2,
    });
    expect(nfd).toMatchObject({
      utf16CodeUnits: 2,
      codePoints: 2,
      unicodeScalars: 2,
      graphemeClusters: 1,
      words: 1,
      utf8Bytes: 3,
    });
  });

  it.each([
    ['family emoji', '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66', 11, 7, 25],
    ['flag', '\ud83c\uddf0\ud83c\uddf7', 4, 2, 8],
    ['skin-tone sequence', '\ud83d\udc4d\ud83c\udffd', 4, 2, 8],
    ['Hangul Jamo syllable', '\u1112\u1161\u11ab', 3, 3, 9],
  ])('counts %s as one grapheme cluster', (_label, input, utf16, codePoints, utf8Bytes) => {
    expect(analyzeText(input)).toMatchObject({
      utf16CodeUnits: utf16,
      codePoints,
      unicodeScalars: codePoints,
      loneSurrogates: 0,
      graphemeClusters: 1,
      graphemesWithoutWhitespace: 1,
      utf8Bytes,
    });
  });

  it('uses locale-sensitive word segmentation without assuming exact CJK or Thai tokenization', () => {
    const chinese = analyzeText('\u4e2d\u6587\u6e2c\u8a66', { locale: 'zh' });
    const thai = analyzeText('\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22', { locale: 'th' });

    expect(chinese.graphemeClusters).toBe(4);
    expect(chinese.words).toBeGreaterThan(0);
    expect(chinese.words).toBeLessThanOrEqual(chinese.graphemeClusters);
    expect(chinese.resolvedLocale).toMatch(/^zh(?:-|$)/);
    expect(thai.graphemeClusters).toBeGreaterThan(0);
    expect(thai.words).toBeGreaterThan(0);
    expect(thai.words).toBeLessThanOrEqual(thai.graphemeClusters);
    expect(thai.resolvedLocale).toMatch(/^th(?:-|$)/);
  });
});

describe('whitespace, sentences, paragraphs, and lines', () => {
  it('excludes Unicode whitespace graphemes, including NBSP', () => {
    const analysis = analyzeText(`a\u00a0b\t\nc`);

    expect(analysis.graphemeClusters).toBe(6);
    expect(analysis.graphemesWithoutWhitespace).toBe(3);
    expect(analysis.words).toBe(3);
  });

  it('counts CRLF once and recognizes CR, LF, NEL, LS, and PS with a trailing empty line', () => {
    const input = 'a\r\nb\rc\nd\u0085e\u2028f\u2029';
    const analysis = analyzeText(input);

    expect(analysis.lineBreaks).toBe(6);
    expect(analysis.lines).toBe(7);
    expect(analysis.paragraphs).toBe(1);
  });

  it('counts nonblank line blocks as paragraphs and ignores whitespace-only blocks', () => {
    const analysis = analyzeText('\nalpha\ncontinues\n \t\u00a0\nbeta\r\n\r\n gamma\n');

    expect(analysis.paragraphs).toBe(3);
    expect(analyzeText('\n\t\u00a0\r\n').paragraphs).toBe(0);
  });

  it('counts only nonblank sentence segments', () => {
    expect(analyzeText('First sentence. Second sentence!\n\t').sentences).toBe(2);
    expect(analyzeText('\u00a0\n\t').sentences).toBe(0);
  });

  it('defines empty and trailing-break line counts explicitly', () => {
    expect(analyzeText('')).toMatchObject({ lineBreaks: 0, lines: 0, paragraphs: 0 });
    expect(analyzeText('text')).toMatchObject({ lineBreaks: 0, lines: 1 });
    expect(analyzeText('text\n')).toMatchObject({ lineBreaks: 1, lines: 2 });
    expect(analyzeText('\n')).toMatchObject({ lineBreaks: 1, lines: 2, paragraphs: 0 });
  });
});

describe('ill-formed UTF-16 and UTF-8 policy', () => {
  it('reports lone surrogate offsets and rejects their UTF-8 byte count by default', () => {
    const analysis = analyzeText('A\ud800B\udc00C');

    expect(analysis).toMatchObject({
      utf16CodeUnits: 5,
      codePoints: 5,
      unicodeScalars: 3,
      loneSurrogates: 2,
      loneSurrogateOffsets: [1, 3],
      utf8Bytes: null,
    });
  });

  it('counts TextEncoder replacement bytes only when requested', () => {
    expect(analyzeText('A\ud800B\udc00C', { utf8Policy: 'replace-ill-formed' }).utf8Bytes).toBe(9);
    expect(analyzeText('\ud83d\ude00')).toMatchObject({
      utf16CodeUnits: 2,
      codePoints: 1,
      unicodeScalars: 1,
      loneSurrogates: 0,
      loneSurrogateOffsets: [],
      utf8Bytes: 4,
    });
  });
});

describe('validation and invariants', () => {
  it('uses English and reject-ill-formed defaults', () => {
    const analysis = analyzeText('hello');
    expect(analysis.resolvedLocale).toMatch(/^en(?:-|$)/);
    expect(analysis.utf8Bytes).toBe(5);
  });

  it('enforces the UTF-16 input cap before segmentation', () => {
    expect(MAX_TEXT_INPUT_CODE_UNITS).toBe(200_000);
    expect(analyzeText('a'.repeat(MAX_TEXT_INPUT_CODE_UNITS)).utf16CodeUnits).toBe(MAX_TEXT_INPUT_CODE_UNITS);
    expectError(
      () => analyzeText('a'.repeat(MAX_TEXT_INPUT_CODE_UNITS + 1)),
      'INPUT_TOO_LARGE',
    );
  });

  it('honors a lower caller-provided UTF-16 input cap', () => {
    expect(analyzeText('abc', { maxCodeUnits: 3 }).utf16CodeUnits).toBe(3);
    expectError(() => analyzeText('abcd', { maxCodeUnits: 3 }), 'INPUT_TOO_LARGE');
    expect(() => analyzeText('', { maxCodeUnits: MAX_TEXT_INPUT_CODE_UNITS + 1 })).toThrow(TypeError);
  });

  it('rejects malformed locale identifiers with a stable code', () => {
    expectError(() => analyzeText('hello', { locale: 'not a locale' }), 'INVALID_LOCALE');
  });

  it('reports unavailable Intl.Segmenter with a stable code', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    try {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
      expectError(() => analyzeText('hello'), 'SEGMENTER_UNAVAILABLE');
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
      else delete (Intl as unknown as { Segmenter?: unknown }).Segmenter;
    }
  });

  it('maintains core relationships across mixed Unicode input', () => {
    const corpus = [
      '',
      'plain ASCII words',
      'e\u0301 \u00e9',
      '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66 \ud83c\uddf0\ud83c\uddf7',
      '\u1112\u1161\u11ab \u4e2d\u6587 \u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22',
      'one\r\ntwo\u0085three\u2028four\u2029',
      'A\ud800B\udc00C',
    ];

    for (const input of corpus) {
      expectCoreInvariants(input, analyzeText(input));
      expectCoreInvariants(input, analyzeText(input, { utf8Policy: 'replace-ill-formed' }));
    }
  });
});
