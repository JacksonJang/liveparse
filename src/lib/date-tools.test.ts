import { describe, expect, it } from 'vitest';
import {
  MAX_BUSINESS_DAY_STEPS,
  MAX_DATE_ORDINAL,
  MAX_HOLIDAYS,
  DateToolError,
  addBusinessDays,
  addDays,
  addMonths,
  addWeeks,
  addYears,
  birthdayCountdown,
  businessDaysBetween,
  calendarAge,
  compareDates,
  dateToOrdinal,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  durationBetweenTimes,
  formatIsoDate,
  formatTime,
  isBusinessDay,
  isLeapYear,
  isValidIsoDate,
  isValidTime,
  isoWeek,
  isoWeekBoundaries,
  isoWeekInfo,
  nextBirthday,
  ordinalToDate,
  parseIsoDate,
  parseTime,
  subtractBusinessDays,
  timeDuration,
  weeksInIsoYear,
} from './date-tools';

describe('strict proleptic-Gregorian ISO dates', () => {
  it('parses the minimum supported date', () => {
    expect(parseIsoDate('0001-01-01')).toEqual({ year: 1, month: 1, day: 1 });
  });

  it('parses the maximum supported date', () => {
    expect(parseIsoDate('9999-12-31')).toEqual({ year: 9999, month: 12, day: 31 });
  });

  it('formats zero-padded years, months, and days', () => {
    expect(formatIsoDate({ year: 7, month: 3, day: 4 })).toBe('0007-03-04');
  });

  it.each([
    '',
    '2024-1-01',
    '24-01-01',
    '2024/01/01',
    ' 2024-01-01',
    '2024-01-01 ',
    '+2024-01-01',
    '２０２４-０１-０１',
  ])('rejects non-strict date syntax %j', (input) => {
    expect(() => parseIsoDate(input)).toThrow(DateToolError);
    expect(isValidIsoDate(input)).toBe(false);
  });

  it.each([
    '0000-01-01',
    '10000-01-01',
    '2024-00-01',
    '2024-13-01',
    '2024-01-00',
    '2024-04-31',
    '2023-02-29',
    '1900-02-29',
  ])('rejects invalid calendar date %s', (input) => {
    expect(() => parseIsoDate(input)).toThrow(DateToolError);
  });

  it('rejects invalid object fields instead of normalizing them', () => {
    expect(() => formatIsoDate({ year: 2024, month: 2, day: 30 })).toThrow(/Day/);
    expect(() => formatIsoDate({ year: 2024.5, month: 2, day: 1 })).toThrow(/Year/);
  });

  it('accepts valid leap days', () => {
    expect(isValidIsoDate('2000-02-29')).toBe(true);
    expect(formatIsoDate('2000-02-29')).toBe('2000-02-29');
  });

  it('round-trips representative month boundaries and calendar eras', () => {
    for (const year of [1, 4, 100, 400, 1600, 1900, 1999, 2000, 2024, 9999]) {
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [1, daysInMonth(year, month)]) {
          const value = { year, month, day };
          expect(parseIsoDate(formatIsoDate(value))).toEqual(value);
        }
      }
    }
  });
});

