export const DISCORD_TIMESTAMP_STYLES = ['t', 'T', 'd', 'D', 'f', 'F', 's', 'S', 'R'] as const;

export type DiscordTimestampStyle = (typeof DISCORD_TIMESTAMP_STYLES)[number];

export interface DiscordStyleDefinition {
  style: DiscordTimestampStyle;
  name: string;
  description: string;
}

export const DISCORD_STYLE_DEFINITIONS: readonly DiscordStyleDefinition[] = [
  { style: 't', name: 'Short Time', description: 'Time without seconds' },
  { style: 'T', name: 'Medium Time', description: 'Time including seconds' },
  { style: 'd', name: 'Short Date', description: 'Compact numeric date' },
  { style: 'D', name: 'Long Date', description: 'Written month and date' },
  { style: 'f', name: 'Long Date, Short Time', description: 'Discord’s documented default' },
  { style: 'F', name: 'Full Date, Short Time', description: 'Weekday, date, and time' },
  { style: 's', name: 'Short Date, Short Time', description: 'Compact date and time' },
  { style: 'S', name: 'Short Date, Medium Time', description: 'Compact date and time with seconds' },
  { style: 'R', name: 'Relative Time', description: 'Relative to the viewer’s current time' },
] as const;

export const MAX_DISCORD_INPUT_CHARACTERS = 80;
const MIN_DATE_MILLISECONDS = -8_640_000_000_000_000;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const MIN_DISCORD_SECONDS = 0n;
const MAX_DISCORD_SECONDS = BigInt(MAX_DATE_MILLISECONDS / 1_000);
const TAG_PATTERN = /^<t:(\d+)(?::([tTdDfFsSR]))?>$/;
const INTEGER_PATTERN = /^\d+$/;

export interface ParsedDiscordTimestamp {
  ok: true;
  seconds: string;
  milliseconds: number;
  style: DiscordTimestampStyle;
  explicitStyle: boolean;
  source: 'tag' | 'seconds';
  warning: string | null;
  suggestedSeconds: string | null;
  suggestedUnit: 'milliseconds' | 'microseconds' | 'nanoseconds' | null;
}

export interface DiscordTimestampError {
  ok: false;
  error: string;
  suggestedSeconds?: string;
  suggestedUnit?: 'milliseconds' | 'microseconds' | 'nanoseconds';
}

export type DiscordTimestampParseResult = ParsedDiscordTimestamp | DiscordTimestampError;

export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface WallClockResolution {
  ok: true;
  candidates: number[];
  warning: string | null;
}

export interface WallClockResolutionError {
  ok: false;
  error: string;
}

export type ResolveWallClockResult = WallClockResolution | WallClockResolutionError;

function isDiscordStyle(value: string): value is DiscordTimestampStyle {
  return (DISCORD_TIMESTAMP_STYLES as readonly string[]).includes(value);
}

function normalizedInteger(value: bigint): string {
  return value.toString();
}

function plausibleUnitSuggestion(value: bigint): {
  unit: 'milliseconds' | 'microseconds' | 'nanoseconds';
  seconds: string;
} | null {
  const absoluteDigits = (value < 0n ? -value : value).toString().length;
  const divisor = absoluteDigits >= 18
    ? { unit: 'nanoseconds' as const, value: 1_000_000_000n }
    : absoluteDigits >= 15
      ? { unit: 'microseconds' as const, value: 1_000_000n }
      : absoluteDigits >= 12
        ? { unit: 'milliseconds' as const, value: 1_000n }
        : null;
  if (!divisor) return null;

  const seconds = value / divisor.value;
  const milliseconds = Number(seconds) * 1_000;
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1990 || year > 2200) return null;
  return { unit: divisor.unit, seconds: normalizedInteger(seconds) };
}

