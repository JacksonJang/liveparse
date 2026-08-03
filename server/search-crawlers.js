import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_USER_AGENT_LENGTH = 2_048;

const CLAIMED_CRAWLER_PATTERNS = Object.freeze([
  ['googlebot', /(?:^|[^a-z0-9])googlebot(?:-[a-z0-9_-]+)?(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['bingbot', /(?:^|[^a-z0-9])bingbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['duckduckbot', /(?:^|[^a-z0-9])duckduckbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['yandexbot', /(?:^|[^a-z0-9])yandexbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['baiduspider', /(?:^|[^a-z0-9])baiduspider(?:-[a-z0-9_-]+)?(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['naver', /(?:^|[^a-z0-9])(?:naverbot|yeti)(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['seznambot', /(?:^|[^a-z0-9])seznambot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['yepbot', /(?:^|[^a-z0-9])yepbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['amazonbot', /(?:^|[^a-z0-9])amazonbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['internet-archive', /(?:^|[^a-z0-9])(?:archive\.org_bot|ia_archiver)(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['applebot', /(?:^|[^a-z0-9])applebot(?:-extended)?(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['common-crawl', /(?:^|[^a-z0-9])ccbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['petalbot', /(?:^|[^a-z0-9])petalbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['bytespider', /(?:^|[^a-z0-9])bytespider(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['yahoo-slurp', /(?:^|[^a-z0-9])slurp(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['bravebot', /(?:^|[^a-z0-9])bravebot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['mojeekbot', /(?:^|[^a-z0-9])mojeekbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['oai-searchbot', /(?:^|[^a-z0-9])oai-searchbot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
  ['perplexitybot', /(?:^|[^a-z0-9])perplexitybot(?:\/[a-z0-9._-]+)?(?=$|[^a-z0-9])/i],
]);

export const CLAIMED_CRAWLER_NAMES = Object.freeze(CLAIMED_CRAWLER_PATTERNS.map(([name]) => name));
const CLAIMED_CRAWLER_NAME_SET = new Set(CLAIMED_CRAWLER_NAMES);
const AGGREGATE_FIELDS = Object.freeze(['claimedCrawlerRequests', 'crawlers', 'date', 'observedHours', 'pages']);

export function classifyClaimedCrawler(userAgent) {
  if (typeof userAgent !== 'string') return null;
  const normalized = userAgent.trim();
  if (normalized.length === 0 || normalized.length > MAX_USER_AGENT_LENGTH) return null;
  return CLAIMED_CRAWLER_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

function isCanonicalHtmlPath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && !value.includes('?')
    && !value.includes('#')
    && (value === '/' || value.endsWith('/'));
}

function copyAllowedPaths(value) {
  if (!(value instanceof Set) || value.size === 0) {
    throw new TypeError('ClaimedCrawlerCounter requires a non-empty Set of canonical HTML paths.');
  }
  const paths = new Set();
  for (const path of value) {
    if (!isCanonicalHtmlPath(path)) throw new TypeError(`Invalid canonical HTML path: ${JSON.stringify(path)}`);
    paths.add(path);
  }
  return paths;
}

export function claimedCrawlerFromRequest({
  method,
  isHtml,
  requestPath,
  userAgent,
  allowedPaths,
} = {}) {
  if (method !== 'GET' || isHtml !== true || !isCanonicalHtmlPath(requestPath)
    || !(allowedPaths instanceof Set) || !allowedPaths.has(requestPath)) {
    return null;
  }
  const crawler = classifyClaimedCrawler(userAgent);
  return crawler ? { crawler, path: requestPath } : null;
}

export function calendarHourInTimeZone(date, timeZone = 'Asia/Seoul') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('A valid Date is required.');
  const values = Object.create(null);
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: values.hour,
  };
}

function emptyAggregate(date) {
  return {
    date,
    observedHours: [],
    claimedCrawlerRequests: 0,
    crawlers: {},
    pages: {},
  };
}

function assertCountMap(value, label, keyValidator) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const [key, count] of Object.entries(value)) {
    if (!keyValidator(key)) throw new Error(`${label} contains an invalid key: ${JSON.stringify(key)}.`);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${label}.${key} must be a positive integer.`);
    }
  }
}

function countMapTotal(value) {
  return Object.values(value).reduce((total, count) => total + count, 0);
}

export function validateClaimedCrawlerAggregate(value, expectedDate) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Claimed crawler aggregate for ${expectedDate} must be an object.`);
  }
  if (value.date !== expectedDate) {
    throw new Error(`Claimed crawler aggregate ${expectedDate} contains date ${JSON.stringify(value.date)}.`);
  }
  const fields = Object.keys(value).sort();
  if (fields.length !== AGGREGATE_FIELDS.length || fields.some((field, index) => field !== AGGREGATE_FIELDS[index])) {
    throw new Error(`Claimed crawler aggregate ${expectedDate} contains unexpected or missing fields.`);
  }
  if (!Array.isArray(value.observedHours) || value.observedHours.length === 0) {
    throw new Error(`Claimed crawler aggregate ${expectedDate} must contain at least one observed hour.`);
  }
  const normalizedHours = [...new Set(value.observedHours)].sort();
  if (normalizedHours.length !== value.observedHours.length
    || normalizedHours.some((hour, index) => hour !== value.observedHours[index] || !/^(?:[01]\d|2[0-3])$/.test(hour))) {
    throw new Error(`Claimed crawler aggregate ${expectedDate} has invalid, duplicate, or unsorted observed hours.`);
  }
  if (!Number.isInteger(value.claimedCrawlerRequests) || value.claimedCrawlerRequests < 0) {
    throw new Error(`Claimed crawler aggregate ${expectedDate} has an invalid request count.`);
  }
  assertCountMap(value.crawlers, `Claimed crawler aggregate ${expectedDate} crawlers`, (key) => CLAIMED_CRAWLER_NAME_SET.has(key));
  assertCountMap(value.pages, `Claimed crawler aggregate ${expectedDate} pages`, isCanonicalHtmlPath);
  if (countMapTotal(value.crawlers) !== value.claimedCrawlerRequests
    || countMapTotal(value.pages) !== value.claimedCrawlerRequests) {
    throw new Error(`Claimed crawler aggregate ${expectedDate} totals do not match claimedCrawlerRequests.`);
  }
  return value;
}

export class ClaimedCrawlerCounter {
  constructor({
    directory,
    allowedPaths,
    timeZone = 'Asia/Seoul',
    now = () => new Date(),
    onError = console.error,
  }) {
    if (!directory) throw new Error('ClaimedCrawlerCounter requires a directory.');
    if (typeof now !== 'function') throw new TypeError('ClaimedCrawlerCounter now must be a function.');
    if (typeof onError !== 'function') throw new TypeError('ClaimedCrawlerCounter onError must be a function.');
    calendarHourInTimeZone(new Date(0), timeZone);
    this.directory = directory;
    this.allowedPaths = copyAllowedPaths(allowedPaths);
    this.timeZone = timeZone;
    this.now = now;
    this.onError = onError;
    this.days = new Map();
    this.queue = Promise.resolve();
    this.writeSequence = 0;
  }

  enqueue(label, operation) {
    const next = this.queue.then(operation);
    this.queue = next.catch((error) => this.onError(label, error));
    return next;
  }

  touch() {
    const observedAt = calendarHourInTimeZone(this.now(), this.timeZone);
    return this.enqueue('Claimed crawler heartbeat write failed:', async () => {
      const aggregate = await this.load(observedAt.date);
      if (aggregate.observedHours.includes(observedAt.hour)) return false;
      aggregate.observedHours.push(observedAt.hour);
      aggregate.observedHours.sort();
      await this.persist(aggregate);
      return true;
    });
  }

  record(request) {
    const entry = claimedCrawlerFromRequest({
      ...(request && typeof request === 'object' ? request : {}),
      allowedPaths: this.allowedPaths,
    });
    if (!entry) return Promise.resolve(false);
    const recordedAt = calendarHourInTimeZone(this.now(), this.timeZone);
    return this.enqueue('Claimed crawler aggregate write failed:', async () => {
      const aggregate = await this.load(recordedAt.date);
      if (!aggregate.observedHours.includes(recordedAt.hour)) {
        aggregate.observedHours.push(recordedAt.hour);
        aggregate.observedHours.sort();
      }
      aggregate.claimedCrawlerRequests += 1;
      aggregate.crawlers[entry.crawler] = (aggregate.crawlers[entry.crawler] ?? 0) + 1;
      aggregate.pages[entry.path] = (aggregate.pages[entry.path] ?? 0) + 1;
      await this.persist(aggregate);
      return true;
    });
  }

  async load(date) {
    if (this.days.has(date)) return this.days.get(date);
    const filePath = join(this.directory, `${date}.json`);
    let aggregate;
    try {
      aggregate = validateClaimedCrawlerAggregate(JSON.parse(await readFile(filePath, 'utf8')), date);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`Cannot read ${filePath}: ${error.message}`);
      aggregate = emptyAggregate(date);
    }
    this.days.set(date, aggregate);
    return aggregate;
  }

  async persist(aggregate) {
    validateClaimedCrawlerAggregate(aggregate, aggregate.date);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filePath = join(this.directory, `${aggregate.date}.json`);
    const temporaryPath = `${filePath}.${process.pid}.${this.writeSequence += 1}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(aggregate, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  flush() {
    return this.queue;
  }
}
