#!/usr/bin/env node

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANONICAL_ORIGIN = 'https://liveparse.com';
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_ROOT = resolve(process.argv[2] || process.env.DIST_DIR || join(PROJECT_ROOT, 'dist'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['gt', '>'],
    ['lt', '<'],
    ['nbsp', ' '],
    ['quot', '"'],
  ]);
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const hexadecimal = name[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return named.get(name.toLowerCase()) ?? entity;
  });
}

function parseAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function openingTags(html, name) {
  const matches = [];
  const pattern = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  let match;
  while ((match = pattern.exec(html))) matches.push(parseAttributes(match[1]));
  return matches;
}

function elementContents(html, name) {
  const matches = [];
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
  let match;
  while ((match = pattern.exec(html))) matches.push(match[1]);
  return matches;
}

function plainText(fragment) {
  return decodeEntities(fragment.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function visibleText(html) {
  const body = elementContents(html, 'body')[0] ?? html;
  return plainText(
    body
      .replace(/<(script|style|template|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(script|style|template|svg|noscript)\b[^>]*\/\s*>/gi, ' '),
  );
}

function titleValues(html) {
  return elementContents(html, 'title').map(plainText).filter(Boolean);
}

function descriptionValues(html) {
  return openingTags(html, 'meta')
    .filter((attributes) => attributes.get('name')?.toLowerCase() === 'description')
    .map((attributes) => attributes.get('content')?.trim() || '')
    .filter(Boolean);
}

function canonicalValues(html) {
  return openingTags(html, 'link')
    .filter((attributes) => (attributes.get('rel') || '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((attributes) => attributes.get('href')?.trim() || '')
    .filter(Boolean);
}

function h1Values(html) {
  return elementContents(html, 'h1').map(plainText).filter(Boolean);
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attributes = parseAttributes(match[1]);
    if ((attributes.get('type') || '').toLowerCase() === 'application/ld+json') blocks.push(match[2].trim());
  }
  return blocks;
}

function validateJsonLd(html, label, required = false) {
  const blocks = jsonLdBlocks(html);
  if (required && blocks.length === 0) fail(`${label}: at least one JSON-LD block is required`);
  blocks.forEach((block, index) => {
    if (!block) {
      fail(`${label}: JSON-LD block ${index + 1} is empty`);
      return;
    }
    try {
      const parsed = JSON.parse(block);
      if (parsed === null || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
        fail(`${label}: JSON-LD block ${index + 1} must contain an object or array`);
      }
    } catch (error) {
      fail(`${label}: JSON-LD block ${index + 1} is invalid JSON (${error.message})`);
    }
  });
}

function validatePageBasics(html, label, expectedCanonical, { minimumCharacters = 200 } = {}) {
  const titles = titleValues(html);
  if (titles.length !== 1) fail(`${label}: expected exactly one non-empty <title>, found ${titles.length}`);
  else {
    if (!/json/i.test(titles[0])) fail(`${label}: title must mention JSON`);
    if (titles[0].length < 15 || titles[0].length > 90) fail(`${label}: title should be 15-90 characters`);
  }

  const descriptions = descriptionValues(html);
  if (descriptions.length !== 1) fail(`${label}: expected exactly one meta description, found ${descriptions.length}`);
  else {
    if (!/json/i.test(descriptions[0])) fail(`${label}: meta description must mention JSON`);
    if (descriptions[0].length < 50 || descriptions[0].length > 200) {
      fail(`${label}: meta description should be 50-200 characters`);
    }
  }

  const canonicals = canonicalValues(html);
  if (canonicals.length !== 1) fail(`${label}: expected exactly one canonical link, found ${canonicals.length}`);
  else {
    try {
      const canonical = new URL(canonicals[0]);
      if (canonical.href !== expectedCanonical) {
        fail(`${label}: canonical is ${canonical.href}, expected ${expectedCanonical}`);
      }
    } catch {
      fail(`${label}: canonical is not an absolute URL (${JSON.stringify(canonicals[0])})`);
    }
  }

  const headings = h1Values(html);
  if (headings.length !== 1) fail(`${label}: expected exactly one non-empty H1, found ${headings.length}`);
  else if (!/json/i.test(headings[0])) fail(`${label}: H1 must mention JSON`);

  const text = visibleText(html);
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  if (text.length < minimumCharacters || words.length < 30) {
    fail(`${label}: visible static copy is too thin (${text.length} characters, ${words.length} words)`);
  }
  if (!/json/i.test(text) || !/pars(?:e|er|ing)/i.test(text)) {
    fail(`${label}: visible static copy must explain JSON parsing`);
  }

}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  await visit(root);
  return files;
}

function publicPathForHtml(relativePath) {
  const normalized = relativePath.split(sep).join('/');
  if (normalized === 'index.html') return '/';
  if (normalized.endsWith('/index.html')) return `/${normalized.slice(0, -'index.html'.length)}`;
  return `/${normalized}`;
}

function isGuideHtml(relativePath) {
  const normalized = relativePath.split(sep).join('/').toLowerCase();
  return /(?:^|[\/_-])(?:guide|guides|tutorial|tutorials)(?:[\/_.-]|$)/.test(normalized);
}

async function staticFileForUrl(distRoot, url) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!decodedPath.startsWith('/') || decodedPath.includes('\0') || decodedPath.includes('\\')) return null;
  if (decodedPath.split('/').some((segment) => segment === '..')) return null;

  let candidate = resolve(distRoot, decodedPath.slice(1));
  if (!isWithin(distRoot, candidate)) return null;
  try {
    let fileStat = await stat(candidate);
    if (fileStat.isDirectory()) {
      candidate = join(candidate, 'index.html');
      fileStat = await stat(candidate);
    }
    if (!fileStat.isFile()) return null;
    const realCandidate = await realpath(candidate);
    return isWithin(distRoot, realCandidate) ? realCandidate : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function extractLinks(html) {
  return openingTags(html, 'a').map((attributes) => attributes.get('href')?.trim() || '').filter(Boolean);
}

function normalizeUrl(value, base, label) {
  try {
    return new URL(value, base);
  } catch {
    fail(`${label}: invalid URL ${JSON.stringify(value)}`);
    return null;
  }
}

async function readRequired(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    fail(`${label}: cannot read ${path} (${error.message})`);
    return null;
  }
}

async function main() {
  let distRoot;
  try {
    distRoot = await realpath(DIST_ROOT);
    if (!(await stat(distRoot)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    console.error(`SEO smoke check failed: dist directory is unavailable at ${DIST_ROOT} (${error.message})`);
    process.exitCode = 1;
    return;
  }

  const allFiles = await walkFiles(distRoot);
  const htmlFiles = allFiles.filter((path) => path.toLowerCase().endsWith('.html'));
  const htmlByPath = new Map();
  for (const path of htmlFiles) htmlByPath.set(path, await readFile(path, 'utf8'));

  const homepagePath = join(distRoot, 'index.html');
  const homepage = htmlByPath.get(homepagePath) ?? (await readRequired(homepagePath, 'homepage'));
  if (homepage !== null) {
    validatePageBasics(homepage, 'homepage', `${CANONICAL_ORIGIN}/`);
    const homepageTitle = titleValues(homepage)[0] || '';
    const homepageH1 = h1Values(homepage)[0] || '';
    if (!/\bjson\s+parser\b/i.test(homepageTitle)) fail('homepage: title must target the phrase "JSON Parser"');
    if (!/\bjson\s+parser\b/i.test(homepageH1)) fail('homepage: H1 must target the phrase "JSON Parser"');
  }

  const robotsPath = join(distRoot, 'robots.txt');
  const sitemapPath = join(distRoot, 'sitemap.xml');
  const [robots, sitemap] = await Promise.all([
    readRequired(robotsPath, 'robots.txt'),
    readRequired(sitemapPath, 'sitemap.xml'),
  ]);

  const expectedSitemapUrl = `${CANONICAL_ORIGIN}/sitemap.xml`;
  if (robots !== null) {
    if (!/^\s*user-agent\s*:/im.test(robots)) fail('robots.txt: missing User-agent directive');
    if (/^\s*disallow\s*:\s*\/\s*(?:#.*)?$/im.test(robots)) fail('robots.txt: the entire site is disallowed');
    const declaredSitemaps = [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)].map((match) => match[1]);
    if (!declaredSitemaps.includes(expectedSitemapUrl)) {
      fail(`robots.txt: must declare ${expectedSitemapUrl}`);
    }
    for (const declaredSitemap of declaredSitemaps) {
      if (declaredSitemap !== expectedSitemapUrl) {
        fail(`robots.txt: non-canonical sitemap declaration ${declaredSitemap}`);
      }
    }
  }

  const sitemapUrls = [];
  const sitemapUrlSet = new Set();
  if (sitemap !== null) {
    if (!/<urlset\b/i.test(sitemap)) fail('sitemap.xml: missing <urlset> root');
    const locations = [...sitemap.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map((match) => plainText(match[1]));
    if (locations.length === 0) fail('sitemap.xml: contains no <loc> URLs');

    for (const location of locations) {
      let url;
      try {
        url = new URL(location);
      } catch {
        fail(`sitemap.xml: invalid URL ${JSON.stringify(location)}`);
        continue;
      }
      if (url.origin !== CANONICAL_ORIGIN || url.protocol !== 'https:') {
        fail(`sitemap.xml: non-canonical URL ${url.href}`);
      }
      if (url.search || url.hash) fail(`sitemap.xml: URL must not contain a query or fragment (${url.href})`);
      if (sitemapUrlSet.has(url.href)) fail(`sitemap.xml: duplicate URL ${url.href}`);
      sitemapUrlSet.add(url.href);
      sitemapUrls.push(url);

      const staticFile = await staticFileForUrl(distRoot, url);
      if (!staticFile) {
        fail(`sitemap.xml: ${url.href} has no corresponding static file`);
        continue;
      }
      if (staticFile.toLowerCase().endsWith('.html')) {
        const page = htmlByPath.get(staticFile) ?? (await readFile(staticFile, 'utf8'));
        const canonicals = canonicalValues(page);
        if (canonicals.length === 1 && normalizeUrl(canonicals[0], CANONICAL_ORIGIN, staticFile)?.href !== url.href) {
          fail(`sitemap.xml: ${url.href} does not match its page canonical ${canonicals[0]}`);
        }
      }
    }
    if (!sitemapUrlSet.has(`${CANONICAL_ORIGIN}/`)) fail('sitemap.xml: homepage URL is missing');
  }

  const guideFiles = htmlFiles.filter((path) => isGuideHtml(relative(distRoot, path)));
  const expectedGuideUrls = new Map();
  for (const path of guideFiles) {
    const publicPath = publicPathForHtml(relative(distRoot, path));
    const expectedUrl = new URL(publicPath, CANONICAL_ORIGIN).href;
    expectedGuideUrls.set(expectedUrl, path);
    validatePageBasics(htmlByPath.get(path), `guide ${publicPath}`, expectedUrl);
    if (!sitemapUrlSet.has(expectedUrl)) fail(`guide ${publicPath}: missing from sitemap.xml`);
  }

  const inboundGuideLinks = new Map([...expectedGuideUrls.keys()].map((url) => [url, 0]));
  let internalLinkCount = 0;
  const checkedTargets = new Map();
  for (const [path, html] of htmlByPath) {
    const sourcePublicPath = publicPathForHtml(relative(distRoot, path));
    const sourceUrl = new URL(sourcePublicPath, CANONICAL_ORIGIN);
    for (const href of extractLinks(html)) {
      if (/^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      const target = normalizeUrl(href, sourceUrl, `page ${sourcePublicPath}`);
      if (!target || target.origin !== CANONICAL_ORIGIN) continue;
      internalLinkCount += 1;
      const targetWithoutFragment = new URL(target.href);
      targetWithoutFragment.hash = '';
      const guideTarget = targetWithoutFragment.href;
      if (inboundGuideLinks.has(guideTarget) && guideTarget !== sourceUrl.href) {
        inboundGuideLinks.set(guideTarget, inboundGuideLinks.get(guideTarget) + 1);
      }

      const lookupKey = `${targetWithoutFragment.pathname}${targetWithoutFragment.search}`;
      if (!checkedTargets.has(lookupKey)) {
        checkedTargets.set(lookupKey, await staticFileForUrl(distRoot, targetWithoutFragment));
      }
      if (!checkedTargets.get(lookupKey)) {
        fail(`page ${sourcePublicPath}: broken internal link ${JSON.stringify(href)}`);
      }
    }
    validateJsonLd(html, path === homepagePath ? 'homepage' : `page ${sourcePublicPath}`, path === homepagePath);
  }

  for (const [url, inboundCount] of inboundGuideLinks) {
    if (inboundCount === 0) fail(`guide ${new URL(url).pathname}: has no inbound internal link`);
  }

  if (failures.length > 0) {
    console.error(`SEO smoke check failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:`);
    failures.forEach((message) => console.error(`- ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `SEO smoke check passed: ${htmlFiles.length} HTML file${htmlFiles.length === 1 ? '' : 's'}, ` +
      `${sitemapUrls.length} sitemap URL${sitemapUrls.length === 1 ? '' : 's'}, ` +
      `${guideFiles.length} guide page${guideFiles.length === 1 ? '' : 's'}, ${internalLinkCount} internal link${internalLinkCount === 1 ? '' : 's'}.`,
  );
}

await main();
