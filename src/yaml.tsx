import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_YAML_OPTIONS,
  MAX_YAML_INPUT_CHARACTERS,
  YAML_LARGE_INPUT_WARNING_CHARACTERS,
  type YamlMode,
  type YamlOptions,
} from './lib/yaml-config';
import type {
  YamlDiagnostic,
  YamlOperationResult,
  YamlStats,
  YamlViewerRow,
  YamlViewerRowKind,
  YamlWorkerRequest,
  YamlWorkerResponse,
} from './lib/yaml-worker-protocol';
import './styles.css';
import './xml.css';
import './yaml.css';

const OPERATION_TIMEOUT_MILLISECONDS = 2_000;
const WORKER_LOAD_TIMEOUT_MILLISECONDS = 12_000;

function yamlViewerKindLabel(kind: YamlViewerRowKind): string {
  switch (kind) {
    case 'document': return 'Document';
    case 'mapping': return 'Mapping';
    case 'sequence': return 'Sequence';
    case 'scalar': return 'Scalar';
    case 'alias': return 'Alias';
    case 'empty': return 'Empty';
  }
}

const YAML_SAMPLES: Record<YamlMode, string> = {
  format: `# Synthetic deployment settings\ndefaults: &defaults { retries: 3, enabled: true }\nservice:\n name: liveparse-demo\n policy: *defaults\n message: >\n  YAML formatting can normalize presentation\n  while preserving parsed data.\n---\nrelease: 2026-08-04\nregions: [seoul, portland]\n`,
  validate: `# YAML 1.2 syntax sample\nworkflow:\n  name: private-check\n  enabled: true\n  steps:\n    - id: parse\n      timeout_seconds: 2\n    - id: review\n      required: false\n`,
  view: `catalog:\n  defaults: &product-defaults\n    currency: USD\n    available: true\n  products:\n    - id: p-104\n      name: Trail Bottle\n      policy: *product-defaults\n    - id: p-219\n      name: Foldable Stand\n      notes: |\n        Synthetic data for the tree viewer.\n        Search by key, value, type, tag, or anchor.\n`,
  'yaml-to-json': `# Comments have no JSON representation\naccount: demo\nlarge_integer: 900719925474099312345\ndefaults: &defaults\n  enabled: true\n  retries: 3\nservices:\n  - name: api\n    policy: *defaults\n  - name: worker\n    policy: *defaults\n`,
  'json-to-yaml': `{
  "project": "LiveParse demo",
  "largeInteger": 900719925474099312345,
  "decimalToken": 1.2300,
  "features": ["formatter", "validator", "viewer"],
  "private": true,
  "notes": null
}`,
};

const MODE_COPY: Record<YamlMode, {
  action: string;
  busy: string;
  inputHeading: string;
  inputLabel: string;
  ready: string;
  resultHeading: string;
  resultLabel: string;
}> = {
  format: {
    action: 'Format YAML',
    busy: 'Formatting…',
    inputHeading: 'YAML to format',
    inputLabel: 'YAML source to format',
    ready: 'Ready to parse and reserialize the synthetic YAML sample locally.',
    resultHeading: 'Formatted YAML',
    resultLabel: 'Formatted YAML output',
  },
  validate: {
    action: 'Validate YAML',
    busy: 'Validating…',
    inputHeading: 'YAML to validate',
    inputLabel: 'YAML source to validate',
    ready: 'Ready to validate the synthetic YAML sample locally.',
    resultHeading: 'Syntax result',
    resultLabel: 'YAML syntax result',
  },
  view: {
    action: 'Build YAML tree',
    busy: 'Building…',
    inputHeading: 'YAML to explore',
    inputLabel: 'YAML source to display as a tree',
    ready: 'Ready to build a non-expanding YAML tree locally.',
    resultHeading: 'YAML document tree',
    resultLabel: 'YAML document tree result',
  },
  'yaml-to-json': {
    action: 'Convert to JSON',
    busy: 'Converting…',
    inputHeading: 'YAML to convert',
    inputLabel: 'YAML source to convert to JSON',
    ready: 'Ready to convert the synthetic YAML sample to strict JSON locally.',
    resultHeading: 'Strict JSON output',
    resultLabel: 'JSON converted from YAML',
  },
  'json-to-yaml': {
    action: 'Convert to YAML',
    busy: 'Converting…',
    inputHeading: 'JSON to convert',
    inputLabel: 'Strict JSON source to convert to YAML',
    ready: 'Ready to convert strict JSON to YAML 1.2 locally.',
    resultHeading: 'YAML 1.2 output',
    resultLabel: 'YAML converted from JSON',
  },
};

