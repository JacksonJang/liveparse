import React, { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  addBusinessDays,
  addDays,
  addMonths,
  addWeeks,
  addYears,
  businessDaysBetween,
  calendarAge,
  compareDates,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  formatTime,
  isLeapYear,
  isValidIsoDate,
  isoWeekInfo,
  nextBirthday,
  parseIsoDate,
  parseTime,
  timeDuration,
  type CalendarDate,
  type Feb29AnniversaryPolicy,
  type IsoWeekday,
  type TimeDurationResult,
} from './lib/date-tools';
import { usFederalHolidays } from './lib/us-federal-holidays';
import './styles.css';
import './date-tools.css';

type PageMode =
  | 'age-calculator'
  | 'age-calculator-on-specific-date'
  | 'date-calculator'
  | 'days-between-dates'
  | 'business-days-calculator'
  | 'time-duration-calculator'
  | 'week-number-calculator'
  | 'birthday-countdown';

interface ResultRow {
  label: string;
  value: string;
}

interface DisplayResult {
  eyebrow: string;
  headline: string;
  description?: string;
  rows: ResultRow[];
  warning?: string;
  note?: string;
  copyText: string;
  query: Record<string, string | number | boolean>;
}

const PAGE_LABELS: Record<PageMode, string> = {
  'age-calculator': 'Age calculator',
  'age-calculator-on-specific-date': 'Age on a date',
  'date-calculator': 'Add or subtract dates',
  'days-between-dates': 'Days between dates',
  'business-days-calculator': 'Business days',
  'time-duration-calculator': 'Time duration',
  'week-number-calculator': 'ISO week number',
  'birthday-countdown': 'Birthday countdown',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const SHARED_QUERY = new URLSearchParams(window.location.search);

function localToday(): string {
  const now = new Date();
  return formatIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

const TODAY = localToday();
// Landing pages such as /5-business-days-from-today/ preset the business-day amount through <body data-business-days>.
const PRESET_BUSINESS_DAYS = /^-?\d{1,9}$/.test(document.body.dataset.businessDays ?? '') ? String(document.body.dataset.businessDays) : null;
const DEFAULT_BIRTH_DATE = formatIsoDate(addYears(TODAY, -30).date);
const DEFAULT_RANGE_END = formatIsoDate(addDays(TODAY, 30));

function queryText(key: string, fallback: string, maximumLength = 10_000): string {
  const value = SHARED_QUERY.get(key);
  return value !== null && value.length <= maximumLength ? value : fallback;
}

function queryDate(key: string, fallback: string): string {
  const value = SHARED_QUERY.get(key);
  return value !== null && isValidIsoDate(value) ? value : fallback;
}

function queryTime(key: string, fallback: string): string {
  const value = SHARED_QUERY.get(key);
  if (value === null) return fallback;
  try {
    parseTime(value);
    return value;
  } catch {
    return fallback;
  }
}

function queryBoolean(key: string, fallback: boolean): boolean {
  const value = SHARED_QUERY.get(key);
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function queryChoice<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  const value = SHARED_QUERY.get(key);
  return value !== null && choices.includes(value as T) ? value as T : fallback;
}

function requireDate(value: string, label: string): CalendarDate {
  if (!isValidIsoDate(value)) throw new Error(`${label} must be a real date in strict YYYY-MM-DD format.`);
  return parseIsoDate(value);
}

function requireWholeNumber(
  value: string,
  label: string,
  options: { minimum?: number; maximum?: number } = {},
): number {
  if (!/^-?\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the safe calculation range.`);
  if (options.minimum !== undefined && parsed < options.minimum) {
    throw new Error(`${label} must be at least ${options.minimum}.`);
  }
  if (options.maximum !== undefined && parsed > options.maximum) {
    throw new Error(`${label} must be no more than ${options.maximum}.`);
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The calculation could not be completed.';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

function longDate(input: CalendarDate | string): string {
  const date = typeof input === 'string' ? parseIsoDate(input) : input;
  return `${WEEKDAY_NAMES[dayOfWeek(date) - 1]}, ${MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`;
}

function shortDate(date: CalendarDate, withYear: boolean): string {
  return `${WEEKDAY_SHORT[dayOfWeek(date) - 1]}, ${MONTH_NAMES[date.month - 1].slice(0, 3)} ${date.day}${withYear ? `, ${date.year}` : ''}`;
}

function dateDirection(start: CalendarDate | string, end: CalendarDate | string): string {
  const comparison = compareDates(start, end);
  return comparison === 0 ? 'Same date' : comparison < 0 ? 'Forward' : 'Backward';
}

function durationLabel(result: TimeDurationResult): string {
  const parts = [plural(result.hours, 'hour'), plural(result.minutes, 'minute')];
  if (result.seconds !== 0) parts.push(plural(result.seconds, 'second'));
  return parts.join(', ');
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Browser clipboard permissions can be unavailable; retain a local fallback.
    }
  }
  const fallback = document.createElement('textarea');
  fallback.value = value;
  fallback.readOnly = true;
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Clipboard access was rejected.');
}

function queryFrom(values: Record<string, string | number | boolean>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    query.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return query;
}

function useCalculator() {
  const [result, setResult] = useState<DisplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const calculate = (build: () => DisplayResult) => {
    try {
      setResult(build());
      setError(null);
      setStatus('Calculation complete.');
    } catch (caught) {
      setResult(null);
      setError(errorMessage(caught));
      setStatus('Please correct the highlighted inputs and calculate again.');
    }
  };

  const clear = (message = 'Inputs reset.') => {
    setResult(null);
    setError(null);
    setStatus(message);
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await copyText(result.copyText);
      setStatus('Result copied to the clipboard.');
    } catch (caught) {
      setStatus(errorMessage(caught));
    }
  };

  const shareResult = async () => {
    if (!result) return;
    const url = new URL(window.location.href);
    url.search = queryFrom(result.query).toString();
    window.history.replaceState(null, '', url);
    try {
      await copyText(url.toString());
      setStatus('Share link copied. The address bar now contains the shared inputs.');
    } catch {
      setStatus('The share URL is in the address bar; clipboard access was unavailable.');
    }
  };

  return { result, error, status, calculate, clear, copyResult, shareResult };
}

function CalculatorLayout({ mode, lead, children }: { mode: PageMode; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="date-app">
      <div className="date-toolbar">
        <div className="date-local-badge">
          <strong>Local calendar calculation</strong>
          <small>Dates stay in this browser and are never uploaded.</small>
        </div>
        <span className="date-mode-badge">{PAGE_LABELS[mode]}</span>
      </div>
      {lead}
      <div className="date-workspace">{children}</div>
    </div>
  );
}

function InputPanel({
  title,
  description,
  error,
  onSubmit,
  onReset,
  children,
}: {
  title: string;
  description: string;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <section className="date-panel date-input-panel" aria-labelledby="date-input-heading">
      <div className="date-panel-heading">
        <div>
          <h3 id="date-input-heading">{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <form className="date-form" noValidate onSubmit={onSubmit}>
        {children}
        {error && <p className="date-error" role="alert">{error}</p>}
        <div className="date-actions">
          <button className="date-button date-button-primary" type="submit">Calculate</button>
          <button className="date-button date-button-muted" type="button" onClick={onReset}>Reset</button>
        </div>
      </form>
    </section>
  );
}

function ResultPanel({
  result,
  status,
  onCopy,
  onShare,
  onReset,
  disclaimer,
}: {
  result: DisplayResult | null;
  status: string;
  onCopy: () => void;
  onShare: () => void;
  onReset: () => void;
  disclaimer?: string;
}) {
  return (
    <section className="date-panel date-result-panel" aria-labelledby="date-result-heading">
      <div className="date-panel-heading">
        <div>
          <h3 id="date-result-heading">Result</h3>
          <p>Inputs are calculated locally with the calendar or clock rules stated on this page.</p>
        </div>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {result ? (
          <>
            <div className="date-result-hero">
              <small>{result.eyebrow}</small>
              <strong>{result.headline}</strong>
              {result.description && <p>{result.description}</p>}
            </div>
            <dl className="date-result-grid">
              {result.rows.map((row) => (
                <div className="date-result-item" key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            {result.warning && <p className="date-result-warning">{result.warning}</p>}
            {result.note && <p className="date-result-note">{result.note}</p>}
            <div className="date-result-actions">
              <button className="date-button date-button-secondary" type="button" onClick={onCopy}>Copy result</button>
              <button className="date-button date-button-secondary" type="button" onClick={onShare}>Copy share link</button>
              <button className="date-button date-button-muted" type="button" onClick={onReset}>Reset</button>
            </div>
          </>
        ) : (
          <div className="date-result-empty">
            <span aria-hidden="true">=</span>
            <strong>Your result will appear here</strong>
            <p>Enter real ISO dates or clock times, choose any options, and press Calculate.</p>
          </div>
        )}
        {status && <p className="date-result-note" role="status">{status}</p>}
      </div>
      {disclaimer && <p className="date-disclaimer">{disclaimer}</p>}
    </section>
  );
}

function Presets({ children }: { children: ReactNode }) {
  return (
    <div className="date-preset-block">
      <span>Preset examples</span>
      <div className="date-presets">{children}</div>
    </div>
  );
}

function LeapPolicyField({
  value,
  onChange,
}: {
  value: Feb29AnniversaryPolicy;
  onChange: (value: Feb29AnniversaryPolicy) => void;
}) {
  return (
    <label className="date-field date-field-wide">
      <span>February 29 anniversary rule</span>
      <select className="date-select" value={value} onChange={(event) => onChange(event.target.value as Feb29AnniversaryPolicy)}>
        <option value="feb28">Use February 28 in non-leap years</option>
        <option value="mar1">Use March 1 in non-leap years</option>
      </select>
      <small>This only changes anniversaries for a February 29 birth date.</small>
    </label>
  );
}

const AGE_DISCLAIMER = 'Calendar ages are informational. They are not a legal, benefits, school, insurance, or eligibility determination.';

function AgeCalculator({ specificDate }: { specificDate: boolean }) {
  const mode: PageMode = specificDate ? 'age-calculator-on-specific-date' : 'age-calculator';
  const defaultAsOf = TODAY;
  const [birthDate, setBirthDate] = useState(() => queryDate('birth', DEFAULT_BIRTH_DATE));
  const [asOfDate, setAsOfDate] = useState(() => specificDate ? queryDate('asof', defaultAsOf) : defaultAsOf);
  const [policy, setPolicy] = useState<Feb29AnniversaryPolicy>(() => queryChoice('leap', ['feb28', 'mar1'] as const, 'feb28'));
  const calculator = useCalculator();

  const reset = () => {
    setBirthDate(DEFAULT_BIRTH_DATE);
    setAsOfDate(defaultAsOf);
    setPolicy('feb28');
    calculator.clear();
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      const birth = requireDate(birthDate, 'Birth date');
      const reference = requireDate(asOfDate, specificDate ? 'As-of date' : 'Today');
      if (compareDates(birth, reference) > 0) throw new Error('Birth date cannot be later than the calculation date.');
      const age = calendarAge(birth, reference, { feb29Policy: policy });
      const birthday = nextBirthday(birth, reference, { feb29Policy: policy, includeToday: true });
      const headline = `${plural(age.years, 'year')}, ${plural(age.months, 'month')}, ${plural(age.days, 'day')}`;
      const birthdayValue = birthday.isToday
        ? `${longDate(birthday.date)} — today`
        : `${longDate(birthday.date)} — in ${plural(birthday.daysUntil, 'day')}`;
      const leapBirth = birth.month === 2 && birth.day === 29;
      const copy = [
        `Age${specificDate ? ` on ${formatIsoDate(reference)}` : ''}: ${headline}`,
        `Total: ${age.absoluteDays} days (${age.wholeWeeks} weeks, ${age.remainingDays} days)`,
        `Next birthday: ${formatIsoDate(birthday.date)}; turning ${birthday.turningAge}`,
      ].join('\n');
      const shareQuery: Record<string, string | number | boolean> = { birth: birthDate, leap: policy };
      if (specificDate) shareQuery.asof = asOfDate;
      return {
        eyebrow: specificDate ? `Age on ${formatIsoDate(reference)}` : `Age as of ${formatIsoDate(reference)}`,
        headline,
        description: `Born ${longDate(birth)}.`,
        rows: [
          { label: 'Total calendar days', value: plural(age.absoluteDays, 'day') },
          { label: 'Whole weeks', value: `${plural(age.wholeWeeks, 'week')} + ${plural(age.remainingDays, 'day')}` },
          { label: 'Next birthday', value: birthdayValue },
          { label: 'Age to turn', value: plural(birthday.turningAge, 'year') },
        ],
        warning: leapBirth
          ? `Leap-day policy: this calculator treats the anniversary as ${policy === 'feb28' ? 'February 28' : 'March 1'} in a non-leap year.`
          : undefined,
        note: `The birth year ${birth.year} ${isLeapYear(birth.year) ? 'is' : 'is not'} a leap year. All differences are based on local calendar dates, not elapsed milliseconds.`,
        copyText: copy,
        query: shareQuery,
      };
    });
  };

  const setPreset = (birth: string, asOf = defaultAsOf) => {
    setBirthDate(birth);
    setAsOfDate(asOf);
    calculator.clear();
  };

  return (
    <CalculatorLayout mode={mode}>
      <InputPanel
        title={specificDate ? 'Find age on a specific date' : 'Find an exact calendar age'}
        description={specificDate ? 'Both dates are required. The as-of date can be today, past, or future.' : `Today is ${TODAY} in this browser's local calendar.`}
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-field-grid">
          <label className="date-field">
            <span>Birth date</span>
            <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required />
            <small>Strict YYYY-MM-DD</small>
          </label>
          {specificDate && (
            <label className="date-field">
              <span>Age on this date</span>
              <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} required />
              <small>Required as-of date</small>
            </label>
          )}
          <LeapPolicyField value={policy} onChange={setPolicy} />
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => setPreset('1990-06-15')}>Born June 15, 1990</button>
          <button className="date-chip" type="button" onClick={() => { setPolicy('feb28'); setPreset('2000-02-29'); }}>Leap-day birthday</button>
          {specificDate && <button className="date-chip" type="button" onClick={() => setPreset('2000-01-01', '2025-01-01')}>25-year milestone</button>}
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
        disclaimer={AGE_DISCLAIMER}
      />
    </CalculatorLayout>
  );
}

type DateOperation = 'add' | 'subtract';

function DateCalculator() {
  const [startDate, setStartDate] = useState(() => queryDate('start', TODAY));
  const [operation, setOperation] = useState<DateOperation>(() => queryChoice('op', ['add', 'subtract'] as const, 'add'));
  const [years, setYears] = useState(() => queryText('years', '0', 8));
  const [months, setMonths] = useState(() => queryText('months', '0', 8));
  const [weeks, setWeeks] = useState(() => queryText('weeks', '0', 8));
  const [days, setDays] = useState(() => queryText('days', '30', 8));
  const calculator = useCalculator();

  const reset = () => {
    setStartDate(TODAY);
    setOperation('add');
    setYears('0');
    setMonths('0');
    setWeeks('0');
    setDays('30');
    calculator.clear();
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      const start = requireDate(startDate, 'Start date');
      const amounts = {
        years: requireWholeNumber(years, 'Years', { minimum: 0, maximum: 9_999 }),
        months: requireWholeNumber(months, 'Months', { minimum: 0, maximum: 119_999 }),
        weeks: requireWholeNumber(weeks, 'Weeks', { minimum: 0, maximum: 521_770 }),
        days: requireWholeNumber(days, 'Days', { minimum: 0, maximum: 3_652_058 }),
      };
      const sign = operation === 'add' ? 1 : -1;
      const yearShift = addYears(start, sign * amounts.years);
      const monthShift = addMonths(yearShift.date, sign * amounts.months);
      const weekShift = addWeeks(monthShift.date, sign * amounts.weeks);
      const resultDate = addDays(weekShift, sign * amounts.days);
      const clamped = yearShift.clamped || monthShift.clamped;
      const nonZeroParts = [
        amounts.years ? plural(amounts.years, 'year') : '',
        amounts.months ? plural(amounts.months, 'month') : '',
        amounts.weeks ? plural(amounts.weeks, 'week') : '',
        amounts.days ? plural(amounts.days, 'day') : '',
      ].filter(Boolean);
      const interval = nonZeroParts.length > 0 ? nonZeroParts.join(', ') : 'zero days';
      const action = operation === 'add' ? 'Added' : 'Subtracted';
      const isoResult = formatIsoDate(resultDate);
      return {
        eyebrow: `${action} from ${formatIsoDate(start)}`,
        headline: longDate(resultDate),
        description: `${action} ${interval}, in years → months → weeks → days order.`,
        rows: [
          { label: 'ISO date', value: isoResult },
          { label: 'Weekday', value: WEEKDAY_NAMES[dayOfWeek(resultDate) - 1] },
          { label: 'Calendar-day shift', value: plural(Math.abs(daysBetween(start, resultDate, { signed: true })), 'day') },
          { label: 'Days in result month', value: plural(daysInMonth(resultDate.year, resultDate.month), 'day') },
        ],
        warning: clamped
          ? 'Month-end clamp applied: the target month did not contain the original day, so the result uses that month’s last valid day.'
          : undefined,
        note: 'Calendar units are applied sequentially. Reordering years, months, weeks, and days can produce a different result near month ends.',
        copyText: `${action} ${interval} from ${formatIsoDate(start)}\nResult: ${isoResult} (${WEEKDAY_NAMES[dayOfWeek(resultDate) - 1]})${clamped ? '\nMonth-end clamp applied.' : ''}`,
        query: { start: startDate, op: operation, years, months, weeks, days },
      };
    });
  };

  const preset = (settings: {
    start?: string;
    operation?: DateOperation;
    years?: string;
    months?: string;
    weeks?: string;
    days?: string;
  }) => {
    setStartDate(settings.start ?? TODAY);
    setOperation(settings.operation ?? 'add');
    setYears(settings.years ?? '0');
    setMonths(settings.months ?? '0');
    setWeeks(settings.weeks ?? '0');
    setDays(settings.days ?? '0');
    calculator.clear();
  };

  return (
    <CalculatorLayout mode="date-calculator">
      <InputPanel
        title="Shift a calendar date"
        description="Add or subtract whole calendar units. Invalid month-end dates are safely clamped."
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-field-grid">
          <label className="date-field date-field-wide">
            <span>Start date</span>
            <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
            <small>Strict YYYY-MM-DD</small>
          </label>
          <div className="date-field date-field-wide">
            <span>Operation</span>
            <div className="date-choice-row" aria-label="Date operation">
              <button className="date-chip" type="button" aria-pressed={operation === 'add'} onClick={() => setOperation('add')}>Add</button>
              <button className="date-chip" type="button" aria-pressed={operation === 'subtract'} onClick={() => setOperation('subtract')}>Subtract</button>
            </div>
          </div>
          <div className="date-number-units date-field-wide">
            {([
              ['Years', years, setYears],
              ['Months', months, setMonths],
              ['Weeks', weeks, setWeeks],
              ['Days', days, setDays],
            ] as const).map(([label, value, setter]) => (
              <label className="date-field" key={label}>
                <span>{label}</span>
                <input className="date-input" type="number" min="0" step="1" value={value} onChange={(event) => setter(event.target.value)} inputMode="numeric" />
              </label>
            ))}
          </div>
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => preset({ days: '90' })}>90 days from today</button>
          <button className="date-chip" type="button" onClick={() => preset({ start: '2025-01-31', months: '1' })}>Jan 31 + 1 month</button>
          <button className="date-chip" type="button" onClick={() => preset({ start: '2024-02-29', years: '1' })}>Leap day + 1 year</button>
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
      />
    </CalculatorLayout>
  );
}

