import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_XML_FORMAT_OPTIONS,
  MAX_XML_INPUT_CHARACTERS,
  XML_LARGE_INPUT_WARNING_CHARACTERS,
  type XmlFormatOptions,
  type XmlMode,
} from './lib/xml-config';
import { canDownloadXmlAsUtf8, xmlDeclarationEncoding } from './lib/xml-download';
import type {
  XmlOperationResult,
  XmlStats,
  XmlViewerRow,
  XmlWorkerRequest,
  XmlWorkerResponse,
} from './lib/xml-worker-protocol';
import './styles.css';
import './xml.css';

// Inputs above this size skip automatic running; the status text points to the button instead.
const AUTO_RUN_MAX_CHARACTERS = 20_000;

const OPERATION_TIMEOUT_MILLISECONDS = 2_000;
const WORKER_LOAD_TIMEOUT_MILLISECONDS = 12_000;

const XML_SAMPLES: Record<XmlMode, string> = {
  format: `<?xml version="1.0" encoding="UTF-8"?><catalog xmlns="https://example.com/catalog" xmlns:meta="https://example.com/meta"><!-- Synthetic product data --><product id="p-104" meta:updated="2026-08-04"><name>Trail &amp; Field Bottle</name><price currency="USD">24.00</price><description><![CDATA[Insulated <bottle> for demos & testing.]]></description><stock warehouse="ICN">18</stock></product><product id="p-219"><name>Foldable Stand</name><price currency="USD">39.50</price><stock warehouse="LAX">7</stock></product></catalog>`,
  validate: `<?xml version="1.0" encoding="UTF-8"?>
<shipment xmlns="https://example.com/shipping" id="ship-2026-0814">
  <origin country="KR">Seoul</origin>
  <destination country="US">Portland</destination>
  <packages>
    <package tracking="DEMO-001" weight-kg="2.4" />
    <package tracking="DEMO-002" weight-kg="1.1" />
  </packages>
</shipment>`,
  view: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="https://www.w3.org/2005/Atom" xmlns:demo="https://example.com/demo">
  <title>Release notes</title>
  <updated>2026-08-04T09:00:00Z</updated>
  <!-- Synthetic entries for the tree viewer -->
  <entry demo:stage="stable">
    <id>urn:demo:release:42</id>
    <title>XML tools</title>
    <summary type="text">Formatter, checker, and tree viewer</summary>
  </entry>
  <entry demo:stage="preview">
    <id>urn:demo:release:43</id>
    <title>Namespace report</title>
    <summary><![CDATA[Shows prefixes & namespace URIs as text.]]></summary>
  </entry>
</feed>`,
};

const MODE_COPY: Record<XmlMode, {
  action: string;
  busy: string;
  inputHeading: string;
  inputLabel: string;
  ready: string;
  running: string;
  resultHeading: string;
}> = {
  format: {
    action: 'Format XML',
    busy: 'Formatting…',
    inputHeading: 'XML to format',
    inputLabel: 'XML source to format',
    ready: 'Ready to format the synthetic sample locally.',
    running: 'Formatting XML in a local browser worker…',
    resultHeading: 'Formatted XML',
  },
  validate: {
    action: 'Check XML',
    busy: 'Checking…',
    inputHeading: 'XML to check',
    inputLabel: 'XML source to check for well-formedness',
    ready: 'Ready to check the synthetic sample for well-formedness locally.',
    running: 'Checking XML well-formedness in a local browser worker…',
    resultHeading: 'Well-formedness result',
  },
  view: {
    action: 'Build tree',
    busy: 'Building…',
    inputHeading: 'XML to explore',
    inputLabel: 'XML source to display as a tree',
    ready: 'Ready to build a searchable tree from the synthetic sample locally.',
    running: 'Building an XML tree in a local browser worker…',
    resultHeading: 'XML document tree',
  },
};

type NumericStatKey = Exclude<keyof XmlStats, 'rootName'>;
const STAT_LABELS: Array<[NumericStatKey, string]> = [
  ['elements', 'Elements'],
  ['attributes', 'Attributes'],
  ['textNodes', 'Text nodes'],
  ['comments', 'Comments'],
  ['cdataSections', 'CDATA'],
  ['processingInstructions', 'Processing instructions'],
  ['documentTypes', 'DOCTYPE declarations'],
  ['maxDepth', 'Maximum depth'],
  ['namespaces', 'Namespace URIs'],
];

function currentMode(): XmlMode {
  const mode = document.body.dataset.xmlMode;
  return mode === 'validate' || mode === 'view' ? mode : 'format';
}

function lineCount(value: string): number {
  return value ? value.split(/\r\n|\r|\n/).length : 0;
}

function downloadXml(value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/xml;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'formatted-document.xml';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function StatsGrid({ stats }: { stats: XmlStats }): React.JSX.Element {
  return (
    <div className="xml-stats-wrap">
      <p><strong>Root element</strong><code>{stats.rootName}</code></p>
      <dl className="xml-stats" aria-label="XML document statistics">
        {STAT_LABELS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{stats[key].toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function rowKindLabel(row: XmlViewerRow): string {
  switch (row.kind) {
    case 'declaration': return 'Declaration';
    case 'doctype': return 'Document type';
    case 'element-open': return 'Opening element';
    case 'element-empty': return 'Empty element';
    case 'element-close': return 'Closing element';
    case 'attribute': return 'Attribute';
    case 'text': return 'Text';
    case 'comment': return 'Comment';
    case 'cdata': return 'CDATA';
    case 'processing-instruction': return 'Processing instruction';
  }
}

function foldSearchText(value: string): string {
  return Array.from(value, (character) => character.toLocaleLowerCase('en-US')).join('');
}

function sourceOffsetForFoldedOffset(value: string, targetOffset: number): number {
  let foldedOffset = 0;
  let sourceOffset = 0;
  for (const character of value) {
    const nextFoldedOffset = foldedOffset + character.toLocaleLowerCase('en-US').length;
    if (targetOffset < nextFoldedOffset) return sourceOffset;
    foldedOffset = nextFoldedOffset;
    sourceOffset += character.length;
  }
  return value.length;
}

function displayedRowValue(row: XmlViewerRow, normalizedQuery: string): string | undefined {
  const value = row.value;
  if (!value || !normalizedQuery) return value;
  const foldedMatchIndex = foldSearchText(value).indexOf(normalizedQuery);
  if (foldedMatchIndex < 0 || value.length <= 120) return value;
  const sourceMatchStart = sourceOffsetForFoldedOffset(value, foldedMatchIndex);
  if (sourceMatchStart < 24) return value;
  const sourceMatchEnd = sourceOffsetForFoldedOffset(value, foldedMatchIndex + normalizedQuery.length);
  const start = Math.max(0, sourceMatchStart - 20);
  const end = Math.min(value.length, Math.max(sourceMatchEnd, sourceMatchStart + 1) + 72);
  return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}

function XmlTree({ rows, truncated, hasDocumentType }: { rows: XmlViewerRow[]; truncated: boolean; hasDocumentType: boolean }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => new Set());
  const normalizedQuery = foldSearchText(query.trim());
  const branchRows = useMemo(() => rows.filter((row) => row.kind === 'element-open'), [rows]);
  const visibleRows = useMemo(() => {
    if (normalizedQuery) {
      return rows.filter((row) => foldSearchText(`${row.label}\n${row.value ?? ''}`).includes(normalizedQuery));
    }

    const visible: XmlViewerRow[] = [];
    let hiddenBelowDepth: number | null = null;
    for (const row of rows) {
      if (hiddenBelowDepth !== null) {
        if (row.depth < hiddenBelowDepth || (row.depth === hiddenBelowDepth && row.kind !== 'element-close')) hiddenBelowDepth = null;
        else continue;
      }
      visible.push(row);
      if (row.kind === 'element-open' && collapsedIds.has(row.id)) hiddenBelowDepth = row.depth;
    }
    return visible;
  }, [collapsedIds, normalizedQuery, rows]);

  const toggleRow = (id: number) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="xml-tree-shell">
      <div className="xml-tree-tools">
        <label><span className="visually-hidden">Search element names, attributes, and text</span><input type="search" value={query} onChange={(event) => { const nextQuery = event.target.value; setQuery(nextQuery); if (nextQuery.trim()) setCollapsedIds(new Set()); }} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Search names, attributes, or text" /></label>
        <span role="status" aria-live="polite" aria-atomic="true">{visibleRows.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} rows</span>
        <button type="button" onClick={() => setCollapsedIds(new Set())} disabled={Boolean(normalizedQuery) || collapsedIds.size === 0}>Expand all</button>
        <button type="button" onClick={() => setCollapsedIds(new Set(branchRows.map((row) => row.id)))} disabled={Boolean(normalizedQuery) || branchRows.length === 0}>Collapse all</button>
      </div>
      {hasDocumentType ? <p className="xml-doctype-warning" role="status"><strong>DTD grammar not checked.</strong> The DOCTYPE is displayed as bounded opaque text. This tree does not establish that the internal subset is well formed, and no external resource was fetched.</p> : null}
      {truncated ? <p className="xml-tree-warning" role="status">The tree reached its row or output limit and is incomplete. Use a smaller document before relying on this structural overview.</p> : null}
      {visibleRows.length ? <div className="xml-tree" role="list" aria-label="XML document outline">
        {visibleRows.map((row) => {
          const isBranch = row.kind === 'element-open';
          const isCollapsed = collapsedIds.has(row.id) && !normalizedQuery;
          const displayedValue = displayedRowValue(row, normalizedQuery);
          return (
            <div className={`xml-tree-row kind-${row.kind}`} key={row.id} role="listitem" style={{ paddingInlineStart: `${12 + Math.min(row.depth, 24) * 18}px` }} title={`${rowKindLabel(row)} at depth ${row.depth}`}>
              {isBranch ? <button type="button" className="xml-tree-toggle" onClick={() => toggleRow(row.id)} disabled={Boolean(normalizedQuery)} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${row.label}`}>{isCollapsed ? '+' : '−'}</button> : <span className="xml-tree-guide" aria-hidden="true">·</span>}
              <span className="xml-row-kind">{rowKindLabel(row)}</span>
              <code className="xml-row-label">{row.label}</code>
              {displayedValue !== undefined && displayedValue !== '' ? <span className="xml-row-value">{displayedValue}</span> : null}
            </div>
          );
        })}
      </div> : <p className="xml-tree-empty" role="status">No outline rows match “{query}”. Try a shorter or different search.</p>}
    </div>
  );
}

