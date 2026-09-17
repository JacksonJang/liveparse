import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { validateEnglishBranding, validatePngIcon } from './seo-branding.mjs';

const page = '<html lang="en"><head><title>JSON Formatter | LiveParse</title>' +
  '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">' +
  '<meta property="og:locale" content="en_US"></head><body><h1>JSON Formatter</h1></body></html>';

describe('English search branding', () => {
  it('accepts English metadata with multilingual input examples', () => {
    expect(validateEnglishBranding(page.replace('</body>', '<pre>한국어 日本語 Español</pre></body>'), 'example')).toEqual([]);
  });
  it('catches stale language pages, alternates, and search metadata', () => {
    const stale = page.replace('lang="en"', 'lang="ko"').replace('JSON Formatter | LiveParse', '한국어 JSON 파서')
      .replace('</head>', '<link rel="alternate" hreflang="ko" href="/ko/json-parser/"></head>');
    expect(validateEnglishBranding(stale, 'example').join('\n')).toMatch(/lang must be en/);
    expect(validateEnglishBranding(stale, 'example').join('\n')).toMatch(/retired language URL/);
    expect(validateEnglishBranding(stale, 'example').join('\n')).toMatch(/titles and descriptions must be English/);
  });
  it('requires the PNG declaration and detects wrong image bytes or dimensions', async () => {
    expect(validateEnglishBranding(page.replace('192x192', '48x48'), 'example')).toHaveLength(1);
    const icon = await readFile(new URL('../public/icon-192.png', import.meta.url));
    expect(validatePngIcon(icon, 192, 'icon')).toEqual([]);
    expect(validatePngIcon(icon, 512, 'icon')).toHaveLength(1);
    expect(validatePngIcon(Buffer.from('<html>not an image</html>'), 192, 'icon')).toHaveLength(1);
  });
});
