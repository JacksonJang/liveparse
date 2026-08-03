#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateClaimedCrawlerAggregate } from '../server/search-crawlers.js';

export const REPORT_TIME_ZONE = 'Asia/Seoul';
export const DEFAULT_REQUESTED_DAYS = 30;
export const MAX_REQUESTED_DAYS = 366;

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultAggregateDirectory = resolve(
  projectRoot,
  process.env.SEARCH_CRAWLER_DIR || '.runtime/search-crawlers',
);
const aggregateFilenamePattern = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function parseRequestedDays(value = DEFAULT_REQUESTED_DAYS) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_REQUESTED_DAYS) {
    throw new Error(`Usage: node scripts/report-search-crawlers.mjs [days from 1 to ${MAX_REQUESTED_DAYS}]`);
  }
  return days;
}

export function calendarDateInTimeZone(date, timeZone = REPORT_TIME_ZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('A valid Date is required.');
  const values = Object.create(null);
  for (const part of new Intl.DateTimeFormat('en-GB', {
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

function unobservedRow(date) {
  return {
    date,
    observed: false,
    observedHours: [],
    claimedCrawlerRequests: null,
    crawlers: {},
    pages: {},
  };
}

export function fillUnobservedCalendarDays(dates, aggregates) {
  const byDate = aggregates instanceof Map
    ? aggregates
    : new Map(aggregates.map((aggregate) => [aggregate.date, aggregate]));
  return dates.map((date) => {
    const aggregate = byDate.get(date);
    return aggregate ? { ...aggregate, observed: true } : unobservedRow(date);
  });
}

function aggregateFieldTotals(rows, field) {
  const totals = new Map();
  for (const row of rows) {
    if (!row.observed) continue;
    for (const [key, value] of Object.entries(row[field] || {})) {
      totals.set(key, (totals.get(key) || 0) + value);
    }
  }
  return [...totals].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function formatClaimedCrawlerReport({ rows, recordedAggregateCount, timeZone = REPORT_TIME_ZONE }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('The crawler report calendar window must contain at least one day.');
  }
  const observedRows = rows.filter((row) => row.observed);
  const unobservedDays = rows.length - observedRows.length;
  const observedHourCount = observedRows.reduce((total, row) => total + row.observedHours.length, 0);
  const claimedRequestTotal = observedRows.reduce((total, row) => total + row.claimedCrawlerRequests, 0);
  const lines = [
    `Claimed search-crawler requests (${timeZone} calendar days; cookie-free aggregate telemetry)`,
    'Identity warning: crawler names are classified only from unverified User-Agent claims; they are not authenticated crawler identities.',
    `Calendar window: ${rows[0].date} through ${rows.at(-1).date} (${rows.length} days)`,
    `Coverage: ${recordedAggregateCount} observed day${recordedAggregateCount === 1 ? '' : 's'}, ${unobservedDays} unobserved day${unobservedDays === 1 ? '' : 's'}, ${observedHourCount}/${rows.length * 24} hourly heartbeat buckets observed.`,
    '',
  ];

  for (const row of rows) {
    if (!row.observed) {
      lines.push(`${row.date}  UNOBSERVED  heartbeat: unobserved  claimed requests: unobserved`);
      continue;
    }
    const hours = row.observedHours.join(', ');
    lines.push(
      `${row.date}  observed  heartbeat: ${String(row.observedHours.length).padStart(2)}/24 hour${row.observedHours.length === 1 ? '' : 's'} ` +
      `(${hours})  claimed requests: ${String(row.claimedCrawlerRequests).padStart(5)}`,
    );
  }

  lines.push('', `Total claimed crawler requests on observed days: ${claimedRequestTotal}`);
  for (const [field, label] of [['crawlers', 'Claimed crawler totals'], ['pages', 'Canonical page totals']]) {
    lines.push('', `${label}:`);
    const totals = aggregateFieldTotals(rows, field);
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
    let parsed;
    try {
      parsed = JSON.parse(await readFile(resolve(aggregateDirectory, name), 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read claimed crawler aggregate ${name}: ${error.message}`);
    }
    try {
      aggregates.set(date, validateClaimedCrawlerAggregate(parsed, date));
    } catch (error) {
      throw new Error(`Invalid claimed crawler aggregate ${name}: ${error.message}`);
    }
  }
  return aggregates;
}

export async function runClaimedCrawlerReport({
  aggregateDirectory = defaultAggregateDirectory,
  now = new Date(),
  requestedDays = DEFAULT_REQUESTED_DAYS,
  write = console.log,
} = {}) {
  const days = parseRequestedDays(requestedDays);
  const endDate = calendarDateInTimeZone(now, REPORT_TIME_ZONE);
  const dates = calendarDatesEndingOn(endDate, days);
  const aggregates = await readAggregatesForDates(aggregateDirectory, dates);
  const rows = fillUnobservedCalendarDays(dates, aggregates);
  const report = formatClaimedCrawlerReport({
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
  runClaimedCrawlerReport({ requestedDays: process.argv[2] || DEFAULT_REQUESTED_DAYS }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
