export type EpochUnit = 'auto' | 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds';

export type DetectedEpochUnit = Exclude<EpochUnit, 'auto'>;

export type EpochErrorCode =
  | 'empty-input'
  | 'input-too-long'
  | 'invalid-format'
  | 'too-many-fraction-digits'
  | 'fraction-not-supported'
  | 'date-out-of-range'
  | 'invalid-date';

export interface EpochConversionSuccess {
  ok: true;
  detectedUnit: DetectedEpochUnit;
  /** The exact instant represented as nanoseconds since the Unix epoch. */
  epochNanoseconds: bigint;
  /** A millisecond-resolution Date projection of the exact instant. */
  date: Date;
  iso: string;
  utc: string;
  local: string;
  rfc: string;
  relative: string;
  seconds: string;
  milliseconds: string;
  microseconds: string;
  nanoseconds: string;
  /** Mathematical floor of epochNanoseconds / 1,000,000. */
  millisecondFloor: string;
  /** Positive remainder in the range 0..999,999 after flooring to milliseconds. */
  subMillisecondNanoseconds: string;
  warning?: string;
}

export interface EpochConversionFailure {
  ok: false;
  code: EpochErrorCode;
  error: string;
}

export type EpochConversionResult = EpochConversionSuccess | EpochConversionFailure;

const NANOSECONDS_PER_MICROSECOND = 1_000n;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000n;
const MAX_DATE_NANOSECONDS = MAX_DATE_MILLISECONDS * NANOSECONDS_PER_MILLISECOND;
export const MAX_EPOCH_INPUT_CHARACTERS = 80;

const UNIT_NANOSECONDS: Record<DetectedEpochUnit, bigint> = {
  seconds: NANOSECONDS_PER_SECOND,
  milliseconds: NANOSECONDS_PER_MILLISECOND,
  microseconds: NANOSECONDS_PER_MICROSECOND,
  nanoseconds: 1n,
};

function failure(code: EpochErrorCode, error: string): EpochConversionFailure {
  return { ok: false, code, error };
}

/** Integer division rounded toward negative infinity. */
function floorDivide(dividend: bigint, divisor: bigint): bigint {
  let quotient = dividend / divisor;
  const remainder = dividend % divisor;
  if (remainder !== 0n && ((dividend < 0n) !== (divisor < 0n))) quotient -= 1n;
  return quotient;
}

/** A modulo paired with floorDivide, always non-negative for a positive divisor. */
function floorModulo(dividend: bigint, divisor: bigint): bigint {
  return dividend - floorDivide(dividend, divisor) * divisor;
}

function formatExactUnit(epochNanoseconds: bigint, nanosecondsPerUnit: bigint): string {
  if (nanosecondsPerUnit === 1n) return epochNanoseconds.toString();

  const isNegative = epochNanoseconds < 0n;
  const absolute = isNegative ? -epochNanoseconds : epochNanoseconds;
  const integer = absolute / nanosecondsPerUnit;
  const remainder = absolute % nanosecondsPerUnit;
  const sign = isNegative ? '-' : '';
  if (remainder === 0n) return `${sign}${integer}`;

  const fractionWidth = nanosecondsPerUnit.toString().length - 1;
  const fraction = remainder.toString().padStart(fractionWidth, '0').replace(/0+$/, '');
  return `${sign}${integer}.${fraction}`;
}

function formatExactIso(epochNanoseconds: bigint): string {
  const secondFloor = floorDivide(epochNanoseconds, NANOSECONDS_PER_SECOND);
  const fractionNanoseconds = floorModulo(epochNanoseconds, NANOSECONDS_PER_SECOND);
  const secondDate = new Date(Number(secondFloor * 1_000n));
  const baseIso = secondDate.toISOString();
  const fraction = fractionNanoseconds
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '')
    .padEnd(3, '0');
  return `${baseIso.slice(0, -5)}.${fraction}Z`;
}

function detectIntegerUnit(digits: string): DetectedEpochUnit {
  const significantDigits = digits.replace(/^0+(?=\d)/, '');
  if (significantDigits.length <= 10) return 'seconds';
  if (significantDigits.length <= 13) return 'milliseconds';
  if (significantDigits.length <= 16) return 'microseconds';
  return 'nanoseconds';
}

function formatRelative(dateMilliseconds: number, nowMilliseconds = Date.now()): string {
  const differenceMilliseconds = dateMilliseconds - nowMilliseconds;
  const absoluteMilliseconds = Math.abs(differenceMilliseconds);
  if (absoluteMilliseconds < 1_000) return 'now';

  const units = [
    { name: 'year', milliseconds: 365.2425 * 24 * 60 * 60 * 1_000 },
    { name: 'month', milliseconds: 30.436875 * 24 * 60 * 60 * 1_000 },
    { name: 'day', milliseconds: 24 * 60 * 60 * 1_000 },
    { name: 'hour', milliseconds: 60 * 60 * 1_000 },
    { name: 'minute', milliseconds: 60 * 1_000 },
    { name: 'second', milliseconds: 1_000 },
  ] as const;
  const unit = units.find((candidate) => absoluteMilliseconds >= candidate.milliseconds) ?? units[units.length - 1];
  const amount = Math.max(1, Math.round(absoluteMilliseconds / unit.milliseconds));
  const label = `${amount} ${unit.name}${amount === 1 ? '' : 's'}`;
  return differenceMilliseconds < 0 ? `${label} ago` : `in ${label}`;
}

