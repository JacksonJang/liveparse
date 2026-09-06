import { describe, expect, it } from 'vitest';
import { updateSitemap } from './update-sitemap-lastmod.mjs';

describe('update-sitemap-lastmod', () => {
  it('rewrites lastmod from the resolver and leaves unresolved or unchanged entries alone', () => {
    const xml = `<urlset>
  <url>
    <loc>https://liveparse.com/</loc>
    <lastmod>2026-08-01</lastmod>
  </url>
  <url>
    <loc>https://liveparse.com/about/</loc>
    <lastmod>2026-09-04</lastmod>
  </url>
  <url>
    <loc>https://liveparse.com/unknown/</loc>
    <lastmod>2026-01-01</lastmod>
  </url>
</urlset>`;
    const dates = { '/': '2026-09-06', '/about/': '2026-09-04' };
    const { xml: next, changed } = updateSitemap(xml, (p) => dates[p] ?? null);
    expect(changed).toBe(1);
    expect(next).toContain('<loc>https://liveparse.com/</loc>\n    <lastmod>2026-09-06</lastmod>');
    expect(next).toContain('<loc>https://liveparse.com/unknown/</loc>\n    <lastmod>2026-01-01</lastmod>');
  });
});
