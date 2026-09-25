import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { validateEnglishBranding, validateKoreanBranding, validatePngIcon, validateSpanishBranding } from './seo-branding.mjs';

const page = '<html lang="en"><head><title>JSON Formatter | LiveParse</title>' +
  '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">' +
  '<meta property="og:locale" content="en_US"></head><body><h1>JSON Formatter</h1></body></html>';

describe('English search branding', () => {
  it('accepts English metadata with multilingual input examples', () => {
    expect(validateEnglishBranding(page.replace('</body>', '<pre>한국어 日本語 Español</pre></body>'), 'example')).toEqual([]);
  });
  it('catches stale language pages, alternates, and search metadata', () => {
    const stale = page.replace('lang="en"', 'lang="ko"').replace('JSON Formatter | LiveParse', '한국어 JSON 파서')
      .replace('</head>', '<link rel="alternate" hreflang="es" href="/es/contador-palabras/"></head>');
    expect(validateEnglishBranding(stale, 'example').join('\n')).toMatch(/lang must be en/);
    expect(validateEnglishBranding(stale, 'example').join('\n')).toMatch(/hreflang es must point to a live localized page/);
    expect(validateEnglishBranding(stale, 'example').join('\n')).toMatch(/titles and descriptions must be English/);
  });
  it('permits hreflang alternates for the live Spanish pages and blocks retired ko/ja links', () => {
    const withAlternates = page.replace('</head>',
      '<link rel="alternate" hreflang="en" href="https://liveparse.com/word-counter/">' +
      '<link rel="alternate" hreflang="es" href="/es/contador-de-palabras/">' +
      '<link rel="alternate" hreflang="x-default" href="https://liveparse.com/word-counter/"></head>');
    expect(validateEnglishBranding(withAlternates, 'example')).toEqual([]);
    const retired = page.replace('</body>', '<a href="/es/contador-palabras/">old</a><a href="/es/contar-caracteres/">old</a></body>');
    expect(validateEnglishBranding(retired, 'example').join('\n')).toMatch(/retired language URL/);
    expect(validateEnglishBranding(retired, 'example').join('\n').match(/retired language URL/g)).toHaveLength(2);
  });
  it('validates the Spanish branding contract and its hreflang cluster', () => {
    const spanishPage = '<html lang="es"><head><title>Contador de palabras | LiveParse</title>' +
      '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">' +
      '<link rel="canonical" href="https://liveparse.com/es/contador-de-palabras/">' +
      '<link rel="alternate" hreflang="en" href="https://liveparse.com/word-counter/">' +
      '<link rel="alternate" hreflang="es" href="https://liveparse.com/es/contador-de-palabras/">' +
      '<link rel="alternate" hreflang="x-default" href="https://liveparse.com/word-counter/">' +
      '<meta property="og:locale" content="es_ES">' +
      '<meta name="robots" content="index,follow"></head><body><h1>Contador de palabras</h1>' +
      '<script type="application/ld+json">{"inLanguage":"es"}</script></body></html>';
    expect(validateSpanishBranding(spanishPage, 'example')).toEqual([]);
    const wrongLocale = spanishPage.replace('lang="es"', 'lang="en"').replace('es_ES', 'en_US')
      .replace(/<link rel="alternate" hreflang="x-default"[^>]*>/, '');
    const failures = validateSpanishBranding(wrongLocale, 'example');
    expect(failures.join('\n')).toMatch(/lang must be es/);
    expect(failures.join('\n')).toMatch(/og:locale must be es_ES/);
    expect(failures.join('\n')).toMatch(/missing hreflang alternate for x-default/);
    const mismatchedAlternate = spanishPage.replace('hreflang="es" href="https://liveparse.com/es/contador-de-palabras/"',
      'hreflang="es" href="https://liveparse.com/es/contador-de-caracteres/"');
    expect(validateSpanishBranding(mismatchedAlternate, 'example').join('\n')).toMatch(/must match the canonical URL/);
  });
  it('validates the Korean branding contract and its hreflang cluster', () => {
    const koreanPage = '<html lang="ko"><head><title>JSON 파서 | LiveParse</title>' +
      '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">' +
      '<link rel="canonical" href="https://liveparse.com/ko/json-parser/">' +
      '<link rel="alternate" hreflang="en" href="https://liveparse.com/json-formatter/">' +
      '<link rel="alternate" hreflang="ko" href="https://liveparse.com/ko/json-parser/">' +
      '<link rel="alternate" hreflang="x-default" href="https://liveparse.com/json-formatter/">' +
      '<meta property="og:locale" content="ko_KR">' +
      '<meta name="robots" content="index,follow"></head><body><h1>JSON 파서</h1>' +
      '<script type="application/ld+json">{"inLanguage":"ko"}</script></body></html>';
    expect(validateKoreanBranding(koreanPage, 'example')).toEqual([]);
    const wrongLanguage = koreanPage.replace('lang="ko"', 'lang="en"').replace('ko_KR', 'en_US');
    expect(validateKoreanBranding(wrongLanguage, 'example').join('\n')).toMatch(/lang must be ko/);
  });
  it('requires the PNG declaration and detects wrong image bytes or dimensions', async () => {
    expect(validateEnglishBranding(page.replace('192x192', '48x48'), 'example')).toHaveLength(1);
    const icon = await readFile(new URL('../public/icon-192.png', import.meta.url));
    expect(validatePngIcon(icon, 192, 'icon')).toEqual([]);
    expect(validatePngIcon(icon, 512, 'icon')).toHaveLength(1);
    expect(validatePngIcon(Buffer.from('<html>not an image</html>'), 192, 'icon')).toHaveLength(1);
  });
});
