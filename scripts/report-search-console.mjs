#!/usr/bin/env node
// Rank click-through opportunities from a Google Search Console Performance export.
// Usage: node scripts/report-search-console.mjs <export.zip | directory | Pages.csv> [--min-impressions 20] [--max-position 20]
// The export is produced by Search Console → Performance → Export → Download CSV (a zip with Pages.csv, Queries.csv, ...).

import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell !== ''));
}

function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[%,\s]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

export function parsePerformanceRows(source) {
  const rows = parseCsv(source.replace(/^﻿/, ''));
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase().replace(/\s+/g, ''));
  const keyIndex = 0;
  const clicks = header.findIndex((h) => h === 'clicks' || h === '클릭수' || h === '클릭');
  const impressions = header.findIndex((h) => h === 'impressions' || h === '노출수' || h === '노출');
  const ctr = header.findIndex((h) => h === 'ctr' || h === '클릭률');
  const position = header.findIndex((h) => h === 'position' || h.endsWith('게재순위'));
  if (clicks < 0 || impressions < 0) throw new Error(`Unrecognized Search Console header: ${rows[0].join(', ')}`);
  return rows.slice(1).map((cells) => {
    const impressionCount = toNumber(cells[impressions]);
    const clickCount = toNumber(cells[clicks]);
    return {
      key: cells[keyIndex],
      clicks: clickCount,
      impressions: impressionCount,
      ctr: ctr >= 0 ? toNumber(cells[ctr]) / 100 : impressionCount ? clickCount / impressionCount : 0,
      position: position >= 0 ? toNumber(cells[position]) : 0,
    };
  });
}

// Expected CTR by average position, a conservative published-curve approximation used only for ranking opportunities.
export function expectedCtr(position) {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.10;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.03;
  if (position <= 20) return 0.01;
  return 0.003;
}

export function rankOpportunities(rows, { minImpressions = 20, maxPosition = 20 } = {}) {
  return rows
    .filter((row) => row.impressions >= minImpressions && row.position > 0 && row.position <= maxPosition)
    .map((row) => {
      const expected = expectedCtr(row.position);
      const missedClicks = Math.max(0, row.impressions * expected - row.clicks);
      return { ...row, expectedCtr: expected, missedClicks };
    })
    .sort((a, b) => b.missedClicks - a.missedClicks || b.impressions - a.impressions);
}

function formatTable(title, rows, limit) {
  const lines = [`${title}`, '  missed  impr  clicks   ctr   pos  key'];
  for (const row of rows.slice(0, limit)) {
    lines.push(
      `  ${row.missedClicks.toFixed(1).padStart(6)}  ${String(row.impressions).padStart(4)}  ${String(row.clicks).padStart(6)}  ${(row.ctr * 100).toFixed(1).padStart(4)}%  ${row.position.toFixed(1).padStart(4)}  ${row.key}`,
    );
  }
  if (rows.length === 0) lines.push('  (no rows met the thresholds)');
  return lines.join('\n');
}

async function collectCsvFiles(input) {
  const target = resolve(input);
  const info = await stat(target);
  if (info.isDirectory()) {
    return (await readdir(target)).filter((name) => name.toLowerCase().endsWith('.csv')).map((name) => join(target, name));
  }
  if (target.toLowerCase().endsWith('.zip')) {
    const directory = await mkdtemp(join(tmpdir(), 'gsc-export-'));
    await execFileAsync('unzip', ['-q', '-o', target, '-d', directory]);
    const files = await collectCsvFiles(directory);
    return files.map((file) => ({ file, cleanup: directory }));
  }
  return [target];
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith('--'));
  if (!input) {
    console.error('Usage: node scripts/report-search-console.mjs <export.zip | directory | Pages.csv> [--min-impressions N] [--max-position N] [--limit N]');
    process.exitCode = 1;
    return;
  }
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
  };
  const thresholds = { minImpressions: option('--min-impressions', 20), maxPosition: option('--max-position', 20) };
  const limit = option('--limit', 25);

  const entries = await collectCsvFiles(input);
  let cleanup = null;
  const files = entries.map((entry) => { if (typeof entry === 'object') { cleanup = entry.cleanup; return entry.file; } return entry; });
  try {
    for (const file of files) {
      const name = basename(file).toLowerCase();
      if (!/(page|querie|query|검색어|페이지)/.test(name)) continue;
      const rows = parsePerformanceRows(await readFile(file, 'utf8'));
      const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
      const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
      console.log(`\n${basename(file)}: ${rows.length} rows, ${totalImpressions} impressions, ${totalClicks} clicks (${totalImpressions ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00'}% CTR)`);
      console.log(formatTable('Biggest click-through gaps (impressions >= ' + thresholds.minImpressions + ', position <= ' + thresholds.maxPosition + '):', rankOpportunities(rows, thresholds), limit));
    }
  } finally {
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
