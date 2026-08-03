#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { parseXml } from '@rgrove/parse-xml';

export const WEBSUB_FEED_URL = 'https://liveparse.com/feed.xml';
export const WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/';
export const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';
export const DEFAULT_WEBSUB_TIMEOUT_MS = 10_000;
export const MAX_ATOM_FEED_BYTES = 1_000_000;
export const MAX_HUB_RESPONSE_BYTES = 64_000;

const USER_AGENT = 'LiveParse-WebSub-Notifier/1.0 (+https://liveparse.com/)';
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

function canonicalHttpsUrl(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty URL string.`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid: ${JSON.stringify(value)}`);
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value) {
    throw new TypeError(`${label} must be a canonical absolute HTTPS URL without credentials or a fragment: ${value}`);
  }
  return url.href;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The request is already being rejected; a failed best-effort cancellation
    // should not hide the useful redirect or size error.
  }
}

function redirectTarget(response, requestUrl) {
  const location = response.headers.get('location');
  const candidate = response.redirected && response.url ? response.url : location;
  if (!candidate) return null;
  try {
    return new URL(candidate, requestUrl);
  } catch {
    return null;
  }
}

async function rejectRedirect(response, requestUrl, label) {
  if (!response.redirected && (response.status < 300 || response.status >= 400)) return;

  const target = redirectTarget(response, requestUrl);
  const untrusted = target && target.origin !== new URL(requestUrl).origin;
  await cancelBody(response);
  if (untrusted) {
    throw new Error(`${label} refused a redirect to untrusted origin ${target.origin}.`);
  }
  throw new Error(`${label} refused a redirect${target ? ` to ${target.href}` : ''}.`);
}

async function readLimitedBody(response, maximumBytes, label) {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength.trim())) {
    const declaredBytes = BigInt(contentLength.trim());
    if (declaredBytes > BigInt(maximumBytes)) {
      await cancelBody(response);
      throw new Error(`${label} is larger than ${maximumBytes} bytes.`);
    }
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size-limit error below.
        }
        throw new Error(`${label} is larger than ${maximumBytes} bytes.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function requestLimited(fetchImpl, url, init, { timeoutMs, maximumBytes, label }) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${timeoutMs} ms.`)),
    timeoutMs,
  );

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    await rejectRedirect(response, url, label);
    const body = await readLimitedBody(response, maximumBytes, `${label} response`);
    return { body, headers: response.headers, status: response.status };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs} ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function responseSnippet(body) {
  const text = new TextDecoder('utf-8').decode(body).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= 300 ? text : `${text.slice(0, 300)}...`;
}

function assertSuccessfulStatus(status, body, label) {
  if (status >= 200 && status < 300) return;
  const detail = responseSnippet(body);
  throw new Error(`${label} failed with HTTP ${status}${detail ? `: ${detail}` : ''}`);
}

function directElements(parent, name) {
  const matches = parent.children.filter((child) => child.type === 'element' && child.name === name);
  for (const element of matches) {
    if ('xmlns' in element.attributes && element.attributes.xmlns !== ATOM_NAMESPACE) {
      throw new Error(`Atom <${name}> must remain in the Atom namespace.`);
    }
  }
  return matches;
}

function singleElement(parent, name, context = 'Atom feed') {
  const matches = directElements(parent, name);
  if (matches.length !== 1) {
    throw new Error(`${context} must contain exactly one direct <${name}> element; found ${matches.length}.`);
  }
  return matches[0];
}

function plainElementText(element, name) {
  if (element.children.some((child) => child.type === 'element')) {
    throw new Error(`Atom <${name}> must contain text only.`);
  }
  const value = element.text.trim();
  if (!value) throw new Error(`Atom <${name}> must not be empty.`);
  return value;
}

function parseRfc3339(value, label) {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) throw new Error(`${label} is not a valid RFC 3339 timestamp: ${JSON.stringify(value)}`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} is not a valid RFC 3339 timestamp: ${JSON.stringify(value)}`);
  }

  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new Error(`${label} is not a valid RFC 3339 timestamp: ${JSON.stringify(value)}`);
    }
  }

  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(hour, minute, second, 0);
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
    || calendarDate.getUTCHours() !== hour
    || calendarDate.getUTCMinutes() !== minute
    || calendarDate.getUTCSeconds() !== second
  ) {
    throw new Error(`${label} is not a valid RFC 3339 timestamp: ${JSON.stringify(value)}`);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} is not a valid RFC 3339 timestamp: ${JSON.stringify(value)}`);
  }
  return timestamp;
}

function exactRelation(root, relation, expectedHref) {
  const links = directElements(root, 'link').filter((element) => element.attributes.rel === relation);
  if (links.length !== 1) {
    throw new Error(`Atom feed must contain exactly one direct rel=${JSON.stringify(relation)} link; found ${links.length}.`);
  }
  const [link] = links;
  if (link.attributes.href !== expectedHref) {
    throw new Error(`Atom rel=${JSON.stringify(relation)} link must be exactly ${expectedHref}.`);
  }
  return link;
}

