import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  JsonlColumn,
  JsonlLineError,
  JsonlLineWarning,
  JsonlSummary,
  JsonlTableRow,
  JsonlWorkerRequest,
  JsonlWorkerResponse,
} from './lib/jsonl';
import './jsonl.css';

const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 42;
const PAGE_ROWS = 100;
const OVERSCAN_ROWS = 18;
const TABLE_RECORD_LIMIT = 100_000;

const examples = {
  'Commerce events': [
    '{"event":"order.created","order_id":9223372036854775807,"customer":{"id":9007199254740993,"country":"KR"},"total":149.95,"currency":"USD","created_at":"2026-08-02T09:15:12Z"}',
    '{"event":"payment.captured","order_id":9223372036854775807,"payment_id":"pay_01K1W8S8A6","amount":149.95,"method":"card","risk":{"score":0.08,"review":false}}',
    '{"event":"shipment.dispatched","order_id":9223372036854775807,"tracking":"LP-8842-1937","carrier":"DHL","items":[{"sku":"KB-104","quantity":1}]}',
    '{"event":"order.updated","order_id":9223372036854775807,"status":"delivered","status":"completed","updated_at":"2026-08-04T15:42:07Z"}',
  ].join('\n'),
  'Service logs': [
    '{"timestamp":"2026-08-02T10:00:00.120Z","level":"info","service":"checkout-api","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","message":"request completed","http":{"method":"POST","path":"/v1/orders","status":201,"duration_ms":83.4}}',
    '{"timestamp":"2026-08-02T10:00:01.442Z","level":"warn","service":"payments-worker","trace_id":"00f067aa0ba902b7","message":"provider retry scheduled","retry":{"attempt":2,"delay_ms":1500}}',
    '{"timestamp":"2026-08-02T10:00:03.008Z","level":"error","service":"inventory-api","trace_id":"9f3c1d7e52284ff2","message":"reservation conflict","error":{"code":"VERSION_MISMATCH","sku":"KB-104"}}',
    '{"timestamp":"2026-08-02T10:00:03.611Z","level":"info","service":"inventory-api","trace_id":"9f3c1d7e52284ff2","message":"reservation retried","inventory_version":18446744073709551615}',
    '{"timestamp":"2026-08-02T10:00:05.219Z","level":"info","service":"email-worker","trace_id":"71ad5ca81e224115","message":"receipt queued","recipient_domain":"example.com"}',
    '{"timestamp":"2026-08-02T10:00:08.904Z","level":"debug","service":"catalog-api","trace_id":"40b37134aa1f4f35","message":"cache hit","cache":{"key":"product:KB-104","ttl_seconds":287}}',
  ].join('\n'),
  'Mixed line errors': [
    '{"request_id":"req_018f","status":200,"duration_ms":42}',
    '{"request_id":"req_0190","status":201,}',
    "{'request_id':'req_0191','status':500}",
    '{"request_id":"req_0192","status":true}',
    '{"request_id":"req_0193","status":503,"error":{"code":"UPSTREAM_TIMEOUT"}}',
    '{"request_id":"req_0194","status":200',
  ].join('\n'),
} as const;

type ExampleName = keyof typeof examples;
type ParsedResponse = Extract<JsonlWorkerResponse, { type: 'parsed' }>;
type ExportAction = { action: 'copy' | 'download'; format: 'csv' | 'jsonl' };

function detectionLabel(summary: JsonlSummary): string {
  switch (summary.detection) {
    case 'jsonl': return 'JSONL / NDJSON detected';
    case 'json': return 'Regular multi-line JSON detected';
    case 'single-record': return 'One JSON record detected';
    case 'empty': return 'Waiting for JSONL';
  }
}

function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeBaseName(filename: string): string {
  const base = filename.replace(/\.(jsonl|ndjson|json|txt)$/i, '').replace(/[^a-z0-9._-]+/gi, '-');
  return base || 'liveparse-jsonl';
}

