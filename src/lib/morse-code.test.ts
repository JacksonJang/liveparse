import { describe, expect, it } from 'vitest';
import {
  INTERNATIONAL_MORSE_CODE,
  MAX_MORSE_DIAGNOSTICS,
  MAX_MORSE_INPUT_CODE_UNITS,
  MORSE_LETTER_SEPARATOR,
  MORSE_REPLACEMENT_CHARACTER,
  MORSE_WORD_SEPARATOR,
  MorseInputError,
  decodeMorse,
  encodeMorse,
} from './morse-code';

const EXPECTED_LETTERS: Readonly<Record<string, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', É: '..-..',
};

const EXPECTED_DIGITS: Readonly<Record<string, string>> = {
  1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....',
  6: '-....', 7: '--...', 8: '---..', 9: '----.', 0: '-----',
};

const EXPECTED_PUNCTUATION: Readonly<Record<string, string>> = {
  '.': '.-.-.-',
  ',': '--..--',
  ':': '---...',
  '?': '..--..',
  "'": '.----.',
  '-': '-....-',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '"': '.-..-.',
  '=': '-...-',
  '+': '.-.-.',
  '×': '-..-',
  '@': '.--.-.',
};

function tableFor(category: 'letter' | 'digit' | 'punctuation'): Record<string, string> {
  return Object.fromEntries(
    INTERNATIONAL_MORSE_CODE
      .filter((entry) => entry.category === category)
      .map((entry) => [entry.character, entry.code]),
  );
}

describe('ITU-R M.1677-1 Morse table', () => {
  it('contains the exact written letters, figures, and punctuation used by the converter', () => {
    expect(tableFor('letter')).toEqual(EXPECTED_LETTERS);
    expect(tableFor('digit')).toEqual(EXPECTED_DIGITS);
    expect(tableFor('punctuation')).toEqual(EXPECTED_PUNCTUATION);
    expect(INTERNATIONAL_MORSE_CODE).toHaveLength(51);
    expect(new Set(INTERNATIONAL_MORSE_CODE.map((entry) => entry.character)).size).toBe(51);
  });

  it('does not label common non-ITU extensions as standard written characters', () => {
    const characters = new Set(INTERNATIONAL_MORSE_CODE.map((entry) => entry.character));
    for (const extension of ['!', ';', '&', '_', '$']) expect(characters.has(extension)).toBe(false);
  });

  it('exports immutable reference data and explicit separators', () => {
    expect(Object.isFrozen(INTERNATIONAL_MORSE_CODE)).toBe(true);
    expect(INTERNATIONAL_MORSE_CODE.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(MORSE_LETTER_SEPARATOR).toBe(' ');
    expect(MORSE_WORD_SEPARATOR).toBe(' / ');
  });
});

describe('text to Morse', () => {
  it('encodes letters case-insensitively, digits, and explicit word boundaries', () => {
    const result = encodeMorse('Sos\t 2026\nradio');
    expect(result).toEqual({
      ok: true,
      output: '... --- ... / ..--- ----- ..--- -.... / .-. .- -.. .. ---',
      normalized: '... --- ... / ..--- ----- ..--- -.... / .-. .- -.. .. ---',
      diagnostics: [],
    });
  });

  it('encodes the complete reference table deterministically', () => {
    for (const entry of INTERNATIONAL_MORSE_CODE) {
      const result = encodeMorse(entry.character);
      expect(result.ok).toBe(true);
      expect(result.output).toBe(entry.code);
    }
    expect(encodeMorse('abcdefghijklmnopqrstuvwxyz').output)
      .toBe(Object.values(EXPECTED_LETTERS).slice(0, 26).join(' '));
    expect(encodeMorse('0123456789').output).toBe('----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----.');
  });

  it('supports accented E and warns about visible typographic normalization', () => {
    const result = encodeMorse('é “A—B’” 1′');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('..-.. / .-..-. .- -....- -... .----. .-..-. / .---- .----.');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'NORMALIZED_CHARACTER',
      'NORMALIZED_CHARACTER',
      'NORMALIZED_CHARACTER',
      'NORMALIZED_CHARACTER',
      'NORMALIZED_CHARACTER',
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      'warning', 'warning', 'warning', 'warning', 'warning',
    ]);
    expect(result.diagnostics[1]).toMatchObject({
      character: '—',
      normalizedCharacter: '-',
      offset: 4,
      length: 1,
    });
  });

  it('never silently drops unsupported characters and reports UTF-16 offsets', () => {
    const result = encodeMorse('A😀!B');
    expect(result.ok).toBe(false);
    expect(result.output).toBe(`.- ${MORSE_REPLACEMENT_CHARACTER} ${MORSE_REPLACEMENT_CHARACTER} -...`);
    expect(result.normalized).toBe(result.output);
    expect(result.diagnostics).toMatchObject([
      { code: 'UNSUPPORTED_CHARACTER', severity: 'error', character: '😀', offset: 1, length: 2 },
      { code: 'UNSUPPORTED_CHARACTER', severity: 'error', character: '!', offset: 3, length: 1 },
    ]);
  });

  it('collapses Unicode whitespace runs without creating phantom words', () => {
    expect(encodeMorse('\u3000 A\r\n\t B\u00a0').output).toBe('.- / -...');
    expect(encodeMorse('   ').output).toBe('');
  });

  it('caps hostile diagnostic volume while retaining an error summary', () => {
    const result = encodeMorse('!'.repeat(MAX_MORSE_DIAGNOSTICS + 5));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(MAX_MORSE_DIAGNOSTICS);
    expect(result.diagnostics[result.diagnostics.length - 1]).toMatchObject({
      code: 'DIAGNOSTICS_TRUNCATED',
      severity: 'error',
      omitted: 6,
    });
  });
});

