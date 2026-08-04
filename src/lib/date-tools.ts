export const MIN_DATE_YEAR = 1;
export const MAX_DATE_YEAR = 9_999;
export const MAX_DATE_ORDINAL = 3_652_058;
export const MAX_HOLIDAYS = 10_000;
export const MAX_BUSINESS_DAY_STEPS = MAX_DATE_ORDINAL;

export type DateToolErrorCode =
  | 'INVALID_DATE_FORMAT'
  | 'INVALID_DATE'
  | 'INVALID_TIME_FORMAT'
  | 'INVALID_TIME'
  | 'INVALID_OPTION'
  | 'INVALID_RANGE'
  | 'RESULT_OUT_OF_RANGE'
  | 'LIMIT_EXCEEDED'
  | 'NO_BUSINESS_DAYS';

export class DateToolError extends RangeError {
  readonly code: DateToolErrorCode;

  constructor(code: DateToolErrorCode, message: string) {
    super(message);
    this.name = 'DateToolError';
    this.code = code;
    Object.setPrototypeOf(this, DateToolError.prototype);
  }
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export type DateInput = CalendarDate | string;
export type DateOverflowPolicy = 'clamp' | 'reject';
export type Feb29AnniversaryPolicy = 'feb28' | 'mar1';
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface DateShiftOptions {
  /** How an invalid target day such as February 31 is handled. Defaults to `clamp`. */
  overflow?: DateOverflowPolicy;
}

export interface DateShiftResult {
  date: CalendarDate;
  /** True when the source day was reduced to the last day of the target month. */
  clamped: boolean;
}

export interface DaysBetweenOptions {
  /** Preserve input order as a sign. Defaults to true. */
  signed?: boolean;
  /** Count both endpoint dates. Defaults to false. */
  inclusive?: boolean;
}

export interface CalendarAgeOptions {
  /** Controls a February 29 birthday's anniversary in non-leap years. Defaults to `feb28`. */
  feb29Policy?: Feb29AnniversaryPolicy;
}

export interface CalendarAgeResult {
  sign: -1 | 0 | 1;
  years: number;
  months: number;
  days: number;
  /** Signed exact ordinal-day difference, preserving input order. */
  totalDays: number;
  absoluteDays: number;
  /** Exact fractional week count. */
  totalWeeks: number;
  wholeWeeks: number;
  remainingDays: number;
}

export interface BirthdayCountdownOptions extends CalendarAgeOptions {
  /** Treat a birthday occurring on the reference date as next. Defaults to true. */
  includeToday?: boolean;
}

export interface BirthdayCountdownResult {
  date: CalendarDate;
  daysUntil: number;
  totalWeeks: number;
  wholeWeeks: number;
  remainingDays: number;
  isToday: boolean;
  turningAge: number;
}

export interface BusinessDayOptions {
  /** ISO weekdays where Monday is 1 and Sunday is 7. Defaults to Saturday/Sunday. */
  weekend?: readonly number[] | ReadonlySet<number>;
  /** Strict ISO dates. Duplicate dates are ignored. */
  holidays?: readonly string[] | ReadonlySet<string>;
}

export interface BusinessDaysBetweenOptions extends BusinessDayOptions {
  /** Defaults to false. */
  includeStart?: boolean;
  /** Defaults to true. */
  includeEnd?: boolean;
  /** Preserve input order as a sign. Defaults to true. */
  signed?: boolean;
}

export interface ClockTime {
  hour: number;
  minute: number;
  second: number;
}

export type TimeInput = ClockTime | string;

export interface FormatTimeOptions {
  /** Defaults to true only when seconds are non-zero. */
  includeSeconds?: boolean;
}

export interface TimeDurationOptions {
  /** Allow an end time earlier than the start by treating it as the next day. */
  overnight?: boolean;
  /** Non-negative whole seconds subtracted from the gross duration. */
  breakSeconds?: number;
}

export interface TimeDurationResult {
  totalSeconds: number;
  grossSeconds: number;
  breakSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
  crossedMidnight: boolean;
}

export interface IsoWeek {
  weekYear: number;
  week: number;
  weekday: IsoWeekday;
}

export interface IsoWeekBoundaries {
  monday: CalendarDate;
  sunday: CalendarDate;
}

export interface IsoWeekInfo extends IsoWeek, IsoWeekBoundaries {}

const DAYS_BEFORE_MONTH = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
const DEFAULT_WEEKEND: readonly IsoWeekday[] = [6, 7];

function fail(code: DateToolErrorCode, message: string): never {
  throw new DateToolError(code, message);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    fail('INVALID_OPTION', `${label} must be a boolean.`);
  }
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) {
    fail('INVALID_DATE', `Year must be a whole number from ${MIN_DATE_YEAR} through ${MAX_DATE_YEAR}.`);
  }
}

function assertWholeNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    fail('INVALID_OPTION', `${label} must be a safe whole number.`);
  }
}

function isLeapYearUnchecked(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonthUnchecked(year: number, month: number): number {
  if (month === 2) return isLeapYearUnchecked(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function assertCalendarDate(value: CalendarDate): CalendarDate {
  if (typeof value !== 'object' || value === null) {
    fail('INVALID_DATE', 'Date must be a strict ISO string or a calendar-date object.');
  }

  const { year, month, day } = value;
  assertYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    fail('INVALID_DATE', 'Month must be a whole number from 1 through 12.');
  }
  const maximumDay = daysInMonthUnchecked(year, month);
  if (!Number.isInteger(day) || day < 1 || day > maximumDay) {
    fail('INVALID_DATE', `Day must be a whole number from 1 through ${maximumDay} for this month.`);
  }
  return { year, month, day };
}

function normalizeDate(input: DateInput): CalendarDate {
  if (typeof input === 'string') return parseIsoDate(input);
  return assertCalendarDate(input);
}

function daysBeforeYear(year: number): number {
  const priorYears = year - 1;
  return 365 * priorYears
    + Math.floor(priorYears / 4)
    - Math.floor(priorYears / 100)
    + Math.floor(priorYears / 400);
}

function toOrdinalUnchecked(date: CalendarDate): number {
  return daysBeforeYear(date.year)
    + DAYS_BEFORE_MONTH[date.month]
    + (date.month > 2 && isLeapYearUnchecked(date.year) ? 1 : 0)
    + date.day
    - 1;
}

function fromOrdinalUnchecked(ordinal: number): CalendarDate {
  let low = MIN_DATE_YEAR;
  let high = MAX_DATE_YEAR;
  let year = MIN_DATE_YEAR;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = daysBeforeYear(middle);
    const next = daysBeforeYear(middle + 1);
    if (ordinal < start) {
      high = middle - 1;
    } else if (ordinal >= next) {
      low = middle + 1;
    } else {
      year = middle;
      break;
    }
  }

  let dayOfYear = ordinal - daysBeforeYear(year);
  let month = 1;
  while (dayOfYear >= daysInMonthUnchecked(year, month)) {
    dayOfYear -= daysInMonthUnchecked(year, month);
    month += 1;
  }
  return { year, month, day: dayOfYear + 1 };
}

function dateFromOrdinal(ordinal: number, operation = 'Date calculation'): CalendarDate {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > MAX_DATE_ORDINAL) {
    fail(
      'RESULT_OUT_OF_RANGE',
      `${operation} must stay between 0001-01-01 and 9999-12-31.`,
    );
  }
  return fromOrdinalUnchecked(ordinal);
}

function signOf(value: number): -1 | 0 | 1 {
  return value === 0 ? 0 : value < 0 ? -1 : 1;
}

function validateOverflowPolicy(policy: DateOverflowPolicy | undefined): DateOverflowPolicy {
  const normalized = policy ?? 'clamp';
  if (normalized !== 'clamp' && normalized !== 'reject') {
    fail('INVALID_OPTION', 'overflow must be either "clamp" or "reject".');
  }
  return normalized;
}

