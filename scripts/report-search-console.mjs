#!/usr/bin/env node
// Rank click-through opportunities from a Google Search Console Performance export.
// Usage: node scripts/report-search-console.mjs <export.zip | directory | Pages.csv> [--compare previous-export.zip] [--min-impressions 20] [--max-position 20]
// The export is produced by Search Console → Performance → Export → Download CSV (a zip with Pages.csv, Queries.csv, ...).

import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function zipExtractionCommand(target, directory, platformName = platform()) {
  return platformName === 'darwin'
    ? { command: 'ditto', args: ['-x', '-k', target, directory] }
    : { command: 'unzip', args: ['-q', '-o', target, '-d', directory] };
}

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

export function parseExportFilters(source) {
  const rows = parseCsv(source.replace(/^﻿/, ''));
  if (rows.length < 2) return {};
  return Object.fromEntries(rows.slice(1)
    .filter((cells) => cells[0]?.trim())
    .map((cells) => [cells[0].trim().toLowerCase(), String(cells[1] ?? '').trim()]));
}

export function summarizePerformanceRows(rows) {
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const positionedImpressions = rows.reduce(
    (sum, row) => sum + (row.position > 0 ? row.impressions : 0),
    0,
  );
  const weightedPosition = positionedImpressions
    ? rows.reduce((sum, row) => sum + (row.position > 0 ? row.impressions * row.position : 0), 0) / positionedImpressions
    : 0;
  return {
    clicks,
    ctr: impressions ? clicks / impressions : 0,
    impressions,
    weightedPosition,
  };
}

export function summarizeVisibilityBands(rows) {
  const visibleRows = rows.filter((row) => row.impressions > 0 && row.position > 0);
  const impressionsAtOrAbove = (maximumPosition) => visibleRows
    .filter((row) => row.position <= maximumPosition)
    .reduce((sum, row) => sum + row.impressions, 0);
  const totalImpressions = visibleRows.reduce((sum, row) => sum + row.impressions, 0);
  const top10Impressions = impressionsAtOrAbove(10);
  const top20Impressions = impressionsAtOrAbove(20);
  return {
    beyond20Impressions: totalImpressions - top20Impressions,
    top10Impressions,
    top20Impressions,
  };
}

export function comparePerformanceRows(currentRows, previousRows) {
  const previousByKey = new Map(previousRows.map((row) => [row.key, row]));
  const matches = currentRows
    .filter((row) => {
      const previous = previousByKey.get(row.key);
      return previous && row.impressions > 0 && row.position > 0 && previous.position > 0;
    })
    .map((current) => {
      const previous = previousByKey.get(current.key);
      return {
        current,
        positionImprovement: previous.position - current.position,
        previous,
      };
    })
    .sort((a, b) => b.current.impressions - a.current.impressions || a.current.key.localeCompare(b.current.key));
  const currentImpressions = matches.reduce((sum, match) => sum + match.current.impressions, 0);
  const weightedPositionImprovement = currentImpressions
    ? matches.reduce((sum, match) => sum + match.current.impressions * match.positionImprovement, 0) / currentImpressions
    : 0;
  return { currentImpressions, matches, weightedPositionImprovement };
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

function fileRole(name) {
  const normalized = name.toLowerCase();
  if (/(^|[^a-z])(filters?|필터)([^a-z]|$)/.test(normalized)) return 'filters';
  if (/(^|[^a-z])(chart|차트)([^a-z]|$)/.test(normalized)) return 'chart';
  if (/(pages?|페이지)/.test(normalized)) return 'pages';
  if (/(queries|query|검색어)/.test(normalized)) return 'queries';
  return null;
}

function exportPeriod(filters) {
  return filters.date || filters['date range'] || filters['날짜'] || filters['기간'] || 'unknown';
}

function formatSummary(summary) {
  return `${summary.impressions} impressions, ${summary.clicks} clicks, ${(summary.ctr * 100).toFixed(2)}% CTR, average position ${summary.weightedPosition.toFixed(2)}`;
}

function formatSigned(value, digits) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatComparison(title, comparison, limit) {
  const lines = [
    `${title}: ${comparison.matches.length} overlapping rows, ${comparison.currentImpressions} current impressions, ${comparison.weightedPositionImprovement >= 0 ? '+' : ''}${comparison.weightedPositionImprovement.toFixed(2)} positions (positive means better)`,
    '  current  previous   change  key',
  ];
  for (const match of comparison.matches.slice(0, limit)) {
    lines.push(
      `  ${match.current.position.toFixed(1).padStart(7)}  ${match.previous.position.toFixed(1).padStart(8)}  ${formatSigned(match.positionImprovement, 1).padStart(7)}  ${match.current.key}`,
    );
  }
  if (comparison.matches.length === 0) lines.push('  (no overlapping rows with impressions and positions)');
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
    const extraction = zipExtractionCommand(target, directory);
    await execFileAsync(extraction.command, extraction.args);
    const files = await collectCsvFiles(directory);
    return files.map((file) => ({ file, cleanup: directory }));
  }
  return [target];
}