interface ToolFailure {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

function currentMode(): YamlMode {
  const mode = document.body.dataset.yamlMode;
  return mode === 'validate' || mode === 'view' || mode === 'yaml-to-json' || mode === 'json-to-yaml' ? mode : 'format';
}

function lineCount(value: string): number {
  return value ? value.split(/\r\n|\r|\n/).length : 0;
}

function resultOutput(result: YamlOperationResult | null): string | null {
  return result && 'output' in result ? result.output : null;
}

function outputExtension(mode: YamlMode): 'json' | 'yaml' {
  return mode === 'yaml-to-json' ? 'json' : 'yaml';
}

function downloadText(value: string, mode: YamlMode): void {
  const extension = outputExtension(mode);
  const mime = extension === 'json' ? 'application/json;charset=utf-8' : 'application/yaml;charset=utf-8';
  const url = URL.createObjectURL(new Blob([value], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `liveparse-result.${extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function YamlStatsGrid({ stats }: { stats: YamlStats }): React.JSX.Element {
  const values: Array<[string, string]> = [
    ['Documents', stats.documents.toLocaleString('en-US')],
    ['Mappings', stats.mappings.toLocaleString('en-US')],
    ['Sequences', stats.sequences.toLocaleString('en-US')],
    ['Scalars', stats.scalars.toLocaleString('en-US')],
    ['Aliases', stats.aliases.toLocaleString('en-US')],
    ['Anchors', stats.anchors.toLocaleString('en-US')],
    ['Comments', stats.comments.toLocaleString('en-US')],
    ['Max depth', stats.maxDepth.toLocaleString('en-US')],
  ];
  return (
    <div className="xml-stats-wrap">
      <p><strong>Resolved version</strong><code>{stats.versions.map((version) => `YAML ${version}`).join(', ')}</code></p>
      <dl className="xml-stats" aria-label="YAML document statistics">
        {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </div>
  );
}

function JsonStatsGrid({ result }: { result: Extract<YamlOperationResult, { mode: 'json-to-yaml' }> }): React.JSX.Element {
  const stats = result.jsonStats;
  const values: Array<[string, number]> = [
    ['Objects', stats.objects],
    ['Arrays', stats.arrays],
    ['Properties', stats.properties],
    ['Strings', stats.strings],
    ['Numbers', stats.numbers],
    ['Booleans', stats.booleans],
    ['Nulls', stats.nulls],
    ['Characters', stats.characters],
  ];
  return <dl className="xml-stats" aria-label="JSON input statistics">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString('en-US')}</dd></div>)}</dl>;
}

function Diagnostics({ diagnostics }: { diagnostics: YamlDiagnostic[] }): React.JSX.Element | null {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
      const key = `${diagnostic.code}\u0000${diagnostic.message}\u0000${diagnostic.line ?? ''}\u0000${diagnostic.column ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [diagnostics]);
  if (!unique.length) return null;
  return (
    <section className="yaml-diagnostics" aria-labelledby="yaml-diagnostics-heading">
      <h3 id="yaml-diagnostics-heading">Review before using this result</h3>
      <ul>{unique.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${index}`}>
          <strong>{diagnostic.code.replace(/_/g, ' ')}</strong>
          <span>{diagnostic.message}{diagnostic.line ? ` (line ${diagnostic.line}${diagnostic.column ? `, column ${diagnostic.column}` : ''})` : ''}</span>
        </li>
      ))}</ul>
    </section>
  );
}

function isBranch(row: YamlViewerRow): boolean {
  return row.kind === 'document' || row.kind === 'mapping' || row.kind === 'sequence';
}

function foldSearch(value: string): string {
  return value.toLocaleLowerCase('en-US');
}

function YamlTree({ rows, truncated }: { rows: YamlViewerRow[]; truncated: boolean }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => new Set());
  const normalizedQuery = foldSearch(query.trim());
  const branchRows = useMemo(() => rows.filter(isBranch), [rows]);
  const visibleRows = useMemo(() => {
    if (normalizedQuery) {
      return rows.filter((row) => foldSearch(`${row.kind}\n${row.label}\n${row.value ?? ''}\n${row.valueType ?? ''}\n${row.anchor ?? ''}\n${row.tag ?? ''}`).includes(normalizedQuery));
    }
    const visible: YamlViewerRow[] = [];
    let hiddenBelowDepth: number | null = null;
    for (const row of rows) {
      if (hiddenBelowDepth !== null) {
        if (row.depth > hiddenBelowDepth) continue;
        hiddenBelowDepth = null;
      }
      visible.push(row);
      if (isBranch(row) && collapsedIds.has(row.id)) hiddenBelowDepth = row.depth;
    }
    return visible;
  }, [collapsedIds, normalizedQuery, rows]);

  const toggleRow = (id: number) => setCollapsedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="xml-tree-shell yaml-tree-shell">
      <div className="xml-tree-tools">
        <label><span className="visually-hidden">Search YAML keys, values, types, tags, and anchors</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setCollapsedIds(new Set()); }} placeholder="Search keys, values, types, tags, or anchors" /></label>
        <span role="status" aria-live="polite" aria-atomic="true">{visibleRows.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} rows</span>
        <button type="button" disabled={Boolean(normalizedQuery) || collapsedIds.size === 0} onClick={() => setCollapsedIds(new Set())}>Expand all</button>
        <button type="button" disabled={Boolean(normalizedQuery) || branchRows.length === 0} onClick={() => setCollapsedIds(new Set(branchRows.map((row) => row.id)))}>Collapse all</button>
      </div>
      {truncated ? <p className="xml-tree-warning" role="status">The tree reached its 10,000-row display limit. Use a smaller stream before relying on this outline.</p> : null}
      {visibleRows.length ? <div className="xml-tree" role="list" aria-label={normalizedQuery ? 'Filtered YAML outline; matching rows may omit ancestors' : 'YAML document outline; each row announces its nesting level'}>{visibleRows.map((row) => {
        const branch = isBranch(row);
        const collapsed = collapsedIds.has(row.id) && !normalizedQuery;
        return (
          <div className={`xml-tree-row yaml-kind-${row.kind}`} key={row.id} role="listitem" style={{ paddingInlineStart: `${12 + Math.min(row.depth, 24) * 18}px` }} title={`${yamlViewerKindLabel(row.kind)}${row.line ? ` at line ${row.line}, column ${row.column ?? 1}` : ''}`}>
            <span className="visually-hidden">Nesting level {row.depth + 1}{branch ? `, ${collapsed ? 'collapsed' : 'expanded'}` : ''}. </span>
            {branch ? <button type="button" className="xml-tree-toggle" disabled={Boolean(normalizedQuery)} onClick={() => toggleRow(row.id)} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.label}, nesting level ${row.depth + 1}`}>{collapsed ? '+' : '−'}</button> : <span className="xml-tree-guide" aria-hidden="true">·</span>}
            <span className="xml-row-kind">{yamlViewerKindLabel(row.kind)}</span>
            <code className="xml-row-label">{row.label}</code>
            {row.value !== undefined ? <span className="xml-row-value">{row.value}</span> : null}
            {row.valueType ? <span className="yaml-row-chip">{row.valueType}</span> : null}
            {row.anchor ? <span className="yaml-row-chip">&amp;{row.anchor}</span> : null}
            {row.tag ? <span className="yaml-row-chip yaml-tag-chip">{row.tag}</span> : null}
          </div>
        );
      })}</div> : <p className="xml-tree-empty" role="status">No YAML rows match “{query}”. Try a shorter search.</p>}
    </div>
  );
}