function buildSuccess(
  epochNanoseconds: bigint,
  detectedUnit: DetectedEpochUnit,
  warningParts: string[] = [],
): EpochConversionResult {
  if (epochNanoseconds < -MAX_DATE_NANOSECONDS || epochNanoseconds > MAX_DATE_NANOSECONDS) {
    return failure(
      'date-out-of-range',
      'This timestamp is outside the JavaScript Date range (±8,640,000,000,000,000 milliseconds).',
    );
  }

  const millisecondFloor = floorDivide(epochNanoseconds, NANOSECONDS_PER_MILLISECOND);

  const date = new Date(Number(millisecondFloor));
  if (Number.isNaN(date.getTime())) {
    return failure('date-out-of-range', 'This timestamp cannot be represented as a JavaScript Date.');
  }

  const subMillisecondNanoseconds = floorModulo(epochNanoseconds, NANOSECONDS_PER_MILLISECOND);
  if (subMillisecondNanoseconds !== 0n) {
    warningParts.push(
      'The Date object, local time, and RFC display use the containing millisecond; ISO/UTC and exact epoch values preserve nanoseconds.',
    );
  }

  const iso = formatExactIso(epochNanoseconds);
  return {
    ok: true,
    detectedUnit,
    epochNanoseconds,
    date,
    iso,
    utc: iso.replace('T', ' ').replace('Z', ' UTC'),
    local: date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }),
    rfc: date.toUTCString(),
    relative: formatRelative(date.getTime()),
    seconds: formatExactUnit(epochNanoseconds, NANOSECONDS_PER_SECOND),
    milliseconds: formatExactUnit(epochNanoseconds, NANOSECONDS_PER_MILLISECOND),
    microseconds: formatExactUnit(epochNanoseconds, NANOSECONDS_PER_MICROSECOND),
    nanoseconds: epochNanoseconds.toString(),
    millisecondFloor: millisecondFloor.toString(),
    subMillisecondNanoseconds: subMillisecondNanoseconds.toString(),
    ...(warningParts.length > 0 ? { warning: warningParts.join(' ') } : {}),
  };
}

/**
 * Convert an epoch value without passing through Number. Integer seconds,
 * milliseconds, microseconds, and nanoseconds stay exact. Decimal input is
 * supported for seconds with at most nine fractional digits.
 */
export function parseEpoch(input: string, unit: EpochUnit = 'auto'): EpochConversionResult {
  const normalized = input.trim();
  if (normalized.length === 0) return failure('empty-input', 'Enter a Unix timestamp to convert.');
  if (normalized.length > MAX_EPOCH_INPUT_CHARACTERS) {
    return failure(
      'input-too-long',
      `Use at most ${MAX_EPOCH_INPUT_CHARACTERS} characters. Valid Unix timestamps within the browser date range are much shorter.`,
    );
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) {
    return failure(
      'invalid-format',
      'Use digits with an optional sign. Only seconds may include a decimal fraction.',
    );
  }

  const [, signToken, integerDigits, fractionDigits] = match;
  if (fractionDigits && fractionDigits.length > 9) {
    return failure('too-many-fraction-digits', 'Decimal seconds support at most 9 fractional digits.');
  }

  const detectedUnit: DetectedEpochUnit = unit === 'auto'
    ? (fractionDigits ? 'seconds' : detectIntegerUnit(integerDigits))
    : unit;
  if (fractionDigits && detectedUnit !== 'seconds') {
    return failure(
      'fraction-not-supported',
      'Decimal fractions are supported for seconds only. Use an integer for smaller units.',
    );
  }

  let epochNanoseconds = BigInt(integerDigits) * UNIT_NANOSECONDS[detectedUnit];
  if (fractionDigits) epochNanoseconds += BigInt(fractionDigits.padEnd(9, '0'));
  if (signToken === '-') epochNanoseconds = -epochNanoseconds;

  const warnings: string[] = [];
  if (unit === 'auto') {
    warnings.push(fractionDigits
      ? 'Decimal input was interpreted as seconds.'
      : `Unit auto-detected as ${detectedUnit} from the integer digit count; select a unit to override the heuristic.`);
  }
  return buildSuccess(epochNanoseconds, detectedUnit, warnings);
}

/** Convert a valid Date, ISO-like date string, or millisecond number to exact epoch units. */
export function dateToEpoch(input: Date | string | number): EpochConversionResult {
  if (typeof input === 'string' && input.trim().length === 0) {
    return failure('invalid-date', 'Enter a date to convert.');
  }

  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) {
    return failure('invalid-date', 'Enter a valid date within the JavaScript Date range.');
  }

  return buildSuccess(BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND, 'milliseconds');
}
