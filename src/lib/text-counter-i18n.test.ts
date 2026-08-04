import { describe, expect, it } from 'vitest';
import {
  calculateJapaneseManuscriptEstimate,
  calculateKoreanAsciiWeightedCount,
  formatTextCounterMessage,
  getTextCounterMessages,
  getTextCounterNumberLocale,
  resolveTextCounterAnalysisLocale,
  resolveTextCounterCharacterLimit,
  resolveTextCounterUiLocale,
} from './text-counter-i18n';

describe('text-counter locale contracts', () => {
  it('defaults unknown UI locales to English and accepts regional variants', () => {
    expect(resolveTextCounterUiLocale(undefined)).toBe('en');
    expect(resolveTextCounterUiLocale('')).toBe('en');
    expect(resolveTextCounterUiLocale('fr-FR')).toBe('en');
    expect(resolveTextCounterUiLocale('es-MX')).toBe('es');
    expect(resolveTextCounterUiLocale('JA_jp')).toBe('ja');
    expect(resolveTextCounterUiLocale('ko-KR')).toBe('ko');
  });

  it('provides localized runtime labels and number locales for every UI locale', () => {
    expect(getTextCounterMessages('en').clear).toBe('Clear');
    expect(getTextCounterMessages('es').clear).toBe('Borrar');
    expect(getTextCounterMessages('ja').clear).toBe('クリア');
    expect(getTextCounterMessages('ko').clear).toBe('지우기');
    expect(getTextCounterNumberLocale('en')).toBe('en-US');
    expect(getTextCounterNumberLocale('es')).toBe('es-ES');
    expect(getTextCounterNumberLocale('ja')).toBe('ja-JP');
    expect(getTextCounterNumberLocale('ko')).toBe('ko-KR');
  });

  it('interpolates known placeholders without discarding unknown ones', () => {
    expect(formatTextCounterMessage('{count} of {limit}', { count: '12', limit: 20 }))
      .toBe('12 of 20');
    expect(formatTextCounterMessage('{known} {missing}', { known: 'yes' }))
      .toBe('yes {missing}');
  });

  it('uses data-attribute defaults for analysis locale and character limit', () => {
    expect(resolveTextCounterAnalysisLocale(undefined)).toBe('auto');
    expect(resolveTextCounterAnalysisLocale('  ')).toBe('auto');
    expect(resolveTextCounterAnalysisLocale(' ja-JP ')).toBe('ja-JP');

    expect(resolveTextCounterCharacterLimit(undefined)).toBe(280);
    expect(resolveTextCounterCharacterLimit('')).toBe(280);
    expect(resolveTextCounterCharacterLimit('0')).toBe(280);
    expect(resolveTextCounterCharacterLimit('280.5')).toBe(280);
    expect(resolveTextCounterCharacterLimit('1000001')).toBe(280);
    expect(resolveTextCounterCharacterLimit('1')).toBe(1);
    expect(resolveTextCounterCharacterLimit('500')).toBe(500);
    expect(resolveTextCounterCharacterLimit('1000000')).toBe(1_000_000);
  });
});

describe('localized character-page helper metrics', () => {
  it('returns the quotient and remainder for 400-character manuscript sheets', () => {
    expect(calculateJapaneseManuscriptEstimate(0)).toEqual({
      fullSheets: 0,
      remainderCharacters: 0,
    });
    expect(calculateJapaneseManuscriptEstimate(399)).toEqual({
      fullSheets: 0,
      remainderCharacters: 399,
    });
    expect(calculateJapaneseManuscriptEstimate(400)).toEqual({
      fullSheets: 1,
      remainderCharacters: 0,
    });
    expect(calculateJapaneseManuscriptEstimate(801)).toEqual({
      fullSheets: 2,
      remainderCharacters: 1,
    });
  });

  it('rejects invalid manuscript-sheet inputs', () => {
    expect(() => calculateJapaneseManuscriptEstimate(-1)).toThrow(RangeError);
    expect(() => calculateJapaneseManuscriptEstimate(1.5)).toThrow(RangeError);
    expect(() => calculateJapaneseManuscriptEstimate(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('applies ASCII=1 and each non-ASCII code point=2 without treating emoji as two UTF-16 units', () => {
    expect(calculateKoreanAsciiWeightedCount('ABC 123\n')).toEqual({
      weightedCount: 8,
      asciiCodePoints: 8,
      nonAsciiCodePoints: 0,
    });
    expect(calculateKoreanAsciiWeightedCount('A한😀')).toEqual({
      weightedCount: 5,
      asciiCodePoints: 1,
      nonAsciiCodePoints: 2,
    });
    expect(calculateKoreanAsciiWeightedCount('e\u0301')).toEqual({
      weightedCount: 3,
      asciiCodePoints: 1,
      nonAsciiCodePoints: 1,
    });
  });
});