async function loadExport(input) {
  const entries = await collectCsvFiles(input);
  const cleanupDirectories = new Set();
  const files = entries.map((entry) => {
    if (typeof entry === 'object') {
      cleanupDirectories.add(entry.cleanup);
      return entry.file;
    }
    return entry;
  });
  try {
    const loaded = await Promise.all(files.map(async (file) => ({
      name: basename(file),
      role: fileRole(basename(file)),
      source: await readFile(file, 'utf8'),
    })));
    const byRole = new Map(loaded.filter((file) => file.role).map((file) => [file.role, file]));
    const filters = byRole.has('filters') ? parseExportFilters(byRole.get('filters').source) : {};
    const rows = (role) => byRole.has(role) ? parsePerformanceRows(byRole.get(role).source) : [];
    return {
      chartRows: rows('chart'),
      filters,
      pagesRows: rows('pages'),
      period: exportPeriod(filters),
      queriesRows: rows('queries'),
    };
  } finally {
    await Promise.all([...cleanupDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  }
}

function printExport(report, thresholds, limit, label = 'Export') {
  console.log(`\n${label}: period ${report.period}`);
  if (report.chartRows.length > 0) {
    console.log(`Property chart total: ${formatSummary(summarizePerformanceRows(report.chartRows))}`);
  } else {
    console.log('Property chart total: unavailable');
  }
  for (const [name, rows] of [['Queries', report.queriesRows], ['Pages', report.pagesRows]]) {
    const summary = summarizePerformanceRows(rows);
    const visibility = summarizeVisibilityBands(rows);
    console.log(`\n${name} table row sum: ${rows.length} rows, ${formatSummary(summary)}`);
    console.log(`Average-position visibility: top 10 = ${visibility.top10Impressions} impressions, top 20 = ${visibility.top20Impressions} impressions, beyond 20 = ${visibility.beyond20Impressions} impressions.`);
    console.log(formatTable('Biggest click-through gaps (impressions >= ' + thresholds.minImpressions + ', position <= ' + thresholds.maxPosition + '):', rankOpportunities(rows, thresholds), limit));
  }
  console.log('\nNote: visibility bands classify each row by its average position; they are not an exact per-impression rank distribution. Query and page row sums are dimension totals, not the property chart total. Rare queries can be omitted, and multiple page results can make page impressions exceed the property total.');
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith('--'));
  if (!input) {
    console.error('Usage: node scripts/report-search-console.mjs <export.zip | directory | Pages.csv> [--compare previous-export.zip] [--min-impressions N] [--max-position N] [--limit N]');
    process.exitCode = 1;
    return;
  }
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
  };
  const thresholds = { minImpressions: option('--min-impressions', 20), maxPosition: option('--max-position', 20) };
  const limit = option('--limit', 25);
  const compareIndex = args.indexOf('--compare');
  const compareInput = compareIndex >= 0 ? args[compareIndex + 1] : null;
  if (compareIndex >= 0 && (!compareInput || compareInput.startsWith('--'))) {
    throw new Error('--compare requires a previous Search Console export path.');
  }

  const current = await loadExport(input);
  printExport(current, thresholds, limit, 'Current export');
  if (compareInput) {
    const previous = await loadExport(compareInput);
    printExport(previous, thresholds, limit, 'Previous export');
    if (current.period !== previous.period) {
      console.warn(`\nWARNING: period mismatch (${current.period} vs ${previous.period}). Do not compare total clicks, impressions, or CTR directly.`);
    } else if (current.chartRows.length > 0 && previous.chartRows.length > 0) {
      const currentChart = summarizePerformanceRows(current.chartRows);
      const previousChart = summarizePerformanceRows(previous.chartRows);
      console.log(`\nProperty chart change: ${formatSigned(currentChart.impressions - previousChart.impressions, 0)} impressions, ${formatSigned(currentChart.weightedPosition - previousChart.weightedPosition, 2)} average-position value (negative is better).`);
    }
    console.log(`\n${formatComparison('Same-query position comparison', comparePerformanceRows(current.queriesRows, previous.queriesRows), limit)}`);
    console.log(`\n${formatComparison('Same-page position comparison', comparePerformanceRows(current.pagesRows, previous.pagesRows), limit)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
