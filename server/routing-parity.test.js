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

  it('includes the UUID generator, validator, decoder, and guide cluster with intentional aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set([
      '/uuid-generator/',
      '/uuid-v4-generator/',
      '/uuid-v7-generator/',
      '/uuid-validator/',
      '/uuid-decoder/',
    ]);
    const expectedAliases = new Map([
      ['/guid-generator', '/uuid-generator/'],
      ['/generate-uuid', '/uuid-generator/'],
      ['/uuid-generator-online', '/uuid-generator/'],
      ['/uuid-v4', '/uuid-v4-generator/'],
      ['/uuid4-generator', '/uuid-v4-generator/'],
      ['/generate-uuid-v4', '/uuid-v4-generator/'],
      ['/guid-v4-generator', '/uuid-v4-generator/'],
      ['/uuid-v7', '/uuid-v7-generator/'],
      ['/uuid-checker', '/uuid-validator/'],
      ['/uuid-decode', '/uuid-decoder/'],
      ['/decode-uuid', '/uuid-decoder/'],
      ['/uuid-parser', '/uuid-decoder/'],
      ['/uuid-inspector', '/uuid-decoder/'],
      ['/guid-decoder', '/uuid-decoder/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/uuid-generator',
      '/uuid-v4-generator',
      '/uuid-v7-generator',
      '/uuid-validator',
      '/uuid-decoder',
      '/guides/uuid-v4-vs-v7',
      '/guides/uuid-versions-explained',
      '/guides/uuid-collision-probability',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualUuidAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualUuidAliases).toEqual(completeExpectedAliases);
    expect(redirects.has('/uuid-v4-generator')).toBe(false);
    expect(redirects.has('/uuid-decoder')).toBe(false);
    expect(redirects.get('/uuid-checker')).toBe('/uuid-validator/');
  });

  it('includes the hash and checksum cluster with intentional canonical aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set([
      '/hash-generator/',
      '/sha256-generator/',
      '/md5-generator/',
      '/file-checksum/',
    ]);
    const expectedAliases = new Map([
      ['/hash', '/hash-generator/'],
      ['/hashing-tool', '/hash-generator/'],
      ['/online-hash-generator', '/hash-generator/'],
      ['/sha-256-generator', '/sha256-generator/'],
      ['/sha256-hash', '/sha256-generator/'],
      ['/sha256', '/sha256-generator/'],
      ['/md5-hash-generator', '/md5-generator/'],
      ['/md5-hash', '/md5-generator/'],
      ['/md5', '/md5-generator/'],
      ['/checksum', '/file-checksum/'],
      ['/checksum-calculator', '/file-checksum/'],
      ['/file-hash', '/file-checksum/'],
      ['/file-hash-calculator', '/file-checksum/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/hash-generator',
      '/sha256-generator',
      '/md5-generator',
      '/file-checksum',
      '/guides',
      '/guides/sha256-vs-md5',
      '/guides/hash-vs-encryption',
      '/guides/how-to-verify-file-checksum',
      '/guides/hashing-utf8-newlines',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualAliases).toEqual(completeExpectedAliases);
  });

  it('includes the URL encoding and parsing cluster with intentional canonical aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set([
      '/url-encoder/',
      '/url-decoder/',
      '/url-parser/',
      '/query-string-parser/',
    ]);
    const expectedAliases = new Map([
      ['/url-encode', '/url-encoder/'],
      ['/encode-url', '/url-encoder/'],
      ['/urlencode', '/url-encoder/'],
      ['/percent-encoder', '/url-encoder/'],
      ['/url-decode', '/url-decoder/'],
      ['/decode-url', '/url-decoder/'],
      ['/urldecode', '/url-decoder/'],
      ['/percent-decoder', '/url-decoder/'],
      ['/parse-url', '/url-parser/'],
      ['/url-inspector', '/url-parser/'],
      ['/url-analyzer', '/url-parser/'],
      ['/query-string', '/query-string-parser/'],
      ['/query-parser', '/query-string-parser/'],
      ['/parse-query-string', '/query-string-parser/'],
      ['/url-query-parser', '/query-string-parser/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/url-encoder',
      '/url-decoder',
      '/url-parser',
      '/query-string-parser',
      '/guides/url-percent-encoding',
      '/guides/encodeuri-vs-encodeuricomponent',
      '/guides/percent20-vs-plus',
      '/guides/double-url-encoding',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualAliases).toEqual(completeExpectedAliases);
  });

  it('includes the number-base, binary-text, and ASCII cluster with intentional aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set([
      '/binary-converter/',
      '/hex-converter/',
      '/binary-translator/',
      '/ascii-table/',
    ]);
    const expectedAliases = new Map([
      ['/binary-to-decimal', '/binary-converter/'],
      ['/decimal-to-binary', '/binary-converter/'],
      ['/base-converter', '/binary-converter/'],
      ['/number-base-converter', '/binary-converter/'],
      ['/hex-to-decimal', '/hex-converter/'],
      ['/decimal-to-hex', '/hex-converter/'],
      ['/hexadecimal-converter', '/hex-converter/'],
      ['/binary-to-text', '/binary-translator/'],
      ['/text-to-binary', '/binary-translator/'],
      ['/ascii-chart', '/ascii-table/'],
      ['/ascii-code-table', '/ascii-table/'],
      ['/ascii-codes', '/ascii-table/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/binary-converter',
      '/hex-converter',
      '/binary-translator',
      '/ascii-table',
      '/guides/binary-decimal-hex-octal-conversion',
      '/guides/twos-complement-signed-binary',
      '/guides/ascii-vs-unicode-utf8',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualAliases).toEqual(completeExpectedAliases);
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

  it('includes the XML formatter, validator, viewer, and guide with only the intended aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set(['/xml-formatter/', '/xml-validator/', '/xml-viewer/']);
    const expectedAliases = new Map([
      ['/xml-format', '/xml-formatter/'],
      ['/format-xml', '/xml-formatter/'],
      ['/xml-beautifier', '/xml-formatter/'],
      ['/xml-pretty-printer', '/xml-formatter/'],
      ['/online-xml-formatter', '/xml-formatter/'],
      ['/xml-formatter-online', '/xml-formatter/'],
      ['/validate-xml', '/xml-validator/'],
      ['/xml-validation', '/xml-validator/'],
      ['/xml-checker', '/xml-validator/'],
      ['/xml-syntax-checker', '/xml-validator/'],
      ['/online-xml-validator', '/xml-validator/'],
      ['/xml-validator-online', '/xml-validator/'],
      ['/view-xml', '/xml-viewer/'],
      ['/xml-tree-viewer', '/xml-viewer/'],
      ['/online-xml-viewer', '/xml-viewer/'],
      ['/xml-viewer-online', '/xml-viewer/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/xml-formatter',
      '/xml-validator',
      '/xml-viewer',
      '/guides/xml-well-formed-vs-valid',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualXmlAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualXmlAliases).toEqual(completeExpectedAliases);

    const routeNames = [...directories, ...redirects.keys()];
    expect(routeNames.some((route) => /(?:xsd|xml-(?:schema|dtd)|(?:schema|dtd)-xml)/i.test(route))).toBe(false);
  });

  it('includes the YAML tools and guides with only syntax, viewing, and conversion aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set([
      '/yaml-formatter/',
      '/yaml-validator/',
      '/yaml-viewer/',
      '/yaml-to-json/',
      '/json-to-yaml/',
    ]);
    const expectedAliases = new Map([
      ['/yaml-beautifier', '/yaml-formatter/'],
      ['/yaml-prettify', '/yaml-formatter/'],
      ['/format-yaml', '/yaml-formatter/'],
      ['/yml-formatter', '/yaml-formatter/'],
      ['/yml-validator', '/yaml-validator/'],
      ['/validate-yaml', '/yaml-validator/'],
      ['/yaml-checker', '/yaml-validator/'],
      ['/yaml-parser', '/yaml-viewer/'],
      ['/yaml-tree-viewer', '/yaml-viewer/'],
      ['/view-yaml', '/yaml-viewer/'],
      ['/convert-yaml-to-json', '/yaml-to-json/'],
      ['/yml-to-json', '/yaml-to-json/'],
      ['/convert-json-to-yaml', '/json-to-yaml/'],
      ['/json-to-yml', '/json-to-yaml/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/yaml-formatter',
      '/yaml-validator',
      '/yaml-viewer',
      '/yaml-to-json',
      '/json-to-yaml',
      '/guides/yaml-1-1-vs-1-2',
      '/guides/yaml-to-json-types',
      '/guides/yaml-anchors-aliases-merge-keys',
      '/guides/common-yaml-errors',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualYamlAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualYamlAliases).toEqual(completeExpectedAliases);

    const routeNames = [...directories, ...redirects.keys()];
    expect(routeNames.some((route) => /yaml-(?:schema|linter|lint|fixer)|(?:schema|lint|linter|fixer)-yaml/i.test(route))).toBe(false);
  });

  it('includes the text measurement tools and guides with intentional aliases', async () => {
    const source = await readFile(resolve(projectRoot, 'scripts/serve-production.mjs'), 'utf8');
    const directories = directoryRoutes(source);
    const redirects = new Map(routeRedirects(source));
    const canonicalTargets = new Set([
      '/word-counter/',
      '/character-counter/',
      '/es/contador-de-palabras/',
      '/es/contador-de-caracteres/',
    ]);
    const expectedAliases = new Map([
      ['/word-count', '/word-counter/'],
      ['/word-count-checker', '/word-counter/'],
      ['/character-count', '/character-counter/'],
      ['/letter-counter', '/character-counter/'],
      ['/es/contador-palabras', '/es/contador-de-palabras/'],
      ['/es/contar-palabras', '/es/contador-de-palabras/'],
      ['/es/contador-caracteres', '/es/contador-de-caracteres/'],
      ['/es/contar-caracteres', '/es/contador-de-caracteres/'],
    ]);

    expect(directories).toEqual(expect.arrayContaining([
      '/word-counter',
      '/character-counter',
      '/es/contador-de-palabras',
      '/es/contador-de-caracteres',
      '/ja/character-counter',
      '/ko/character-counter',
      '/guides/how-word-counting-works',
      '/guides/grapheme-clusters-vs-code-points-and-bytes',
    ]));
    for (const [alias, target] of expectedAliases) {
      expect(redirects.get(alias)).toBe(target);
      expect(redirects.get(`${alias}/`)).toBe(target);
    }

    const actualAliases = [...redirects]
      .filter(([, target]) => canonicalTargets.has(target))
      .map(([alias, target]) => [alias, target])
      .sort(([left], [right]) => left.localeCompare(right));
    const completeExpectedAliases = [...expectedAliases]
      .flatMap(([alias, target]) => [[alias, target], [`${alias}/`, target]])
      .sort(([left], [right]) => left.localeCompare(right));
    expect(actualAliases).toEqual(completeExpectedAliases);
  });
});
