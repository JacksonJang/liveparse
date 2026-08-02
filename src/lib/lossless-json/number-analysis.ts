const MAX_SAFE_INTEGER_DECIMAL = '9007199254740991';
const EXPONENT_SATURATION = 1_000_000_000;

interface NormalizedDecimal {
  negative: boolean;
  zero: boolean;
  /** Significant decimal digits with leading and trailing zeroes removed. */
  digits: string;
  /** Power of ten applied to digits. Saturated for hostile exponents. */
  exponent: number;
}

export interface JsonNumberAnalysis {
  unsafeInteger: boolean;
  overflow: boolean;
  representationChanged: boolean;
  javascriptRepresentation?: string;
  valueChanged: boolean;
}

function saturatedExponent(sign: string | undefined, digits: string | undefined): number {
  if (!digits) return 0;
  let value = 0;
  for (let index = 0; index < digits.length; index += 1) {
    if (value >= EXPONENT_SATURATION) return sign === '-' ? -EXPONENT_SATURATION : EXPONENT_SATURATION;
    value = Math.min(EXPONENT_SATURATION, value * 10 + (digits.charCodeAt(index) - 48));
  }
  return sign === '-' ? -value : value;
}

function clampExponent(value: number): number {
  return Math.max(-EXPONENT_SATURATION, Math.min(EXPONENT_SATURATION, value));
}

function normalizeDecimal(raw: string): NormalizedDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?)(\d+))?$/.exec(raw);
  if (!match) throw new Error(`Cannot analyze invalid JSON number: ${raw}`);

  const negative = match[1] === '-';
  const fraction = match[3] ?? '';
  let digits = `${match[2]}${fraction}`;
  let exponent = clampExponent(saturatedExponent(match[4], match[5]) - fraction.length);

  let firstNonZero = 0;
  while (firstNonZero < digits.length && digits.charCodeAt(firstNonZero) === 48) firstNonZero += 1;
  if (firstNonZero === digits.length) return { negative, zero: true, digits: '0', exponent: 0 };
  digits = digits.slice(firstNonZero);

  let lastNonZero = digits.length;
  while (lastNonZero > 0 && digits.charCodeAt(lastNonZero - 1) === 48) lastNonZero -= 1;
  exponent = clampExponent(exponent + digits.length - lastNonZero);
  digits = digits.slice(0, lastNonZero);

  return { negative, zero: false, digits, exponent };
}

function decimalsEqual(left: NormalizedDecimal, right: NormalizedDecimal): boolean {
  if (left.zero || right.zero) return left.zero && right.zero;
  return left.negative === right.negative && left.digits === right.digits && left.exponent === right.exponent;
}

function exceedsSafeInteger(decimal: NormalizedDecimal): boolean {
  if (decimal.zero || decimal.exponent < 0) return false;
  const integerDigits = decimal.digits.length + decimal.exponent;
  if (integerDigits !== MAX_SAFE_INTEGER_DECIMAL.length) {
    return integerDigits > MAX_SAFE_INTEGER_DECIMAL.length;
  }
  const integer = decimal.digits.padEnd(integerDigits, '0');
  return integer > MAX_SAFE_INTEGER_DECIMAL;
}

export function analyzeJsonNumber(raw: string): JsonNumberAnalysis {
  const decimal = normalizeDecimal(raw);
  const javascriptNumber = Number(raw);
  const overflow = !decimal.zero && !Number.isFinite(javascriptNumber);

  if (overflow) {
    return {
      unsafeInteger: false,
      overflow: true,
      representationChanged: false,
      valueChanged: true,
    };
  }

  const javascriptRepresentation = JSON.stringify(javascriptNumber);
  // A finite Number always has a JSON representation.
  const canonical = javascriptRepresentation ?? 'null';
  const canonicalDecimal = normalizeDecimal(canonical);
  const negativeZeroChanged = decimal.zero && decimal.negative && !canonical.startsWith('-');

  return {
    unsafeInteger: exceedsSafeInteger(decimal),
    overflow: false,
    representationChanged: canonical !== raw,
    javascriptRepresentation: canonical,
    valueChanged: negativeZeroChanged || !decimalsEqual(decimal, canonicalDecimal),
  };
}