describe('leap years, month lengths, ordinals, and comparison', () => {
  it.each([
    [1900, false],
    [2000, true],
    [2023, false],
    [2024, true],
  ] as const)('classifies leap year %i as %s', (year, expected) => {
    expect(isLeapYear(year)).toBe(expected);
  });

  it('returns Gregorian month lengths', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });

  it('rejects out-of-range year and month arguments', () => {
    expect(() => isLeapYear(0)).toThrow(/Year/);
    expect(() => isLeapYear(10_000)).toThrow(/Year/);
    expect(() => daysInMonth(2024, 0)).toThrow(/Month/);
    expect(() => daysInMonth(2024, 13)).toThrow(/Month/);
  });

  it('maps the supported endpoints to exact ordinals', () => {
    expect(dateToOrdinal('0001-01-01')).toBe(0);
    expect(dateToOrdinal('9999-12-31')).toBe(MAX_DATE_ORDINAL);
    expect(ordinalToDate(MAX_DATE_ORDINAL)).toEqual({ year: 9999, month: 12, day: 31 });
  });

  it('round-trips ordinals across the entire supported range', () => {
    for (let ordinal = 0; ordinal <= MAX_DATE_ORDINAL; ordinal += 9_973) {
      expect(dateToOrdinal(ordinalToDate(ordinal))).toBe(ordinal);
    }
    expect(dateToOrdinal(ordinalToDate(MAX_DATE_ORDINAL))).toBe(MAX_DATE_ORDINAL);
  });

  it('keeps leap-day ordinals consecutive', () => {
    expect(dateToOrdinal('2000-02-29') - dateToOrdinal('2000-02-28')).toBe(1);
    expect(dateToOrdinal('2000-03-01') - dateToOrdinal('2000-02-29')).toBe(1);
    expect(dateToOrdinal('1900-03-01') - dateToOrdinal('1900-02-28')).toBe(1);
  });

  it('compares dates without time-zone state', () => {
    expect(compareDates('2024-01-01', '2024-01-02')).toBe(-1);
    expect(compareDates('2024-01-02', '2024-01-01')).toBe(1);
    expect(compareDates('2024-01-01', { year: 2024, month: 1, day: 1 })).toBe(0);
  });

  it('uses ISO weekdays with 0001-01-01 as Monday', () => {
    expect(dayOfWeek('0001-01-01')).toBe(1);
    expect(dayOfWeek('2000-01-01')).toBe(6);
    expect(dayOfWeek('2024-01-01')).toBe(1);
  });

  it('rejects ordinals outside the supported range', () => {
    expect(() => ordinalToDate(-1)).toThrow(/0001-01-01/);
    expect(() => ordinalToDate(MAX_DATE_ORDINAL + 1)).toThrow(/9999-12-31/);
    expect(() => ordinalToDate(1.5)).toThrow(/whole number/);
  });
});

