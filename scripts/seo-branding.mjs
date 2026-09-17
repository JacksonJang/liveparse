// Shared release checks for the site's English metadata and stable search icon.
export function validateEnglishBranding(html, label) {
  const failures = [];
  const attributes = (tag) => new Map([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)]
    .map((match) => [match[1].toLowerCase(), match[2]]));
  const language = attributes(html.match(/<html\b[^>]*>/i)?.[0] || '').get('lang');
  if (language !== 'en') failures.push(`${label}: html lang must be en`);
  const links = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].map((match) => attributes(match[0]));
  for (const link of links) {
    const href = link.get('href') || '';
    if (/^(?:https:\/\/liveparse\.com)?\/(ko|ja|es)\//.test(href)) {
      failures.push(`${label}: retired language URL ${href}`);
    }
    if (link.has('hreflang')) failures.push(`${label}: remove obsolete language alternates`);
  }
  if (!links.some((link) => link.get('rel') === 'icon' && link.get('href') === '/icon-192.png'
    && link.get('type') === 'image/png' && link.get('sizes') === '192x192')) {
    failures.push(`${label}: missing stable 192px PNG favicon declaration`);
  }
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attributes(match[0]));
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

export function validatePngIcon(bytes, expectedSize, label) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.toString('ascii', 12, 16) !== 'IHDR') return [`${label}: invalid PNG header`];
  return bytes.readUInt32BE(16) === expectedSize && bytes.readUInt32BE(20) === expectedSize
    ? [] : [`${label}: expected a square ${expectedSize}px PNG`];
}