function DaysBetweenCalculator() {
  const [startDate, setStartDate] = useState(() => queryDate('start', TODAY));
  const [endDate, setEndDate] = useState(() => queryDate('end', DEFAULT_RANGE_END));
  const [signed, setSigned] = useState(() => queryBoolean('signed', false));
  const [inclusive, setInclusive] = useState(() => queryBoolean('inclusive', false));
  const calculator = useCalculator();

  const reset = () => {
    setStartDate(TODAY);
    setEndDate(DEFAULT_RANGE_END);
    setSigned(false);
    setInclusive(false);
    calculator.clear();
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      const start = requireDate(startDate, 'Start date');
      const end = requireDate(endDate, 'End date');
      const countedSigned = daysBetween(start, end, { signed: true, inclusive });
      const elapsedSigned = daysBetween(start, end, { signed: true, inclusive: false });
      const elapsedAbsolute = daysBetween(start, end, { signed: false, inclusive: false });
      const displayed = signed ? countedSigned : Math.abs(countedSigned);
      const age = calendarAge(start, end);
      const period = `${plural(age.years, 'year')}, ${plural(age.months, 'month')}, ${plural(age.days, 'day')}`;
      const method = inclusive ? 'Both endpoint dates counted' : 'Elapsed days; endpoint dates not both counted';
      return {
        eyebrow: `${dateDirection(start, end)} date range`,
        headline: plural(displayed, 'day'),
        description: `${formatIsoDate(start)} → ${formatIsoDate(end)}. ${method}.`,
        rows: [
          { label: 'Signed elapsed days', value: formatNumber(elapsedSigned) },
          { label: 'Absolute elapsed days', value: formatNumber(elapsedAbsolute) },
          { label: 'Whole weeks', value: `${plural(Math.floor(Math.abs(displayed) / 7), 'week')} + ${plural(Math.abs(displayed) % 7, 'day')}` },
          { label: 'Calendar period', value: period },
        ],
        note: inclusive
          ? 'Inclusive counting adds one calendar date to the ordinary elapsed-day difference, including when both inputs are the same date.'
          : 'Elapsed-day counting measures midnight boundaries between dates. Turn on inclusive counting to count both the start and end dates.',
        copyText: `Days between ${formatIsoDate(start)} and ${formatIsoDate(end)}: ${displayed}\nSigned elapsed: ${elapsedSigned}\nAbsolute elapsed: ${elapsedAbsolute}\nMethod: ${method}`,
        query: { start: startDate, end: endDate, signed, inclusive },
      };
    });
  };

  const preset = (start: string, end: string, countBoth = false) => {
    setStartDate(start);
    setEndDate(end);
    setInclusive(countBoth);
    calculator.clear();
  };

  return (
    <CalculatorLayout mode="days-between-dates">
      <InputPanel
        title="Compare two calendar dates"
        description="Choose signed or absolute display and whether both endpoint dates count."
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-field-grid">
          <label className="date-field">
            <span>Start date</span>
            <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
            <small>Strict YYYY-MM-DD</small>
          </label>
          <label className="date-field">
            <span>End date</span>
            <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
            <small>Dates may be entered in either order.</small>
          </label>
          <div className="date-field date-field-wide">
            <label className="date-check">
              <input type="checkbox" checked={signed} onChange={(event) => setSigned(event.target.checked)} />
              Preserve direction with a negative result when end is earlier
            </label>
            <label className="date-check">
              <input type="checkbox" checked={inclusive} onChange={(event) => setInclusive(event.target.checked)} />
              Include both start and end dates
            </label>
          </div>
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => preset(TODAY, DEFAULT_RANGE_END)}>Next 30 elapsed days</button>
          <button className="date-chip" type="button" onClick={() => preset('2024-02-28', '2024-03-01', true)}>Across leap day</button>
          <button className="date-chip" type="button" onClick={() => { setSigned(true); preset('2025-12-31', '2025-01-01'); }}>Reverse one year</button>
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
      />
    </CalculatorLayout>
  );
}