function validateAnniversaryPolicy(
  policy: Feb29AnniversaryPolicy | undefined,
): Feb29AnniversaryPolicy {
  const normalized = policy ?? 'feb28';
  if (normalized !== 'feb28' && normalized !== 'mar1') {
    fail('INVALID_OPTION', 'feb29Policy must be either "feb28" or "mar1".');
  }
  return normalized;
}

function anniversaryInYear(
  birthDate: CalendarDate,
  year: number,
  policy: Feb29AnniversaryPolicy,
): CalendarDate {
  assertYear(year);
  if (birthDate.month === 2 && birthDate.day === 29 && !isLeapYearUnchecked(year)) {
    return policy === 'feb28'
      ? { year, month: 2, day: 28 }
      : { year, month: 3, day: 1 };
  }
  return { year, month: birthDate.month, day: birthDate.day };
}

export function isLeapYear(year: number): boolean {
  assertYear(year);
  return isLeapYearUnchecked(year);
}

export function daysInMonth(year: number, month: number): number {
  assertYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    fail('INVALID_DATE', 'Month must be a whole number from 1 through 12.');
  }
  return daysInMonthUnchecked(year, month);
}

export function parseIsoDate(input: string): CalendarDate {
  if (typeof input !== 'string') {
    fail('INVALID_DATE_FORMAT', 'Date input must be a string in YYYY-MM-DD format.');
  }
  if (input.length !== 10) {
    fail('INVALID_DATE_FORMAT', 'Date must contain exactly 10 characters in YYYY-MM-DD format.');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    fail('INVALID_DATE_FORMAT', 'Date must use strict YYYY-MM-DD syntax with ASCII digits.');
  }
  return assertCalendarDate({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  });
}