export function parseDiscordTimestampInput(rawInput: string): DiscordTimestampParseResult {
  if (rawInput.length > MAX_DISCORD_INPUT_CHARACTERS) {
    return { ok: false, error: `Input is limited to ${MAX_DISCORD_INPUT_CHARACTERS} characters.` };
  }

  const input = rawInput.trim();
  if (!input) return { ok: false, error: 'Enter Unix seconds or a Discord timestamp tag.' };

  const tagMatch = TAG_PATTERN.exec(input);
  const source = tagMatch ? 'tag' as const : 'seconds' as const;
  if (!tagMatch && !INTEGER_PATTERN.test(input)) {
    if (/^<t:/i.test(input)) {
      return { ok: false, error: 'Use <t:UNIX_SECONDS> or <t:UNIX_SECONDS:STYLE> with a documented style letter.' };
    }
    return { ok: false, error: 'Enter non-negative whole Unix seconds, not a signed, decimal, or formatted time.' };
  }

  const secondsText = tagMatch ? tagMatch[1] : input;
  let seconds: bigint;
  try {
    seconds = BigInt(secondsText);
  } catch {
    return { ok: false, error: 'The Unix seconds value is not a valid integer.' };
  }

  const suggestion = plausibleUnitSuggestion(seconds);
  if (seconds < MIN_DISCORD_SECONDS || seconds > MAX_DISCORD_SECONDS) {
    if (suggestion) {
      return {
        ok: false,
        error: `That value is outside the seconds range and looks like Unix ${suggestion.unit}. Discord’s documented tag syntax uses seconds.`,
        suggestedSeconds: suggestion.seconds,
        suggestedUnit: suggestion.unit,
      };
    }
    return { ok: false, error: 'That value is outside the date range this browser can preview safely.' };
  }

  const styleText = tagMatch?.[2] ?? 'f';
  if (!isDiscordStyle(styleText)) {
    return { ok: false, error: `Unsupported style “${styleText}”. Use t, T, d, D, f, F, s, S, or R.` };
  }

  const warning = suggestion
    ? `This looks like Unix ${suggestion.unit}, but Discord’s documented tag syntax uses seconds.`
    : null;

  return {
    ok: true,
    seconds: normalizedInteger(seconds),
    milliseconds: Number(seconds) * 1_000,
    style: styleText,
    explicitStyle: Boolean(tagMatch?.[2]),
    source,
    warning,
    suggestedSeconds: suggestion?.seconds ?? null,
    suggestedUnit: suggestion?.unit ?? null,
  };
}

export function discordTimestampCode(seconds: string | bigint, style?: DiscordTimestampStyle): string {
  const parsedSeconds = typeof seconds === 'bigint' ? seconds : BigInt(seconds);
  if (parsedSeconds < 0n) throw new RangeError('Discord timestamp codes require non-negative whole Unix seconds.');
  const normalizedSeconds = parsedSeconds.toString();
  return style ? `<t:${normalizedSeconds}:${style}>` : `<t:${normalizedSeconds}>`;
}

export function allDiscordTimestampCodes(seconds: string | bigint): Record<DiscordTimestampStyle, string> {
  return Object.fromEntries(
    DISCORD_TIMESTAMP_STYLES.map((style) => [style, discordTimestampCode(seconds, style)]),
  ) as Record<DiscordTimestampStyle, string>;
}

export function parseWallClockInput(value: string): WallClockParts | null {
  const match = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const parts: WallClockParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  if (parts.year < 1 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31
      || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  const check = new Date(0);
  check.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  check.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month
      || check.getUTCDate() !== parts.day || check.getUTCHours() !== parts.hour
      || check.getUTCMinutes() !== parts.minute || check.getUTCSeconds() !== parts.second) return null;
  return parts;
}

function utcMilliseconds(parts: WallClockParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function formatterForZone(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    era: 'short',
  });
}

