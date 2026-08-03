#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPORT_TIME_ZONE = 'Asia/Seoul';
export const DEFAULT_REQUESTED_DAYS = 30;
export const MAX_REQUESTED_DAYS = 366;

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultAggregateDirectory = resolve(
  projectRoot,
  process.env.SEARCH_REFERRAL_DIR || '.runtime/search-referrals',
);
const aggregateFilenamePattern = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function parseRequestedDays(value = DEFAULT_REQUESTED_DAYS) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_REQUESTED_DAYS) {
    throw new Error(`Usage: npm run report:search-referrals -- [days from 1 to ${MAX_REQUESTED_DAYS}]`);
  }
  return days;
}

export function calendarDateInTimeZone(date, timeZone = REPORT_TIME_ZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('A valid Date is required.');

  const values = Object.create(null);
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDateForCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError(`Invalid calendar date: ${JSON.stringify(value)}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError(`Invalid calendar date: ${JSON.stringify(value)}`);
  }
  return date;
}

export function calendarDatesEndingOn(endDate, requestedDays) {
  const days = parseRequestedDays(requestedDays);
  const end = utcDateForCalendarDate(endDate);
  const dates = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function emptyAggregate(date) {
  return {
    date,
    searchLandingVisits: 0,
    engines: {},
    pages: {},
  };
}

function validateAggregate(aggregate, expectedDate) {
  if (!aggregate || typeof aggregate !== 'object') {
    throw new Error(`Search referral aggregate for ${expectedDate} must be an object.`);
  }
  if (aggregate.date !== expectedDate) {
    throw new Error(`Search referral aggregate ${expectedDate} contains date ${JSON.stringify(aggregate.date)}.`);
  }
  if (!Number.isInteger(aggregate.searchLandingVisits) || aggregate.searchLandingVisits < 0) {
    throw new Error(`Search referral aggregate ${expectedDate} has an invalid visit count.`);
  }
  for (const field of ['engines', 'pages']) {
    if (!aggregate[field] || typeof aggregate[field] !== 'object' || Array.isArray(aggregate[field])) {
      throw new Error(`Search referral aggregate ${expectedDate} has an invalid ${field} map.`);
    }
  }
  return aggregate;
}

export function fillMissingCalendarDays(dates, aggregates) {
  const byDate = aggregates instanceof Map
    ? aggregates
    : new Map(aggregates.map((aggregate) => [aggregate.date, aggregate]));
  return dates.map((date) => byDate.get(date) ?? emptyAggregate(date));
}

export function recentSearchReferralAverage(rows, maximumDays = 7) {
  if (!Number.isInteger(maximumDays) || maximumDays < 1) {
    throw new TypeError('maximumDays must be a positive integer.');
  }
  const recent = rows.slice(-maximumDays);
  const total = recent.reduce((sum, row) => sum + row.searchLandingVisits, 0);
  return {
    days: recent.length,
    total,
    dailyAverage: recent.length === 0 ? 0 : total / recent.length,
  };
}

function aggregateFieldTotals(rows, field) {
  const totals = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row[field] || {})) {
      totals.set(key, (totals.get(key) || 0) + value);
    }
  }
  return [...totals].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function formatSearchReferralReport({ rows, recordedAggregateCount, timeZone = REPORT_TIME_ZONE }) {
  if (rows.length === 0) throw new Error('The report calendar window must contain at least one day.');

  const lines = [
    `Search-engine referral landing visits (${timeZone} calendar days; cookie-free; not unique visitors or Search Console clicks)`,
    `Calendar window: ${rows[0].date} through ${rows.at(-1).date} (${rows.length} days; missing aggregate dates count as zero)`,
  ];
  const missingDays = rows.length - recordedAggregateCount;
  if (recordedAggregateCount === 0) {
    lines.push('No search referral aggregates were recorded in this calendar window; every day counts as zero.');
  } else if (missingDays > 0) {
    lines.push(`${recordedAggregateCount} day${recordedAggregateCount === 1 ? '' : 's'} had an aggregate; ${missingDays} missing day${missingDays === 1 ? '' : 's'} count as zero.`);
  }

  lines.push('');
  for (const row of rows) lines.push(`${row.date}  ${String(row.searchLandingVisits).padStart(5)} visits`);

  const recent = recentSearchReferralAverage(rows);
  const targetPercentage = recent.dailyAverage / 100 * 100;
  lines.push(
    '',
    `${recent.days}-day calendar average: ${recent.dailyAverage.toFixed(1)} search landing visits/day (${targetPercentage.toFixed(1)}% of the 100/day target)`,
  );

  for (const field of ['engines', 'pages']) {
    lines.push('', `Top ${field}:`);
    const totals = aggregateFieldTotals(rows, field).slice(0, 10);
    if (totals.length === 0) lines.push('    0  (none recorded)');
    else for (const [key, value] of totals) lines.push(`${String(value).padStart(5)}  ${key}`);
  }
  return lines.join('\n');
}

async function readAggregatesForDates(aggregateDirectory, dates) {
  let files;
  try {
    files = await readdir(aggregateDirectory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    files = [];
  }

  const requestedDateSet = new Set(dates);
  const selectedFiles = files
    .map((name) => ({ match: aggregateFilenamePattern.exec(name), name }))
    .filter(({ match }) => match && requestedDateSet.has(match[1]))
    .sort((left, right) => left.name.localeCompare(right.name));
  const aggregates = new Map();
  for (const { match, name } of selectedFiles) {
    const date = match[1];
    const aggregate = JSON.parse(await readFile(resolve(aggregateDirectory, name), 'utf8'));
    aggregates.set(date, validateAggregate(aggregate, date));
  }
  return aggregates;
}

export async function runSearchReferralReport({
  aggregateDirectory = defaultAggregateDirectory,
  now = new Date(),
  requestedDays = DEFAULT_REQUESTED_DAYS,
  write = console.log,
} = {}) {
  const days = parseRequestedDays(requestedDays);
  const endDate = calendarDateInTimeZone(now, REPORT_TIME_ZONE);
  const dates = calendarDatesEndingOn(endDate, days);
  const aggregates = await readAggregatesForDates(aggregateDirectory, dates);
  const rows = fillMissingCalendarDays(dates, aggregates);
  const report = formatSearchReferralReport({
    rows,
    recordedAggregateCount: aggregates.size,
    timeZone: REPORT_TIME_ZONE,
  });
  write(report);
  return { dates, recordedAggregateCount: aggregates.size, report, rows };
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectExecution()) {
  runSearchReferralReport({ requestedDays: process.argv[2] || DEFAULT_REQUESTED_DAYS }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