describe('day differences and bounded date shifts', () => {
  it('returns zero for the same date by default', () => {
    expect(daysBetween('2024-02-29', '2024-02-29')).toBe(0);
  });

  it('counts a forward interval exactly across leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('preserves reverse direction by default', () => {
    expect(daysBetween('2024-03-01', '2024-02-28')).toBe(-2);
  });

  it('can return an unsigned reverse interval', () => {
    expect(daysBetween('2024-03-01', '2024-02-28', { signed: false })).toBe(2);
  });

  it('adds both endpoints when inclusive', () => {
    expect(daysBetween('2024-02-28', '2024-03-01', { inclusive: true })).toBe(3);
    expect(daysBetween('2024-03-01', '2024-02-28', { inclusive: true })).toBe(-3);
    expect(daysBetween('2024-02-29', '2024-02-29', { inclusive: true })).toBe(1);
  });

  it('covers the full calendar with an exact safe integer', () => {
    expect(daysBetween('0001-01-01', '9999-12-31')).toBe(MAX_DATE_ORDINAL);
  });

  it('adds days across year and leap-month boundaries', () => {
    expect(addDays('1999-12-31', 1)).toEqual({ year: 2000, month: 1, day: 1 });
    expect(addDays('2000-02-28', 2)).toEqual({ year: 2000, month: 3, day: 1 });
    expect(addDays('2000-03-01', -1)).toEqual({ year: 2000, month: 2, day: 29 });
  });

  it('adds positive and negative weeks exactly', () => {
    expect(addWeeks('2024-01-01', 5)).toEqual({ year: 2024, month: 2, day: 5 });
    expect(addWeeks('2024-01-08', -1)).toEqual({ year: 2024, month: 1, day: 1 });
  });

  it('clamps January 31 into February and reports it', () => {
    expect(addMonths('2023-01-31', 1)).toEqual({
      date: { year: 2023, month: 2, day: 28 },
      clamped: true,
    });
    expect(addMonths('2024-01-31', 1)).toEqual({
      date: { year: 2024, month: 2, day: 29 },
      clamped: true,
    });
  });

  it('does not report a clamp when the day exists', () => {
    expect(addMonths('2024-01-29', 1)).toEqual({
      date: { year: 2024, month: 2, day: 29 },
      clamped: false,
    });
  });

  it('supports negative month shifts across a year', () => {
    expect(addMonths('2024-01-15', -2)).toEqual({
      date: { year: 2023, month: 11, day: 15 },
      clamped: false,
    });
  });

  it('clamps February 29 when adding a non-leap year', () => {
    expect(addYears('2020-02-29', 1)).toEqual({
      date: { year: 2021, month: 2, day: 28 },
      clamped: true,
    });
    expect(addYears('2020-02-29', 4)).toEqual({
      date: { year: 2024, month: 2, day: 29 },
      clamped: false,
    });
  });

  it('can reject month-end and leap-day clamps', () => {
    expect(() => addMonths('2023-01-31', 1, { overflow: 'reject' })).toThrow(/overflow/);
    expect(() => addYears('2020-02-29', 1, { overflow: 'reject' })).toThrow(/overflow/);
  });

  it('rejects shifts outside minimum and maximum dates', () => {
    expect(() => addDays('0001-01-01', -1)).toThrow(/0001-01-01/);
    expect(() => addDays('9999-12-31', 1)).toThrow(/9999-12-31/);
    expect(() => addMonths('0001-01-01', -1)).toThrow(/Adding months/);
    expect(() => addYears('9999-12-31', 1)).toThrow(/Adding years/);
  });

  it('rejects fractional and unsafe shift amounts', () => {
    expect(() => addDays('2024-01-01', 1.5)).toThrow(/whole number/);
    expect(() => addWeeks('2024-01-01', Number.MAX_SAFE_INTEGER)).toThrow(/too large/);
  });
});

describe('calendar age, totals, and birthday countdown', () => {
  it('computes a birthday-to-birthday age', () => {
    expect(calendarAge('2000-05-20', '2024-05-20')).toMatchObject({
      sign: 1,
      years: 24,
      months: 0,
      days: 0,
    });
  });

  it('computes age immediately before a birthday', () => {
    expect(calendarAge('2000-05-20', '2024-05-19')).toMatchObject({
      years: 23,
      months: 11,
      days: 29,
    });
  });

  it('uses February 28 as the default non-leap anniversary', () => {
    expect(calendarAge('2020-02-29', '2021-02-28')).toMatchObject({
      years: 1,
      months: 0,
      days: 0,
    });
  });

  it('uses March 1 when requested for a February 29 anniversary', () => {
    expect(calendarAge('2020-02-29', '2021-02-28', { feb29Policy: 'mar1' })).toMatchObject({
      years: 0,
      months: 11,
      days: 30,
    });
    expect(calendarAge('2020-02-29', '2021-03-01', { feb29Policy: 'mar1' })).toMatchObject({
      years: 1,
      months: 0,
      days: 0,
    });
  });

  it('returns symmetric components and a negative sign in reverse', () => {
    const forward = calendarAge('2000-01-15', '2024-03-20');
    const reverse = calendarAge('2024-03-20', '2000-01-15');
    expect(reverse).toMatchObject({
      sign: -1,
      years: forward.years,
      months: forward.months,
      days: forward.days,
      totalDays: -forward.totalDays,
      absoluteDays: forward.absoluteDays,
    });
  });

  it('reports exact total-day and whole-week values', () => {
    expect(calendarAge('2024-01-01', '2024-01-17')).toMatchObject({
      totalDays: 16,
      absoluteDays: 16,
      totalWeeks: 16 / 7,
      wholeWeeks: 2,
      remainingDays: 2,
    });
  });

  it('handles month-end age decomposition deterministically', () => {
    expect(calendarAge('2023-01-31', '2023-03-30')).toMatchObject({
      years: 0,
      months: 1,
      days: 30,
    });
  });

  it('returns all zero components for an identical date', () => {
    expect(calendarAge('2024-02-29', '2024-02-29')).toEqual({
      sign: 0,
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      absoluteDays: 0,
      totalWeeks: 0,
      wholeWeeks: 0,
      remainingDays: 0,
    });
  });

  it('returns a same-day birthday countdown by default', () => {
    expect(nextBirthday('2000-05-20', '2024-05-20')).toEqual({
      date: { year: 2024, month: 5, day: 20 },
      daysUntil: 0,
      totalWeeks: 0,
      wholeWeeks: 0,
      remainingDays: 0,
      isToday: true,
      turningAge: 24,
    });
  });

  it('can advance a same-day birthday to next year', () => {
    expect(nextBirthday('2000-05-20', '2024-05-20', { includeToday: false })).toMatchObject({
      date: { year: 2025, month: 5, day: 20 },
      daysUntil: 365,
      isToday: false,
      turningAge: 25,
    });
  });

  it('applies both February 29 birthday policies', () => {
    expect(birthdayCountdown('2000-02-29', '2023-02-27')).toMatchObject({
      date: { year: 2023, month: 2, day: 28 },
      daysUntil: 1,
    });
    expect(birthdayCountdown('2000-02-29', '2023-02-28', { feb29Policy: 'mar1' })).toMatchObject({
      date: { year: 2023, month: 3, day: 1 },
      daysUntil: 1,
    });
  });

  it('rejects a birthday reference before birth', () => {
    expect(() => nextBirthday('2024-01-02', '2024-01-01')).toThrow(/earlier than/);
  });

  it('reports an explicit overflow when no later birthday is representable', () => {
    expect(() => nextBirthday('2000-01-01', '9999-12-31')).toThrow(/after 9999/);
  });
});