describe('Morse to text', () => {
  it('decodes explicit tokens and canonicalizes accepted whitespace and slash spacing', () => {
    const result = decodeMorse('  ...\t---  .../ .-\u3000-...  ');
    expect(result).toEqual({
      ok: true,
      output: 'SOS AB',
      normalized: '... --- ... / .- -...',
      diagnostics: [],
    });
  });

  it('uses any amount of whitespace only as a letter separator', () => {
    expect(decodeMorse('....   ..').output).toBe('HI');
    expect(decodeMorse('....\n\n..').output).toBe('HI');
    expect(decodeMorse('   ').output).toBe('');
  });

  it('does not guess how to split unseparated Morse', () => {
    const result = decodeMorse('...---...');
    expect(result.ok).toBe(false);
    expect(result.output).toBe(MORSE_REPLACEMENT_CHARACTER);
    expect(result.normalized).toBe(MORSE_REPLACEMENT_CHARACTER);
    expect(result.diagnostics).toMatchObject([{
      code: 'UNKNOWN_TOKEN',
      severity: 'error',
      token: '...---...',
      tokenIndex: 0,
      offset: 0,
      length: 9,
    }]);
  });

  it('reports the ITU X/multiplication collision in strict mode', () => {
    const result = decodeMorse('-..-');
    expect(result.ok).toBe(false);
    expect(result.output).toBe(MORSE_REPLACEMENT_CHARACTER);
    expect(result.normalized).toBe('-..-');
    expect(result.diagnostics).toMatchObject([{
      code: 'AMBIGUOUS_TOKEN',
      severity: 'error',
      candidates: ['X', '×'],
      resolvedAs: null,
      tokenIndex: 0,
      offset: 0,
    }]);
  });

  it('can prefer the letter for practical decoding without hiding ambiguity', () => {
    const result = decodeMorse('... -..- ×', { ambiguity: 'prefer-letter' });
    expect(result.ok).toBe(false);
    expect(result.output).toBe(`SX${MORSE_REPLACEMENT_CHARACTER}`);
    expect(result.normalized).toBe(`... -..- ${MORSE_REPLACEMENT_CHARACTER}`);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'AMBIGUOUS_TOKEN',
      severity: 'warning',
      resolvedAs: 'X',
    });
    expect(result.diagnostics[1]).toMatchObject({ code: 'UNKNOWN_TOKEN', severity: 'error', token: '×' });

    const onlyAmbiguity = decodeMorse('-..-', { ambiguity: 'prefer-letter' });
    expect(onlyAmbiguity.ok).toBe(true);
    expect(onlyAmbiguity.output).toBe('X');
    expect(onlyAmbiguity.diagnostics).toMatchObject([{ severity: 'warning', resolvedAs: 'X' }]);
  });

  it('diagnoses leading, repeated, and trailing word separators', () => {
    const result = decodeMorse('/ ... // --- /');
    expect(result.ok).toBe(false);
    expect(result.output).toBe('S O');
    expect(result.normalized).toBe('... / ---');
    expect(result.diagnostics.map((diagnostic) => (
      diagnostic.code === 'INVALID_WORD_SEPARATOR' ? diagnostic.reason : null
    ))).toEqual(['leading', 'repeated', 'trailing']);
  });

  it('keeps arbitrary unknown tokens out of converted and normalized output', () => {
    const result = decodeMorse('<img> .-.-');
    expect(result.ok).toBe(false);
    expect(result.output).toBe(`${MORSE_REPLACEMENT_CHARACTER}${MORSE_REPLACEMENT_CHARACTER}`);
    expect(result.normalized).toBe(`${MORSE_REPLACEMENT_CHARACTER} ${MORSE_REPLACEMENT_CHARACTER}`);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['UNKNOWN_TOKEN', 'UNKNOWN_TOKEN']);
    expect(result.diagnostics[0]).toMatchObject({ token: '<img>', offset: 0, length: 5, tokenIndex: 0 });
  });

  it('round-trips every unambiguous written character', () => {
    for (const entry of INTERNATIONAL_MORSE_CODE.filter((candidate) => candidate.code !== '-..-')) {
      const encoded = encodeMorse(entry.character);
      const decoded = decodeMorse(encoded.output);
      expect(decoded.ok).toBe(true);
      expect(decoded.output).toBe(entry.character);
      expect(decoded.normalized).toBe(entry.code);
    }
  });

  it('caps warning-only diagnostics without changing a successful conversion', () => {
    const input = Array.from({ length: MAX_MORSE_DIAGNOSTICS + 5 }, () => '-..-').join(' ');
    const result = decodeMorse(input, { ambiguity: 'prefer-letter' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('X'.repeat(MAX_MORSE_DIAGNOSTICS + 5));
    expect(result.diagnostics).toHaveLength(MAX_MORSE_DIAGNOSTICS);
    expect(result.diagnostics[result.diagnostics.length - 1]).toMatchObject({
      code: 'DIAGNOSTICS_TRUNCATED',
      severity: 'warning',
      omitted: 6,
    });
  });
});

