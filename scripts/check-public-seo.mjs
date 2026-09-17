#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml } from '@rgrove/parse-xml';
import { validateEnglishBranding } from './seo-branding.mjs';

export const DEFAULT_BASE_URL = 'https://liveparse.com';
export const NORMAL_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const GOOGLEBOT_SMARTPHONE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 ' +
  '(compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_ROBOTS_BYTES = 1_000_000;
const MAX_SITEMAP_BYTES = 10_000_000;
const MAX_ATOM_BYTES = 2_000_000;
const MAX_HTML_BYTES = 5_000_000;
const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';
const ATOM_MEDIA_TYPE = 'application/atom+xml';
const EXPECTED_WEBSUB_HUB = 'https://pubsubhubbub.appspot.com/';
const MAX_ATOM_ENTRIES = 50;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export class PublicSeoCheckError extends Error {
  constructor(failures, counts) {
    super(`${failures.length} public SEO check${failures.length === 1 ? '' : 's'} failed`);
    this.name = 'PublicSeoCheckError';
    this.failures = failures;
    this.counts = counts;
  }
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Base URL is invalid: ${JSON.stringify(value)}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError(`Base URL must use HTTP or HTTPS: ${JSON.stringify(value)}`);
  }
  if (url.username || url.password) throw new TypeError('Base URL must not contain credentials.');
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Base URL must be an origin without a path, query, or fragment.');
  }
  return new URL(`${url.origin}/`);
}

function transportUrl(canonicalUrl, baseUrl) {
  const target = new URL(baseUrl);
  target.pathname = canonicalUrl.pathname;
  target.search = canonicalUrl.search;
  target.hash = '';
  return target;
}

async function readLimitedBody(response, maximumBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel();
    throw new Error(`response is larger than ${maximumBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`response is larger than ${maximumBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchResource(fetchImpl, url, { userAgent, accept, timeoutMs, maximumBytes, transportHeaders = {} }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        ...transportHeaders,
        Accept: accept,
        'Cache-Control': 'no-cache',
        'User-Agent': userAgent,
      },
    });
    const body = await readLimitedBody(response, maximumBytes);
    return { body, headers: response.headers, status: response.status };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${timeoutMs} ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeEntities(value, { html = false } = {}) {
  const named = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['gt', '>'],
    ['lt', '<'],
    ['quot', '"'],
    ...(html ? [['nbsp', ' ']] : []),
  ]);
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][\w.-]*);/gi, (entity, name) => {
    if (name.startsWith('#')) {
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

function parseRobots(source) {
  const groups = [];
  const sitemapValues = [];
  let group = null;

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!group || group.hasDirectives) {
        group = { agents: [], hasDirectives: false, rules: [] };
        groups.push(group);
      }
      if (value) group.agents.push(value.toLowerCase());
      continue;
    }

    if (field === 'sitemap') {
      if (value) sitemapValues.push(value);
      continue;
    }

    if (group) {
      group.hasDirectives = true;
      if (field === 'allow' || field === 'disallow') group.rules.push({ field, value });
    }
  }

  const requestAgent = GOOGLEBOT_SMARTPHONE_USER_AGENT.toLowerCase();
  let bestSpecificity = -1;
  const matchingGroups = [];
  for (const candidate of groups) {
    const specificities = candidate.agents
      .map((agent) => (agent === '*' ? 0 : requestAgent.includes(agent) ? agent.length : -1));
    const specificity = Math.max(-1, ...specificities);
    if (specificity < 0) continue;
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      matchingGroups.length = 0;
    }
    if (specificity === bestSpecificity) matchingGroups.push(candidate);
  }

  return {
    effectiveRules: matchingGroups.flatMap((candidate) => candidate.rules),
    hasEffectiveGroup: matchingGroups.length > 0,
    sitemapValues,
  };
}

function parseAbsoluteHttpUrl(value, label, failures) {
  let url;
  try {
    url = new URL(value);
  } catch {
    failures.push(`${label}: expected an absolute URL, received ${JSON.stringify(value)}`);
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    failures.push(`${label}: URL must use HTTP(S) without credentials or a fragment (${url.href})`);
    return null;
  }
  return url;
}