describe('business-day counting and shifting', () => {
  it('defaults to excluding the start and including the end', () => {
    expect(businessDaysBetween('2024-01-01', '2024-01-05')).toBe(4);
  });

  it('can include both endpoints', () => {
    expect(businessDaysBetween('2024-01-01', '2024-01-05', {
      includeStart: true,
      includeEnd: true,
    })).toBe(5);
  });

  it('preserves direction or returns an unsigned count', () => {
    expect(businessDaysBetween('2024-01-05', '2024-01-01')).toBe(-4);
    expect(businessDaysBetween('2024-01-05', '2024-01-01', { signed: false })).toBe(4);
  });

  it('requires both flags to include a zero-length endpoint', () => {
    expect(businessDaysBetween('2024-01-02', '2024-01-02')).toBe(0);
    expect(businessDaysBetween('2024-01-02', '2024-01-02', {
      includeStart: true,
      includeEnd: true,
    })).toBe(1);
  });

  it('subtracts weekday holidays exactly once', () => {
    expect(businessDaysBetween('2024-01-01', '2024-01-05', {
      includeStart: true,
      holidays: ['2024-01-03', '2024-01-03'],
    })).toBe(4);
  });

  it('does not subtract a holiday that already falls on a weekend', () => {
    expect(businessDaysBetween('2024-01-01', '2024-01-07', {
      includeStart: true,
      holidays: ['2024-01-06'],
    })).toBe(5);
  });

  it('supports custom Friday-Saturday weekends', () => {
    expect(businessDaysBetween('2024-01-01', '2024-01-07', {
      includeStart: true,
      weekend: [5, 6],
    })).toBe(5);
  });

  it('supports calendars with no weekend', () => {
    expect(businessDaysBetween('2024-01-01', '2024-01-07', {
      includeStart: true,
      weekend: [],
    })).toBe(7);
  });

  it('returns zero counts for an all-weekend calendar', () => {
    expect(businessDaysBetween('2024-01-01', '2024-12-31', {
      weekend: [1, 2, 3, 4, 5, 6, 7],
    })).toBe(0);
  });

  it('identifies weekends and custom holidays', () => {
    expect(isBusinessDay('2024-01-06')).toBe(false);
    expect(isBusinessDay('2024-01-08', { holidays: new Set(['2024-01-08']) })).toBe(false);
    expect(isBusinessDay('2024-01-08')).toBe(true);
  });

  it('adds through a weekend', () => {
    expect(addBusinessDays('2024-01-05', 1)).toEqual({ year: 2024, month: 1, day: 8 });
  });

  it('adds through a weekend and a holiday', () => {
    expect(addBusinessDays('2024-01-05', 1, { holidays: ['2024-01-08'] })).toEqual({
      year: 2024,
      month: 1,
      day: 9,
    });
  });

  it('supports negative addition and explicit subtraction', () => {
    expect(addBusinessDays('2024-01-08', -1)).toEqual({ year: 2024, month: 1, day: 5 });
    expect(subtractBusinessDays('2024-01-08', 1)).toEqual({ year: 2024, month: 1, day: 5 });
  });

  it('leaves the input unchanged for a zero shift even on a weekend', () => {
    expect(addBusinessDays('2024-01-06', 0)).toEqual({ year: 2024, month: 1, day: 6 });
  });

  it('rejects a non-zero shift when every weekday is a weekend', () => {
    expect(() => addBusinessDays('2024-01-01', 1, {
      weekend: [1, 2, 3, 4, 5, 6, 7],
    })).toThrow(/At least one/);
  });

  it('rejects invalid weekend and holiday input', () => {
    expect(() => isBusinessDay('2024-01-01', { weekend: [0 as 1] })).toThrow(/1 through 7/);
    expect(() => isBusinessDay('2024-01-01', { holidays: ['2024-02-30'] })).toThrow(/Day/);
  });

  it('enforces the holiday and shift limits', () => {
    expect(() => isBusinessDay('2024-01-01', {
      holidays: Array.from({ length: MAX_HOLIDAYS + 1 }, () => '2024-01-01'),
    })).toThrow(/At most/);
    expect(() => addBusinessDays('2024-01-01', MAX_BUSINESS_DAY_STEPS + 1)).toThrow(/cannot exceed/);
  });

  it('rejects business-day shifts beyond calendar endpoints', () => {
    expect(() => addBusinessDays('9999-12-31', 1)).toThrow(/9999-12-31/);
    expect(() => subtractBusinessDays('0001-01-01', 1)).toThrow(/0001-01-01/);
  });
});

