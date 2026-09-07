import { addDays, dayOfWeek, formatIsoDate, type CalendarDate, type IsoWeekday } from './date-tools';

export interface NamedHoliday {
  date: string;
  name: string;
}

function nthWeekday(year: number, month: number, weekday: IsoWeekday, occurrence: number): CalendarDate {
  const first = { year, month, day: 1 };
  const offset = (weekday - dayOfWeek(first) + 7) % 7;
  return { year, month, day: 1 + offset + (occurrence - 1) * 7 };
}

function lastWeekday(year: number, month: number, weekday: IsoWeekday): CalendarDate {
  const firstOfNextMonth = month === 12
    ? { year: year + 1, month: 1, day: 1 }
    : { year, month: month + 1, day: 1 };
  const last = addDays(firstOfNextMonth, -1);
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

function observedFixedHoliday(year: number, month: number, day: number): CalendarDate {
  const legalDate = { year, month, day };
  const weekday = dayOfWeek(legalDate);
  if (weekday === 6) return addDays(legalDate, -1);
  if (weekday === 7) return addDays(legalDate, 1);
  return legalDate;
}

function named(name: string, date: CalendarDate): NamedHoliday {
  return { date: formatIsoDate(date), name };
}

export function usFederalHolidays(year: number): NamedHoliday[] {
  if (!Number.isInteger(year) || year < 2021 || year > 9_998) {
    throw new RangeError('U.S. federal holiday presets support whole years from 2021 through 9998.');
  }
  return [
    named("New Year's Day", observedFixedHoliday(year, 1, 1)),
    named('Birthday of Martin Luther King, Jr.', nthWeekday(year, 1, 1, 3)),
    named("Washington's Birthday", nthWeekday(year, 2, 1, 3)),
    named('Memorial Day', lastWeekday(year, 5, 1)),
    named('Juneteenth National Independence Day', observedFixedHoliday(year, 6, 19)),
    named('Independence Day', observedFixedHoliday(year, 7, 4)),
    named('Labor Day', nthWeekday(year, 9, 1, 1)),
    named('Columbus Day', nthWeekday(year, 10, 1, 2)),
    named('Veterans Day', observedFixedHoliday(year, 11, 11)),
    named('Thanksgiving Day', nthWeekday(year, 11, 4, 4)),
    named('Christmas Day', observedFixedHoliday(year, 12, 25)),
  ].sort((left, right) => left.date.localeCompare(right.date));
}
