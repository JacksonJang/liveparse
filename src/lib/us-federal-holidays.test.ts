import { describe, expect, it } from 'vitest';
import { usFederalHolidays } from './us-federal-holidays';

describe('U.S. federal holiday preset', () => {
  it('matches the OPM 2026 holiday schedule', () => {
    expect(usFederalHolidays(2026).map((holiday) => holiday.date)).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  it('observes Saturday holidays on Friday and Sunday holidays on Monday', () => {
    const dates = usFederalHolidays(2027).map((holiday) => holiday.date);
    expect(dates).toContain('2027-06-18');
    expect(dates).toContain('2027-07-05');
    expect(dates).toContain('2027-12-24');
  });

  it('rejects years outside the modern preset range', () => {
    expect(() => usFederalHolidays(2020)).toThrow(/2021/);
    expect(() => usFederalHolidays(9_999)).toThrow(/9998/);
  });
});