describe('strict clock times and durations', () => {
  it('parses HH:MM with zero seconds', () => {
    expect(parseTime('09:07')).toEqual({ hour: 9, minute: 7, second: 0 });
  });

  it('parses the maximum HH:MM:SS value', () => {
    expect(parseTime('23:59:59')).toEqual({ hour: 23, minute: 59, second: 59 });
  });

  it('formats seconds automatically or explicitly', () => {
    expect(formatTime({ hour: 9, minute: 7, second: 0 })).toBe('09:07');
    expect(formatTime('09:07', { includeSeconds: true })).toBe('09:07:00');
    expect(formatTime('09:07:05')).toBe('09:07:05');
  });

  it.each([
    '',
    '9:07',
    '09:7',
    '09.07',
    ' 09:07',
    '09:07 ',
    '09:07:00.000',
    '０９:０７',
  ])('rejects non-strict time syntax %j', (input) => {
    expect(() => parseTime(input)).toThrow(DateToolError);
    expect(isValidTime(input)).toBe(false);
  });

  it.each(['24:00', '23:60', '23:59:60'])('rejects out-of-range clock time %s', (input) => {
    expect(() => parseTime(input)).toThrow(DateToolError);
  });

  it('calculates a same-day duration with seconds', () => {
    expect(timeDuration('09:15:30', '10:46:45')).toEqual({
      totalSeconds: 5_475,
      grossSeconds: 5_475,
      breakSeconds: 0,
      hours: 1,
      minutes: 31,
      seconds: 15,
      crossedMidnight: false,
    });
  });

  it('calculates an overnight duration across midnight', () => {
    expect(durationBetweenTimes('23:30', '01:15', { overnight: true })).toMatchObject({
      totalSeconds: 6_300,
      hours: 1,
      minutes: 45,
      seconds: 0,
      crossedMidnight: true,
    });
  });

  it('rejects an earlier end when overnight is disabled', () => {
    expect(() => timeDuration('23:30', '01:15')).toThrow(/enable overnight/);
  });

  it('subtracts a break from the gross duration', () => {
    expect(timeDuration('09:00', '17:30', { breakSeconds: 1_800 })).toMatchObject({
      grossSeconds: 30_600,
      breakSeconds: 1_800,
      totalSeconds: 28_800,
      hours: 8,
      minutes: 0,
      seconds: 0,
    });
  });

  it('rejects a break longer than the duration', () => {
    expect(() => timeDuration('09:00', '09:30', { breakSeconds: 1_801 })).toThrow(/exceed/);
    expect(() => timeDuration('09:00', '10:00', { breakSeconds: -1 })).toThrow(/between 0/);
  });

  it('returns zero for identical times even when overnight is enabled', () => {
    expect(timeDuration('12:00', '12:00', { overnight: true })).toMatchObject({
      grossSeconds: 0,
      totalSeconds: 0,
      crossedMidnight: false,
    });
  });
});

