import { describe, expect, it, vi } from 'vitest';
import {
  ATOM_NAMESPACE,
  WEBSUB_FEED_URL,
  WEBSUB_HUB_URL,
  runWebSubNotification,
  validateAtomFeed,
} from './notify-websub.mjs';

const LATEST = '2026-08-04T06:56:03+09:00';
const OLDER = '2026-08-04T05:37:22+09:00';

function atomFeed({
  feedId = WEBSUB_FEED_URL,
  selfHref = WEBSUB_FEED_URL,
  hubHref = WEBSUB_HUB_URL,
  feedUpdated = LATEST,
  latestEntryUpdated = LATEST,
  selfType = 'application/atom+xml',
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="${ATOM_NAMESPACE}">
  <id>${feedId}</id>
  <title>LiveParse updates</title>
  <updated>${feedUpdated}</updated>
  <link rel="self" type="${selfType}" href="${selfHref}" />
  <link rel="hub" href="${hubHref}" />
  <entry>
    <id>https://liveparse.com/older/</id>
    <title>Older entry</title>
    <updated>${OLDER}</updated>
  </entry>
  <entry>
    <id>https://liveparse.com/latest/</id>
    <title>Latest entry</title>
    <updated>${latestEntryUpdated}</updated>
  </entry>
</feed>`;
}

function feedResponse(source = atomFeed(), init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/atom+xml; charset=UTF-8');
  return new Response(source, { ...init, headers });
}

describe('WebSub Atom validation', () => {
  it('accepts the exact feed identity, discovery links, and latest RFC 3339 timestamp', () => {
    expect(validateAtomFeed(atomFeed())).toEqual({
      entryCount: 2,
      feedId: WEBSUB_FEED_URL,
      updated: LATEST,
      updatedTimestamp: Date.parse(LATEST),
    });
  });

  it.each([
    ['feed id', atomFeed({ feedId: 'https://liveparse.com/other.xml' }), /feed <id> must be exactly/],
    ['self URL', atomFeed({ selfHref: 'https://liveparse.com/other.xml' }), /rel="self" link must be exactly/],
    ['self type', atomFeed({ selfType: 'application/xml' }), /type="application\/atom\+xml"/],
    ['hub URL', atomFeed({ hubHref: 'https://example.com/hub' }), /rel="hub" link must be exactly/],
    ['invalid calendar date', atomFeed({ feedUpdated: '2026-02-30T10:00:00Z', latestEntryUpdated: '2026-02-30T10:00:00Z' }), /not a valid RFC 3339/],
    ['stale feed timestamp', atomFeed({ feedUpdated: OLDER }), /must equal the latest entry/],
  ])('rejects an inexact or stale %s before notification', (_label, source, expected) => {
    expect(() => validateAtomFeed(source)).toThrow(expected);
  });

  it('requires exactly one direct self and hub relation', () => {
    const duplicateSelf = atomFeed().replace(
      '<link rel="hub"',
      `<link rel="self" type="application/atom+xml" href="${WEBSUB_FEED_URL}" />\n  <link rel="hub"`,
    );
    expect(() => validateAtomFeed(duplicateSelf)).toThrow(/exactly one direct rel="self" link; found 2/);
  });
});

describe('manual WebSub publish notification', () => {
  it('validates the public feed before posting the exact form and reports the non-guarantee', async () => {
    const requests = [];
    const output = [];
    const fetchImpl = vi.fn(async (url, init) => {
      requests.push({ url, init });
      if (url === WEBSUB_FEED_URL) return feedResponse();
      if (url === WEBSUB_HUB_URL) return new Response(null, { status: 204 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await runWebSubNotification({ fetchImpl, write: (message) => output.push(message) });

    expect(result).toEqual({
      entryCount: 2,
      feedUrl: WEBSUB_FEED_URL,
      hubUrl: WEBSUB_HUB_URL,
      status: 204,
      updated: LATEST,
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: WEBSUB_FEED_URL,
      init: { method: 'GET', redirect: 'manual' },
    });
    expect(requests[0].init.headers.Accept).toBe('application/atom+xml');
    expect(requests[1]).toMatchObject({
      url: WEBSUB_HUB_URL,
      init: { method: 'POST', redirect: 'manual' },
    });
    expect(requests[1].init.headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
    expect(new URLSearchParams(requests[1].init.body)).toEqual(new URLSearchParams([
      ['hub.mode', 'publish'],
      ['hub.url', WEBSUB_FEED_URL],
    ]));
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('accepted the publish notification');
    expect(output[0]).toContain('accepted notification is not an indexing guarantee');
  });

  it.each([
    ['non-2xx status', feedResponse('unavailable', { status: 503 }), /Public Atom feed request failed with HTTP 503/],
    ['wrong media type', feedResponse(atomFeed(), { headers: { 'Content-Type': 'application/xml' } }), /must use Content-Type application\/atom\+xml/],
    ['invalid XML', feedResponse('<feed>'), /not well-formed XML/],
    ['wrong feed identity', feedResponse(atomFeed({ feedId: 'https://liveparse.com/wrong.xml' })), /feed <id> must be exactly/],
  ])('does not contact the hub when the public feed has a %s', async (_label, response, expected) => {
    const fetchImpl = vi.fn(async () => response);
    await expect(runWebSubNotification({ fetchImpl, write: () => {} })).rejects.toThrow(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails a non-2xx hub response and includes a bounded useful detail', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(feedResponse())
      .mockResolvedValueOnce(new Response('topic was rejected', { status: 400 }));

    await expect(runWebSubNotification({ fetchImpl, write: () => {} }))
      .rejects.toThrow('WebSub hub request failed with HTTP 400: topic was rejected');
  });

  it.each([
    ['feed', 0],
    ['hub', 1],
  ])('refuses an untrusted-origin redirect from the %s request', async (_label, redirectAt) => {
    const redirect = new Response(null, {
      status: 307,
      headers: { Location: 'https://attacker.example/collect' },
    });
    const fetchImpl = vi.fn(async (_url, _init) => {
      if (fetchImpl.mock.calls.length - 1 === redirectAt) return redirect;
      return feedResponse();
    });

    await expect(runWebSubNotification({ fetchImpl, write: () => {} }))
      .rejects.toThrow(/refused a redirect to untrusted origin https:\/\/attacker\.example/);
    expect(fetchImpl).toHaveBeenCalledTimes(redirectAt + 1);
  });

  it('caps the streamed hub response body even without Content-Length', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(feedResponse())
      .mockResolvedValueOnce(new Response('x'.repeat(33), { status: 400 }));

    await expect(runWebSubNotification({
      fetchImpl,
      maximumResponseBytes: 32,
      write: () => {},
    })).rejects.toThrow('WebSub hub request response is larger than 32 bytes');
  });

  it('aborts a request that exceeds its timeout and never posts afterward', async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));

    await expect(runWebSubNotification({ fetchImpl, timeoutMs: 10, write: () => {} }))
      .rejects.toThrow('Public Atom feed request timed out after 10 ms');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