function ResultPanel({ result, mode }: { result: XmlOperationResult | null; mode: XmlMode }): React.JSX.Element {
  if (!result) return <div className="xml-empty-result"><strong>No current result</strong><span>Run the local {mode === 'validate' ? 'well-formedness check' : mode === 'view' ? 'tree builder' : 'formatter'} after the input is ready.</span></div>;
  if (result.mode === 'format') {
    return <div className="xml-format-result">{result.stats.documentTypes > 0 ? <p className="xml-doctype-warning" role="status"><strong>DTD grammar not checked.</strong> The DOCTYPE was preserved as bounded opaque source. This result does not establish that the internal subset is well formed, and no external resource was fetched.</p> : null}<label className="visually-hidden" htmlFor="xml-output">Formatted XML result</label><textarea id="xml-output" value={result.output} readOnly spellCheck={false} rows={20} /><StatsGrid stats={result.stats} /></div>;
  }
  if (result.mode === 'validate') {
    return <div className="xml-validation-result" role="status"><div className="xml-validation-mark" aria-hidden="true">✓</div><div><p>Well-formed XML 1.0</p><h3>One document element and matching XML syntax were found.</h3><span>This is a syntax result, not DTD, XSD, Relax NG, Schematron, namespace-policy, signature, or application validation.</span></div><StatsGrid stats={result.stats} /></div>;
  }
  return <div className="xml-view-result"><XmlTree rows={result.rows} truncated={result.truncated} hasDocumentType={result.stats.documentTypes > 0} /><StatsGrid stats={result.stats} /></div>;
}

