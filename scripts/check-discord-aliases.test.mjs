import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, discordRedirectRequests, runDiscordAliasCheck } from './check-discord-aliases.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function startServer(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

describe('Discord alias redirect guard', () => {
  it('builds slash, directory, and index variants for browser and Googlebot', () => {
    const requests = discordRedirectRequests();
    expect(requests).toHaveLength(36);
    expect(requests.filter(({ sourcePath }) => sourcePath === '/discord-snowflake-converter/')).toHaveLength(2);
    expect(requests.some(({ sourcePath }) => sourcePath === '/discord-message-id-converter/index.html')).toBe(true);
  });

  it('accepts permanent redirects to the canonical generator', async () => {
    const requests = [];
    const baseUrl = await startServer((request, response) => {
      requests.push(request.url);
      response.setHeader('Location', '/discord-timestamp-generator/');
      response.statusCode = 308;
      response.end();
    });

    await expect(runDiscordAliasCheck({ baseUrl, timeoutMs: 1_000 })).resolves.toEqual({
      redirects: 6,
      requests: 36,
    });
    expect(DEFAULT_BASE_URL).toBe('https://liveparse.com');
    expect(requests).toHaveLength(36);
  });

  it('fails stale deployment routes that still return 404', async () => {
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/discord-timestamp-converter/') {
        response.setHeader('Location', '/discord-timestamp-generator/');
        response.statusCode = 308;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });

    let error;
    try {
      await runDiscordAliasCheck({ baseUrl, timeoutMs: 1_000 });
    } catch (caught) {
      error = caught;
    }
    expect(error?.name).toBe('DiscordAliasCheckError');
    expect(error?.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('/discord-snowflake-converter: expected HTTP 308, received HTTP 404'),
    ]));
  });
});
