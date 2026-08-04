import { describe, expect, it } from 'vitest';
import {
  buildToneTimeline,
  MorseAudioSignalLimitError,
} from './morse-audio';

describe('buildToneTimeline', () => {
  it('uses one unit for a dot and three for a dash', () => {
    expect(buildToneTimeline('.').segments).toEqual([
      { startUnits: 0, durationUnits: 1 },
    ]);
    expect(buildToneTimeline('-').segments).toEqual([
      { startUnits: 0, durationUnits: 3 },
    ]);
  });

  it('uses one-unit intra-element gaps', () => {
    expect(buildToneTimeline('.-..')).toEqual({
      segments: [
        { startUnits: 0, durationUnits: 1 },
        { startUnits: 2, durationUnits: 3 },
        { startUnits: 6, durationUnits: 1 },
        { startUnits: 8, durationUnits: 1 },
      ],
      totalUnits: 9,
    });
  });

  it('uses a three-unit letter gap without adding an intra-element gap', () => {
    expect(buildToneTimeline('. -')).toEqual({
      segments: [
        { startUnits: 0, durationUnits: 1 },
        { startUnits: 4, durationUnits: 3 },
      ],
      totalUnits: 7,
    });
  });

  it('uses a seven-unit word gap without also adding a letter gap', () => {
    expect(buildToneTimeline('. / -')).toEqual({
      segments: [
        { startUnits: 0, durationUnits: 1 },
        { startUnits: 8, durationUnits: 3 },
      ],
      totalUnits: 11,
    });
  });

  it('combines 1:3 tones and 1:3:7 gaps across a full phrase', () => {
    expect(buildToneTimeline('.- -... / .')).toEqual({
      segments: [
        { startUnits: 0, durationUnits: 1 },
        { startUnits: 2, durationUnits: 3 },
        { startUnits: 8, durationUnits: 3 },
        { startUnits: 12, durationUnits: 1 },
        { startUnits: 14, durationUnits: 1 },
        { startUnits: 16, durationUnits: 1 },
        { startUnits: 24, durationUnits: 1 },
      ],
      totalUnits: 25,
    });
  });

  it('returns an immutable empty timeline for empty input', () => {
    const timeline = buildToneTimeline('');

    expect(timeline).toEqual({ segments: [], totalUnits: 0 });
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.segments)).toBe(true);
  });

  it('freezes the result, segment collection, and every segment', () => {
    const timeline = buildToneTimeline('.-');

    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.segments)).toBe(true);
    expect(timeline.segments.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ['leading space', ' .'],
    ['trailing space', '. '],
    ['double letter space', '.  -'],
    ['bare slash', './-'],
    ['unspaced slash', '. /-'],
    ['leading word separator', '/ .'],
    ['trailing word separator', '. /'],
    ['repeated word separator', '. / / -'],
    ['newline', '.\n-'],
    ['trailing newline', '.\n'],
    ['tab', '.\t-'],
    ['non-breaking space', '.\u00a0-'],
    ['Unicode bullet', '•'],
    ['Unicode dash', '−'],
    ['letter', '.A'],
  ])('rejects non-canonical input: %s', (_label, input) => {
    expect(() => buildToneTimeline(input)).toThrow(SyntaxError);
  });

  it('enforces a signal cap before producing a timeline', () => {
    expect(buildToneTimeline('...', { maxSignals: 3 }).segments).toHaveLength(3);
    expect(() => buildToneTimeline('....', { maxSignals: 3 })).toThrowError(
      expect.objectContaining({
        name: 'MorseAudioSignalLimitError',
        limit: 3,
      }),
    );
    expect(() => buildToneTimeline('.', { maxSignals: 0 })).toThrow(MorseAudioSignalLimitError);
    expect(buildToneTimeline('', { maxSignals: 0 })).toEqual({ segments: [], totalUnits: 0 });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid maxSignals value: %s',
    (maxSignals) => {
      expect(() => buildToneTimeline('.', { maxSignals })).toThrow(RangeError);
    },
  );
});
