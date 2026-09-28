#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TOOL_DIRS = [
  'json-formatter', 'sql-formatter', 'uuid-generator', 'word-counter',
  'base64-decoder', 'base64-encoder', 'jwt-decoder', 'regex-tester',
  'image-compressor', 'image-resizer', 'discord-timestamp-generator',
  'url-encoder', 'url-decoder', 'url-parser', 'xml-formatter',
  'yaml-formatter', 'json-repair', 'json-compare', 'json-to-csv',
  'csv-to-json', 'json-to-yaml', 'yaml-to-json', 'hash-generator',
  'md5-generator', 'sha256-generator', 'character-counter',
  'binary-converter', 'hex-converter', 'binary-translator',
  'morse-code-translator', 'ascii-table', 'file-checksum',
  'jwt-expiration-checker', 'query-string-parser', 'uuid-decoder',
  'uuid-validator', 'uuid-v4-generator', 'uuid-v7-generator',
  'png-to-jpg', 'webp-to-jpg', 'webp-to-png', 'age-calculator',
  'date-calculator', 'days-between-dates', 'business-days-calculator',
  'time-duration-calculator', 'week-number-calculator', 'birthday-countdown',
  'xml-validator', 'xml-viewer', 'yaml-validator', 'yaml-viewer',
  'jsonl-parser', 'sql-server-formatter', 'mysql-sql-formatter',
  'postgresql-sql-formatter', 'bigquery-sql-formatter',
  'unix-timestamp-converter',
];

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/);
  if (!match) return '';
  return stripTags(match[1]).replace(/\s*\|.*$/, '').trim();
}

function extractSteps(html) {
  const olMatch = html.match(/<ol class="steps-grid">([\s\S]*?)<\/ol>/);
  if (!olMatch) return [];
  const steps = [];
  const liRegex = /<li>[\s\S]*?<\/li>/g;
  let liMatch;
  while ((liMatch = liRegex.exec(olMatch[1])) !== null) {
    const nameMatch = liMatch[0].match(/<h3>([^<]+)<\/h3>/);
    const textMatch = liMatch[0].match(/<p>([\s\S]*?)<\/p>/);
    if (nameMatch) {
      steps.push({
        name: stripTags(nameMatch[1]),
        text: textMatch ? stripTags(textMatch[1]) : '',
      });
    }
  }
  return steps;
}

function buildHowTo(toolDir, title, steps) {
  const url = `https://liveparse.com/${toolDir}/`;
  return {
    '@type': 'HowTo',
    '@id': `${url}#howto`,
    name: `How to use the ${title}`,
    description: `Step-by-step instructions for using the LiveParse ${title}.`,
    totalTime: 'PT1M',
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
      url: `${url}#step-${i + 1}`,
    })),
  };
}

function insertHowTo(html, howTo) {
  const howToJson = JSON.stringify(howTo, null, 2);

  // Find the </script> tag that follows the JSON-LD block
  const scriptCloseIndex = html.indexOf('</script>', html.indexOf('application/ld+json'));
  if (scriptCloseIndex === -1) return { added: false, reason: 'no JSON-LD script close found' };

  // Walk backwards from </script> to find the last ] that closes @graph
  let searchBack = html.lastIndexOf(']', scriptCloseIndex);
  if (searchBack === -1) return { added: false, reason: 'no closing bracket found before </script>' };

  // Insert the HowTo object before this closing bracket
  const before = html.slice(0, searchBack);
  const after = html.slice(searchBack);

  // Check if there's already a comma or if we need to add one
  const trimmedBefore = before.replace(/\s+$/, '');
  if (trimmedBefore.endsWith('}') || trimmedBefore.endsWith(']')) {
    return {
      added: true,
      html: before + ',\n          ' + howToJson + after,
    };
  }
  return { added: false, reason: 'unexpected JSON structure before closing bracket' };
}

async function main() {
  let added = 0;
  let skipped = 0;
  const results = [];

  for (const toolDir of TOOL_DIRS) {
    const filePath = resolve(PROJECT_ROOT, toolDir, 'index.html');
    let html;
    try {
      html = await readFile(filePath, 'utf-8');
    } catch {
      results.push({ tool: toolDir, status: 'no-file' });
      skipped++;
      continue;
    }

    if (html.includes('"HowTo"')) {
      results.push({ tool: toolDir, status: 'already-has' });
      skipped++;
      continue;
    }

    const steps = extractSteps(html);
    if (steps.length === 0) {
      results.push({ tool: toolDir, status: 'no-steps' });
      skipped++;
      continue;
    }

    const title = extractTitle(html);
    const howTo = buildHowTo(toolDir, title, steps);
    const result = insertHowTo(html, howTo);

    if (result.added) {
      await writeFile(filePath, result.html, 'utf-8');
      results.push({ tool: toolDir, status: 'added', steps: steps.length });
      added++;
    } else {
      results.push({ tool: toolDir, status: result.reason });
      skipped++;
    }
  }

  console.log(`HowTo schema: ${added} added, ${skipped} skipped`);
  for (const r of results) {
    console.log(`  ${r.tool}: ${r.status}${r.steps ? ` (${r.steps} steps)` : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
