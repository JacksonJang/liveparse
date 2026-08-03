import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SEARCH_ENGINES = [
  ['google', /(?:^|\.)google\.(?:com|[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/],
  ['bing', /(?:^|\.)bing\.com$/],
  ['duckduckgo', /(?:^|\.)duckduckgo\.com$/],
  ['yahoo', /(?:^|\.)search\.yahoo\.(?:com|[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/],
  ['baidu', /(?:^|\.)baidu\.com$/],
  ['yandex', /(?:^|\.)yandex\.(?:com|ru|tr|kz|by)$/],
  ['ecosia', /(?:^|\.)ecosia\.org$/],
  ['brave', /^search\.brave\.com$/],
  ['qwant', /(?:^|\.)qwant\.com$/],
  ['startpage', /(?:^|\.)startpage\.com$/],
  ['seznam', /(?:^|\.)seznam\.cz$/],
  ['naver', /^search\.naver\.com$/],
  ['daum', /^search\.daum\.net$/],
];

const BOT_USER_AGENT = /(?:bot|crawler|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discordbot|curl|wget)/i;

export function classifySearchReferrer(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return SEARCH_ENGINES.find(([, pattern]) => pattern.test(hostname))?.[0] ?? null;
}

export function isLikelyBot(userAgent) {
  return typeof userAgent !== 'string' || userAgent.trim().length === 0 || BOT_USER_AGENT.test(userAgent);
}

export function dayInTimeZone(date, timeZone = 'Asia/Seoul') {
  const values = Object.create(null);
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export function searchReferralFromRequest({
  method,
  isHtml,
  requestPath,
  referrer,
  userAgent,
  allowedPaths,
  purpose,
  secPurpose,
  secFetchDest,
}) {
  if (method !== 'GET' || !isHtml || typeof requestPath !== 'string' || !requestPath.startsWith('/')) return null;
  if (allowedPaths instanceof Set && !allowedPaths.has(requestPath)) return null;
  if (/\b(?:prefetch|prerender)\b/i.test(`${purpose || ''} ${secPurpose || ''}`)) return null;
  if (secFetchDest && secFetchDest !== 'document') return null;
  if (isLikelyBot(userAgent)) return null;
  const engine = classifySearchReferrer(referrer);
  return engine ? { engine, path: requestPath } : null;
}

function emptyAggregate(date) {
  return {
    date,
    searchLandingVisits: 0,
    engines: {},
    pages: {},
  };
}

function isAggregate(value, date) {
  return value && typeof value === 'object' && value.date === date
    && Number.isInteger(value.searchLandingVisits) && value.searchLandingVisits >= 0
    && value.engines && typeof value.engines === 'object'
    && value.pages && typeof value.pages === 'object';
}

export class SearchReferralCounter {
  constructor({ directory, timeZone = 'Asia/Seoul', now = () => new Date(), onError = console.error }) {
    if (!directory) throw new Error('SearchReferralCounter requires a directory.');
    this.directory = directory;
    this.timeZone = timeZone;
    this.now = now;
    this.onError = onError;
    this.days = new Map();
    this.queue = Promise.resolve();
  }

  record(entry) {
    const recordedAt = this.now();
    const date = dayInTimeZone(recordedAt, this.timeZone);
    this.queue = this.queue
      .then(async () => {
        const aggregate = await this.load(date);
        aggregate.searchLandingVisits += 1;
        aggregate.engines[entry.engine] = (aggregate.engines[entry.engine] ?? 0) + 1;
        aggregate.pages[entry.path] = (aggregate.pages[entry.path] ?? 0) + 1;
        await this.persist(aggregate);
      })
      .catch((error) => this.onError('Search referral aggregate write failed:', error));
    return this.queue;
  }

  async load(date) {
    if (this.days.has(date)) return this.days.get(date);
    const filePath = join(this.directory, `${date}.json`);
    let aggregate;
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (!isAggregate(parsed, date)) throw new Error('invalid aggregate structure');
      aggregate = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`Cannot read ${filePath}: ${error.message}`);
      aggregate = emptyAggregate(date);
    }
    this.days.set(date, aggregate);
    return aggregate;
  }

  async persist(aggregate) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filePath = join(this.directory, `${aggregate.date}.json`);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(aggregate, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  flush() {
    return this.queue;
  }
}