function validateRobots(source, canonicalOrigin, failures) {
  const parsed = parseRobots(source);
  if (!parsed.hasEffectiveGroup) failures.push('robots.txt: no user-agent group applies to Googlebot');

  const allows = parsed.effectiveRules.filter(({ field, value }) => field === 'allow' && value.trim());
  if (allows.length === 0) failures.push('robots.txt: the effective Googlebot group has no non-empty Allow directive');

  const blanketDisallows = parsed.effectiveRules.filter(({ field, value }) => {
    if (field !== 'disallow') return false;
    let normalized = value.replace(/\s+/g, '');
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep the original value when percent escapes are malformed.
    }
    return normalized === '/' || normalized === '/*' || normalized === '/*$';
  });
  if (blanketDisallows.length > 0) {
    failures.push(`robots.txt: the effective Googlebot group contains blanket Disallow: ${blanketDisallows[0].value}`);
  }

  if (parsed.sitemapValues.length === 0) failures.push('robots.txt: no Sitemap directive is present');

  const sitemapUrls = parsed.sitemapValues
    .map((value, index) => parseAbsoluteHttpUrl(value, `robots.txt Sitemap ${index + 1}`, failures))
    .filter(Boolean);
  const seen = new Set();
  for (const url of sitemapUrls) {
    if (seen.has(url.href)) failures.push(`robots.txt: duplicate Sitemap directive (${url.href})`);
    seen.add(url.href);
  }
  if (sitemapUrls.some((url) => url.origin !== sitemapUrls[0]?.origin)) {
    failures.push('robots.txt: all Sitemap directives must use one canonical origin');
  }
  for (const url of sitemapUrls) {
    if (url.origin !== canonicalOrigin) {
      failures.push(`robots.txt: Sitemap must use canonical origin ${canonicalOrigin} (${url.href})`);
    }
  }
  const expectedSitemap = `${canonicalOrigin}/sitemap.xml`;
  const expectedFeed = `${canonicalOrigin}/feed.xml`;
  for (const expected of [expectedSitemap, expectedFeed]) {
    if (!seen.has(expected)) failures.push(`robots.txt: missing Sitemap directive (${expected})`);
  }
  for (const url of sitemapUrls) {
    if (url.href !== expectedSitemap && url.href !== expectedFeed) {
      failures.push(`robots.txt: unexpected Sitemap directive (${url.href})`);
    }
  }
  if (sitemapUrls.length !== 2) {
    failures.push(`robots.txt: expected exactly 2 Sitemap directives, found ${sitemapUrls.length}`);
  }

  return {
    feedUrl: sitemapUrls.find((url) => url.href === expectedFeed) ?? null,
    sitemapUrl: sitemapUrls.find((url) => url.href === expectedSitemap) ?? null,
  };
}

