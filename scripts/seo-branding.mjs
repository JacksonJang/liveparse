// Shared release checks for the site's English metadata, localized metadata,
// and stable search icon.
const LIVE_LOCALIZED_PAGES = new Map([
  ['/es/contador-de-palabras/', { language: 'es', ogLocale: 'es_ES' }],
  ['/es/contador-de-caracteres/', { language: 'es', ogLocale: 'es_ES' }],
  ['/ko/json-parser/', { language: 'ko', ogLocale: 'ko_KR' }],
  ['/ko/character-counter/', { language: 'ko', ogLocale: 'ko_KR' }],
  ['/ja/character-counter/', { language: 'ja', ogLocale: 'ja_JP' }],
  ['/ko/word-counter/', { language: 'ko', ogLocale: 'ko_KR' }],
  ['/ja/word-counter/', { language: 'ja', ogLocale: 'ja_JP' }],
]);
const ALLOWED_HREFLANG_VALUES = new Set(['en', 'es', 'ko', 'ja', 'x-default']);
const RETIRED_LANGUAGE_PREFIX = /^(?:https:\/\/liveparse\.com)?\/(?:ko|ja|es)\//;

export function isLiveLocalizedPath(pathname) {
  return LIVE_LOCALIZED_PAGES.has(pathname);
}

export function liveLocalizedConfig(pathname) {
  return LIVE_LOCALIZED_PAGES.get(pathname);
}

function parseAttributes(tag) {
  return new Map([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)]
    .map((match) => [match[1].toLowerCase(), match[2]]));
}

export function validateEnglishBranding(html, label) {
  const failures = [];
  const language = parseAttributes(html.match(/<html\b[^>]*>/i)?.[0] || '').get('lang');
  if (language !== 'en') failures.push(`${label}: html lang must be en`);
  const links = [...html.matchAll(/<(a|link)\b[^>]*>/gi)].map((match) => ({
    tag: match[1].toLowerCase(), ...Object.fromEntries(parseAttributes(match[0])),
  }));
  for (const link of links) {
    const href = link.href || '';
    const isAnchor = link.tag === 'a';
    const isHreflangAlternate = Boolean(link.hreflang) && (link.rel || '').toLowerCase() === 'alternate';
    const normalizedHref = href.replace(/^https:\/\/liveparse\.com/, '');
    if (!isHreflangAlternate && RETIRED_LANGUAGE_PREFIX.test(href) && !LIVE_LOCALIZED_PAGES.has(normalizedHref)) {
      failures.push(`${label}: retired language URL ${href}`);
    }
    if (Boolean(link.hreflang) && !isAnchor
      && (!isHreflangAlternate || !ALLOWED_HREFLANG_VALUES.has(link.hreflang))) {
      failures.push(`${label}: hreflang alternates must use rel="alternate" and en, es, ko, or x-default`);
    }
    if (isHreflangAlternate && link.hreflang !== 'en' && /^[a-z]{2}$/.test(link.hreflang || '')
      && !LIVE_LOCALIZED_PAGES.has(normalizedHref)) {
      failures.push(`${label}: hreflang ${link.hreflang} must point to a live localized page`);
    }
  }
  if (!links.some((link) => link.rel === 'icon' && link.href === '/icon-192.png'
    && link.type === 'image/png' && link.sizes === '192x192')) {
    failures.push(`${label}: missing stable 192px PNG favicon declaration`);
  }
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
  for (const meta of metadata) {
    if (meta.get('property') === 'og:locale' && meta.get('content') !== 'en_US') {
      failures.push(`${label}: og:locale must be en_US`);
    }
  }
  const searchText = [
    ...[...html.matchAll(/<(?:title|h1)\b[^>]*>(.*?)<\/(?:title|h1)>/gis)].map((match) => match[1]),
    ...metadata.filter((meta) => /(?:title|description)$/.test(meta.get('name') || meta.get('property') || ''))
      .map((meta) => meta.get('content') || ''),
  ];
  if (searchText.some((value) => /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value))) {
    failures.push(`${label}: search titles and descriptions must be English`);
  }
  for (const match of html.matchAll(/"inLanguage"\s*:\s*"([^"]+)"/g)) {
    if (!/^en(?:[-_]US)?$/.test(match[1])) failures.push(`${label}: structured data must describe English content`);
  }
  return failures;
}