function XmlToolApp(): React.JSX.Element {
  const mode = currentMode();
  const copy = MODE_COPY[mode];
  const [input, setInput] = useState(XML_SAMPLES[mode]);
  const [options, setOptions] = useState<XmlFormatOptions>({ ...DEFAULT_XML_FORMAT_OPTIONS });
  const [result, setResult] = useState<XmlOperationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(copy.ready);
  const workerRef = useRef<Worker | null>(null);
  const operationTimeoutRef = useRef<number | null>(null);
  const loadTimeoutRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const stopWorker = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (operationTimeoutRef.current !== null) window.clearTimeout(operationTimeoutRef.current);
    if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
    operationTimeoutRef.current = null;
    loadTimeoutRef.current = null;
  };

  useEffect(() => () => stopWorker(), []);

  const invalidateResult = (nextMessage: string) => {
    stopWorker();
    setBusy(false);
    setResult(null);
    setError(null);
    setMessage(nextMessage);
  };

  const changeInput = (value: string) => {
    const next = value.slice(0, MAX_XML_INPUT_CHARACTERS);
    setInput(next);
    invalidateResult(value.length > MAX_XML_INPUT_CHARACTERS
      ? `Only the first ${MAX_XML_INPUT_CHARACTERS.toLocaleString('en-US')} UTF-16 code units were kept.`
      : next.length >= XML_LARGE_INPUT_WARNING_CHARACTERS
        ? `Large XML loaded (${next.length.toLocaleString('en-US')} UTF-16 code units). The local operation may use substantial browser memory; split the document when possible.`
        : next.length > AUTO_RUN_MAX_CHARACTERS
          ? `Automatic running is limited to ${AUTO_RUN_MAX_CHARACTERS.toLocaleString('en-US')} UTF-16 code units. Choose the tool button to run this document.`
        : 'Input changed. Running the tool…');
  };

  const changeOptions = (changes: Partial<XmlFormatOptions>) => {
    setOptions((current) => ({ ...current, ...changes }));
    invalidateResult('Formatting settings changed. Reformatting…');
  };

  // Run automatically for typical document sizes; the button remains for explicit re-runs.
  useEffect(() => {
    if (!input.trim() || input.length > AUTO_RUN_MAX_CHARACTERS) return;
    const timer = window.setTimeout(() => runTool(), 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, options, mode]);

  const runTool = (event?: React.FormEvent) => {
    event?.preventDefault();
    stopWorker();
    setError(null);
    setResult(null);
    if (!input.trim()) {
      setBusy(false);
      setError('Paste an XML document before running this tool.');
      setMessage('Nothing was processed or sent anywhere.');
      return;
    }
    if (input.length > MAX_XML_INPUT_CHARACTERS) {
      setBusy(false);
      setError(`XML input is limited to ${MAX_XML_INPUT_CHARACTERS.toLocaleString('en-US')} UTF-16 code units.`);
      return;
    }

    const requestId = ++requestIdRef.current;
    const request: XmlWorkerRequest = { id: requestId, mode, input, options };
    let worker: Worker;
    try {
      worker = new Worker(new URL('./xml.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setBusy(false);
      setError('The local XML worker could not start in this browser. Reload the page and try again.');
      setMessage('The operation did not start, and no XML was uploaded.');
      return;
    }
    workerRef.current = worker;
    setBusy(true);
    setMessage('Loading the XML engine locally…');
    let requestPosted = false;
    const isCurrentRequest = () => workerRef.current === worker && requestIdRef.current === requestId;
    const failCurrentRequest = (errorMessage: string, statusMessage: string) => {
      if (!isCurrentRequest()) return;
      stopWorker();
      setBusy(false);
      setError(errorMessage);
      setMessage(statusMessage);
    };

    worker.addEventListener('message', (workerEvent: MessageEvent<XmlWorkerResponse>) => {
      if (!isCurrentRequest()) return;
      const response = workerEvent.data;
      if (response.type === 'ready') {
        if (requestPosted) return;
        if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
        try {
          worker.postMessage(request);
          requestPosted = true;
        } catch {
          failCurrentRequest('The local XML worker could not receive this document. Reload the page and try again.', 'The operation did not start, and no XML was uploaded.');
          return;
        }
        setMessage(copy.running);
        operationTimeoutRef.current = window.setTimeout(() => {
          if (!isCurrentRequest() || !requestPosted) return;
          failCurrentRequest('Processing exceeded 2 seconds and was stopped to keep this tab responsive. Split the XML into a smaller document and try again.', 'The local XML worker was stopped. No XML was uploaded.');
        }, OPERATION_TIMEOUT_MILLISECONDS);
        return;
      }
      if (response.type === 'protocol-error') {
        failCurrentRequest(response.message, 'The operation stopped because the local worker could not read the request. No XML was uploaded.');
        return;
      }
      if (response.id !== requestId || !requestPosted) return;
      stopWorker();
      setBusy(false);
      if (response.ok) {
        if (response.result.mode !== mode) {
          setError('The local XML worker returned a result for a different tool. Reload the page and try again.');
          setMessage('The mismatched local result was discarded.');
          return;
        }
        setResult(response.result);
        setMessage(response.result.mode === 'format'
          ? response.result.stats.documentTypes > 0
            ? 'Formatted locally, but the preserved DOCTYPE and its internal-subset grammar were not checked. Review the result and use a DTD-aware parser when required.'
            : 'Formatted locally. Raw XML tokens were preserved; review inserted or removed structural whitespace before replacing source.'
          : response.result.mode === 'validate'
            ? 'The document is well-formed XML 1.0 under this checker. No DTD, XSD, schema, signature, or application rules were checked.'
            : `Built a local tree with ${response.result.rows.length.toLocaleString('en-US')} rows${response.result.truncated ? ' (row or output limit reached)' : ''}.${response.result.stats.documentTypes > 0 ? ' The DOCTYPE is opaque and its DTD grammar was not checked.' : ''}`);
      } else {
        const location = response.line === undefined ? '' : ` Line ${response.line.toLocaleString('en-US')}${response.column === undefined ? '' : `, column ${response.column.toLocaleString('en-US')}`}.`;
        setError(`${response.message}${location}`);
        setMessage('XML processing stopped locally. No document was uploaded and no external resource was fetched.');
      }
    });
    worker.addEventListener('error', () => failCurrentRequest(requestPosted ? 'The local XML worker could not finish. Try a smaller document.' : 'The local XML worker could not load. Reload the page and try again.', 'XML processing stopped without uploading the document.'));
    worker.addEventListener('messageerror', () => failCurrentRequest('The browser could not read the local XML response. Reload the page and try again.', 'XML processing stopped without uploading the document.'));
    loadTimeoutRef.current = window.setTimeout(() => {
      if (!isCurrentRequest() || requestPosted) return;
      failCurrentRequest('The local XML engine took more than 12 seconds to load and was stopped. Reload the page and try again.', 'The operation did not start, and no XML was uploaded.');
    }, WORKER_LOAD_TIMEOUT_MILLISECONDS);
  };

  const formattedOutput = result?.mode === 'format' ? result.output : '';
  const formattedEncoding = formattedOutput ? xmlDeclarationEncoding(formattedOutput) : null;
  const downloadUsesUtf8 = !formattedOutput || canDownloadXmlAsUtf8(formattedOutput);
  const copyOutput = async () => {
    if (!formattedOutput) return;
    try {
      await navigator.clipboard.writeText(formattedOutput);
      setMessage('Copied the complete formatted XML result.');
    } catch {
      setMessage('Clipboard access failed. Select the formatted XML and copy it manually.');
    }
  };

  return (
    <form className={`xml-app mode-${mode}`} onSubmit={runTool} aria-busy={busy}>
      <div className="xml-app-bar">
        <div className="xml-local-badge"><span aria-hidden="true" /><div><strong>Private browser XML tool</strong><small>Input remains in this tab; external resources are never fetched</small></div></div>
        <a href="/guides/xml-well-formed-vs-valid/">Well-formed vs valid</a>
      </div>
      {mode === 'format' ? <section className="xml-controls" aria-labelledby="xml-settings-heading"><div><p>Layout controls</p><h2 id="xml-settings-heading">Choose indentation and line endings</h2></div><label><span>Indentation</span><select value={options.indentation} onChange={(event) => changeOptions({ indentation: event.target.value as XmlFormatOptions['indentation'] })}><option value="2-spaces">2 spaces</option><option value="4-spaces">4 spaces</option><option value="tabs">Tabs</option></select></label><label><span>Line endings</span><select value={options.lineEnding} onChange={(event) => changeOptions({ lineEnding: event.target.value as XmlFormatOptions['lineEnding'] })}><option value="lf">LF (Unix/macOS)</option><option value="crlf">CRLF (Windows)</option></select></label></section> : null}
      <div className={`xml-workspace ${mode === 'format' ? 'paired' : ''}`}>
        <section className="xml-input-card" aria-labelledby="xml-input-heading">
          <header><div><p>Source document</p><h2 id="xml-input-heading">{copy.inputHeading}</h2></div><span>{lineCount(input).toLocaleString('en-US')} lines · {input.length.toLocaleString('en-US')} UTF-16 units</span></header>
          <label className="visually-hidden" htmlFor="xml-input">{copy.inputLabel}</label>
          <textarea id="xml-input" value={input} onChange={(event) => changeInput(event.target.value)} maxLength={MAX_XML_INPUT_CHARACTERS} spellCheck={false} autoCapitalize="off" autoComplete="off" rows={20} />
          <div className="xml-actions"><button className="xml-button primary" type="submit" disabled={busy}>{busy ? copy.busy : copy.action}</button><button className="xml-button" type="button" disabled={busy} onClick={() => { setInput(XML_SAMPLES[mode]); invalidateResult('Loaded a synthetic XML sample. Run the local tool when ready.'); }}>Load sample</button><button className="xml-button quiet" type="button" disabled={busy} onClick={() => { setInput(''); invalidateResult('Input and result cleared from this page.'); }}>Clear</button></div>
        </section>
        <section className="xml-result-card" aria-labelledby="xml-result-heading">
          <header><div><p>{mode === 'validate' ? 'Syntax finding' : mode === 'view' ? 'Structured outline' : 'Serialized result'}</p><h2 id="xml-result-heading">{copy.resultHeading}</h2></div>{mode === 'format' && formattedOutput ? <span>{lineCount(formattedOutput).toLocaleString('en-US')} lines · {formattedOutput.length.toLocaleString('en-US')} UTF-16 units</span> : null}</header>
          <ResultPanel result={result} mode={mode} />
          {mode === 'format' ? <div className="xml-actions result-actions"><button className="xml-button" type="button" onClick={copyOutput} disabled={!formattedOutput || busy}>Copy result</button><button className="xml-button" type="button" onClick={() => { if (formattedOutput && downloadUsesUtf8) { downloadXml(formattedOutput); setMessage('Downloaded the complete formatted XML result as a UTF-8 .xml file.'); } }} disabled={!formattedOutput || busy || !downloadUsesUtf8} title={!downloadUsesUtf8 ? `Browser download is disabled because the declaration specifies ${formattedEncoding ?? 'a non-UTF-8 encoding'}.` : undefined}>Download .xml</button>{formattedOutput && !downloadUsesUtf8 ? <span className="xml-download-warning" role="status">Download disabled: the source declares <code>{formattedEncoding}</code>, but a browser text Blob would contain UTF-8 bytes. Copy the result into an encoding-aware editor instead.</span> : null}</div> : null}
        </section>
      </div>
      {error ? <p className="xml-error" role="alert"><strong>{mode === 'validate' ? 'Could not confirm well-formedness:' : 'Could not process XML:'}</strong> {error}</p> : null}
      <div className="xml-limit"><strong>Know the boundary</strong><span>{mode === 'format' ? 'Raw tags, attributes, quotes, supported entity-reference spellings, declarations, comments, CDATA, processing instructions, mixed content, and preserved-space subtrees remain verbatim. Only eligible whitespace between or around markup changes; LF or CRLF applies to inserted separators. That whitespace can still be semantic or break a signature, so review a diff.' : mode === 'validate' ? 'This checks XML 1.0 well-formedness only for documents without a DOCTYPE. A DOCTYPE stops the check because this validator does not implement DTD grammar; no DTD or external resource is fetched or validated. Custom ENTITY declarations and undefined named references are also rejected. XSD, signatures, namespace policies, and application rules are not evaluated.' : 'The tree is a text-only structural view. A DOCTYPE is shown as opaque text and never fetched or validated; custom ENTITY declarations and undefined named references are rejected. The tool does not render XML as HTML, validate a schema, or evaluate XPath.'}</span></div>
      <p className="xml-activity" aria-live="polite"><strong>Local status</strong><span>{message}</span></p>
    </form>
  );
}

const root = document.getElementById('xml-root');
if (root) createRoot(root).render(<XmlToolApp />);