describe('Morse resource limits and runtime contracts', () => {
  it('accepts the documented limit and rejects the next UTF-16 code unit', () => {
    expect(encodeMorse(' '.repeat(MAX_MORSE_INPUT_CODE_UNITS)).ok).toBe(true);
    expect(() => encodeMorse(' '.repeat(MAX_MORSE_INPUT_CODE_UNITS + 1))).toThrow(MorseInputError);

    let caught: unknown;
    try {
      decodeMorse('....', { maxCodeUnits: 3 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MorseInputError);
    expect(caught).toMatchObject({ code: 'INPUT_TOO_LARGE', limit: 3, actual: 4 });
  });

  it('rejects invalid arguments and option values', () => {
    expect(() => encodeMorse(42 as unknown as string)).toThrow(TypeError);
    expect(() => decodeMorse('...', null as unknown as object)).toThrow(TypeError);
    for (const maxCodeUnits of [-1, 1.5, Number.NaN, MAX_MORSE_INPUT_CODE_UNITS + 1]) {
      expect(() => encodeMorse('', { maxCodeUnits })).toThrow(RangeError);
    }
    expect(() => decodeMorse('...', { ambiguity: 'guess' as 'reject' })).toThrow(TypeError);
  });

  it('returns frozen result, diagnostic, candidate, and table structures', () => {
    const result = decodeMorse('-..-');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic.code).toBe('AMBIGUOUS_TOKEN');
    if (diagnostic.code === 'AMBIGUOUS_TOKEN') expect(Object.isFrozen(diagnostic.candidates)).toBe(true);
  });
});