export function validateLocalizedBranding(html, label, { language = 'es', ogLocale = 'es_ES' } = {}) {
  const failures = [];
  const htmlLanguage = parseAttributes(html.match(/<html\b[^>]*>/i)?.[0] || '').get('lang');
  if (htmlLanguage !== language) failures.push(`${label}: html lang must be ${language}`);
  const links = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
  for (const link of links) {
    const href = link.get('href') || '';
    if (RETIRED_LANGUAGE_PREFIX.test(href) && !LIVE_LOCALIZED_PAGES.has(href.replace(/^https:\/\/liveparse\.com/, ''))) {
      failures.push(`${label}: retired language URL ${href}`);
    }
  }
  if (!links.some((link) => link.get('rel') === 'icon' && link.get('href') === '/icon-192.png'
    && link.get('type') === 'image/png' && link.get('sizes') === '192x192')) {
    failures.push(`${label}: missing stable 192px PNG favicon declaration`);
  }
  const alternateLinks = links.filter((link) => (link.get('rel') || '').toLowerCase() === 'alternate'
    && link.has('hreflang'));
  const hreflangValues = new Set(alternateLinks.map((link) => link.get('hreflang')));
  for (const required of ['en', language, 'x-default']) {
    if (!hreflangValues.has(required)) failures.push(`${label}: missing hreflang alternate for ${required}`);
  }
  const localizedAlternate = alternateLinks.find((link) => link.get('hreflang') === language);
  const canonicals = links.filter((link) => (link.get('rel') || '').toLowerCase() === 'canonical');
  if (canonicals.length !== 1) {
    failures.push(`${label}: expected exactly one canonical link, found ${canonicals.length}`);
  } else if (localizedAlternate) {
    const canonicalHref = canonicals[0].get('href') || '';
    const alternateHref = localizedAlternate.get('href') || '';
    const normalize = (href) => href.replace(/^https:\/\/liveparse\.com/, '');
    if (normalize(alternateHref) !== normalize(canonicalHref)) {
      failures.push(`${label}: hreflang ${language} alternate must match the canonical URL`);
    }
  }
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
  for (const meta of metadata) {
    if (meta.get('property') === 'og:locale' && meta.get('content') !== ogLocale) {
      failures.push(`${label}: og:locale must be ${ogLocale}`);
    }
    if ((meta.get('name') || '').toLowerCase() === 'robots' && /noindex|nofollow|none/i.test(meta.get('content') || '')) {
      failures.push(`${label}: meta robots must allow indexing`);
    }
  }
  for (const match of html.matchAll(/"inLanguage"\s*:\s*"([^"]+)"/g)) {
    if (!new RegExp(`^${language}(?:[-_](?:[A-Za-z]{2,4}))?$`).test(match[1])) {
      failures.push(`${label}: structured data must describe ${language} content`);
    }
  }
  return failures;
}

export function validateSpanishBranding(html, label) {
  return validateLocalizedBranding(html, label, { language: 'es', ogLocale: 'es_ES' });
}

export function validateKoreanBranding(html, label) {
  return validateLocalizedBranding(html, label, { language: 'ko', ogLocale: 'ko_KR' });
}

export function validateJapaneseBranding(html, label) {
  return validateLocalizedBranding(html, label, { language: 'ja', ogLocale: 'ja_JP' });
}

export function validatePngIcon(bytes, expectedSize, label) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.toString('ascii', 12, 16) !== 'IHDR') return [`${label}: invalid PNG header`];
  return bytes.readUInt32BE(16) === expectedSize && bytes.readUInt32BE(20) === expectedSize
    ? [] : [`${label}: expected a square ${expectedSize}px PNG`];
}