function ResultPanel({ result, mode }: { result: YamlOperationResult | null; mode: YamlMode }): React.JSX.Element {
  if (!result) return <div className="xml-empty-result"><strong>No current result</strong><span>Run the local {mode === 'validate' ? 'syntax validator' : mode === 'view' ? 'tree builder' : 'conversion or formatting operation'} after the input is ready.</span></div>;
  if (result.mode === 'validate') {
    return <div className="yaml-result-stack"><div className="xml-validation-result"><div className="xml-validation-mark" aria-hidden="true">✓</div><div><p>Parsed successfully</p><h3>Valid YAML syntax; no duplicate scalar keys found</h3><span>Complex collection-key equality and Kubernetes, Docker Compose, GitHub Actions, OpenAPI, or another application schema are not validated.</span></div><YamlStatsGrid stats={result.stats} /></div><Diagnostics diagnostics={result.diagnostics} /></div>;
  }
  if (result.mode === 'view') {
    return <div className="yaml-result-stack"><YamlTree rows={result.rows} truncated={result.truncated} /><YamlStatsGrid stats={result.stats} /><Diagnostics diagnostics={result.diagnostics} /></div>;
  }
  return <div className="yaml-result-stack"><label className="visually-hidden" htmlFor="yaml-output">{MODE_COPY[mode].resultLabel}</label><textarea id="yaml-output" className="yaml-output" value={result.output} readOnly spellCheck={false} rows={22} />{result.mode === 'json-to-yaml' ? <JsonStatsGrid result={result} /> : <YamlStatsGrid stats={result.stats} />}<Diagnostics diagnostics={result.diagnostics} /></div>;
}