export function validateAtomFeed(source, {
  feedUrl = WEBSUB_FEED_URL,
  hubUrl = WEBSUB_HUB_URL,
} = {}) {
  const expectedFeedUrl = canonicalHttpsUrl(feedUrl, 'Feed URL');
  const expectedHubUrl = canonicalHttpsUrl(hubUrl, 'Hub URL');
  if (typeof source !== 'string' || source.length === 0) throw new Error('Atom feed body is empty.');

  let document;
  try {
    document = parseXml(source);
  } catch (error) {
    throw new Error(`Atom feed is not well-formed XML: ${error.message}`, { cause: error });
  }
  if (document.children.some((child) => child.type === 'doctype')) {
    throw new Error('Atom feed must not contain a document type declaration.');
  }

  const root = document.root;
  if (!root || root.name !== 'feed' || root.attributes.xmlns !== ATOM_NAMESPACE) {
    throw new Error(`Atom feed root must be <feed xmlns=${JSON.stringify(ATOM_NAMESPACE)}>.`);
  }

  const id = plainElementText(singleElement(root, 'id'), 'id');
  if (id !== expectedFeedUrl) throw new Error(`Atom feed <id> must be exactly ${expectedFeedUrl}.`);

  const selfLink = exactRelation(root, 'self', expectedFeedUrl);
  if (selfLink.attributes.type !== 'application/atom+xml') {
    throw new Error('Atom rel="self" link must declare type="application/atom+xml".');
  }
  exactRelation(root, 'hub', expectedHubUrl);

  const feedUpdated = plainElementText(singleElement(root, 'updated'), 'updated');
  const feedUpdatedTimestamp = parseRfc3339(feedUpdated, 'Atom feed <updated>');

  const entries = directElements(root, 'entry');
  if (entries.length === 0) throw new Error('Atom feed must contain at least one direct <entry>.');
  const entryUpdatedTimestamps = entries.map((entry, index) => {
    const updated = plainElementText(singleElement(entry, 'updated', `Atom entry ${index + 1}`), 'updated');
    return parseRfc3339(updated, `Atom entry ${index + 1} <updated>`);
  });
  const latestEntryTimestamp = Math.max(...entryUpdatedTimestamps);
  if (feedUpdatedTimestamp !== latestEntryTimestamp) {
    throw new Error('Atom feed <updated> must equal the latest entry <updated> timestamp.');
  }

  return {
    entryCount: entries.length,
    feedId: id,
    updated: feedUpdated,
    updatedTimestamp: feedUpdatedTimestamp,
  };
}

function decodeAtomBody(body) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (error) {
    throw new Error('Atom feed body is not valid UTF-8.', { cause: error });
  }
}

export async function runWebSubNotification({
  feedUrl = WEBSUB_FEED_URL,
  hubUrl = WEBSUB_HUB_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_WEBSUB_TIMEOUT_MS,
  maximumFeedBytes = MAX_ATOM_FEED_BYTES,
  maximumResponseBytes = MAX_HUB_RESPONSE_BYTES,
  write = console.log,
} = {}) {
  const expectedFeedUrl = canonicalHttpsUrl(feedUrl, 'Feed URL');
  const expectedHubUrl = canonicalHttpsUrl(hubUrl, 'Hub URL');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  positiveInteger(timeoutMs, 'timeoutMs', 2_147_483_647);
  positiveInteger(maximumFeedBytes, 'maximumFeedBytes');
  positiveInteger(maximumResponseBytes, 'maximumResponseBytes');

  const feedResponse = await requestLimited(fetchImpl, expectedFeedUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/atom+xml',
      'Cache-Control': 'no-cache',
      'User-Agent': USER_AGENT,
    },
  }, {
    timeoutMs,
    maximumBytes: maximumFeedBytes,
    label: 'Public Atom feed request',
  });
  assertSuccessfulStatus(feedResponse.status, feedResponse.body, 'Public Atom feed request');

  const contentType = (feedResponse.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/atom+xml') {
    throw new Error(`Public Atom feed must use Content-Type application/atom+xml; received ${contentType || 'none'}.`);
  }

  const feed = validateAtomFeed(decodeAtomBody(feedResponse.body), {
    feedUrl: expectedFeedUrl,
    hubUrl: expectedHubUrl,
  });

  const form = new URLSearchParams();
  form.set('hub.mode', 'publish');
  form.set('hub.url', expectedFeedUrl);
  const hubResponse = await requestLimited(fetchImpl, expectedHubUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/plain, */*;q=0.1',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': USER_AGENT,
    },
    body: form.toString(),
  }, {
    timeoutMs,
    maximumBytes: maximumResponseBytes,
    label: 'WebSub hub request',
  });
  assertSuccessfulStatus(hubResponse.status, hubResponse.body, 'WebSub hub request');

  write(
    `WebSub hub accepted the publish notification for ${expectedFeedUrl} `
    + `(HTTP ${hubResponse.status}; ${feed.entryCount} recent entries; updated ${feed.updated}). `
    + 'The accepted notification is not an indexing guarantee.',
  );
  return {
    entryCount: feed.entryCount,
    feedUrl: expectedFeedUrl,
    hubUrl: expectedHubUrl,
    status: hubResponse.status,
    updated: feed.updated,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    await runWebSubNotification();
  } catch (error) {
    console.error(`WebSub notification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