export function isValidIsoDate(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  try {
    parseIsoDate(input);
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDate(input: DateInput): string {
  const date = normalizeDate(input);
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function dateToOrdinal(input: DateInput): number {
  return toOrdinalUnchecked(normalizeDate(input));
}

export function ordinalToDate(ordinal: number): CalendarDate {
  assertWholeNumber(ordinal, 'Ordinal');
  return dateFromOrdinal(ordinal, 'Ordinal');
}

export function compareDates(left: DateInput, right: DateInput): -1 | 0 | 1 {
  return signOf(dateToOrdinal(left) - dateToOrdinal(right));
}

export function dayOfWeek(input: DateInput): IsoWeekday {
  return ((dateToOrdinal(input) % 7) + 1) as IsoWeekday;
}

export function daysBetween(
  startInput: DateInput,
  endInput: DateInput,
  options: DaysBetweenOptions = {},
): number {
  assertBoolean(options.signed, 'signed');
  assertBoolean(options.inclusive, 'inclusive');
  const difference = dateToOrdinal(endInput) - dateToOrdinal(startInput);
  const magnitude = Math.abs(difference) + (options.inclusive ? 1 : 0);
  if (options.signed === false) return magnitude;
  return difference < 0 ? -magnitude : magnitude;
}

export function addDays(input: DateInput, amount: number): CalendarDate {
  assertWholeNumber(amount, 'Day amount');
  return dateFromOrdinal(dateToOrdinal(input) + amount, 'Adding days');
}

export function addWeeks(input: DateInput, amount: number): CalendarDate {
  assertWholeNumber(amount, 'Week amount');
  const dayAmount = amount * 7;
  if (!Number.isSafeInteger(dayAmount)) {
    fail('LIMIT_EXCEEDED', 'Week amount is too large to calculate safely.');
  }
  return addDays(input, dayAmount);
}

export function addMonths(
  input: DateInput,
  amount: number,
  options: DateShiftOptions = {},
): DateShiftResult {
  assertWholeNumber(amount, 'Month amount');
  const overflow = validateOverflowPolicy(options.overflow);
  const date = normalizeDate(input);
  const targetMonthIndex = (date.year - 1) * 12 + date.month - 1 + amount;
  const maximumMonthIndex = (MAX_DATE_YEAR - 1) * 12 + 11;
  if (!Number.isSafeInteger(targetMonthIndex) || targetMonthIndex < 0 || targetMonthIndex > maximumMonthIndex) {
    fail('RESULT_OUT_OF_RANGE', 'Adding months must stay between 0001-01-01 and 9999-12-31.');
  }

  const year = Math.floor(targetMonthIndex / 12) + 1;
  const month = (targetMonthIndex % 12) + 1;
  const maximumDay = daysInMonthUnchecked(year, month);
  const clamped = date.day > maximumDay;
  if (clamped && overflow === 'reject') {
    fail('INVALID_DATE', 'The target month does not contain the source day and overflow is set to reject.');
  }
  return { date: { year, month, day: Math.min(date.day, maximumDay) }, clamped };
}

export function addYears(
  input: DateInput,
  amount: number,
  options: DateShiftOptions = {},
): DateShiftResult {
  assertWholeNumber(amount, 'Year amount');
  const overflow = validateOverflowPolicy(options.overflow);
  const date = normalizeDate(input);
  const year = date.year + amount;
  if (!Number.isSafeInteger(year) || year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) {
    fail('RESULT_OUT_OF_RANGE', 'Adding years must stay between 0001-01-01 and 9999-12-31.');
  }

  const maximumDay = daysInMonthUnchecked(year, date.month);
  const clamped = date.day > maximumDay;
  if (clamped && overflow === 'reject') {
    fail('INVALID_DATE', 'The target year does not contain the source day and overflow is set to reject.');
  }
  return {
    date: { year, month: date.month, day: Math.min(date.day, maximumDay) },
    clamped,
  };
}

function unsignedCalendarAge(
  earlier: CalendarDate,
  later: CalendarDate,
  policy: Feb29AnniversaryPolicy,
): Pick<CalendarAgeResult, 'years' | 'months' | 'days'> {
  let years = later.year - earlier.year;
  let cursor = anniversaryInYear(earlier, earlier.year + years, policy);
  if (compareDates(cursor, later) > 0) {
    years -= 1;
    cursor = anniversaryInYear(earlier, earlier.year + years, policy);
  }

  let months = 0;
  while (months < 11) {
    const candidate = addMonths(cursor, months + 1).date;
    if (compareDates(candidate, later) > 0) break;
    months += 1;
  }
  cursor = addMonths(cursor, months).date;
  return {
    years,
    months,
    days: dateToOrdinal(later) - dateToOrdinal(cursor),
  };
}

export function calendarAge(
  startInput: DateInput,
  endInput: DateInput,
  options: CalendarAgeOptions = {},
): CalendarAgeResult {
  const policy = validateAnniversaryPolicy(options.feb29Policy);
  const start = normalizeDate(startInput);
  const end = normalizeDate(endInput);
  const totalDays = toOrdinalUnchecked(end) - toOrdinalUnchecked(start);
  const sign = signOf(totalDays);
  const earlier = sign < 0 ? end : start;
  const later = sign < 0 ? start : end;
  const parts = unsignedCalendarAge(earlier, later, policy);
  const absoluteDays = Math.abs(totalDays);

  return {
    sign,
    ...parts,
    totalDays,
    absoluteDays,
    totalWeeks: absoluteDays / 7,
    wholeWeeks: Math.floor(absoluteDays / 7),
    remainingDays: absoluteDays % 7,
  };
}

export const dateDuration = calendarAge;

export function nextBirthday(
  birthInput: DateInput,
  referenceInput: DateInput,
  options: BirthdayCountdownOptions = {},
): BirthdayCountdownResult {
  assertBoolean(options.includeToday, 'includeToday');
  const policy = validateAnniversaryPolicy(options.feb29Policy);
  const birthDate = normalizeDate(birthInput);
  const referenceDate = normalizeDate(referenceInput);
  if (compareDates(referenceDate, birthDate) < 0) {
    fail('INVALID_RANGE', 'Birthday reference date cannot be earlier than the birth date.');
  }

  let year = referenceDate.year;
  let candidate = anniversaryInYear(birthDate, year, policy);
  const comparison = compareDates(candidate, referenceDate);
  if (comparison < 0 || (comparison === 0 && options.includeToday === false)) {
    year += 1;
    if (year > MAX_DATE_YEAR) {
      fail('RESULT_OUT_OF_RANGE', 'The next birthday falls after 9999-12-31.');
    }
    candidate = anniversaryInYear(birthDate, year, policy);
  }

  const daysUntil = dateToOrdinal(candidate) - dateToOrdinal(referenceDate);
  return {
    date: candidate,
    daysUntil,
    totalWeeks: daysUntil / 7,
    wholeWeeks: Math.floor(daysUntil / 7),
    remainingDays: daysUntil % 7,
    isToday: daysUntil === 0,
    turningAge: candidate.year - birthDate.year,
  };
}

export const birthdayCountdown = nextBirthday;

function normalizeWeekend(
  input: BusinessDayOptions['weekend'],
): ReadonlySet<IsoWeekday> {
  const values: readonly number[] = input === undefined
    ? DEFAULT_WEEKEND
    : Array.isArray(input)
      ? input
      : input instanceof Set
        ? [...input]
        : fail('INVALID_OPTION', 'weekend must be an array or Set of ISO weekdays.');

  if (values.length > 7) {
    fail('LIMIT_EXCEEDED', 'weekend cannot contain more than seven entries.');
  }
  const weekend = new Set<IsoWeekday>();
  for (const value of values) {
    if (!Number.isInteger(value) || value < 1 || value > 7) {
      fail('INVALID_OPTION', 'Weekend weekdays must be whole numbers from 1 through 7.');
    }
    weekend.add(value as IsoWeekday);
  }
  return weekend;
}

function normalizeHolidays(
  input: BusinessDayOptions['holidays'],
): ReadonlySet<number> {
  if (input === undefined) return new Set<number>();
  const values: readonly string[] = Array.isArray(input)
    ? input
    : input instanceof Set
      ? [...input]
      : fail('INVALID_OPTION', 'holidays must be an array or Set of strict ISO date strings.');

  if (values.length > MAX_HOLIDAYS) {
    fail('LIMIT_EXCEEDED', `At most ${MAX_HOLIDAYS} holidays may be supplied.`);
  }
  const holidays = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'string') {
      fail('INVALID_OPTION', 'Every holiday must be a strict ISO date string.');
    }
    holidays.add(dateToOrdinal(parseIsoDate(value)));
  }
  return holidays;
}

function isBusinessOrdinal(
  ordinal: number,
  weekend: ReadonlySet<IsoWeekday>,
  holidays: ReadonlySet<number>,
): boolean {
  const weekday = ((ordinal % 7) + 1) as IsoWeekday;
  return !weekend.has(weekday) && !holidays.has(ordinal);
}

function countBusinessOrdinalRange(
  low: number,
  high: number,
  weekend: ReadonlySet<IsoWeekday>,
  holidays: ReadonlySet<number>,
): number {
  if (low > high || weekend.size === 7) return 0;
  const length = high - low + 1;
  const fullWeeks = Math.floor(length / 7);
  let count = fullWeeks * (7 - weekend.size);
  const remainderStart = low + fullWeeks * 7;
  for (let ordinal = remainderStart; ordinal <= high; ordinal += 1) {
    if (!weekend.has(((ordinal % 7) + 1) as IsoWeekday)) count += 1;
  }
  for (const holiday of holidays) {
    if (
      holiday >= low
      && holiday <= high
      && !weekend.has(((holiday % 7) + 1) as IsoWeekday)
    ) {
      count -= 1;
    }
  }
  return count;
}

export function isBusinessDay(input: DateInput, options: BusinessDayOptions = {}): boolean {
  const weekend = normalizeWeekend(options.weekend);
  const holidays = normalizeHolidays(options.holidays);
  return isBusinessOrdinal(dateToOrdinal(input), weekend, holidays);
}

export function businessDaysBetween(
  startInput: DateInput,
  endInput: DateInput,
  options: BusinessDaysBetweenOptions = {},
): number {
  assertBoolean(options.includeStart, 'includeStart');
  assertBoolean(options.includeEnd, 'includeEnd');
  assertBoolean(options.signed, 'signed');
  const start = dateToOrdinal(startInput);
  const end = dateToOrdinal(endInput);
  const direction = signOf(end - start);
  const includeStart = options.includeStart ?? false;
  const includeEnd = options.includeEnd ?? true;
  const weekend = normalizeWeekend(options.weekend);
  const holidays = normalizeHolidays(options.holidays);

  if (direction === 0) {
    const count = includeStart && includeEnd && isBusinessOrdinal(start, weekend, holidays) ? 1 : 0;
    return count;
  }

  const lowEndpoint = Math.min(start, end);
  const highEndpoint = Math.max(start, end);
  const includeLow = direction > 0 ? includeStart : includeEnd;
  const includeHigh = direction > 0 ? includeEnd : includeStart;
  const low = lowEndpoint + (includeLow ? 0 : 1);
  const high = highEndpoint - (includeHigh ? 0 : 1);
  const count = countBusinessOrdinalRange(low, high, weekend, holidays);
  if (options.signed === false) return count;
  return direction * count;
}

export function addBusinessDays(
  input: DateInput,
  amount: number,
  options: BusinessDayOptions = {},
): CalendarDate {
  assertWholeNumber(amount, 'Business-day amount');
  if (Math.abs(amount) > MAX_BUSINESS_DAY_STEPS) {
    fail(
      'LIMIT_EXCEEDED',
      `Business-day amount cannot exceed ${MAX_BUSINESS_DAY_STEPS}.`,
    );
  }
  const start = dateToOrdinal(input);
  if (amount === 0) return ordinalToDate(start);
  const weekend = normalizeWeekend(options.weekend);
  const holidays = normalizeHolidays(options.holidays);
  if (weekend.size === 7) {
    fail('NO_BUSINESS_DAYS', 'At least one weekday must remain available as a business day.');
  }

  const direction = amount < 0 ? -1 : 1;
  let remaining = Math.abs(amount);
  let ordinal = start;
  let inspected = 0;
  while (remaining > 0) {
    ordinal += direction;
    inspected += 1;
    if (ordinal < 0 || ordinal > MAX_DATE_ORDINAL) {
      fail('RESULT_OUT_OF_RANGE', 'Adding business days must stay between 0001-01-01 and 9999-12-31.');
    }
    if (inspected > MAX_DATE_ORDINAL + 1) {
      fail('LIMIT_EXCEEDED', 'Business-day search exceeded the supported calendar range.');
    }
    if (isBusinessOrdinal(ordinal, weekend, holidays)) remaining -= 1;
  }
  return fromOrdinalUnchecked(ordinal);
}

export function subtractBusinessDays(
  input: DateInput,
  amount: number,
  options: BusinessDayOptions = {},
): CalendarDate {
  assertWholeNumber(amount, 'Business-day amount');
  if (amount < 0) {
    fail('INVALID_OPTION', 'Business-day amount to subtract must be non-negative.');
  }
  return addBusinessDays(input, -amount, options);
}

function assertClockTime(value: ClockTime): ClockTime {
  if (typeof value !== 'object' || value === null) {
    fail('INVALID_TIME', 'Time must be a strict clock string or a clock-time object.');
  }
  const { hour, minute, second } = value;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    fail('INVALID_TIME', 'Hour must be a whole number from 0 through 23.');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    fail('INVALID_TIME', 'Minute must be a whole number from 0 through 59.');
  }
  if (!Number.isInteger(second) || second < 0 || second > 59) {
    fail('INVALID_TIME', 'Second must be a whole number from 0 through 59.');
  }
  return { hour, minute, second };
}