function YamlToolApp(): React.JSX.Element {
  const mode = currentMode();
  const copy = MODE_COPY[mode];
  const [input, setInput] = useState(YAML_SAMPLES[mode]);
  const [options, setOptions] = useState<YamlOptions>({ ...DEFAULT_YAML_OPTIONS });
  const [result, setResult] = useState<YamlOperationResult | null>(null);
  const [failure, setFailure] = useState<ToolFailure | null>(null);
  const [activity, setActivity] = useState(copy.ready);
  const [busy, setBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const loadTimerRef = useRef<number | null>(null);
  const operationTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopWorker = useCallback(() => {
    if (loadTimerRef.current !== null) window.clearTimeout(loadTimerRef.current);
    if (operationTimerRef.current !== null) window.clearTimeout(operationTimerRef.current);
    loadTimerRef.current = null;
    operationTimerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => stopWorker, [stopWorker]);

  const resetForChange = useCallback((message: string) => {
    requestIdRef.current += 1;
    stopWorker();
    setBusy(false);
    setResult(null);
    setFailure(null);
    setActivity(message);
  }, [stopWorker]);

  const updateInput = (value: string, message = 'Input changed. Run the local operation to create a current result.') => {
    setInput(value);
    resetForChange(message);
  };

  const updateOptions = (next: YamlOptions) => {
    setOptions(next);
    resetForChange('An option changed. Run the local operation again before using the result.');
  };

  const finishWithFailure = useCallback((nextFailure: ToolFailure) => {
    stopWorker();
    setBusy(false);
    setResult(null);
    setFailure(nextFailure);
    setActivity(nextFailure.line ? `Stopped at line ${nextFailure.line}${nextFailure.column ? `, column ${nextFailure.column}` : ''}.` : 'The local operation stopped without a usable result.');
  }, [stopWorker]);

  const run = () => {
    if (!input.trim()) {
      finishWithFailure({ code: 'EMPTY_INPUT', message: `Paste ${mode === 'json-to-yaml' ? 'JSON' : 'YAML'} before running this tool.` });
      return;
    }
    if (input.length > MAX_YAML_INPUT_CHARACTERS) {
      finishWithFailure({ code: 'INPUT_TOO_LARGE', message: `Input exceeds the ${MAX_YAML_INPUT_CHARACTERS.toLocaleString('en-US')} character limit.` });
      return;
    }

    requestIdRef.current += 1;
    const id = requestIdRef.current;
    stopWorker();
    setBusy(true);
    setResult(null);
    setFailure(null);
    setActivity(`${copy.busy.replace('…', '')} in a disposable browser worker…`);

    let worker: Worker;
    try {
      worker = new Worker(new URL('./yaml.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      finishWithFailure({ code: 'WORKER_START_FAILED', message: 'The local YAML worker could not start. Reload the page and check whether browser security settings blocked it.' });
      return;
    }
    workerRef.current = worker;
    let readyReceived = false;
    loadTimerRef.current = window.setTimeout(() => finishWithFailure({ code: 'WORKER_LOAD_TIMEOUT', message: 'The local YAML engine did not become ready within 12 seconds.' }), WORKER_LOAD_TIMEOUT_MILLISECONDS);

    worker.addEventListener('error', () => {
      if (id !== requestIdRef.current) return;
      finishWithFailure({ code: 'WORKER_ERROR', message: 'The local YAML worker stopped unexpectedly. The input remained in this tab.' });
    });
    worker.addEventListener('messageerror', () => {
      if (id !== requestIdRef.current) return;
      finishWithFailure({ code: 'WORKER_MESSAGE_ERROR', message: 'The browser could not read the local YAML worker response.' });
    });
    worker.addEventListener('message', (event: MessageEvent<YamlWorkerResponse>) => {
      if (id !== requestIdRef.current) return;
      const message = event.data;
      if (message.type === 'ready') {
        if (readyReceived) {
          finishWithFailure({ code: 'WORKER_PROTOCOL_ERROR', message: 'The local YAML worker sent more than one ready message.' });
          return;
        }
        readyReceived = true;
        if (loadTimerRef.current !== null) window.clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
        operationTimerRef.current = window.setTimeout(() => finishWithFailure({ code: 'OPERATION_TIMEOUT', message: 'The operation exceeded two seconds and its worker was terminated. Reduce nesting, aliases, or input size.' }), OPERATION_TIMEOUT_MILLISECONDS);
        const request: YamlWorkerRequest = { id, mode, input, options };
        worker.postMessage(request);
        return;
      }
      if (message.type === 'protocol-error') {
        finishWithFailure({ code: message.code, message: message.message });
        return;
      }
      if (!readyReceived) {
        finishWithFailure({ code: 'WORKER_PROTOCOL_ERROR', message: 'The local YAML worker returned a result before its ready handshake.' });
        return;
      }
      if (message.id !== id) return;
      stopWorker();
      setBusy(false);
      if (!message.ok) {
        setResult(null);
        setFailure({ code: message.code, message: message.message, line: message.line, column: message.column });
        setActivity(message.line ? `Stopped at line ${message.line}${message.column ? `, column ${message.column}` : ''}.` : 'The local operation stopped without a usable result.');
        return;
      }
      setFailure(null);
      setResult(message.result);
      setActivity(`Current result created locally. ${message.result.diagnostics.length.toLocaleString('en-US')} review note${message.result.diagnostics.length === 1 ? '' : 's'}.`);
    });
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      finishWithFailure({ code: 'FILE_TOO_LARGE', message: 'Choose a text file smaller than 1 MB and within the 200,000-character input limit.' });
      return;
    }
    try {
      const text = await file.text();
      if (text.length > MAX_YAML_INPUT_CHARACTERS) {
        finishWithFailure({ code: 'INPUT_TOO_LARGE', message: `The selected file exceeds the ${MAX_YAML_INPUT_CHARACTERS.toLocaleString('en-US')} character limit.` });
        return;
      }
      updateInput(text, `${file.name} loaded locally. Run the operation when ready.`);
    } catch {
      finishWithFailure({ code: 'FILE_READ_FAILED', message: 'The browser could not read that file as text.' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const output = resultOutput(result);
  const largeInput = input.length > YAML_LARGE_INPUT_WARNING_CHARACTERS;
  const isYamlInput = mode !== 'json-to-yaml';
  const showYamlIndent = mode === 'format' || mode === 'json-to-yaml';
  const showJsonIndent = mode === 'yaml-to-json';

  return (
    <section className="xml-app yaml-app" aria-label="Private browser-based YAML tool">
      <div className="xml-app-bar"><div className="xml-local-badge"><span aria-hidden="true"></span><div><strong>Disposable local worker</strong><small>No source text is posted, saved in the URL, or written to browser storage</small></div></div><a href="/privacy/">Privacy boundary</a></div>
      <div className="xml-controls">
        <div><p>Explicit parsing policy</p><h2>{mode === 'json-to-yaml' ? 'Strict JSON → YAML 1.2' : 'YAML syntax and data controls'}</h2></div>
        {isYamlInput ? <label><span>Default YAML version</span><select value={options.version} onChange={(event) => updateOptions({ ...options, version: event.target.value as YamlOptions['version'] })}><option value="1.2">YAML 1.2 core</option><option value="1.1">YAML 1.1</option></select></label> : null}
        {showYamlIndent ? <label><span>YAML indentation</span><select value={options.indent} onChange={(event) => updateOptions({ ...options, indent: Number(event.target.value) as 2 | 4 })}><option value="2">2 spaces</option><option value="4">4 spaces</option></select></label> : null}
        {showJsonIndent ? <label><span>JSON indentation</span><select value={options.jsonIndent} onChange={(event) => updateOptions({ ...options, jsonIndent: Number(event.target.value) as 2 | 4 })}><option value="2">2 spaces</option><option value="4">4 spaces</option></select></label> : null}
      </div>
      {failure ? <p className="xml-error" role="alert"><strong>{failure.code.replace(/_/g, ' ')}</strong> — {failure.message}{failure.line ? ` Line ${failure.line}${failure.column ? `, column ${failure.column}` : ''}.` : ''}</p> : null}
      {largeInput ? <div className="xml-limit" role="status"><strong>Large input</strong><span>This source exceeds {YAML_LARGE_INPUT_WARNING_CHARACTERS.toLocaleString('en-US')} characters. The disposable worker enforces node, depth, mode-specific output or viewer limits, and a two-second operation limit; YAML-to-JSON also bounds alias construction.</span></div> : null}
      <div className="xml-workspace paired">
        <section className="xml-input-card" aria-labelledby="yaml-input-heading">
          <header><div><p>Source</p><h2 id="yaml-input-heading">{copy.inputHeading}</h2></div><span>{lineCount(input).toLocaleString('en-US')} lines · {input.length.toLocaleString('en-US')} / {MAX_YAML_INPUT_CHARACTERS.toLocaleString('en-US')} chars</span></header>
          <label className="visually-hidden" htmlFor="yaml-input">{copy.inputLabel}</label>
          <textarea id="yaml-input" value={input} onChange={(event) => updateInput(event.target.value)} spellCheck={false} rows={22} aria-describedby="yaml-activity" />
          <div className="xml-actions">
            <button type="button" className="xml-button primary" disabled={busy} onClick={run}>{busy ? copy.busy : copy.action}</button>
            <button type="button" className="xml-button" disabled={busy} onClick={() => updateInput(YAML_SAMPLES[mode], 'Synthetic sample restored. Run the operation when ready.')}>Load sample</button>
            <button type="button" className="xml-button" disabled={busy} onClick={() => fileInputRef.current?.click()}>Open file</button>
            <input ref={fileInputRef} className="visually-hidden" type="file" aria-label="Open a local file" accept={mode === 'json-to-yaml' ? '.json,application/json,text/plain' : '.yaml,.yml,application/yaml,text/yaml,text/plain'} onChange={(event) => void loadFile(event.target.files?.[0])} />
            <button type="button" className="xml-button quiet" disabled={busy || !input} onClick={() => updateInput('', 'Input cleared. Nothing was uploaded or stored.')}>Clear</button>
          </div>
        </section>
        <section className="xml-result-card" aria-labelledby="yaml-result-heading">
          <header><div><p>Current run only</p><h2 id="yaml-result-heading">{copy.resultHeading}</h2></div>{output ? <span>{lineCount(output).toLocaleString('en-US')} lines · {output.length.toLocaleString('en-US')} chars</span> : <span>Waiting for a local run</span>}</header>
          <ResultPanel result={result} mode={mode} />
          <div className="xml-actions result-actions">
            <button type="button" className="xml-button" disabled={!output} onClick={() => { if (!output) return; void navigator.clipboard.writeText(output).then(() => setActivity('Current output copied to the clipboard.'), () => setActivity('Clipboard access was denied. Select the output manually.')); }}>Copy output</button>
            <button type="button" className="xml-button" disabled={!output} onClick={() => { if (!output) return; downloadText(output, mode); setActivity(`Downloaded the current .${outputExtension(mode)} result.`); }}>Download .{outputExtension(mode)}</button>
          </div>
        </section>
      </div>
      <p className="xml-activity" id="yaml-activity" role="status" aria-live="polite" aria-atomic="true"><strong>{busy ? 'Working' : failure ? 'Stopped' : result ? 'Current' : 'Ready'}</strong><span>{activity}</span></p>
    </section>
  );
}

const root = document.getElementById('yaml-root');
if (root) createRoot(root).render(<YamlToolApp />);
