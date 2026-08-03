import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkYamlBundleIsolation,
  YAML_PAGE_PATHS,
  YamlBundleIsolationError,
} from './check-yaml-bundle-isolation.mjs';

const temporaryDirectories = [];
const WORKER_ASSET = 'assets/yaml.worker-aB9_xY-7.js';
const UI_ASSET = 'assets/tool-entry-Qw8_rT.js';
const SHARED_ASSET = 'assets/runtime-Zz1.js';
const WORKER_SOURCE = '(()=>{' +
  'const a=Symbol.for(`yaml.alias`),d=Symbol.for(`yaml.document`);' +
  'const t=`tag:yaml.org,2002:`;' +
  'class YAMLParseError extends Error{} class YAMLWarning extends Error{};' +
  'const c=[`BLOCK_AS_IMPLICIT_KEY`,`MULTILINE_IMPLICIT_KEY`,`TAG_RESOLVE_FAILED`];' +
  'const k=[`directives-end`,`flow-collection`,`map-value-ind`];' +
  'self.__fixture=[a,d,t,YAMLParseError,YAMLWarning,c,k]' +
  '})();';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function pageHtml(scriptAssets, extraHead = '') {
  return '<!doctype html><html><head>' + extraHead + '</head><body>' +
    scriptAssets.map((asset) => `<script type="module" src="/${asset}"></script>`).join('') +
    '</body></html>';
}

async function createFixture({ includeWorker = true, workerSource = WORKER_SOURCE } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'liveparse-yaml-bundle-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, SHARED_ASSET), 'export const runtime=true;\n');
  await writeFile(
    join(root, UI_ASSET),
    `import "./runtime-Zz1.js";new Worker(new URL("/${WORKER_ASSET}",import.meta.url),{type:"module"});\n`,
  );
  if (includeWorker) await writeFile(join(root, WORKER_ASSET), workerSource);
  for (const pagePath of YAML_PAGE_PATHS) {
    await mkdir(join(root, pagePath, '..'), { recursive: true });
    await writeFile(join(root, pagePath), pageHtml([SHARED_ASSET, UI_ASSET]));
  }
  return root;
}

describe('post-Vite YAML bundle isolation', () => {
  it('accepts hashed, minified worker output and a shared UI entry in a temporary dist', async () => {
    const root = await createFixture();

    await expect(checkYamlBundleIsolation(root)).resolves.toMatchObject({
      workerAsset: WORKER_ASSET,
      uiEntry: UI_ASSET,
      checkedPages: 5,
      checkedJavaScriptAssets: 3,
    });
  });

  it('rejects a yaml parser signature in any shared or UI JavaScript chunk', async () => {
    const root = await createFixture();
    await writeFile(join(root, SHARED_ASSET), 'Symbol.for("yaml.document");\n');

    await expect(checkYamlBundleIsolation(root)).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.stringContaining(`${SHARED_ASSET}: yaml parser implementation leaked`),
      ]),
    });
  });

  it('requires a real parser-bearing YAML worker asset rather than a placeholder', async () => {
    const missingRoot = await createFixture({ includeWorker: false });
    await expect(checkYamlBundleIsolation(missingRoot)).rejects.toMatchObject({
      failures: expect.arrayContaining([expect.stringContaining('expected exactly one hashed or unhashed yaml.worker')]),
    });

    const placeholderRoot = await createFixture({ workerSource: 'self.onmessage=()=>{};\n' });
    await expect(checkYamlBundleIsolation(placeholderRoot)).rejects.toMatchObject({
      failures: expect.arrayContaining([expect.stringContaining('independent yaml parser signatures')]),
    });
  });

  it('rejects a direct worker reference from YAML HTML', async () => {
    const root = await createFixture();
    const pagePath = YAML_PAGE_PATHS[0];
    await writeFile(
      join(root, pagePath),
      pageHtml([SHARED_ASSET, UI_ASSET], `<link rel="modulepreload" href="/${WORKER_ASSET}">`),
    );

    await expect(checkYamlBundleIsolation(root)).rejects.toMatchObject({
      failures: expect.arrayContaining([
        expect.stringContaining(`${pagePath}: HTML must not reference the YAML worker asset directly`),
      ]),
    });
  });

  it('rejects YAML pages that diverge to a different worker-loading UI entry', async () => {
    const root = await createFixture();
    const alternateUiAsset = 'assets/another-entry-Nn4.js';
    await writeFile(
      join(root, alternateUiAsset),
      `new Worker(new URL("/${WORKER_ASSET}",import.meta.url),{type:"module"});\n`,
    );
    const divergentPage = YAML_PAGE_PATHS.at(-1);
    await writeFile(join(root, divergentPage), pageHtml([SHARED_ASSET, alternateUiAsset]));

    let error;
    try {
      await checkYamlBundleIsolation(root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(YamlBundleIsolationError);
    expect(error.failures).toEqual(expect.arrayContaining([
      expect.stringContaining(`${divergentPage}: YAML pages must reference the same UI JavaScript entries`),
      expect.stringContaining('the five YAML pages do not reference the same worker-loading UI entry'),
    ]));
  });
});
