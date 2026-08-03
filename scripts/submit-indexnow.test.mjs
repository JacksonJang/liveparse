import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  changedCanonicalUrls,
  parseCanonicalSitemapUrls,
  runIndexNowSubmission,
} from './submit-indexnow.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sitemap(...urls) {
  return `<?xml version="1.0"?><urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'liveparse-indexnow-'));
  temporaryDirectories.push(root);
  const distClientRoot = join(root, 'dist/client');
  const sitemapPath = join(root, 'sitemap.xml');
  const keyPath = join(root, 'key.txt');
  const statePath = join(root, 'runtime/state.json');
  await mkdir(join(distClientRoot, 'tool'), { recursive: true });
  await Promise.all([
    writeFile(keyPath, 'test-key\n'),
    writeFile(join(distClientRoot, 'index.html'), '<h1>Home</h1>'),
    writeFile(join(distClientRoot, 'tool/index.html'), '<h1>Tool v1</h1>'),
    writeFile(sitemapPath, sitemap('https://example.com/', 'https://example.com/tool/')),
  ]);
  return { root, distClientRoot, sitemapPath, keyPath, statePath };
}

describe('IndexNow canonical change selection', () => {
  it('validates canonical sitemap URLs and rejects duplicates or query variants', () => {
    expect(parseCanonicalSitemapUrls(sitemap('https://liveparse.com/', 'https://liveparse.com/tool/'))).toEqual([
      'https://liveparse.com/',
      'https://liveparse.com/tool/',
    ]);
    expect(() => parseCanonicalSitemapUrls(sitemap('https://liveparse.com/', 'https://liveparse.com/'))).toThrow(/Duplicate/);
    expect(() => parseCanonicalSitemapUrls(sitemap('https://liveparse.com/tool/?x=1'))).toThrow(/non-canonical/);
    expect(() => parseCanonicalSitemapUrls(sitemap('https://liveparse.com:444/'))).toThrow(/non-canonical/);
  });

  it('includes added, changed, and deleted URLs but not unchanged URLs', () => {
    expect(changedCanonicalUrls(
      { 'https://liveparse.com/': 'a', 'https://liveparse.com/new/': 'b' },
      { 'https://liveparse.com/': 'a', 'https://liveparse.com/old/': 'c' },
    )).toEqual(['https://liveparse.com/new/', 'https://liveparse.com/old/']);
  });

  it('persists a successful snapshot and skips unchanged pages on the next run', async () => {
    const paths = await fixture();
    const requests = [];
    const options = {
      ...paths,
      host: 'example.com',
      key: 'test-key',
      endpoint: 'https://indexnow.example/indexnow',
      fetchImpl: async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return new Response('', { status: 200 });
      },
      now: () => new Date('2026-08-04T00:00:00.000Z'),
      write: () => {},
    };

    const first = await runIndexNowSubmission(options);
    expect(first.urlList).toEqual(['https://example.com/', 'https://example.com/tool/']);
    expect(requests).toHaveLength(1);

    const second = await runIndexNowSubmission(options);
    expect(second).toMatchObject({ submitted: false, urlList: [], canonicalCount: 2 });
    expect(requests).toHaveLength(1);

    await writeFile(join(paths.distClientRoot, 'tool/index.html'), '<h1>Tool v2</h1>');
    const third = await runIndexNowSubmission(options);
    expect(third.urlList).toEqual(['https://example.com/tool/']);
    expect(requests.at(-1).body.urlList).toEqual(['https://example.com/tool/']);

    const state = JSON.parse(await readFile(paths.statePath, 'utf8'));
    expect(state).toMatchObject({ version: 1, submittedAt: '2026-08-04T00:00:00.000Z' });
  });

  it('notifies IndexNow about a canonical URL removed from the sitemap', async () => {
    const paths = await fixture();
    const bodies = [];
    const options = {
      ...paths,
      host: 'example.com',
      key: 'test-key',
      endpoint: 'https://indexnow.example/indexnow',
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response('', { status: 202 });
      },
      write: () => {},
    };
    await runIndexNowSubmission(options);
    await writeFile(paths.sitemapPath, sitemap('https://example.com/'));
    const result = await runIndexNowSubmission(options);
    expect(result.status).toBe(202);
    expect(bodies.at(-1).urlList).toEqual(['https://example.com/tool/']);
  });
});
