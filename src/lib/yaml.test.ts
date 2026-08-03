import { describe, expect, it } from 'vitest';
import { DEFAULT_YAML_OPTIONS, MAX_YAML_INPUT_CHARACTERS } from './yaml-config';
import { runYamlOperation, YamlToolError } from './yaml';

describe('YAML operations', () => {
  it('validates YAML 1.2 streams with comments, anchors, aliases, and block scalars', () => {
    const result = runYamlOperation('validate', `# config\ndefaults: &defaults\n  enabled: true\nmessage: |\n  hello\ncopy: *defaults\n---\nanswer: 42\n`, { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('validate');
    if (result.mode !== 'validate') return;
    expect(result.stats).toMatchObject({ documents: 2, aliases: 1, anchors: 1 });
    expect(result.stats.comments).toBeGreaterThan(0);
  });

  it('reports a precise line and column for malformed indentation', () => {
    expect(() => runYamlOperation('validate', 'root:\n  ok: true\n bad: false\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'BAD_INDENT', line: 3, column: 1 }),
    );
  });

  it('rejects duplicate mapping keys', () => {
    expect(() => runYamlOperation('validate', 'name: first\nname: second\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );

    expect(() => runYamlOperation('validate', '.nan: first\n.NaN: second\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('validate', '2026-08-04: first\n2026-08-04: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('validate', '!!binary SGVsbG8=: first\n!!binary SGVsbG8=: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('validate', '2026-08-04T00:00:00Z: first\n2026-08-04T09:00:00+09:00: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('validate', '? &key same\n: first\n? *key\n: second\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
  });

  it('does not collapse distinct precision-sensitive scalar keys before diagnostics', () => {
    const decimals = runYamlOperation('validate', '0.123456789012345678901: first\n0.123456789012345678902: second\n', { ...DEFAULT_YAML_OPTIONS });
    expect(decimals.mode === 'validate' && decimals.diagnostics.filter((diagnostic) => diagnostic.code === 'NUMERIC_PRECISION_LOSS')).toHaveLength(2);
    const underflow = runYamlOperation('validate', '1e-400: first\n2e-400: second\n', { ...DEFAULT_YAML_OPTIONS });
    expect(underflow.mode === 'validate' && underflow.diagnostics.filter((diagnostic) => diagnostic.code === 'NUMERIC_PRECISION_LOSS')).toHaveLength(2);
    const dates = runYamlOperation('validate', '0001-01-01: early\n1901-01-01: modern\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(dates.mode).toBe('validate');
    expect(() => runYamlOperation('validate', '2023-02-29: invalid\n2023-03-01: valid\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'INVALID_TIMESTAMP' }),
    );
  });

  it('normalizes YAML 1.1 sexagesimal float keys without quadratic parser comparison', () => {
    expect(() => runYamlOperation('validate', '1:20.0: first\n0:1:20.00: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('validate', '1:20.0: first\n80.0: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('validate', '1:20.: first\n80.0: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    const largeMap = Array.from({ length: 4_000 }, (_, index) => `0.${String(index + 1).padStart(5, '0')}: value`).join('\n');
    const result = runYamlOperation('validate', largeMap, { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('validate');
  });

  it('detects identical unresolved standard-tag scalar keys', () => {
    for (const input of [
      '!!float nope: first\n!!float nope: second\n',
      '!!timestamp nope: first\n!!timestamp nope: second\n',
      '!!float "": first\n!!float "": second\n',
      '!!timestamp "": first\n!!timestamp "": second\n',
    ]) {
      expect(() => runYamlOperation('validate', input, { ...DEFAULT_YAML_OPTIONS })).toThrowError(
        expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
      );
    }
  });

  it('rejects unresolved, forward, and cross-document aliases with a source position', () => {
    expect(() => runYamlOperation('validate', 'root:\n  copy: *missing\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'UNRESOLVED_ALIAS', line: 2, column: 9 }),
    );
    expect(() => runYamlOperation('validate', 'copy: *later\nvalue: &later 1\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'UNRESOLVED_ALIAS', line: 1, column: 7 }),
    );
    expect(() => runYamlOperation('validate', 'value: &shared 1\n---\ncopy: *shared\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'UNRESOLVED_ALIAS', line: 3, column: 7 }),
    );
  });

  it('formats without resolving aliases and preserves document markers', () => {
    const result = runYamlOperation('format', 'base: &base {enabled: true}\ncopy: *base\n---\nitems: [one, two]\n', { ...DEFAULT_YAML_OPTIONS, indent: 4 });
    expect(result.mode).toBe('format');
    if (result.mode !== 'format') return;
    expect(result.output).toContain('&base');
    expect(result.output).toContain('*base');
    expect(result.output).toContain('---');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'RESERIALIZED_PRESENTATION')).toBe(true);
  });

  it('builds bounded viewer rows with scalar types and aliases', () => {
    const result = runYamlOperation('view', 'root:\n  count: 4\n  yesWord: yes\n  nested: &n [true, null]\n  copy: *n\n', { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('view');
    if (result.mode !== 'view') return;
    expect(result.rows.some((row) => row.label === 'count' && row.valueType === 'integer')).toBe(true);
    expect(result.rows.some((row) => row.label === 'yesWord' && row.valueType === 'string')).toBe(true);
    expect(result.rows.some((row) => row.kind === 'alias' && row.value === '*n')).toBe(true);
  });

  it('shows structured, tagged, anchored, and alias mapping keys as viewer rows', () => {
    const result = runYamlOperation('view', '? &key [one, two]\n: sequence-key\n? !kind special\n: tagged-key\n? *key\n: alias-key\n1: numeric-key\n"1": string-key\n', { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('view');
    if (result.mode !== 'view') return;
    expect(result.rows.some((row) => row.label === 'Key 1' && row.kind === 'sequence' && row.anchor === 'key')).toBe(true);
    expect(result.rows.some((row) => row.label === 'Key 2' && row.tag === '!kind')).toBe(true);
    expect(result.rows.some((row) => row.label === 'Key 3' && row.kind === 'alias' && row.value === '*key')).toBe(true);
    expect(result.rows.some((row) => row.label === 'Key 4' && row.valueType === 'integer' && row.value === '1')).toBe(true);
    expect(result.rows.some((row) => row.label === '1' && row.value === 'string-key')).toBe(true);
  });

  it('converts YAML to strict JSON with exact big integers and explicit key coercion warnings', () => {
    const result = runYamlOperation('yaml-to-json', '900719925474099312345: value\nitems: &items [1, 2]\ncopy: *items\n', { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('yaml-to-json');
    if (result.mode !== 'yaml-to-json') return;
    expect(result.output).toContain('"900719925474099312345": "value"');
    expect(result.output).toContain('"copy": [');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'NON_STRING_KEY_COERCED')).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'ALIASES_EXPANDED')).toBe(true);
  });

  it('turns a multi-document YAML stream into one JSON array', () => {
    const result = runYamlOperation('yaml-to-json', 'a: 1\n---\nb: 2\n', { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('yaml-to-json');
    if (result.mode !== 'yaml-to-json') return;
    expect(JSON.parse(result.output)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'DOCUMENT_STREAM_TO_ARRAY')).toBe(true);
  });

  it('rejects mapping-key collisions created by JSON property coercion', () => {
    expect(() => runYamlOperation('yaml-to-json', 'true: boolean key\n"true": string key\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'JSON_KEY_COLLISION' }),
    );
  });

  it('serializes prototype-looking keys as plain JSON data', () => {
    const result = runYamlOperation('yaml-to-json', '__proto__: safe\nconstructor: still-safe\nprototype: data\n', { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('yaml-to-json');
    if (result.mode !== 'yaml-to-json') return;
    const parsed = JSON.parse(result.output);
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    expect(parsed.__proto__).toBe('safe');
    expect(parsed.constructor).toBe('still-safe');
    expect(parsed.prototype).toBe('data');
  });

  it('stops YAML-to-JSON conversion for custom tags, non-finite numbers, cycles, and complex keys', () => {
    expect(() => runYamlOperation('yaml-to-json', 'value: !app thing\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'CUSTOM_TAG_UNSUPPORTED' }),
    );
    expect(() => runYamlOperation('yaml-to-json', 'value: .inf\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'NON_FINITE_NUMBER' }),
    );
    expect(() => runYamlOperation('yaml-to-json', 'root: &root\n  self: *root\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'CYCLIC_ALIAS' }),
    );
    expect(() => runYamlOperation('yaml-to-json', '? [one, two]\n: value\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'COMPLEX_KEY_UNSUPPORTED' }),
    );
    expect(() => runYamlOperation('yaml-to-json', 'base: &base {enabled: true}\nitem: {<<: *base}\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'MERGE_KEY_UNSUPPORTED' }),
    );
  });

  it('stops excessive alias expansion before producing JSON', () => {
    const repeated = (anchor: string) => Array.from({ length: 10 }, () => `*${anchor}`).join(', ');
    const input = `a: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: &b [${repeated('a')}]\nc: [${repeated('b')}]\n`;
    expect(() => runYamlOperation('yaml-to-json', input, { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'ALIAS_LIMIT' }),
    );
  });

  it('reports alias-expanded depth before building or internally reparsing an oversized tree', () => {
    const nested = (value: string, depth: number) => `${'['.repeat(depth)}${value}${']'.repeat(depth)}`;
    const input = `inner: &inner ${nested('0', 140)}\nouter: &outer ${nested('*inner', 140)}\nroot: *outer\n`;
    expect(() => runYamlOperation('yaml-to-json', input, { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DEPTH_LIMIT' }),
    );
  });

  it('converts YAML 1.1 timestamps explicitly and rejects non-JSON built-in values', () => {
    const timestamp = runYamlOperation('yaml-to-json', 'created: 2026-08-04T12:34:56Z\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(timestamp.mode === 'yaml-to-json' && JSON.parse(timestamp.output).created).toBe('2026-08-04T12:34:56.000Z');
    expect(timestamp.diagnostics.some((diagnostic) => diagnostic.code === 'TIMESTAMP_TO_STRING')).toBe(true);

    expect(() => runYamlOperation('yaml-to-json', 'payload: !!binary SGVsbG8=\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'CUSTOM_TAG_UNSUPPORTED' }),
    );
    expect(() => runYamlOperation('yaml-to-json', 'members: !!set {one: null, two: null}\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'CUSTOM_TAG_UNSUPPORTED' }),
    );
    expect(() => runYamlOperation('yaml-to-json', '.inf: value\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'NON_JSON_KEY' }),
    );
  });

  it('never silently rounds YAML decimals during formatting or JSON conversion', () => {
    for (const source of ['0.1234567890123456789012345', '1e-400', '1e400', '-1e400', '9007199254740993.0']) {
      const input = `value: ${source}\n`;
      const validation = runYamlOperation('validate', input, { ...DEFAULT_YAML_OPTIONS });
      expect(validation.mode === 'validate' && validation.diagnostics.some((diagnostic) => diagnostic.code === 'NUMERIC_PRECISION_LOSS')).toBe(true);
      const view = runYamlOperation('view', input, { ...DEFAULT_YAML_OPTIONS });
      expect(view.mode === 'view' && view.rows.some((row) => row.label === 'value' && row.value === source)).toBe(true);
      expect(() => runYamlOperation('format', input, { ...DEFAULT_YAML_OPTIONS })).toThrowError(
        expect.objectContaining<Partial<YamlToolError>>({ code: 'NUMERIC_PRECISION_LOSS' }),
      );
      expect(() => runYamlOperation('yaml-to-json', input, { ...DEFAULT_YAML_OPTIONS })).toThrowError(
        expect.objectContaining<Partial<YamlToolError>>({ code: 'NUMERIC_PRECISION_LOSS' }),
      );
    }
  });

  it('rejects tagged application types and unsafe mapping keys before toJS can erase meaning', () => {
    for (const source of [
      'value: !!omap\n  - first: 1\n  - second: 2\n',
      'value: !!pairs\n  - first: 1\n  - second: 2\n',
      'value: !application thing\n',
    ]) {
      expect(() => runYamlOperation('yaml-to-json', source, { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
        expect.objectContaining<Partial<YamlToolError>>({ code: 'CUSTOM_TAG_UNSUPPORTED' }),
      );
    }

    expect(() => runYamlOperation('yaml-to-json', 'anchor: &key name\n? *key\n: second\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'ALIAS_KEY_UNSUPPORTED' }),
    );
    expect(() => runYamlOperation('yaml-to-json', '? &key name\n: first\n? *key\n: second\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('yaml-to-json', '? [one, two]\n: first\n? [one, two]\n: second\n', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'COMPLEX_KEY_UNSUPPORTED' }),
    );
  });

  it('validates YAML 1.1 timestamp ranges and preserves early years', () => {
    for (const source of ['2023-02-29', '2001-99-99', '2026-08-04T24:00:00Z', '2026-08-04T12:00:00+24:00']) {
      expect(() => runYamlOperation('validate', `created: ${source}\n`, { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
        expect.objectContaining<Partial<YamlToolError>>({ code: 'INVALID_TIMESTAMP' }),
      );
    }

    const formatted = runYamlOperation('format', 'created: 0001-01-01\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(formatted.mode === 'format' && formatted.output).toContain('0001-01-01');
    expect(formatted.mode === 'format' && formatted.output).not.toContain('1901-01-01');
    const converted = runYamlOperation('yaml-to-json', 'created: 0001-01-01\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(converted.mode === 'yaml-to-json' && JSON.parse(converted.output).created).toBe('0001-01-01T00:00:00.000Z');

    const precise = runYamlOperation('validate', 'created: 2026-08-04T12:00:00.1234Z\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(precise.mode === 'validate' && precise.diagnostics.some((diagnostic) => diagnostic.code === 'TIMESTAMP_PRECISION_LOSS')).toBe(true);
    expect(() => runYamlOperation('yaml-to-json', 'created: 2026-08-04T12:00:00.1234Z\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'TIMESTAMP_PRECISION_LOSS' }),
    );
  });

  it('keeps a quoted or YAML 1.2 literal << key instead of treating it as a merge instruction', () => {
    const quoted = runYamlOperation('yaml-to-json', 'item: {"<<": literal}\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    const core = runYamlOperation('yaml-to-json', 'item: {<<: literal}\n', { ...DEFAULT_YAML_OPTIONS, version: '1.2' });
    expect(quoted.mode === 'yaml-to-json' && JSON.parse(quoted.output)).toEqual({ item: { '<<': 'literal' } });
    expect(core.mode === 'yaml-to-json' && JSON.parse(core.output)).toEqual({ item: { '<<': 'literal' } });
  });

  it('converts strict JSON to YAML while preserving exact number tokens', () => {
    const input = '{"large":900719925474099312345,"decimal":1.2300,"overflow":1e400,"items":[true,null,"text"]}';
    const result = runYamlOperation('json-to-yaml', input, { ...DEFAULT_YAML_OPTIONS });
    expect(result.mode).toBe('json-to-yaml');
    if (result.mode !== 'json-to-yaml') return;
    expect(result.output).toContain('900719925474099312345');
    expect(result.output).toContain('1.2300');
    expect(result.output).toContain('1e400');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(['UNSAFE_INTEGER', 'NUMBER_OVERFLOW']));
  });

  it('round-trips JSON string escapes and YAML-sensitive object keys', () => {
    const input = '{"yes":"string","a:b":"hash # value","escapedSlash":"a\\/b","line":"one\\ntwo","unicode":"\\u2603"}';
    const yaml = runYamlOperation('json-to-yaml', input, { ...DEFAULT_YAML_OPTIONS });
    expect(yaml.mode).toBe('json-to-yaml');
    if (yaml.mode !== 'json-to-yaml') return;
    const json = runYamlOperation('yaml-to-json', yaml.output, { ...DEFAULT_YAML_OPTIONS });
    expect(json.mode === 'yaml-to-json' && JSON.parse(json.output)).toEqual(JSON.parse(input));
  });

  it('uses explicit YAML key syntax for JSON property names beyond the simple-key limit', () => {
    const key = 'k'.repeat(2_000);
    const input = JSON.stringify({ [key]: { value: true } });
    const yaml = runYamlOperation('json-to-yaml', input, { ...DEFAULT_YAML_OPTIONS });
    expect(yaml.mode).toBe('json-to-yaml');
    if (yaml.mode !== 'json-to-yaml') return;
    expect(yaml.output).toMatch(/^\? "k+/);
    const json = runYamlOperation('yaml-to-json', yaml.output, { ...DEFAULT_YAML_OPTIONS });
    expect(json.mode === 'yaml-to-json' && JSON.parse(json.output)).toEqual(JSON.parse(input));
  });

  it('verifies generated YAML against the output limit rather than the smaller source limit', () => {
    let value: unknown = Array.from({ length: 2_000 }, () => 0);
    for (let depth = 0; depth < 60; depth += 1) value = [value];
    const input = JSON.stringify(value);
    expect(input.length).toBeLessThan(MAX_YAML_INPUT_CHARACTERS);
    const result = runYamlOperation('json-to-yaml', input, { ...DEFAULT_YAML_OPTIONS, indent: 4 });
    expect(result.mode).toBe('json-to-yaml');
    if (result.mode !== 'json-to-yaml') return;
    expect(result.output.length).toBeGreaterThan(MAX_YAML_INPUT_CHARACTERS);
  });

  it('rejects duplicate JSON keys instead of silently collapsing them', () => {
    expect(() => runYamlOperation('json-to-yaml', '{"id":1,"id":2}', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_JSON_KEY' }),
    );
  });

  it('supports YAML 1.1 as an explicit opt-in while defaulting yes to a YAML 1.2 string', () => {
    const core = runYamlOperation('yaml-to-json', 'answer: yes\n', { ...DEFAULT_YAML_OPTIONS, version: '1.2' });
    const legacy = runYamlOperation('yaml-to-json', 'answer: yes\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(core.mode === 'yaml-to-json' && JSON.parse(core.output).answer).toBe('yes');
    expect(legacy.mode === 'yaml-to-json' && JSON.parse(legacy.output).answer).toBe(true);
  });

  it('honors per-document YAML version directives over the selected default schema', () => {
    const legacy = runYamlOperation('yaml-to-json', '%YAML 1.1\n---\nanswer: yes\n', { ...DEFAULT_YAML_OPTIONS, version: '1.2' });
    expect(legacy.mode === 'yaml-to-json' && JSON.parse(legacy.output).answer).toBe(true);
    expect(legacy.mode === 'yaml-to-json' && legacy.stats.versions).toEqual(['1.1']);

    const core = runYamlOperation('yaml-to-json', '%YAML 1.2\n---\nanswer: yes\n', { ...DEFAULT_YAML_OPTIONS, version: '1.1' });
    expect(core.mode === 'yaml-to-json' && JSON.parse(core.output).answer).toBe('yes');
    expect(core.mode === 'yaml-to-json' && core.stats.versions).toEqual(['1.2']);

    expect(() => runYamlOperation('validate', '%YAML 1.1\n---\nyes: first\ntrue: second\n', { ...DEFAULT_YAML_OPTIONS, version: '1.2' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'DUPLICATE_KEY' }),
    );
    expect(() => runYamlOperation('yaml-to-json', '%YAML 1.1\n---\nbase: &base {enabled: true}\nitem: {<<: *base}\n', { ...DEFAULT_YAML_OPTIONS, version: '1.2' })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'MERGE_KEY_UNSUPPORTED' }),
    );
  });

  it('enforces empty, input-size, and option boundaries', () => {
    expect(() => runYamlOperation('validate', '   ', { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'EMPTY_INPUT' }),
    );
    expect(() => runYamlOperation('validate', 'a'.repeat(MAX_YAML_INPUT_CHARACTERS + 1), { ...DEFAULT_YAML_OPTIONS })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'INPUT_TOO_LARGE' }),
    );
    expect(() => runYamlOperation('validate', 'a: 1', { ...DEFAULT_YAML_OPTIONS, indent: 3 as 2 })).toThrowError(
      expect.objectContaining<Partial<YamlToolError>>({ code: 'INVALID_OPTIONS' }),
    );
  });

  it('bounds diagnostics from warning-heavy YAML and JSON inputs', () => {
    const tagged = Array.from({ length: 200 }, (_, index) => `key${index}: !app value`).join('\n');
    const yaml = runYamlOperation('validate', tagged, { ...DEFAULT_YAML_OPTIONS });
    expect(yaml.mode === 'validate' && yaml.diagnostics).toHaveLength(100);
    expect(yaml.mode === 'validate' && yaml.diagnostics[yaml.diagnostics.length - 1]?.code).toBe('DIAGNOSTICS_TRUNCATED');

    const numbers = `[${Array.from({ length: 200 }, () => '1.0').join(',')}]`;
    const json = runYamlOperation('json-to-yaml', numbers, { ...DEFAULT_YAML_OPTIONS });
    expect(json.mode === 'json-to-yaml' && json.diagnostics).toHaveLength(100);
    expect(json.mode === 'json-to-yaml' && json.diagnostics[json.diagnostics.length - 1]?.code).toBe('DIAGNOSTICS_TRUNCATED');
  });
});