function extractXmlElementContents(source, name) {
  const values = [];
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`,
    'gi',
  );
  let match;
  while ((match = pattern.exec(source))) values.push(match[1]);
  return values;
}

function parseSitemap(source, sitemapUrl, canonicalOrigin, failures) {
  const label = sitemapUrl.href;
  const clean = source.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/<(?:[A-Za-z_][\w.-]*:)?urlset\b[^>]*>[\s\S]*<\/(?:[A-Za-z_][\w.-]*:)?urlset\s*>/i.test(clean)) {
    failures.push(`${label}: expected a URL-set sitemap`);
    return [];
  }
  if (/<(?:[A-Za-z_][\w.-]*:)?sitemapindex\b/i.test(clean)) {
    failures.push(`${label}: sitemap indexes are not supported by this guard; declare URL-set sitemaps directly`);
    return [];
  }

  const urlBlocks = extractXmlElementContents(clean, 'url');
  const openingUrlCount = (clean.match(/<(?:[A-Za-z_][\w.-]*:)?url\b[^>]*>/gi) || []).length;
  const closingUrlCount = (clean.match(/<\/(?:[A-Za-z_][\w.-]*:)?url\s*>/gi) || []).length;
  if (openingUrlCount !== closingUrlCount || openingUrlCount !== urlBlocks.length) {
    failures.push(`${label}: sitemap contains malformed or unmatched <url> entries`);
    return [];
  }
  if (urlBlocks.length === 0) {
    failures.push(`${label}: sitemap contains no <url> entries`);
    return [];
  }

  const urls = [];
  urlBlocks.forEach((block, index) => {
    const locValues = extractXmlElementContents(block, 'loc');
    if (locValues.length !== 1) {
      failures.push(`${label}: <url> entry ${index + 1} must contain exactly one <loc>`);
      return;
    }
    const rawLoc = locValues[0].trim();
    if (/<[^>]+>/.test(rawLoc)) {
      failures.push(`${label}: <loc> entry ${index + 1} contains markup`);
      return;
    }
    const invalidAmpersands = rawLoc.replace(/&(amp|apos|gt|lt|quot|#\d+|#x[\da-f]+);/gi, '').includes('&');
    if (invalidAmpersands) {
      failures.push(`${label}: <loc> entry ${index + 1} contains an unescaped or invalid ampersand`);
      return;
    }
    const decodedLoc = decodeEntities(rawLoc);
    if (/&(?:#[^;\s]+|[a-z][\w.-]*);/i.test(decodedLoc)) {
      failures.push(`${label}: <loc> entry ${index + 1} contains an unknown XML entity`);
      return;
    }
    const url = parseAbsoluteHttpUrl(decodedLoc, `${label} <loc> entry ${index + 1}`, failures);
    if (!url) return;
    if (url.origin !== canonicalOrigin) {
      failures.push(`${label}: <loc> must use canonical origin ${canonicalOrigin} (${url.href})`);
      return;
    }
    urls.push(url);
  });
  return urls;
}

function directXmlElements(node, name) {
  return (node?.children || []).filter((child) => child.type === 'element' && child.name === name);
}

function atomText(parent, name, label, failures) {
  const elements = directXmlElements(parent, name);
  if (elements.length !== 1) {
    failures.push(`${label}: expected exactly one <${name}>, found ${elements.length}`);
    return '';
  }
  const element = elements[0];
  if ((element.attributes?.type || 'text').toLowerCase() !== 'text') {
    failures.push(`${label}: <${name}> must use plain text`);
  }
  if ((element.children || []).some((child) => child.type === 'element')) {
    failures.push(`${label}: <${name}> must not contain child elements`);
  }
  const value = (element.children || [])
    .filter((child) => child.type === 'text' || child.type === 'cdata')
    .map((child) => child.text || '')
    .join('')
    .trim();
  if (!value) failures.push(`${label}: <${name}> must not be empty`);
  return value;
}

function atomLinks(parent, relation) {
  return directXmlElements(parent, 'link').filter((link) =>
    (link.attributes?.rel || 'alternate').trim().toLowerCase() === relation,
  );
}

function oneAtomLink(parent, relation, label, failures) {
  const links = atomLinks(parent, relation);
  if (links.length !== 1) {
    failures.push(`${label}: expected exactly one rel=${JSON.stringify(relation)} link, found ${links.length}`);
    return null;
  }
  const href = (links[0].attributes?.href || '').trim();
  if (!href) {
    failures.push(`${label}: rel=${JSON.stringify(relation)} link must have a non-empty href`);
    return null;
  }
  const url = parseAbsoluteHttpUrl(href, `${label} rel=${JSON.stringify(relation)} link`, failures);
  return url ? { element: links[0], url } : null;
}

function parseAtomTimestamp(value, label, failures) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) {
    failures.push(`${label}: expected an RFC 3339 timestamp with a timezone, received ${JSON.stringify(value)}`);
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (
    day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    failures.push(`${label}: timestamp has an out-of-range calendar or clock field (${JSON.stringify(value)})`);
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    failures.push(`${label}: timestamp cannot be parsed (${JSON.stringify(value)})`);
    return null;
  }
  return timestamp;
}

function validateAtomFeed(source, feedUrl, canonicalOrigin, authoritativeUrls, failures, nowMs) {
  const label = feedUrl.href;
  const clean = source.replace(/^\uFEFF/, '');
  if (/<!DOCTYPE\b/i.test(clean)) failures.push(`${label}: document type declarations are not allowed`);

  let document;
  try {
    document = parseXml(clean);
  } catch (error) {
    failures.push(`${label}: malformed XML (${error.message})`);
    return [];
  }

  const roots = (document.children || []).filter((child) => child.type === 'element');
  if (roots.length !== 1 || roots[0].name !== 'feed') {
    failures.push(`${label}: expected exactly one unprefixed <feed> root`);
    return [];
  }
  const feed = roots[0];
  if (feed.attributes?.xmlns !== ATOM_NAMESPACE) {
    failures.push(`${label}: <feed> must declare the Atom 1.0 namespace ${ATOM_NAMESPACE}`);
  }
  if ((feed.attributes?.['xml:lang'] || '').toLowerCase() !== 'en') {
    failures.push(`${label}: <feed> must declare xml:lang="en"`);
  }

  const feedId = atomText(feed, 'id', label, failures);
  atomText(feed, 'title', label, failures);
  const feedUpdatedValue = atomText(feed, 'updated', label, failures);
  const feedUpdated = feedUpdatedValue ? parseAtomTimestamp(feedUpdatedValue, `${label} <updated>`, failures) : null;
  if (feedId && feedId !== feedUrl.href) failures.push(`${label}: <id> must equal the feed URL ${feedUrl.href}`);

  const selfLink = oneAtomLink(feed, 'self', label, failures);
  if (selfLink) {
    if (selfLink.url.href !== feedUrl.href) failures.push(`${label}: rel="self" must point to ${feedUrl.href}`);
    if ((selfLink.element.attributes?.type || '').toLowerCase() !== ATOM_MEDIA_TYPE) {
      failures.push(`${label}: rel="self" must declare type=${JSON.stringify(ATOM_MEDIA_TYPE)}`);
    }
  }

  const alternateLink = oneAtomLink(feed, 'alternate', label, failures);
  if (alternateLink) {
    const expectedAlternate = `${canonicalOrigin}/`;
    if (alternateLink.url.href !== expectedAlternate) {
      failures.push(`${label}: feed rel="alternate" must point to ${expectedAlternate}`);
    }
    if ((alternateLink.element.attributes?.type || '').toLowerCase() !== 'text/html') {
      failures.push(`${label}: feed rel="alternate" must declare type="text/html"`);
    }
  }

  const hubLink = oneAtomLink(feed, 'hub', label, failures);
  if (hubLink && hubLink.url.href !== EXPECTED_WEBSUB_HUB) {
    failures.push(`${label}: rel="hub" must point to ${EXPECTED_WEBSUB_HUB}`);
  }

  const authors = directXmlElements(feed, 'author');
  if (authors.length !== 1) {
    failures.push(`${label}: expected exactly one feed-level <author>, found ${authors.length}`);
  } else {
    atomText(authors[0], 'name', `${label} <author>`, failures);
    const authorUri = atomText(authors[0], 'uri', `${label} <author>`, failures);
    if (authorUri) {
      const parsedAuthorUri = parseAbsoluteHttpUrl(authorUri, `${label} <author> <uri>`, failures);
      if (parsedAuthorUri?.protocol !== 'https:') failures.push(`${label}: author URI must use HTTPS`);
    }
  }

  const entries = directXmlElements(feed, 'entry');
  if (entries.length === 0) failures.push(`${label}: feed must contain at least one <entry>`);
  if (entries.length > MAX_ATOM_ENTRIES) {
    failures.push(`${label}: recent feed must contain at most ${MAX_ATOM_ENTRIES} entries, found ${entries.length}`);
  }

  const seenIds = new Set();
  const seenUrls = new Set();
  const entryTimes = [];
  entries.forEach((entry, index) => {
    const entryLabel = `${label} entry ${index + 1}`;
    const id = atomText(entry, 'id', entryLabel, failures);
    atomText(entry, 'title', entryLabel, failures);
    const publishedValue = atomText(entry, 'published', entryLabel, failures);
    const updatedValue = atomText(entry, 'updated', entryLabel, failures);
    atomText(entry, 'summary', entryLabel, failures);
    const published = publishedValue ? parseAtomTimestamp(publishedValue, `${entryLabel} <published>`, failures) : null;
    const updated = updatedValue ? parseAtomTimestamp(updatedValue, `${entryLabel} <updated>`, failures) : null;

    if (published !== null && published > nowMs + MAX_FUTURE_SKEW_MS) {
      failures.push(`${entryLabel}: <published> is in the future`);
    }
    if (updated !== null && updated > nowMs + MAX_FUTURE_SKEW_MS) {
      failures.push(`${entryLabel}: <updated> is in the future`);
    }
    if (published !== null && updated !== null && published > updated) {
      failures.push(`${entryLabel}: <published> must not be later than <updated>`);
    }
    if (updated !== null) entryTimes.push({ index, timestamp: updated });

    if (id) {
      if (seenIds.has(id)) failures.push(`${entryLabel}: duplicate <id> ${JSON.stringify(id)}`);
      seenIds.add(id);
    }

    const alternate = oneAtomLink(entry, 'alternate', entryLabel, failures);
    if (!alternate) return;
    if ((alternate.element.attributes?.type || '').toLowerCase() !== 'text/html') {
      failures.push(`${entryLabel}: rel="alternate" must declare type="text/html"`);
    }
    if (alternate.url.origin !== canonicalOrigin) {
      failures.push(`${entryLabel}: alternate URL must use canonical origin ${canonicalOrigin} (${alternate.url.href})`);
    }
    if (alternate.url.search || alternate.url.hash) {
      failures.push(`${entryLabel}: alternate URL must not contain a query or fragment (${alternate.url.href})`);
    }
    if (!authoritativeUrls.has(alternate.url.href)) {
      failures.push(`${entryLabel}: alternate URL is not present in the authoritative URL-set sitemap (${alternate.url.href})`);
    }
    if (seenUrls.has(alternate.url.href)) {
      failures.push(`${entryLabel}: duplicate alternate URL ${alternate.url.href}`);
    }
    seenUrls.add(alternate.url.href);
    if (id && id !== alternate.url.href) {
      failures.push(`${entryLabel}: <id> must equal its canonical alternate URL ${alternate.url.href}`);
    }
  });

  for (let index = 1; index < entryTimes.length; index += 1) {
    if (entryTimes[index - 1].timestamp < entryTimes[index].timestamp) {
      failures.push(`${label}: entries must be ordered by non-increasing <updated>; entry ${entryTimes[index].index + 1} is newer than its predecessor`);
    }
  }
  if (entryTimes.length > 0) {
    const newest = Math.max(...entryTimes.map(({ timestamp }) => timestamp));
    if (feedUpdated !== null && feedUpdated !== newest) {
      failures.push(`${label}: feed <updated> must equal the newest entry <updated>`);
    }
  }
  if (feedUpdated !== null && feedUpdated > nowMs + MAX_FUTURE_SKEW_MS) {
    failures.push(`${label}: feed <updated> is in the future`);
  }

  return entries;
}

function parseAttributes(source) {
  const attributes = new Map();
  let index = 0;
  while (index < source.length) {
    while (/\s|\//.test(source[index] || '')) index += 1;
    if (index >= source.length) break;

    const nameStart = index;
    while (index < source.length && !/[\s=/>]/.test(source[index])) index += 1;
    const name = source.slice(nameStart, index).toLowerCase();
    if (!name) {
      index += 1;
      continue;
    }
    while (/\s/.test(source[index] || '')) index += 1;

    let value = '';
    if (source[index] === '=') {
      index += 1;
      while (/\s/.test(source[index] || '')) index += 1;
      const quote = source[index] === '"' || source[index] === "'" ? source[index++] : '';
      const valueStart = index;
      if (quote) {
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (source[index] === quote) index += 1;
      } else {
        while (index < source.length && !/[\s>]/.test(source[index])) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    if (!attributes.has(name)) attributes.set(name, decodeEntities(value, { html: true }));
  }
  return attributes;
}

function stripRawMarkup(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
}

function openingTagAttributes(source, tagName) {
  const attributes = [];
  const pattern = new RegExp(`<${tagName}\\b`, 'gi');
  let match;
  while ((match = pattern.exec(source))) {
    let index = pattern.lastIndex;
    let quote = '';
    while (index < source.length) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
      index += 1;
    }
    if (index >= source.length) break;
    attributes.push(parseAttributes(source.slice(pattern.lastIndex, index)));
    pattern.lastIndex = index + 1;
  }
  return attributes;
}

function plainText(fragment) {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '), { html: true }).replace(/\s+/g, ' ').trim();
}

function elementTextValues(source, tagName) {
  const values = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'gi');
  let match;
  while ((match = pattern.exec(source))) values.push(plainText(match[1]));
  return values;
}

function hasBlockingRobotsDirective(value) {
  return value
    .toLowerCase()
    .split(/[\s,;]+/)
    .some((directive) => directive === 'noindex' || directive === 'nofollow' || directive === 'none');
}

function validateHtml(body, headers, expectedCanonical, variantLabel) {
  const failures = validateEnglishBranding(body.toString('utf8'), variantLabel);
  const contentType = (headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    failures.push(`${variantLabel}: expected an HTML Content-Type, received ${JSON.stringify(contentType || null)}`);
  }

  const xRobotsTag = headers.get('x-robots-tag') || '';
  if (hasBlockingRobotsDirective(xRobotsTag)) {
    failures.push(`${variantLabel}: X-Robots-Tag contains noindex, nofollow, or none`);
  }

  const html = body.toString('utf8');
  const clean = stripRawMarkup(html);
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(clean);
  const metadata = headMatch?.[1] ?? clean;

  for (const attributes of openingTagAttributes(metadata, 'meta')) {
    const name = (attributes.get('name') || '').trim().toLowerCase();
    if (!/^(?:robots|googlebot(?:-[a-z0-9_-]+)?)$/.test(name)) continue;
    if (hasBlockingRobotsDirective(attributes.get('content') || '')) {
      failures.push(`${variantLabel}: meta ${name} contains noindex, nofollow, or none`);
    }
  }

  const canonicals = openingTagAttributes(metadata, 'link')
    .filter((attributes) => (attributes.get('rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonicals.length !== 1) {
    failures.push(`${variantLabel}: expected exactly one canonical link, found ${canonicals.length}`);
  } else {
    const href = (canonicals[0].get('href') || '').trim();
    const canonical = parseAbsoluteHttpUrl(href, `${variantLabel} canonical`, failures);
    if (canonical && canonical.href !== expectedCanonical.href) {
      failures.push(`${variantLabel}: canonical is ${canonical.href}, expected ${expectedCanonical.href}`);
    }
  }

  if (!elementTextValues(metadata, 'title').some(Boolean)) failures.push(`${variantLabel}: no non-empty <title> found`);
  if (!elementTextValues(clean, 'h1').some(Boolean)) failures.push(`${variantLabel}: no non-empty <h1> found`);
  return failures;
}

function firstDifferentByte(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : sharedLength;
}

function comparableHtmlBody(body) {
  const source = body.toString('utf8').replace(/data-cfemail=(["'])([0-9a-f]{4,})\1/gi, (attribute, quote, token) => {
    if (token.length % 2 !== 0) return attribute;
    const key = Number.parseInt(token.slice(0, 2), 16);
    const decoded = [];
    for (let index = 2; index < token.length; index += 2) {
      const byte = Number.parseInt(token.slice(index, index + 2), 16);
      if (!Number.isInteger(byte)) return attribute;
      decoded.push(byte ^ key);
    }
    return `data-cfemail=${quote}decoded-${Buffer.from(decoded).toString('hex')}${quote}`;
  });
  return Buffer.from(source);
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function throwIfFailed(failures, counts) {
  if (failures.length > 0) throw new PublicSeoCheckError(failures, { ...counts });
}

export function formatCounts(counts) {
  return `${counts.robots} robots.txt, ${counts.sitemaps} sitemap${counts.sitemaps === 1 ? '' : 's'}, ` +
    `${counts.feeds} Atom feed${counts.feeds === 1 ? '' : 's'}, ` +
    `${counts.feedEntries} recent feed entr${counts.feedEntries === 1 ? 'y' : 'ies'}, ` +
    `${counts.urls} URL${counts.urls === 1 ? '' : 's'}, ${counts.pageVariants} page variants`;
}

export async function runPublicSeoCheck({
  baseUrl = DEFAULT_BASE_URL,
  canonicalOrigin = DEFAULT_BASE_URL,
  concurrency = DEFAULT_CONCURRENCY,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const expectedCanonical = normalizeBaseUrl(canonicalOrigin);
  const expectedCanonicalOrigin = expectedCanonical.origin;
  const transportHeaders = base.origin === expectedCanonicalOrigin ? {} : {
    'X-Forwarded-Host': expectedCanonical.host,
    'X-Forwarded-Proto': expectedCanonical.protocol.slice(0, -1),
  };
  if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch-compatible implementation is required.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new TypeError('Concurrency must be an integer from 1 to 32.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Timeout must be a positive integer.');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid Date or timestamp.');

  const failures = [];
  const counts = { feedEntries: 0, feeds: 0, pageVariants: 0, robots: 0, sitemaps: 0, urls: 0 };
  const robotsUrl = new URL('/robots.txt', base);
  let robots;
  try {
    robots = await fetchResource(fetchImpl, robotsUrl, {
      accept: 'text/plain,*/*;q=0.1',
      maximumBytes: MAX_ROBOTS_BYTES,
      timeoutMs,
      transportHeaders,
      userAgent: GOOGLEBOT_SMARTPHONE_USER_AGENT,
    });
    counts.robots = 1;
  } catch (error) {
    failures.push(`robots.txt: request failed (${error.message})`);
    throwIfFailed(failures, counts);
  }
  if (robots.status < 200 || robots.status >= 300) {
    failures.push(`robots.txt: expected a successful response, received HTTP ${robots.status}`);
  }
  const { feedUrl, sitemapUrl } = validateRobots(
    robots.body.toString('utf8'),
    expectedCanonicalOrigin,
    failures,
  );
  throwIfFailed(failures, counts);

  let sitemapResult;
  try {
    const result = await fetchResource(fetchImpl, transportUrl(sitemapUrl, base), {
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
      maximumBytes: MAX_SITEMAP_BYTES,
      timeoutMs,
      transportHeaders,
      userAgent: GOOGLEBOT_SMARTPHONE_USER_AGENT,
    });
    const localFailures = [];
    if (result.status < 200 || result.status >= 300) {
      localFailures.push(`${sitemapUrl.href}: expected a successful response, received HTTP ${result.status}`);
      sitemapResult = { failures: localFailures, urls: [] };
    } else {
      sitemapResult = {
        failures: localFailures,
        urls: parseSitemap(result.body.toString('utf8'), sitemapUrl, expectedCanonicalOrigin, localFailures),
      };
    }
  } catch (error) {
    sitemapResult = { failures: [`${sitemapUrl.href}: request failed (${error.message})`], urls: [] };
  }
  counts.sitemaps = 1;
  failures.push(...sitemapResult.failures);
  const pageUrls = sitemapResult.urls;
  const seenPageUrls = new Set();
  for (const url of pageUrls) {
    if (seenPageUrls.has(url.href)) failures.push(`sitemap: duplicate <loc> URL (${url.href})`);
    seenPageUrls.add(url.href);
  }
  counts.urls = pageUrls.length;
  throwIfFailed(failures, counts);

  try {
    const result = await fetchResource(fetchImpl, transportUrl(feedUrl, base), {
      accept: `${ATOM_MEDIA_TYPE},application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.1`,
      maximumBytes: MAX_ATOM_BYTES,
      timeoutMs,
      transportHeaders,
      userAgent: GOOGLEBOT_SMARTPHONE_USER_AGENT,
    });
    counts.feeds = 1;
    if (result.status < 200 || result.status >= 300) {
      failures.push(`${feedUrl.href}: expected a successful response, received HTTP ${result.status}`);
    } else {
      const contentType = (result.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (contentType !== ATOM_MEDIA_TYPE) {
        failures.push(`${feedUrl.href}: expected Content-Type ${ATOM_MEDIA_TYPE}, received ${JSON.stringify(contentType || null)}`);
      }
      const entries = validateAtomFeed(
        result.body.toString('utf8'),
        feedUrl,
        expectedCanonicalOrigin,
        seenPageUrls,
        failures,
        nowMs,
      );
      counts.feedEntries = entries.length;
    }
  } catch (error) {
    failures.push(`${feedUrl.href}: request failed (${error.message})`);
  }
  throwIfFailed(failures, counts);

  const pageResults = await mapConcurrent(pageUrls, concurrency, async (canonicalUrl) => {
    const target = transportUrl(canonicalUrl, base);
    const requests = [
      ['normal', NORMAL_USER_AGENT],
      ['Googlebot smartphone', GOOGLEBOT_SMARTPHONE_USER_AGENT],
    ];
    const settled = await Promise.allSettled(requests.map(([, userAgent]) => fetchResource(fetchImpl, target, {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      maximumBytes: MAX_HTML_BYTES,
      timeoutMs,
      transportHeaders,
      userAgent,
    })));
    const localFailures = [];
    const responses = [];
    settled.forEach((result, index) => {
      const variantLabel = `${canonicalUrl.href} [${requests[index][0]}]`;
      if (result.status === 'rejected') {
        localFailures.push(`${variantLabel}: request failed (${result.reason?.message || String(result.reason)})`);
        responses[index] = null;
        return;
      }
      responses[index] = result.value;
      if (result.value.status !== 200) {
        localFailures.push(`${variantLabel}: expected HTTP 200, received HTTP ${result.value.status}`);
      }
      localFailures.push(...validateHtml(result.value.body, result.value.headers, canonicalUrl, variantLabel));
    });

    const comparableBodies = responses.map((response) => response && comparableHtmlBody(response.body));
    if (comparableBodies[0] && comparableBodies[1] && !comparableBodies[0].equals(comparableBodies[1])) {
      const offset = firstDifferentByte(comparableBodies[0], comparableBodies[1]);
      localFailures.push(
        `${canonicalUrl.href}: body differs between normal and Googlebot smartphone at byte ${offset} ` +
        `(${comparableBodies[0].length} vs ${comparableBodies[1].length} comparable bytes)`,
      );
    }
    return localFailures;
  });
  counts.pageVariants = pageUrls.length * 2;
  failures.push(...pageResults.flat());
  throwIfFailed(failures, counts);
  return { ...counts };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/check-public-seo.mjs [base-origin]');
    console.log(`Default base origin: ${DEFAULT_BASE_URL}`);
    return 0;
  }
  if (argv.length > 1) {
    console.error('Usage: node scripts/check-public-seo.mjs [base-origin]');
    return 1;
  }

  try {
    const counts = await runPublicSeoCheck({ baseUrl: argv[0] || DEFAULT_BASE_URL });
    console.log(`Public SEO check passed: ${formatCounts(counts)}.`);
    return 0;
  } catch (error) {
    if (error instanceof PublicSeoCheckError) {
      console.error(`Public SEO check failed: ${formatCounts(error.counts)}; ${error.failures.length} failure${error.failures.length === 1 ? '' : 's'}.`);
      const displayed = error.failures.slice(0, 25);
      for (const failure of displayed) console.error(`- ${failure}`);
      if (displayed.length < error.failures.length) {
        console.error(`- ... ${error.failures.length - displayed.length} additional failure(s) omitted`);
      }
    } else {
      console.error(`Public SEO check could not run: ${error.message}`);
    }
    return 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = await main();