type BusinessMode = 'count' | 'add';
const QUICK_BUSINESS_STEPS = [1, 2, 3, 5, 7, 10, 15, 20] as const;
type WeekendPreset = 'sat-sun' | 'fri-sat' | 'sun-only' | 'custom';

function initialCustomWeekend(): IsoWeekday[] {
  const value = SHARED_QUERY.get('customWeekend');
  if (value === null) return [6, 7];
  const parsed = [...new Set(value.split(',').map(Number))]
    .filter((day): day is IsoWeekday => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((left, right) => left - right);
  return parsed;
}

function parseHolidays(value: string): string[] {
  const holidays = [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  for (const holiday of holidays) {
    if (!isValidIsoDate(holiday)) {
      throw new Error(`Holiday “${holiday}” must be a real date in strict YYYY-MM-DD format.`);
    }
  }
  return holidays;
}

function weekendFor(preset: WeekendPreset, custom: readonly IsoWeekday[]): IsoWeekday[] {
  if (preset === 'fri-sat') return [5, 6];
  if (preset === 'sun-only') return [7];
  if (preset === 'custom') return [...custom];
  return [6, 7];
}

function weekendLabel(days: readonly IsoWeekday[]): string {
  if (days.length === 0) return 'No weekend days';
  if (days.length === 7) return 'Every day';
  return days.map((day) => WEEKDAY_SHORT[day - 1]).join(', ');
}

function BusinessDaysCalculator() {
  const [mode, setMode] = useState<BusinessMode>(() => queryChoice('mode', ['count', 'add'] as const, 'add'));
  const [startDate, setStartDate] = useState(() => queryDate('start', TODAY));
  const [endDate, setEndDate] = useState(() => queryDate('end', DEFAULT_RANGE_END));
  const [amount, setAmount] = useState(() => queryText('amount', PRESET_BUSINESS_DAYS ?? '5', 9));
  const [weekendPreset, setWeekendPreset] = useState<WeekendPreset>(() => queryChoice('weekend', ['sat-sun', 'fri-sat', 'sun-only', 'custom'] as const, 'sat-sun'));
  const [customWeekend, setCustomWeekend] = useState<IsoWeekday[]>(initialCustomWeekend);
  const [holidaysText, setHolidaysText] = useState(() => queryText('holidays', '', 100_000));
  const [includeStart, setIncludeStart] = useState(() => queryBoolean('includeStart', false));
  const [includeEnd, setIncludeEnd] = useState(() => queryBoolean('includeEnd', true));
  const calculator = useCalculator();

  const buildAddResult = (
    start: CalendarDate,
    businessAmount: number,
    weekend: IsoWeekday[],
    holidays: string[],
    query: DisplayResult['query'],
  ): DisplayResult => {
    const resultDate = addBusinessDays(start, businessAmount, { weekend, holidays });
    const resultIso = formatIsoDate(resultDate);
    const verifiedSteps = businessDaysBetween(start, resultDate, {
      weekend,
      holidays,
      includeStart: false,
      includeEnd: true,
      signed: true,
    });
    return {
      eyebrow: businessAmount < 0 ? 'Business days subtracted' : 'Business days added',
      headline: longDate(resultDate),
      description: `${formatNumber(Math.abs(businessAmount))} business-day step${Math.abs(businessAmount) === 1 ? '' : 's'} from ${formatIsoDate(start)}.`,
      rows: [
        { label: 'ISO result', value: resultIso },
        { label: 'Calendar-day shift', value: formatNumber(daysBetween(start, resultDate, { signed: true })) },
        { label: 'Business steps verified', value: formatNumber(verifiedSteps) },
        { label: 'Holiday dates supplied', value: formatNumber(holidays.length) },
      ],
      note: `Weekend days: ${weekendLabel(weekend)}. The start date is not counted as the first added business day.`,
      copyText: `${businessAmount} business days from ${formatIsoDate(start)}\nResult: ${resultIso} (${WEEKDAY_NAMES[dayOfWeek(resultDate) - 1]})\nWeekend: ${weekendLabel(weekend)}\nHoliday dates supplied: ${holidays.length}`,
      query,
    };
  };

  // Quick answers from today, using the weekend and holiday settings currently in the form.
  const quickWeekend = weekendFor(weekendPreset, customWeekend);
  let quickHolidays: string[] = [];
  let quickNote = '';
  try {
    quickHolidays = parseHolidays(holidaysText);
  } catch {
    quickNote = 'The holiday list has an invalid line, so these quick answers ignore holidays until it is fixed.';
  }
  const todayDate = parseIsoDate(TODAY);
  const quickRows = QUICK_BUSINESS_STEPS.map((steps) => {
    try {
      const date = addBusinessDays(todayDate, steps, { weekend: quickWeekend, holidays: quickHolidays });
      return { steps, date, shift: daysBetween(todayDate, date, { signed: true }) };
    } catch {
      return { steps, date: null, shift: 0 };
    }
  });

  const runAdd = (startIso: string, steps: number) => {
    setMode('add');
    setStartDate(startIso);
    setAmount(String(steps));
    calculator.calculate(() => buildAddResult(requireDate(startIso, 'Start date'), steps, quickWeekend, quickHolidays, {
      mode: 'add',
      start: startIso,
      end: endDate,
      amount: String(steps),
      weekend: weekendPreset,
      customWeekend: customWeekend.join(','),
      holidays: quickNote ? '' : holidaysText,
      includeStart,
      includeEnd,
    }));
  };

  // Default and shared Add-mode visits should answer immediately instead of waiting for a click.
  useEffect(() => {
    if (mode !== 'add') return;
    const steps = Number(amount);
    if (!Number.isInteger(steps) || Math.abs(steps) > 3_652_058) return;
    runAdd(startDate, steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quickStrip = (
    <section className="date-quick-strip" aria-labelledby="quick-today-heading">
      <div className="date-quick-heading">
        <h3 id="quick-today-heading">Business days from today</h3>
        <p>
          Today is {longDate(todayDate)}. Weekend: {weekendLabel(quickWeekend)}
          {quickHolidays.length > 0 ? `, ${quickHolidays.length} holiday date${quickHolidays.length === 1 ? '' : 's'} excluded` : ', no holidays listed'}.
          Select a card to load it into the calculator.
        </p>
        {quickNote && <p className="date-quick-note">{quickNote}</p>}
      </div>
      <div className="date-quick-grid">
        {quickRows.map((row) => (
          <button key={row.steps} type="button" className="date-quick-card" onClick={() => runAdd(TODAY, row.steps)} disabled={row.date === null}>
            <span>{row.steps} business day{row.steps === 1 ? '' : 's'}</span>
            <strong>{row.date ? shortDate(row.date, row.date.year !== todayDate.year) : '—'}</strong>
            <small>{row.date ? `${formatNumber(row.shift)} calendar day${row.shift === 1 ? '' : 's'} later` : 'No business day available'}</small>
          </button>
        ))}
      </div>
    </section>
  );

  const reset = () => {
    setMode('add');
    setStartDate(TODAY);
    setEndDate(DEFAULT_RANGE_END);
    setAmount('5');
    setWeekendPreset('sat-sun');
    setCustomWeekend([6, 7]);
    setHolidaysText('');
    setIncludeStart(false);
    setIncludeEnd(true);
    calculator.clear();
  };

  const toggleCustomWeekend = (weekday: IsoWeekday) => {
    setCustomWeekend((current) => current.includes(weekday)
      ? current.filter((value) => value !== weekday)
      : [...current, weekday].sort((left, right) => left - right) as IsoWeekday[]);
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      const start = requireDate(startDate, 'Start date');
      const holidays = parseHolidays(holidaysText);
      const weekend = weekendFor(weekendPreset, customWeekend);
      const commonQuery = {
        mode,
        start: startDate,
        end: endDate,
        amount,
        weekend: weekendPreset,
        customWeekend: customWeekend.join(','),
        holidays: holidaysText,
        includeStart,
        includeEnd,
      };

      if (mode === 'add') {
        const businessAmount = requireWholeNumber(amount, 'Business days to add', { minimum: -3_652_058, maximum: 3_652_058 });
        return buildAddResult(start, businessAmount, weekend, holidays, commonQuery);
      }

      const end = requireDate(endDate, 'End date');
      const counted = businessDaysBetween(start, end, {
        weekend,
        holidays,
        includeStart,
        includeEnd,
        signed: true,
      });
      const withoutHolidays = businessDaysBetween(start, end, {
        weekend,
        includeStart,
        includeEnd,
        signed: true,
      });
      const excludedHolidays = Math.max(0, Math.abs(withoutHolidays) - Math.abs(counted));
      return {
        eyebrow: `${dateDirection(start, end)} business-day range`,
        headline: plural(Math.abs(counted), 'business day'),
        description: `${formatIsoDate(start)} → ${formatIsoDate(end)}${counted < 0 ? ' (backward)' : ''}.`,
        rows: [
          { label: 'Signed business days', value: formatNumber(counted) },
          { label: 'Calendar elapsed days', value: formatNumber(daysBetween(start, end, { signed: false })) },
          { label: 'Holiday dates supplied', value: formatNumber(holidays.length) },
          { label: 'Weekday holidays excluded', value: formatNumber(excludedHolidays) },
        ],
        note: `Weekend days: ${weekendLabel(weekend)}. Start ${includeStart ? 'included' : 'excluded'}; end ${includeEnd ? 'included' : 'excluded'}. Duplicate holiday lines are counted once.`,
        copyText: `Business days from ${formatIsoDate(start)} to ${formatIsoDate(end)}: ${counted}\nWeekend: ${weekendLabel(weekend)}\nHoliday dates supplied: ${holidays.length}; excluded in range: ${excludedHolidays}`,
        query: commonQuery,
      };
    });
  };

  const applyPreset = (kind: 'month' | 'holiday') => {
    if (kind === 'month') {
      const today = parseIsoDate(TODAY);
      setMode('count');
      setStartDate(formatIsoDate({ year: today.year, month: today.month, day: 1 }));
      setEndDate(formatIsoDate({ year: today.year, month: today.month, day: daysInMonth(today.year, today.month) }));
      setHolidaysText('');
    } else {
      setMode('count');
      setStartDate('2025-12-20');
      setEndDate('2026-01-05');
      setHolidaysText('2025-12-25\n2026-01-01');
    }
    setWeekendPreset('sat-sun');
    calculator.clear();
  };

  const applyAddPreset = (businessDays: number) => {
    setMode('add');
    setStartDate(TODAY);
    setAmount(String(businessDays));
    setWeekendPreset('sat-sun');
    setHolidaysText('');
    calculator.clear();
  };

  const holidayPresetYear = isValidIsoDate(startDate) ? parseIsoDate(startDate).year : todayDate.year;
  const canLoadUsFederalHolidays = holidayPresetYear >= 2021 && holidayPresetYear <= 9_998;
  const applyUsFederalHolidayPreset = () => {
    const holidays = usFederalHolidays(holidayPresetYear);
    const holidayDates = holidays.map((holiday) => holiday.date);
    const nextHolidaysText = holidayDates.join('\n');
    setWeekendPreset('sat-sun');
    setHolidaysText(nextHolidaysText);
    if (mode !== 'add') {
      calculator.clear(`Loaded ${holidays.length} U.S. federal holiday dates for ${holidayPresetYear}. Calculate to apply them.`);
      return;
    }
    calculator.calculate(() => {
      const businessAmount = requireWholeNumber(amount, 'Business days to add', { minimum: -3_652_058, maximum: 3_652_058 });
      return buildAddResult(requireDate(startDate, 'Start date'), businessAmount, [6, 7], holidayDates, {
        mode: 'add',
        start: startDate,
        end: endDate,
        amount,
        weekend: 'sat-sun',
        customWeekend: customWeekend.join(','),
        holidays: nextHolidaysText,
        includeStart,
        includeEnd,
      });
    });
  };

  return (
    <CalculatorLayout mode="business-days-calculator" lead={quickStrip}>
      <InputPanel
        title="Count or add business days"
        description="Define your weekend, then add optional holiday dates one per line."
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-tablist" role="tablist" aria-label="Business-day calculation">
          <button className="date-tab" type="button" role="tab" aria-selected={mode === 'count'} onClick={() => { setMode('count'); calculator.clear(); }}>Count a range</button>
          <button className="date-tab" type="button" role="tab" aria-selected={mode === 'add'} onClick={() => { setMode('add'); calculator.clear(); }}>Add business days</button>
        </div>
        <div className="date-field-grid">
          <label className="date-field">
            <span>Start date</span>
            <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
          </label>
          {mode === 'count' ? (
            <label className="date-field">
              <span>End date</span>
              <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
            </label>
          ) : (
            <label className="date-field">
              <span>Business days to add</span>
              <input className="date-input" type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" required />
              <small>Use a negative number to subtract.</small>
            </label>
          )}
          <label className="date-field date-field-wide">
            <span>Weekend pattern</span>
            <select className="date-select" value={weekendPreset} onChange={(event) => setWeekendPreset(event.target.value as WeekendPreset)}>
              <option value="sat-sun">Saturday and Sunday</option>
              <option value="fri-sat">Friday and Saturday</option>
              <option value="sun-only">Sunday only</option>
              <option value="custom">Custom days</option>
            </select>
          </label>
          {weekendPreset === 'custom' && (
            <div className="date-field date-field-wide">
              <span>Custom weekend days</span>
              <div className="date-weekday-grid">
                {WEEKDAY_SHORT.map((label, index) => {
                  const weekday = (index + 1) as IsoWeekday;
                  return (
                    <label key={label}>
                      <input type="checkbox" checked={customWeekend.includes(weekday)} onChange={() => toggleCustomWeekend(weekday)} />
                      {label}
                    </label>
                  );
                })}
              </div>
              <small>Selecting every day leaves no available business day for addition.</small>
            </div>
          )}
          <label className="date-field date-field-wide">
            <span>Holiday dates (optional)</span>
            <textarea className="date-textarea" value={holidaysText} onChange={(event) => setHolidaysText(event.target.value)} placeholder={'2026-01-01\n2026-12-25'} spellCheck={false} />
            <small>One strict YYYY-MM-DD date per line. Blank lines and duplicates are ignored. The U.S. preset follows the <a href="https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/" target="_blank" rel="noreferrer">OPM federal schedule</a> for a standard Monday–Friday workweek; verify other closures.</small>
          </label>
          {mode === 'count' && (
            <div className="date-field date-field-wide">
              <label className="date-check">
                <input type="checkbox" checked={includeStart} onChange={(event) => setIncludeStart(event.target.checked)} />
                Include start date when it is a business day
              </label>
              <label className="date-check">
                <input type="checkbox" checked={includeEnd} onChange={(event) => setIncludeEnd(event.target.checked)} />
                Include end date when it is a business day
              </label>
            </div>
          )}
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => applyAddPreset(5)}>5 business days from today</button>
          <button className="date-chip" type="button" onClick={() => applyAddPreset(7)}>7 business days from today</button>
          <button className="date-chip" type="button" onClick={() => applyAddPreset(10)}>10 business days from today</button>
          <button className="date-chip" type="button" onClick={applyUsFederalHolidayPreset} disabled={!canLoadUsFederalHolidays}>U.S. federal holidays ({holidayPresetYear})</button>
          <button className="date-chip" type="button" onClick={() => applyPreset('month')}>This calendar month</button>
          <button className="date-chip" type="button" onClick={() => applyPreset('holiday')}>Year-end holidays</button>
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
      />
    </CalculatorLayout>
  );
}

function TimeDurationCalculator() {
  const [startTime, setStartTime] = useState(() => queryTime('start', '09:00'));
  const [endTime, setEndTime] = useState(() => queryTime('end', '17:30'));
  const [overnight, setOvernight] = useState(() => queryBoolean('overnight', false));
  const [breakMinutes, setBreakMinutes] = useState(() => queryText('break', '30', 6));
  const calculator = useCalculator();

  const reset = () => {
    setStartTime('09:00');
    setEndTime('17:30');
    setOvernight(false);
    setBreakMinutes('30');
    calculator.clear();
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      let start;
      let end;
      try {
        start = parseTime(startTime);
      } catch {
        throw new Error('Start time must be a real 24-hour time in strict HH:MM or HH:MM:SS format.');
      }
      try {
        end = parseTime(endTime);
      } catch {
        throw new Error('End time must be a real 24-hour time in strict HH:MM or HH:MM:SS format.');
      }
      const minutes = requireWholeNumber(breakMinutes, 'Break minutes', { minimum: 0, maximum: 1_440 });
      const result = timeDuration(start, end, { overnight, breakSeconds: minutes * 60 });
      const gross = timeDuration(start, end, { overnight, breakSeconds: 0 });
      const formattedStart = formatTime(start, { includeSeconds: startTime.length === 8 });
      const formattedEnd = formatTime(end, { includeSeconds: endTime.length === 8 });
      return {
        eyebrow: result.crossedMidnight ? 'Overnight duration' : 'Same-day duration',
        headline: durationLabel(result),
        description: `${formattedStart} → ${formattedEnd}${minutes ? `, minus ${plural(minutes, 'break minute')}` : ''}.`,
        rows: [
          { label: 'Gross duration', value: durationLabel(gross) },
          { label: 'Break deducted', value: plural(result.breakSeconds / 60, 'minute') },
          { label: 'Total minutes', value: formatNumber(result.totalSeconds / 60) },
          { label: 'Total seconds', value: formatNumber(result.totalSeconds) },
        ],
        warning: result.crossedMidnight ? 'The end time was treated as occurring on the following calendar day.' : undefined,
        note: 'This is wall-clock arithmetic. It does not attach a date or timezone, so daylight-saving transitions are not inferred.',
        copyText: `Time duration from ${formattedStart} to ${formattedEnd}: ${durationLabel(result)}\nGross: ${durationLabel(gross)}\nBreak: ${minutes} minutes${result.crossedMidnight ? '\nOvernight: yes' : ''}`,
        query: { start: startTime, end: endTime, overnight, break: breakMinutes },
      };
    });
  };

  const preset = (start: string, end: string, overnightValue: boolean, breakValue: string) => {
    setStartTime(start);
    setEndTime(end);
    setOvernight(overnightValue);
    setBreakMinutes(breakValue);
    calculator.clear();
  };

  return (
    <CalculatorLayout mode="time-duration-calculator">
      <InputPanel
        title="Measure a clock-time duration"
        description="Use 24-hour HH:MM or HH:MM:SS times, then optionally cross midnight and deduct a break."
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-field-grid">
          <label className="date-field">
            <span>Start time</span>
            <input className="date-input" type="text" value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="09:00" inputMode="numeric" autoComplete="off" required />
            <small>Strict HH:MM or HH:MM:SS</small>
          </label>
          <label className="date-field">
            <span>End time</span>
            <input className="date-input" type="text" value={endTime} onChange={(event) => setEndTime(event.target.value)} placeholder="17:30" inputMode="numeric" autoComplete="off" required />
            <small>24-hour clock</small>
          </label>
          <label className="date-field">
            <span>Unpaid break (minutes)</span>
            <input className="date-input" type="number" min="0" max="1440" step="1" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} inputMode="numeric" />
            <small>Subtracted after the gross duration.</small>
          </label>
          <div className="date-field">
            <span>Day boundary</span>
            <label className="date-check">
              <input type="checkbox" checked={overnight} onChange={(event) => setOvernight(event.target.checked)} />
              End time may be on the next day
            </label>
          </div>
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => preset('09:00', '17:30', false, '30')}>Workday with break</button>
          <button className="date-chip" type="button" onClick={() => preset('22:00', '06:30', true, '0')}>Overnight shift</button>
          <button className="date-chip" type="button" onClick={() => preset('12:00:15', '12:02:45', false, '0')}>Seconds precision</button>
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
      />
    </CalculatorLayout>
  );
}

