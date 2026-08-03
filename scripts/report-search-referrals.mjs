#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const aggregateDirectory = resolve(projectRoot, process.env.SEARCH_REFERRAL_DIR || '.runtime/search-referrals');
const requestedDays = Number(process.argv[2] || 30);
if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 366) {
  throw new Error('Usage: npm run report:search-referrals -- [days from 1 to 366]');
}

let files;
try {
  files = (await readdir(aggregateDirectory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  files = [];
}

const rows = [];
for (const name of files.slice(-requestedDays)) {
  const aggregate = JSON.parse(await readFile(resolve(aggregateDirectory, name), 'utf8'));
  rows.push(aggregate);
}

console.log('Search-engine referral landing visits (Asia/Seoul days; cookie-free; not unique visitors or Search Console clicks)');
if (rows.length === 0) {
  console.log('No search referral aggregates have been recorded yet.');
  process.exit(0);
}

for (const row of rows) console.log(`${row.date}  ${String(row.searchLandingVisits).padStart(5)} visits`);
const recent = rows.slice(-7);
const recentTotal = recent.reduce((sum, row) => sum + row.searchLandingVisits, 0);
const dailyAverage = recentTotal / recent.length;
console.log(`\n${recent.length}-day average: ${dailyAverage.toFixed(1)} search landing visits/day (${(dailyAverage / 100 * 100).toFixed(1)}% of the 100/day target)`);

for (const field of ['engines', 'pages']) {
  const totals = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row[field] || {})) totals.set(key, (totals.get(key) || 0) + value);
  }
  console.log(`\nTop ${field}:`);
  for (const [key, value] of [...totals].sort((left, right) => right[1] - left[1]).slice(0, 10)) {
    console.log(`${String(value).padStart(5)}  ${key}`);
  }
}
