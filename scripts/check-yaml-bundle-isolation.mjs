#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_DIST_ROOT = join(PROJECT_ROOT, 'dist');

export const YAML_PAGE_PATHS = Object.freeze([
  'yaml-formatter/index.html',
  'yaml-validator/index.html',
  'yaml-viewer/index.html',
  'yaml-to-json/index.html',
  'json-to-yaml/index.html',
]);

const YAML_WORKER_FILENAME = /^yaml\.worker(?:-[A-Za-z0-9_-]+)?\.js$/i;
const YAML_PARSER_SIGNATURES = Object.freeze([
  {
    label: 'yaml node symbols',
    pattern: /Symbol\.for\(\s*["'`]yaml\.(?:alias|document|map|node\.type|pair|scalar|seq)["'`]\s*\)/,
  },
  { label: 'YAML core tag namespace', pattern: /tag:yaml\.org,2002:/ },
  { label: 'yaml parser error classes', pattern: /\bYAML(?:ParseError|Warning)\b/ },
  {
    label: 'yaml parser diagnostic codes',
    pattern: /\b(?:BAD_ALIAS|BAD_DQ_ESCAPE|BAD_INDENT|BLOCK_AS_IMPLICIT_KEY|MULTILINE_IMPLICIT_KEY|TAG_RESOLVE_FAILED)\b/,
  },
  {
    label: 'yaml CST token vocabulary',
    pattern: /^(?=.*["'`]directives-end["'`])(?=.*["'`]flow-collection["'`])(?=.*["'`]map-value-ind["'`])/s,
  },
]);
const MINIMUM_WORKER_SIGNATURES = 3;

export class YamlBundleIsolationError extends Error {
  constructor(failures) {
    super(`YAML bundle isolation check failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
    this.name = 'YamlBundleIsolationError';
    this.failures = failures;
  }
}

function toPosix(value) {
  return value.split(sep).join('/');
}

function isWithin(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function selectClientRoot(requestedRoot) {
  if (await isFile(join(requestedRoot, YAML_PAGE_PATHS[0]))) return requestedRoot;
  const nestedClient = join(requestedRoot, 'client');
  if (await isFile(join(nestedClient, YAML_PAGE_PATHS[0]))) return nestedClient;
  return requestedRoot;
}

async function walkJavaScriptFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && entry.isDirectory() && (entry.name === 'client' || entry.name === 'server')) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

function parserSignatureLabels(source) {
  return YAML_PARSER_SIGNATURES.filter(({ pattern }) => pattern.test(source)).map(({ label }) => label);
}

function attributeValues(html, attributeName) {
  const values = [];
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  let match;
  while ((match = pattern.exec(html))) values.push(match[1] ?? match[2] ?? match[3] ?? '');
  return values;
}

function scriptSources(html) {
  const sources = [];
  const pattern = /<script\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html))) sources.push(...attributeValues(match[1], 'src'));
  return sources;
}

function localJavaScriptPath(reference, htmlPath, clientRoot) {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  if (!withoutQuery || /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(withoutQuery) || /^[a-z][a-z\d+.-]*:/i.test(withoutQuery)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  const candidate = decoded.startsWith('/')
    ? resolve(clientRoot, `.${decoded}`)
    : resolve(dirname(htmlPath), decoded);
  if (!isWithin(clientRoot, candidate) || !candidate.endsWith('.js')) return null;
  return toPosix(relative(clientRoot, candidate));
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function checkYamlBundleIsolation(distRoot = DEFAULT_DIST_ROOT) {
  const requestedRoot = resolve(distRoot);
  try {
    if (!(await stat(requestedRoot)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new YamlBundleIsolationError([`dist directory is unavailable at ${requestedRoot} (${error.message})`]);
  }

  const clientRoot = await selectClientRoot(requestedRoot);
  const failures = [];
  const jsFiles = await walkJavaScriptFiles(clientRoot);
  const jsByRelativePath = new Map();
  for (const path of jsFiles) {
    jsByRelativePath.set(toPosix(relative(clientRoot, path)), await readFile(path, 'utf8'));
  }

  const workerAssets = [...jsByRelativePath.keys()].filter((path) => YAML_WORKER_FILENAME.test(basename(path)));
  if (workerAssets.length !== 1) {
    failures.push(`expected exactly one hashed or unhashed yaml.worker JavaScript asset, found ${workerAssets.length}`);
  }

  const workerAsset = workerAssets[0] ?? null;
  if (workerAsset) {
    const workerSignatures = parserSignatureLabels(jsByRelativePath.get(workerAsset));
    if (workerSignatures.length < MINIMUM_WORKER_SIGNATURES) {
      failures.push(`${workerAsset}: expected at least ${MINIMUM_WORKER_SIGNATURES} independent yaml parser signatures, found ${workerSignatures.length}`);
    }

    for (const [path, source] of jsByRelativePath) {
      if (path === workerAsset) continue;
      const leakedSignatures = parserSignatureLabels(source);
      if (leakedSignatures.length) {
        failures.push(`${path}: yaml parser implementation leaked outside the dedicated worker (${leakedSignatures.join(', ')})`);
      }
    }
  }

  let expectedScriptAssets = null;
  const uiEntries = [];
  for (const pageRelativePath of YAML_PAGE_PATHS) {
    const pagePath = join(clientRoot, pageRelativePath);
    let html;
    try {
      html = await readFile(pagePath, 'utf8');
    } catch (error) {
      failures.push(`${pageRelativePath}: built HTML is unavailable (${error.message})`);
      continue;
    }

    const scriptAssets = [...new Set(scriptSources(html)
      .map((source) => localJavaScriptPath(source, pagePath, clientRoot))
      .filter(Boolean))].sort();
    if (scriptAssets.length === 0) failures.push(`${pageRelativePath}: no local JavaScript UI entry was found`);
    for (const scriptAsset of scriptAssets) {
      if (!jsByRelativePath.has(scriptAsset)) failures.push(`${pageRelativePath}: referenced JavaScript asset does not exist (${scriptAsset})`);
    }

    if (workerAsset) {
      const allAssetReferences = [...attributeValues(html, 'src'), ...attributeValues(html, 'href')]
        .map((reference) => localJavaScriptPath(reference, pagePath, clientRoot))
        .filter(Boolean);
      if (allAssetReferences.includes(workerAsset)) {
        failures.push(`${pageRelativePath}: HTML must not reference the YAML worker asset directly (${workerAsset})`);
      }

      const workerBasename = basename(workerAsset);
      const pageUiEntries = scriptAssets.filter((asset) => jsByRelativePath.get(asset)?.includes(workerBasename));
      if (pageUiEntries.length !== 1) {
        failures.push(`${pageRelativePath}: expected exactly one UI entry that loads ${workerBasename}, found ${pageUiEntries.length}`);
      } else {
        uiEntries.push(pageUiEntries[0]);
      }
    }

    if (expectedScriptAssets === null) expectedScriptAssets = scriptAssets;
    else if (!sameList(scriptAssets, expectedScriptAssets)) {
      failures.push(`${pageRelativePath}: YAML pages must reference the same UI JavaScript entries`);
    }
  }

  if (uiEntries.length === YAML_PAGE_PATHS.length && new Set(uiEntries).size !== 1) {
    failures.push('the five YAML pages do not reference the same worker-loading UI entry');
  }

  if (failures.length) throw new YamlBundleIsolationError(failures);
  return {
    distRoot: clientRoot,
    workerAsset,
    uiEntry: uiEntries[0],
    checkedJavaScriptAssets: jsByRelativePath.size,
    checkedPages: YAML_PAGE_PATHS.length,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || argv[0] === '--help' || argv[0] === '-h') {
    console.log('Usage: node scripts/check-yaml-bundle-isolation.mjs [dist-directory]');
    return argv.length > 1 ? 1 : 0;
  }
  try {
    const result = await checkYamlBundleIsolation(argv[0] || process.env.DIST_DIR || DEFAULT_DIST_ROOT);
    console.log(`YAML bundle isolation passed: ${result.workerAsset} is worker-only; ${result.checkedPages} pages share ${result.uiEntry}.`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}