function normalizeTime(input: TimeInput): ClockTime {
  if (typeof input === 'string') return parseTime(input);
  return assertClockTime(input);
}

function timeToSeconds(input: TimeInput): number {
  const time = normalizeTime(input);
  return time.hour * 3_600 + time.minute * 60 + time.second;
}

export function parseTime(input: string): ClockTime {
  if (typeof input !== 'string') {
    fail('INVALID_TIME_FORMAT', 'Time input must be a string in HH:MM or HH:MM:SS format.');
  }
  if (input.length !== 5 && input.length !== 8) {
    fail('INVALID_TIME_FORMAT', 'Time must contain exactly 5 or 8 characters.');
  }
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) {
    fail('INVALID_TIME_FORMAT', 'Time must use strict HH:MM or HH:MM:SS syntax with ASCII digits.');
  }
  return assertClockTime({
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: match[3] === undefined ? 0 : Number(match[3]),
  });
}

export function isValidTime(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  try {
    parseTime(input);
    return true;
  } catch {
    return false;
  }
}

export function formatTime(input: TimeInput, options: FormatTimeOptions = {}): string {
  assertBoolean(options.includeSeconds, 'includeSeconds');
  const time = normalizeTime(input);
  const base = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  const includeSeconds = options.includeSeconds ?? time.second !== 0;
  return includeSeconds ? `${base}:${String(time.second).padStart(2, '0')}` : base;
}

