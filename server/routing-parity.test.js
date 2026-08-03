import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');

function block(source, name, closing) {
  const pattern = new RegExp(`const ${name} = [\\s\\S]*?\\(\\[([\\s\\S]*?)\\]\\);${closing ?? ''}`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`Could not locate ${name}.`);
  return match[1];
}

function directoryRoutes(source) {
  return [...block(source, 'DIRECTORY_ROUTES').matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function routeRedirects(source) {
  return [...block(source, 'ROUTE_REDIRECTS').matchAll(/\['([^']+)',\s*'([^']+)'\]/g)]
    .map((match) => [match[1], match[2]]);
}

describe('production routing parity', () => {
  it('keeps Node and Cloudflare canonical routes and aliases identical', async () => {
    const [nodeSource, workerSource] = await Promise.all([
      readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8'),
      readFile(resolve(projectRoot, 'server/worker.js'), 'utf8'),
    ]);

    expect(directoryRoutes(nodeSource)).toEqual(directoryRoutes(workerSource));
    expect(routeRedirects(nodeSource)).toEqual(routeRedirects(workerSource));
  });

  it('defines slash and non-slash forms for every alias and direct canonical targets', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = new Set(directoryRoutes(source));
    const redirects = new Map(routeRedirects(source));

    for (const [alias, target] of redirects) {
      expect(target.endsWith('/')).toBe(true);
      expect(directories.has(target.slice(0, -1))).toBe(true);
      if (alias.endsWith('/')) expect(redirects.get(alias.slice(0, -1))).toBe(target);
      else expect(redirects.get(`${alias}/`)).toBe(target);
      expect(redirects.has(target)).toBe(false);
    }
  });

  it('includes the JWT canonical pages and guide without validator-like aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));

    expect(directories).toEqual(expect.arrayContaining([
      '/jwt-decoder',
      '/jwt-expiration-checker',
      '/guides/jwt-decode-vs-verify',
    ]));
    expect(redirects.get('/jwt-decode')).toBe('/jwt-decoder/');
    expect(redirects.get('/jwt-exp-checker')).toBe('/jwt-expiration-checker/');
    expect(redirects.has('/jwt-validator')).toBe(false);
    expect(redirects.has('/jwt-verify')).toBe(false);
  });

  it('includes the SQL formatter cluster with synonym and dialect aliases but no validation claims', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));

    expect(directories).toEqual(expect.arrayContaining([
      '/sql-formatter',
      '/mysql-sql-formatter',
      '/postgresql-sql-formatter',
      '/bigquery-sql-formatter',
      '/sql-server-formatter',
      '/guides/sql-dialect-formatting',
    ]));
    expect(redirects.get('/sql-beautifier')).toBe('/sql-formatter/');
    expect(redirects.get('/format-sql')).toBe('/sql-formatter/');
    expect(redirects.get('/mysql-formatter')).toBe('/mysql-sql-formatter/');
    expect(redirects.get('/postgres-formatter')).toBe('/postgresql-sql-formatter/');
    expect(redirects.get('/google-sql-formatter')).toBe('/bigquery-sql-formatter/');
    expect(redirects.get('/tsql-formatter')).toBe('/sql-server-formatter/');
    expect(redirects.has('/sql-validator')).toBe(false);
    expect(redirects.has('/sql-parser')).toBe(false);
    expect(redirects.has('/sql-linter')).toBe(false);
  });
});