function WeekNumberCalculator() {
  const [date, setDate] = useState(() => queryDate('date', TODAY));
  const calculator = useCalculator();

  const reset = () => {
    setDate(TODAY);
    calculator.clear();
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      const input = requireDate(date, 'Date');
      const week = isoWeekInfo(input);
      const weekLabel = `${week.weekYear}-W${String(week.week).padStart(2, '0')}`;
      const monday = formatIsoDate(week.monday);
      const sunday = formatIsoDate(week.sunday);
      return {
        eyebrow: 'ISO 8601 week date',
        headline: weekLabel,
        description: `${longDate(input)} is ISO weekday ${week.weekday}.`,
        rows: [
          { label: 'ISO week-year', value: formatNumber(week.weekYear) },
          { label: 'Week number', value: formatNumber(week.week) },
          { label: 'Monday', value: `${monday} · ${MONTH_NAMES[week.monday.month - 1]} ${week.monday.day}` },
          { label: 'Sunday', value: `${sunday} · ${MONTH_NAMES[week.sunday.month - 1]} ${week.sunday.day}` },
        ],
        note: 'ISO weeks begin Monday. Week 1 is the week containing January 4, so early January can belong to the previous ISO week-year.',
        copyText: `${formatIsoDate(input)} is ${weekLabel} (ISO weekday ${week.weekday})\nMonday: ${monday}\nSunday: ${sunday}`,
        query: { date },
      };
    });
  };

  const preset = (value: string) => {
    setDate(value);
    calculator.clear();
  };

  return (
    <CalculatorLayout mode="week-number-calculator">
      <InputPanel
        title="Find an ISO week number"
        description="Get the ISO week-year, numbered week, weekday, and Monday–Sunday boundaries."
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-field-grid">
          <label className="date-field date-field-wide">
            <span>Calendar date</span>
            <input className="date-input" type="date" min="0001-01-01" max="9999-12-31" value={date} onChange={(event) => setDate(event.target.value)} required />
            <small>Strict YYYY-MM-DD</small>
          </label>
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => preset(TODAY)}>Today</button>
          <button className="date-chip" type="button" onClick={() => preset('2021-01-01')}>Jan 1 year crossover</button>
          <button className="date-chip" type="button" onClick={() => preset('2020-12-31')}>ISO week 53</button>
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
      />
    </CalculatorLayout>
  );
}