export function timeDuration(
  startInput: TimeInput,
  endInput: TimeInput,
  options: TimeDurationOptions = {},
): TimeDurationResult {
  assertBoolean(options.overnight, 'overnight');
  const breakSeconds = options.breakSeconds ?? 0;
  assertWholeNumber(breakSeconds, 'Break seconds');
  if (breakSeconds < 0 || breakSeconds > 86_400) {
    fail('INVALID_OPTION', 'Break seconds must be between 0 and 86,400.');
  }

  const start = timeToSeconds(startInput);
  const end = timeToSeconds(endInput);
  let grossSeconds = end - start;
  let crossedMidnight = false;
  if (grossSeconds < 0) {
    if (!options.overnight) {
      fail('INVALID_RANGE', 'End time is earlier than start time; enable overnight to cross midnight.');
    }
    grossSeconds += 86_400;
    crossedMidnight = true;
  }
  if (breakSeconds > grossSeconds) {
    fail('INVALID_RANGE', 'Break seconds cannot exceed the gross duration.');
  }

  const totalSeconds = grossSeconds - breakSeconds;
  return {
    totalSeconds,
    grossSeconds,
    breakSeconds,
    hours: Math.floor(totalSeconds / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    crossedMidnight,
  };
}

export const durationBetweenTimes = timeDuration;

export function isoWeek(input: DateInput): IsoWeek {
  const ordinal = dateToOrdinal(input);
  const weekday = ((ordinal % 7) + 1) as IsoWeekday;
  const thursday = fromOrdinalUnchecked(ordinal + 4 - weekday);
  const weekYear = thursday.year;
  const januaryFourth = toOrdinalUnchecked({ year: weekYear, month: 1, day: 4 });
  const januaryFourthWeekday = ((januaryFourth % 7) + 1) as IsoWeekday;
  const weekOneMonday = januaryFourth - januaryFourthWeekday + 1;
  return {
    weekYear,
    week: Math.floor((ordinal - weekOneMonday) / 7) + 1,
    weekday,
  };
}

export function isoWeekBoundaries(input: DateInput): IsoWeekBoundaries {
  const ordinal = dateToOrdinal(input);
  const weekday = ((ordinal % 7) + 1) as IsoWeekday;
  const mondayOrdinal = ordinal - weekday + 1;
  const sundayOrdinal = mondayOrdinal + 6;
  return {
    monday: dateFromOrdinal(mondayOrdinal, 'ISO week boundary'),
    sunday: dateFromOrdinal(sundayOrdinal, 'ISO week boundary'),
  };
}

export function isoWeekInfo(input: DateInput): IsoWeekInfo {
  return { ...isoWeek(input), ...isoWeekBoundaries(input) };
}

export function weeksInIsoYear(year: number): 52 | 53 {
  assertYear(year);
  return isoWeek({ year, month: 12, day: 28 }).week as 52 | 53;
}

export const parseISODate = parseIsoDate;
export const formatISODate = formatIsoDate;
export const isValidISODate = isValidIsoDate;
export const getIsoWeek = isoWeek;