function App() {
  const [input, setInput] = useState(examples['Commerce events']);
  const [inputRevision, setInputRevision] = useState(0);
  const [filename, setFilename] = useState('commerce-events.jsonl');
  const [phase, setPhase] = useState<'starting' | 'parsing' | 'ready' | 'failed'>('starting');
  const [dataset, setDataset] = useState<ParsedResponse | null>(null);
  const [filter, setFilter] = useState('');
  const [filteredCount, setFilteredCount] = useState(0);
  const [rows, setRows] = useState<JsonlTableRow[]>([]);
  const [pageStart, setPageStart] = useState(0);
  const [activity, setActivity] = useState('Parsing stays in this browser tab.');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestParseRef = useRef(0);
  const latestFilterRef = useRef(0);
  const latestPageRef = useRef(0);
  const exportActionsRef = useRef(new Map<number, ExportAction>());
  const filenameRef = useRef(filename);

  useEffect(() => {
    filenameRef.current = filename;
  }, [filename]);

  const browsableCount = Math.min(filteredCount, TABLE_RECORD_LIMIT);

  const postWorkerMessage = (message: JsonlWorkerRequest): boolean => {
    const worker = workerRef.current;
    if (!worker) {
      setPhase('failed');
      setActivity('The local parser worker is unavailable. Reload the page and try again.');
      return false;
    }
    try {
      worker.postMessage(message);
      return true;
    } catch (error) {
      setPhase('failed');
      setActivity(`The local worker could not receive this request: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const replaceInput = (value: string, nextFilename?: string) => {
    // Invalidate the active dataset synchronously with the user action. This
    // prevents a late worker/export response from being paired with new text
    // during the parse debounce window.
    latestParseRef.current = ++requestIdRef.current;
    latestFilterRef.current = 0;
    latestPageRef.current = 0;
    exportActionsRef.current.clear();
    setDataset(null);
    setFilteredCount(0);
    setRows([]);
    setPageStart(0);
    setPhase('parsing');
    setActivity('Waiting to check the updated input in the local worker…');
    setInput(value);
    setInputRevision((current) => current + 1);
    if (nextFilename) setFilename(nextFilename);
  };

  const requestPage = (activeDatasetId: number, start: number) => {
    const requestId = ++requestIdRef.current;
    latestPageRef.current = requestId;
    const message: JsonlWorkerRequest = {
      type: 'page',
      requestId,
      datasetId: activeDatasetId,
      start,
      count: PAGE_ROWS,
    };
    postWorkerMessage(message);
  };

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./jsonl.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      setPhase('failed');
      setActivity(`The local parser worker could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    workerRef.current = worker;

    worker.addEventListener('message', (event: MessageEvent<JsonlWorkerResponse>) => {
      const response = event.data;
      if (response.type === 'parsed') {
        if (response.requestId !== latestParseRef.current) return;
        setDataset(response);
        setFilteredCount(response.summary.validLines);
        setRows([]);
        setPageStart(0);
        setPhase('ready');
        setActivity(`${detectionLabel(response.summary)}. ${response.summary.validLines.toLocaleString()} valid records.`);
        return;
      }
      if (response.type === 'filtered') {
        if (response.datasetId !== latestParseRef.current || response.requestId !== latestFilterRef.current) return;
        setFilteredCount(response.totalRecords);
        setRows([]);
        setPageStart(0);
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
        requestPage(response.datasetId, 0);
        return;
      }
      if (response.type === 'page') {
        if (response.datasetId !== latestParseRef.current || response.requestId !== latestPageRef.current) return;
        setRows(response.rows);
        setPageStart(response.start);
        return;
      }
      if (response.type === 'exported') {
        const pending = exportActionsRef.current.get(response.requestId);
        exportActionsRef.current.delete(response.requestId);
        if (!pending || response.datasetId !== latestParseRef.current) return;
        const suffix = response.scope === 'filtered' ? ' filtered' : '';
        if (pending.action === 'copy') {
          navigator.clipboard.writeText(response.content)
            .then(() => setActivity(`Copied ${response.recordCount.toLocaleString()}${suffix} CSV records.`))
            .catch(() => setActivity('Clipboard access failed. Use Download CSV instead.'));
        } else {
          const base = safeBaseName(filenameRef.current);
          if (pending.format === 'csv') {
            downloadText(response.content, `${base}.csv`, 'text/csv;charset=utf-8');
          } else {
            downloadText(response.content, `${base}.valid.jsonl`, 'application/x-ndjson;charset=utf-8');
          }
          setActivity(`Downloaded ${response.recordCount.toLocaleString()}${suffix} ${pending.format.toUpperCase()} records.`);
        }
        return;
      }
      if (response.type === 'failed') {
        const isCurrentExport = exportActionsRef.current.delete(response.requestId);
        const isCurrentRequest = isCurrentExport
          || response.requestId === latestParseRef.current
          || response.requestId === latestFilterRef.current
          || response.requestId === latestPageRef.current;
        if (!isCurrentRequest) return;
        if (response.datasetId !== undefined && response.datasetId !== latestParseRef.current) return;
        setPhase('failed');
        setActivity(`Worker error: ${response.message}`);
      }
    });

    worker.addEventListener('error', () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      setPhase('failed');
      setActivity('The local parser worker could not start. Reload the page and try again.');
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      latestParseRef.current = requestId;
      setPhase('parsing');
      setActivity('Checking each non-empty line in a local worker…');
      const message: JsonlWorkerRequest = { type: 'parse', requestId, source: input };
      postWorkerMessage(message);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [input, inputRevision]);

  useEffect(() => {
    if (!dataset || dataset.datasetId !== latestParseRef.current) return;
    const timer = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      latestFilterRef.current = requestId;
      const message: JsonlWorkerRequest = {
        type: 'filter',
        requestId,
        datasetId: dataset.datasetId,
        query: filter,
      };
      postWorkerMessage(message);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [dataset, filter]);

  const selectExample = (name: ExampleName) => {
    replaceInput(examples[name], `${name.toLowerCase().replace(/\s+/g, '-')}.jsonl`);
    setFilter('');
  };

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    replaceInput(await file.text(), file.name);
    setFilter('');
    event.target.value = '';
  };

  const requestExport = (format: 'csv' | 'jsonl', action: 'copy' | 'download') => {
    if (!dataset || dataset.datasetId !== latestParseRef.current || !workerRef.current) return;
    const requestId = ++requestIdRef.current;
    exportActionsRef.current.set(requestId, { format, action });
    const scope = filter.trim() ? 'filtered' : 'all';
    setActivity(`Preparing ${scope === 'filtered' ? 'filtered ' : ''}${format.toUpperCase()} locally…`);
    const message: JsonlWorkerRequest = {
      type: 'export',
      requestId,
      datasetId: dataset.datasetId,
      format,
      scope,
      query: filter,
    };
    if (!postWorkerMessage(message)) exportActionsRef.current.delete(requestId);
  };

  const handleTableScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!dataset || rows.length === 0) return;
    const visibleStart = Math.floor(Math.max(0, event.currentTarget.scrollTop - HEADER_HEIGHT) / ROW_HEIGHT);
    const loadedEnd = pageStart + rows.length;
    if (visibleStart >= pageStart + OVERSCAN_ROWS / 2 && visibleStart + 30 < loadedEnd - OVERSCAN_ROWS / 2) return;
    const nextStart = Math.max(0, Math.min(browsableCount, visibleStart - OVERSCAN_ROWS));
    if (nextStart === pageStart) return;
    requestPage(dataset.datasetId, nextStart);
  };

  const gridStyle = dataset
    ? {
        gridTemplateColumns: `84px repeat(${dataset.columns.length}, minmax(160px, 1fr))`,
        minWidth: `${84 + dataset.columns.length * 160}px`,
      }
    : undefined;

  return (
    <section className="jsonl-app" aria-label="Interactive JSONL and NDJSON parser" aria-busy={phase === 'parsing'}>
      <div className="jsonl-toolbar">
        <div className="jsonl-local"><span aria-hidden="true" /><div><strong>Local Web Worker</strong><small>No records are uploaded</small></div></div>
        <div className="jsonl-toolbar-actions">
          <label className="jsonl-select-label">Example
            <select defaultValue="Commerce events" onChange={(event) => selectExample(event.target.value as ExampleName)}>
              {(Object.keys(examples) as ExampleName[]).map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <input ref={fileInputRef} className="jsonl-visually-hidden" type="file" accept=".jsonl,.ndjson,.json,.txt,application/x-ndjson,application/json,text/plain" onChange={loadFile} />
          <button type="button" className="jsonl-button secondary" onClick={() => fileInputRef.current?.click()}>Open file</button>
          <button type="button" className="jsonl-button danger" onClick={() => { replaceInput(''); setFilter(''); }}>Clear</button>
        </div>
      </div>

      <section className="jsonl-input-panel" aria-labelledby="jsonl-input-title">
        <div className="jsonl-panel-heading">
          <div><h3 id="jsonl-input-title">JSONL input</h3><p>{phase === 'ready' && dataset ? `${dataset.summary.totalLines.toLocaleString()} physical lines · ` : ''}{input.length.toLocaleString()} characters</p></div>
          <span className={`jsonl-phase ${phase}`}>{phase === 'parsing' ? 'Parsing…' : phase === 'failed' ? 'Worker error' : 'Line-by-line mode'}</span>
        </div>
        <textarea
          id="jsonl-input"
          value={input}
          onChange={(event) => replaceInput(event.target.value)}
          spellCheck={false}
          aria-label="Paste JSON Lines or NDJSON"
          placeholder={'{"event":"first"}\n{"event":"second"}'}
        />
      </section>

      <div className="jsonl-live-status" role="status" aria-live="polite">{activity}</div>

      {dataset && <>
        <section className="jsonl-summary" aria-label="JSONL parse summary">
          <article className="wide"><span>Detected format</span><strong>{detectionLabel(dataset.summary)}</strong></article>
          <article><span>Physical lines</span><strong>{dataset.summary.totalLines.toLocaleString()}</strong></article>
          <article className="valid"><span>Valid records</span><strong>{dataset.summary.validLines.toLocaleString()}</strong></article>
          <article className={dataset.summary.errorLines ? 'error' : ''}><span>Error lines</span><strong>{dataset.summary.errorLines.toLocaleString()}</strong></article>
          <article className={dataset.summary.warningCount ? 'warning' : ''}><span>Integrity warnings</span><strong>{dataset.summary.warningCount.toLocaleString()}</strong></article>
          <article><span>Blank lines skipped</span><strong>{dataset.summary.blankLines.toLocaleString()}</strong></article>
        </section>

        {dataset.summary.detection === 'json' && <aside className="jsonl-format-note">
          <strong>This looks like one pretty-printed JSON document, not JSONL.</strong>
          <span>Use the <a href="/">JSON Parser</a> for a document that spans multiple lines. JSONL expects one complete JSON value per physical line.</span>
        </aside>}

        <section className="jsonl-results" aria-labelledby="jsonl-table-title">
          <div className="jsonl-results-toolbar">
            <div><h3 id="jsonl-table-title">Record table</h3><p>{filteredCount.toLocaleString()} matching valid records</p></div>
            <label className="jsonl-filter-label" htmlFor="jsonl-filter">Filter keys and values
              <input id="jsonl-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="status, trace ID, value…" />
            </label>
            <div className="jsonl-export-actions">
              <button type="button" className="jsonl-button secondary" disabled={!filteredCount} onClick={() => requestExport('csv', 'copy')}>Copy CSV</button>
              <button type="button" className="jsonl-button primary" disabled={!filteredCount} onClick={() => requestExport('csv', 'download')}>Download CSV</button>
              <button type="button" className="jsonl-button secondary" disabled={!filteredCount} onClick={() => requestExport('jsonl', 'download')}>Download valid JSONL</button>
            </div>
          </div>

          {dataset.columnsTruncated && <p className="jsonl-limit-note">The table shows the first {dataset.columns.length} of {dataset.totalColumns.toLocaleString()} discovered columns. CSV export includes every column.</p>}
          {filteredCount > TABLE_RECORD_LIMIT && <p className="jsonl-limit-note">Interactive browsing is limited to the first {TABLE_RECORD_LIMIT.toLocaleString()} matching rows; export still includes all {filteredCount.toLocaleString()}.</p>}

          {filteredCount > 0 ? <div
            ref={tableScrollRef}
            className="jsonl-table-scroll"
            role="region"
            aria-label="Virtualized JSONL records table"
            tabIndex={0}
            onScroll={handleTableScroll}
          >
            <div className="jsonl-table-header" role="row" style={gridStyle}>
              <div role="columnheader">Line</div>
              {dataset.columns.map((column) => <div key={column.id} role="columnheader" title={column.label}>{column.label}</div>)}
            </div>
            <div className="jsonl-virtual-space" role="rowgroup" style={{ height: `${browsableCount * ROW_HEIGHT}px`, minWidth: gridStyle?.minWidth }}>
              <div className="jsonl-window" style={{ transform: `translateY(${pageStart * ROW_HEIGHT}px)` }}>
                {rows.map((row) => <div className="jsonl-table-row" role="row" key={row.recordIndex} style={gridStyle}>
                  <div className="jsonl-line-cell" role="rowheader">
                    {row.lineNumber.toLocaleString()}
                    {row.warningCount > 0 && <span title={`${row.warningCount} integrity warning${row.warningCount === 1 ? '' : 's'}`} aria-label={`${row.warningCount} integrity warnings`}>!</span>}
                  </div>
                  {row.cells.map((cell, index) => <div key={dataset.columns[index]?.id ?? index} role="cell" title={cell}>{cell || <span className="jsonl-empty-cell">—</span>}</div>)}
                </div>)}
              </div>
            </div>
          </div> : <div className="jsonl-empty-result">{filter ? 'No valid records match this key/value filter.' : 'No valid JSONL records to display.'}</div>}
        </section>

        {dataset.errors.length > 0 && <DiagnosticList
          title={`Line errors (${dataset.summary.errorLines.toLocaleString()})`}
          description="Each error uses the physical JSONL line and the exact UTF-16 column reported by the strict parser."
          diagnostics={dataset.errors}
          truncated={dataset.errorsTruncated}
          kind="error"
        />}

        {dataset.warnings.length > 0 && <DiagnosticList
          title={`Integrity warnings (${dataset.summary.warningCount.toLocaleString()})`}
          description="Warning records remain valid and are exported without changing their original number tokens or duplicate members."
          diagnostics={dataset.warnings}
          truncated={dataset.warningsTruncated}
          kind="warning"
        />}
      </>}
    </section>
  );
}

function DiagnosticList({
  title,
  description,
  diagnostics,
  truncated,
  kind,
}: {
  title: string;
  description: string;
  diagnostics: Array<JsonlLineError | JsonlLineWarning>;
  truncated: boolean;
  kind: 'error' | 'warning';
}) {
  return <section className={`jsonl-diagnostics ${kind}`} aria-labelledby={`jsonl-${kind}-title`}>
    <div className="jsonl-diagnostic-heading"><div><h3 id={`jsonl-${kind}-title`}>{title}</h3><p>{description}</p></div><span>{diagnostics.length.toLocaleString()} shown</span></div>
    <ol>
      {diagnostics.map((diagnostic, index) => <li key={`${diagnostic.lineNumber}-${diagnostic.column}-${diagnostic.code}-${index}`}>
        <div><strong>Line {diagnostic.lineNumber.toLocaleString()}, column {diagnostic.column.toLocaleString()}</strong><code>{diagnostic.code}</code></div>
        <p>{diagnostic.message}</p>
        {diagnostic.pathText !== '$' && <small>Path {diagnostic.pathText}</small>}
        {'sourcePreview' in diagnostic && <pre>{diagnostic.sourcePreview}</pre>}
      </li>)}
    </ol>
    {truncated && <p className="jsonl-truncated">Showing the first {diagnostics.length.toLocaleString()} diagnostics to keep the page responsive.</p>}
  </section>;
}

const root = document.getElementById('jsonl-root');
if (root) createRoot(root).render(<App />);