function birthdayForToday(year: number): string {
  const today = parseIsoDate(TODAY);
  return formatIsoDate({
    year,
    month: today.month,
    day: Math.min(today.day, daysInMonth(year, today.month)),
  });
}

function BirthdayCountdownCalculator() {
  const [birthDate, setBirthDate] = useState(() => queryDate('birth', birthdayForToday(1990)));
  const [policy, setPolicy] = useState<Feb29AnniversaryPolicy>(() => queryChoice('leap', ['feb28', 'mar1'] as const, 'feb28'));
  const calculator = useCalculator();

  const reset = () => {
    setBirthDate(birthdayForToday(1990));
    setPolicy('feb28');
    calculator.clear();
  };

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    calculator.calculate(() => {
      const birth = requireDate(birthDate, 'Birth date');
      const today = parseIsoDate(TODAY);
      if (compareDates(birth, today) > 0) throw new Error('Birth date cannot be later than today.');
      const countdown = nextBirthday(birth, today, { feb29Policy: policy, includeToday: true });
      const age = calendarAge(birth, today, { feb29Policy: policy });
      const nextIso = formatIsoDate(countdown.date);
      const headline = countdown.isToday
        ? 'Happy birthday — today!'
        : `${plural(countdown.daysUntil, 'calendar day')} to go`;
      const leapBirth = birth.month === 2 && birth.day === 29;
      return {
        eyebrow: countdown.isToday ? 'Birthday countdown complete' : 'Next birthday countdown',
        headline,
        description: `${longDate(countdown.date)} · turning ${countdown.turningAge}.`,
        rows: [
          { label: 'Next birthday', value: nextIso },
          { label: 'Weekday', value: WEEKDAY_NAMES[dayOfWeek(countdown.date) - 1] },
          { label: 'Age to turn', value: plural(countdown.turningAge, 'year') },
          { label: 'Weeks + days', value: `${plural(countdown.wholeWeeks, 'week')} + ${plural(countdown.remainingDays, 'day')}` },
        ],
        warning: leapBirth
          ? `For non-leap years, this countdown uses ${policy === 'feb28' ? 'February 28' : 'March 1'} as the anniversary.`
          : undefined,
        note: `Current calendar age: ${age.years} years, ${age.months} months, ${age.days} days. The countdown is a calendar-day difference from local today (${TODAY}).`,
        copyText: `Next birthday: ${nextIso} (${WEEKDAY_NAMES[dayOfWeek(countdown.date) - 1]})\nCountdown: ${countdown.daysUntil} calendar days\nTurning age: ${countdown.turningAge}`,
        query: { birth: birthDate, leap: policy },
      };
    });
  };

  const preset = (date: string, leapPolicy: Feb29AnniversaryPolicy = 'feb28') => {
    setBirthDate(date);
    setPolicy(leapPolicy);
    calculator.clear();
  };

  return (
    <CalculatorLayout mode="birthday-countdown">
      <InputPanel
        title="Count down to the next birthday"
        description={`The reference date is local today, ${TODAY}. The birth year determines the age to turn.`}
        error={calculator.error}
        onSubmit={calculate}
        onReset={reset}
      >
        <div className="date-field-grid">
          <label className="date-field date-field-wide">
            <span>Birth date</span>
            <input className="date-input" type="date" min="0001-01-01" max={TODAY} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required />
            <small>Strict YYYY-MM-DD</small>
          </label>
          <LeapPolicyField value={policy} onChange={setPolicy} />
        </div>
        <Presets>
          <button className="date-chip" type="button" onClick={() => preset(birthdayForToday(1990))}>Birthday today</button>
          <button className="date-chip" type="button" onClick={() => preset('2000-02-29')}>Leap-day birthday</button>
          <button className="date-chip" type="button" onClick={() => preset('1995-12-31')}>New Year’s Eve</button>
        </Presets>
      </InputPanel>
      <ResultPanel
        result={calculator.result}
        status={calculator.status}
        onCopy={calculator.copyResult}
        onShare={calculator.shareResult}
        onReset={reset}
        disclaimer={AGE_DISCLAIMER}
      />
    </CalculatorLayout>
  );
}

function resolvePageMode(): PageMode {
  const knownModes = Object.keys(PAGE_LABELS) as PageMode[];
  const bodyMode = document.body.dataset.page;
  if (bodyMode && knownModes.includes(bodyMode as PageMode)) return bodyMode as PageMode;
  const path = window.location.pathname.toLowerCase();
  return knownModes.find((mode) => path.includes(`/${mode}`)) ?? 'age-calculator';
}

function DateToolsApp({ mode }: { mode: PageMode }) {
  if (mode === 'age-calculator') return <AgeCalculator specificDate={false} />;
  if (mode === 'age-calculator-on-specific-date') return <AgeCalculator specificDate />;
  if (mode === 'date-calculator') return <DateCalculator />;
  if (mode === 'days-between-dates') return <DaysBetweenCalculator />;
  if (mode === 'business-days-calculator') return <BusinessDaysCalculator />;
  if (mode === 'time-duration-calculator') return <TimeDurationCalculator />;
  if (mode === 'week-number-calculator') return <WeekNumberCalculator />;
  return <BirthdayCountdownCalculator />;
}

const root = document.getElementById('date-tools-root') ?? document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <DateToolsApp mode={resolvePageMode()} />
    </React.StrictMode>,
  );
}
