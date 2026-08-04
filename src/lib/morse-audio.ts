export interface MorseToneSegment {
  readonly startUnits: number;
  readonly durationUnits: 1 | 3;
}

export interface MorseToneTimeline {
  readonly segments: readonly MorseToneSegment[];
  readonly totalUnits: number;
}

export interface MorseToneTimelineOptions {
  /** Stop before allocating tone segments when this many signals would be exceeded. */
  readonly maxSignals?: number;
}

export class MorseAudioSignalLimitError extends RangeError {
  readonly limit: number;

  constructor(limit: number) {
    super(`Morse audio is limited to ${limit.toLocaleString('en-US')} dot/dash signals.`);
    this.name = 'MorseAudioSignalLimitError';
    this.limit = limit;
  }
}

const CANONICAL_MORSE = /^(?:[.-]+(?: [.-]+)*(?: \/ [.-]+(?: [.-]+)*)*)?$/;

function assertOptions(options: MorseToneTimelineOptions): number | undefined {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Morse audio options must be an object.');
  }

  const { maxSignals } = options;
  if (maxSignals !== undefined && (!Number.isInteger(maxSignals) || maxSignals < 0)) {
    throw new RangeError('maxSignals must be a non-negative whole number.');
  }
  return maxSignals;
}

/**
 * Builds International Morse timing in units. The accepted representation is
 * canonical written Morse: ASCII dots/dashes, one space between letters, and
 * exactly ` / ` between words.
 */
export function buildToneTimeline(
  normalized: string,
  options: MorseToneTimelineOptions = {},
): MorseToneTimeline {
  if (typeof normalized !== 'string') {
    throw new TypeError('Normalized Morse must be a string.');
  }
  const maxSignals = assertOptions(options);
  const canonicalMatch = CANONICAL_MORSE.exec(normalized);
  if (canonicalMatch?.[0] !== normalized) {
    throw new SyntaxError(
      'Morse audio requires canonical ASCII dots/dashes, single letter spaces, and ` / ` word separators.',
    );
  }

  let signalCount = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const symbol = normalized[index];
    if (symbol !== '.' && symbol !== '-') continue;
    signalCount += 1;
    if (maxSignals !== undefined && signalCount > maxSignals) {
      throw new MorseAudioSignalLimitError(maxSignals);
    }
  }

  if (normalized === '') {
    return Object.freeze({ segments: Object.freeze([]), totalUnits: 0 });
  }

  const segments: MorseToneSegment[] = [];
  let cursor = 0;
  const words = normalized.split(' / ');

  words.forEach((word, wordIndex) => {
    const groups = word.split(' ');

    groups.forEach((group, groupIndex) => {
      for (let signalIndex = 0; signalIndex < group.length; signalIndex += 1) {
        const durationUnits = group[signalIndex] === '.' ? 1 : 3;
        segments.push(Object.freeze({ startUnits: cursor, durationUnits }));
        cursor += durationUnits;
        if (signalIndex < group.length - 1) cursor += 1;
      }

      if (groupIndex < groups.length - 1) cursor += 3;
    });

    if (wordIndex < words.length - 1) cursor += 7;
  });

  return Object.freeze({
    segments: Object.freeze(segments),
    totalUnits: cursor,
  });
}