describe('ISO-8601 week years and Monday-Sunday boundaries', () => {
  it('places 2015-12-31 in ISO week 53', () => {
    expect(isoWeek('2015-12-31')).toEqual({ weekYear: 2015, week: 53, weekday: 4 });
  });

  it('keeps 2016-01-01 in the previous ISO week year', () => {
    expect(isoWeek('2016-01-01')).toEqual({ weekYear: 2015, week: 53, weekday: 5 });
  });

  it('starts ISO week 1 on Monday 2016-01-04', () => {
    expect(isoWeek('2016-01-04')).toEqual({ weekYear: 2016, week: 1, weekday: 1 });
  });

  it('handles a second previous-year boundary', () => {
    expect(isoWeek('2021-01-01')).toEqual({ weekYear: 2020, week: 53, weekday: 5 });
  });

  it('places 2024-12-31 in the next ISO week year', () => {
    expect(isoWeek('2024-12-31')).toEqual({ weekYear: 2025, week: 1, weekday: 2 });
  });

  it('returns exact Monday and Sunday boundaries across a calendar year', () => {
    expect(isoWeekBoundaries('2016-01-01')).toEqual({
      monday: { year: 2015, month: 12, day: 28 },
      sunday: { year: 2016, month: 1, day: 3 },
    });
  });

  it('combines week identity and boundaries', () => {
    expect(isoWeekInfo('2024-01-03')).toEqual({
      weekYear: 2024,
      week: 1,
      weekday: 3,
      monday: { year: 2024, month: 1, day: 1 },
      sunday: { year: 2024, month: 1, day: 7 },
    });
  });

  it('reports 52- and 53-week ISO years', () => {
    expect(weeksInIsoYear(2015)).toBe(53);
    expect(weeksInIsoYear(2021)).toBe(52);
  });

  it('supports the minimum-date ISO week', () => {
    expect(isoWeekInfo('0001-01-01')).toEqual({
      weekYear: 1,
      week: 1,
      weekday: 1,
      monday: { year: 1, month: 1, day: 1 },
      sunday: { year: 1, month: 1, day: 7 },
    });
  });

  it('computes the maximum date week number but rejects an unrepresentable Sunday', () => {
    expect(isoWeek('9999-12-31')).toEqual({ weekYear: 9999, week: 52, weekday: 5 });
    expect(() => isoWeekBoundaries('9999-12-31')).toThrow(/ISO week boundary/);
  });
});