function partsInZone(milliseconds: number, formatter: Intl.DateTimeFormat): WallClockParts | null {
  const values = new Map<string, string>();
  for (const part of formatter.formatToParts(new Date(milliseconds))) {
    if (part.type !== 'literal') values.set(part.type, part.value);
  }
  if (values.get('era') === 'BC') return null;
  const result: WallClockParts = {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function sameParts(left: WallClockParts | null, right: WallClockParts): boolean {
  return left !== null
    && left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function offsetAt(milliseconds: number, formatter: Intl.DateTimeFormat): number | null {
  const parts = partsInZone(milliseconds, formatter);
  if (!parts) return null;
  return utcMilliseconds(parts) - Math.floor(milliseconds / 1_000) * 1_000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterForZone(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

export function resolveWallClock(value: string, timeZone: string): ResolveWallClockResult {
  const desired = parseWallClockInput(value);
  if (!desired) return { ok: false, error: 'Enter a real calendar date and time with a year of at least four digits.' };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatterForZone(timeZone);
  } catch {
    return { ok: false, error: 'Choose a valid IANA timezone.' };
  }

  const desiredMilliseconds = utcMilliseconds(desired);
  const offsets = new Set<number>();
  for (let hours = -72; hours <= 72; hours += 6) {
    const offset = offsetAt(desiredMilliseconds + hours * 3_600_000, formatter);
    if (offset !== null) offsets.add(offset);
  }

  const matchingCandidates = [...offsets]
    .map((offset) => desiredMilliseconds - offset)
    .filter((milliseconds) => milliseconds >= MIN_DATE_MILLISECONDS && milliseconds <= MAX_DATE_MILLISECONDS)
    .filter((milliseconds) => sameParts(partsInZone(milliseconds, formatter), desired))
    .map((milliseconds) => Math.floor(milliseconds / 1_000) * 1_000)
    .filter((milliseconds, index, values) => values.indexOf(milliseconds) === index)
    .sort((left, right) => left - right);

  const candidates = matchingCandidates.filter((milliseconds) => milliseconds >= 0);

  if (matchingCandidates.length > 0 && candidates.length === 0) {
    return {
      ok: false,
      error: 'This generator does not create pre-1970 tags because the Discord reference does not define negative timestamp support.',
    };
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'That wall-clock time does not exist in the selected timezone, usually because clocks move forward for daylight saving time.',
    };
  }

  return {
    ok: true,
    candidates,
    warning: candidates.length > 1
      ? 'That wall-clock time occurs more than once in the selected timezone. Choose the earlier or later occurrence.'
      : null,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateTimeInputForZone(milliseconds: number, timeZone: string): string {
  const formatter = formatterForZone(timeZone);
  const parts = partsInZone(milliseconds, formatter);
  if (!parts) throw new Error('Unable to format the date in that timezone.');
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function timeZoneOffsetLabel(milliseconds: number, timeZone: string): string {
  const formatter = formatterForZone(timeZone);
  const offset = offsetAt(milliseconds, formatter);
  if (offset === null) return 'UTC offset unavailable';
  const totalMinutes = Math.round(offset / 60_000);
  const sign = totalMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(totalMinutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function discordTimestampPreview(
  milliseconds: number,
  style: DiscordTimestampStyle,
  locale: string,
  timeZone: string,
  nowMilliseconds = Date.now(),
): string {
  if (style === 'R') {
    const seconds = Math.round((milliseconds - nowMilliseconds) / 1_000);
    const absolute = Math.abs(seconds);
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (absolute < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(seconds / 3_600);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    const days = Math.round(seconds / 86_400);
    if (Math.abs(days) < 30) return formatter.format(days, 'day');
    const months = Math.round(seconds / 2_629_746);
    if (Math.abs(months) < 12) return formatter.format(months, 'month');
    return formatter.format(Math.round(seconds / 31_556_952), 'year');
  }

  const options: Record<Exclude<DiscordTimestampStyle, 'R'>, Intl.DateTimeFormatOptions> = {
    t: { timeStyle: 'short' },
    T: { timeStyle: 'medium' },
    d: { dateStyle: 'short' },
    D: { dateStyle: 'long' },
    f: { dateStyle: 'long', timeStyle: 'short' },
    F: { dateStyle: 'full', timeStyle: 'short' },
    s: { dateStyle: 'short', timeStyle: 'short' },
    S: { dateStyle: 'short', timeStyle: 'medium' },
  };
  return new Intl.DateTimeFormat(locale, { ...options[style], timeZone }).format(new Date(milliseconds));
}
