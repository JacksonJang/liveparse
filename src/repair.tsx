import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './repair.css';
import {
  type DiffFragment,
  type DiffRow,
  type RepairChange,
  type RepairConfidence,
  type RepairResult,
} from './lib/json-repair';
import { useJsonRepairWorker } from './useJsonRepairWorker';

const MAX_DETAIL_ITEMS = 500;

const examples = {
  'Truncated LLM response': `Here is the JSON you requested:
\`\`\`json
{
  'request_id': 9007199254740993,
  'ok': True,
  'items': [
    {'name': 'alpha', 'score': 1e400},
    {'name': 'beta', 'score': 42},
  ],
  'metadata': {'source': 'assistant'`,
  'Comments and trailing commas': `{
  // Feature rollout settings
  "enabled": true,
  "regions": ["seoul", "tokyo",],
  /* Keep this identifier exact. */
  "account_id": 9007199254740993,
}`,
  'Python dictionary': `{
  'ready': True,
  'archived': False,
  'owner': None,
  'message': 'don\'t coerce IDs to numbers'
}`,
  'Duplicate keys and large numbers': `{
  "event_id": 9223372036854775807,
  "amount": 1e400,
  "status": "queued",
  "status": "sent",
}`,
} as const;

type ExampleName = keyof typeof examples;

const changeLabels: Record<RepairChange['kind'], string> = {
  'extract-json': 'Extracted JSON',
  'remove-code-fence': 'Removed code fence',
  'convert-single-quoted-string': 'Converted quotes',
  'escape-string-character': 'Escaped string character',
  'remove-line-comment': 'Removed line comment',
  'remove-block-comment': 'Removed block comment',
  'replace-python-literal': 'Converted Python literal',
  'remove-trailing-comma': 'Removed trailing comma',
  'remove-dangling-comma': 'Removed cut-off comma',
  'insert-missing-value': 'Inserted missing value',
  'close-string': 'Closed string',
  'close-container': 'Closed container',
};

const warningLabels: Record<string, string> = {
  'unsafe-integer': 'Unsafe JavaScript integer',
  'number-overflow': 'Exponent overflow',
  'number-representation-change': 'Number spelling may change',
  'duplicate-key': 'Duplicate key',
};

function RepairApp() {
  const [input, setInput] = useState<string>(examples['Truncated LLM response']);
  const [copyLabel, setCopyLabel] = useState('Copy repaired JSON');
  const [selectedExample, setSelectedExample] = useState<ExampleName>('Truncated LLM response');
  const fileInput = useRef<HTMLInputElement>(null);
  const workerState = useJsonRepairWorker(input);
  const currentState = workerState.source === input ? workerState : null;
  const analyzing = !currentState || currentState.status === 'pending';
  const result = currentState?.status === 'ready' ? currentState.result : null;
  const workerError = currentState?.status === 'failed' ? currentState.message : null;
  const lines = currentState?.status === 'ready' ? currentState.lineCount : null;

  const chooseExample = (name: ExampleName) => {
    setSelectedExample(name);
    setInput(examples[name]);
  };

  const copyOutput = async () => {
    if (!result?.ok || analyzing) return;
    try {
      await navigator.clipboard.writeText(result.repaired);
      setCopyLabel('Copied');
    } catch {
      setCopyLabel('Copy failed');
    }
    window.setTimeout(() => setCopyLabel('Copy repaired JSON'), 1400);
  };

  const downloadOutput = () => {
    if (!result?.ok || analyzing) return;
    const blob = new Blob([result.repaired], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'repaired.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const openFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setInput(await file.text());
    event.target.value = '';
  };

  return (
    <section className="repair-workbench" aria-labelledby="repair-tool-heading">
      <div className="workbench-bar">
        <div className="local-mark">
          <span aria-hidden="true" />
          <div><strong>Local-only repair</strong><small>Your text stays in this browser tab.</small></div>
        </div>
        <label className="example-picker">
          <span>Example</span>
          <select value={selectedExample} onChange={(event) => chooseExample(event.target.value as ExampleName)}>
            {(Object.keys(examples) as ExampleName[]).map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <div className="repair-editors">
        <section className="editor-panel input-panel" aria-labelledby="repair-tool-heading">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Original</p>
              <h2 id="repair-tool-heading">Malformed JSON input</h2>
              <p>{lines === null ? '…' : lines.toLocaleString()} lines · {input.length.toLocaleString()} characters</p>
            </div>
            <div className="button-row">
              <input ref={fileInput} className="visually-hidden" type="file" accept=".json,.jsonc,.txt,application/json,text/plain" onChange={openFile} tabIndex={-1} />
              <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}>Open file</button>
              <button className="secondary-button danger-button" type="button" onClick={() => setInput('')}>Clear</button>
            </div>
          </div>
          <label className="editor-label" htmlFor="repair-input">Paste malformed or truncated JSON</label>
          <textarea
            id="repair-input"
            className="code-editor"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Paste JSON-like text from an LLM, log, Python output, or configuration file."
          />
        </section>

        <OutputPanel result={result} analyzing={analyzing} workerError={workerError} copyLabel={copyLabel} onCopy={copyOutput} onDownload={downloadOutput} />
      </div>

      <ResultDetails result={result} analyzing={analyzing} workerError={workerError} />
    </section>
  );
}

function OutputPanel({
  result,
  analyzing,
  workerError,
  copyLabel,
  onCopy,
  onDownload,
}: {
  result: RepairResult | null;
  analyzing: boolean;
  workerError: string | null;
  copyLabel: string;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const status = analyzing
    ? 'Checking changes…'
    : workerError
      ? 'Worker unavailable'
      : result?.ok
        ? result.changes.length ? 'Repaired and valid' : 'Already valid JSON'
        : 'Needs manual review';
  return (
    <section className="editor-panel output-panel" aria-labelledby="repair-output-heading" aria-busy={analyzing}>
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Result</p>
          <h2 id="repair-output-heading">Repaired JSON</h2>
          <p role="status" aria-live="polite">{status}</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" disabled={!result?.ok || analyzing} onClick={onDownload}>Download</button>
          <button className="primary-button" type="button" disabled={!result?.ok || analyzing} onClick={onCopy}>{copyLabel}</button>
        </div>
      </div>
      {analyzing ? (
        <div className="failure-state" role="status"><strong>Repairing locally…</strong><p>The worker will return a validated result after typing pauses.</p></div>
      ) : workerError ? (
        <div className="failure-state" role="alert"><strong>The local repair worker could not run.</strong><p>{workerError}</p><small>Reload the page and try again. Your input was not uploaded.</small></div>
      ) : result?.ok ? (
        <>
          <label className="editor-label" htmlFor="repair-output">Validated repaired JSON</label>
          <textarea id="repair-output" className="code-editor output-editor" readOnly value={result.repaired} spellCheck={false} />
        </>
      ) : result ? (
        <div className="failure-state" role="alert">
          <strong>Automatic repair stopped safely.</strong>
          <p>{result.error}</p>
          {result.errorLocation && <p>Line {result.errorLocation.line}, column {result.errorLocation.column}</p>}
          <small>No code was evaluated. Adjust the input or make the remaining change manually.</small>
        </div>
      ) : null}
    </section>
  );
}

function ResultDetails({
  result,
  analyzing,
  workerError,
}: {
  result: RepairResult | null;
  analyzing: boolean;
  workerError: string | null;
}) {
  if (analyzing) return <div className="analysis-placeholder" role="status">Waiting briefly for typing to pause before recalculating the repair.</div>;
  if (workerError) return <div className="analysis-placeholder" role="alert">The local repair worker is unavailable: {workerError}</div>;
  if (!result) return <div className="analysis-placeholder">The repair result is unavailable.</div>;
  if (!result.input.trim()) return <div className="analysis-placeholder">Paste malformed JSON to see confidence, changes, warnings, and a line-by-line diff.</div>;

  return (
    <div className="result-details">
      {result.ok && <ConfidenceCard result={result} />}
      <ChangeList changes={result.changes} />
      {result.ok && result.losslessWarnings.length > 0 && (
        <section className="detail-card preservation-card" aria-labelledby="preservation-heading">
          <div className="detail-heading">
            <p className="panel-kicker">Lossless validation</p>
            <h2 id="preservation-heading">Data-preservation warnings</h2>
            <p>These values remain exactly as text in the repaired output. LiveParse does not coerce them through JavaScript numbers or collapse duplicate keys.</p>
          </div>
          <ul className="warning-list">
            {result.losslessWarnings.slice(0, MAX_DETAIL_ITEMS).map((warning, index) => (
              <li key={`${warning.code}-${warning.location.offset}-${index}`}>
                <span>{warningLabels[warning.code] || warning.code}</span>
                <div><strong>{warning.path}</strong><p>{warning.message}</p><small>Line {warning.location.line}, column {warning.location.column}</small></div>
              </li>
            ))}
          </ul>
          {result.losslessWarnings.length > MAX_DETAIL_ITEMS && <p className="diff-limit">Showing the first {MAX_DETAIL_ITEMS} of {result.losslessWarnings.length.toLocaleString()} preservation warnings.</p>}
        </section>
      )}
      <DiffView rows={result.diff} />
    </div>
  );
}

function ConfidenceCard({ result }: { result: Extract<RepairResult, { ok: true }> }) {
  const description: Record<RepairConfidence, string> = {
    high: 'Only direct syntax conversions were needed. Review the diff before replacing the source.',
    medium: 'At least one contextual choice was made. Confirm that the repaired value matches the intended meaning.',
    low: 'The input was truncated or ambiguous. Treat this as a draft and inspect every assumption.',
  };
  return (
    <section className={`confidence-card confidence-${result.confidence}`} aria-labelledby="confidence-heading">
      <div className="confidence-score" aria-label={`${result.confidenceScore} out of 100 confidence`}>
        <strong>{result.confidenceScore}</strong><span>/ 100</span>
      </div>
      <div>
        <p className="panel-kicker">Repair confidence</p>
        <h2 id="confidence-heading">{capitalize(result.confidence)} confidence</h2>
        <p>{description[result.confidence]}</p>
      </div>
      {result.assumptions.length > 0 && (
        <ul className="assumption-list" aria-label="Repair assumptions">
          {result.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
        </ul>
      )}
    </section>
  );
}

function ChangeList({ changes }: { changes: RepairChange[] }) {
  const visibleChanges = changes.slice(0, MAX_DETAIL_ITEMS);
  return (
    <section className="detail-card" aria-labelledby="changes-heading">
      <div className="detail-heading">
        <p className="panel-kicker">Audit trail</p>
        <h2 id="changes-heading">{changes.length ? `${changes.length} repair change${changes.length === 1 ? '' : 's'}` : 'No repair changes'}</h2>
        <p>{changes.length ? 'Every automatic edit is listed with its source location and certainty.' : 'The input already follows strict JSON syntax.'}</p>
      </div>
      {changes.length > 0 && (
        <ol className="change-list">
          {visibleChanges.map((change, index) => (
            <li key={change.id}>
              <div className="change-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
              <div className="change-copy">
                <div className="change-title">
                  <strong>{changeLabels[change.kind]}</strong>
                  <span className={`certainty certainty-${change.certainty}`}>{change.certainty === 'deterministic' ? 'Direct' : 'Assumption'}</span>
                </div>
                <p>{change.message}</p>
                <small>Original line {change.location.line}, column {change.location.column}</small>
                {(change.before || change.after) && (
                  <div className="change-values">
                    <code aria-label="Before">{previewValue(change.before) || '∅'}</code>
                    <span aria-hidden="true">→</span>
                    <code aria-label="After">{previewValue(change.after) || '∅'}</code>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {changes.length > visibleChanges.length && <p className="diff-limit">Showing the first {MAX_DETAIL_ITEMS} of {changes.length.toLocaleString()} repair changes.</p>}
    </section>
  );
}

function DiffView({ rows }: { rows: DiffRow[] }) {
  const visibleRows = rows.slice(0, MAX_DETAIL_ITEMS);
  return (
    <section className="detail-card diff-card" aria-labelledby="diff-heading">
      <div className="detail-heading">
        <p className="panel-kicker">Before / after</p>
        <h2 id="diff-heading">Repair diff</h2>
        <p>Red marks source text that was removed or replaced; green marks repaired text that was inserted.</p>
      </div>
      <div className="diff-shell" role="table" aria-label="Line-by-line JSON repair diff">
        <div className="diff-header" role="row">
          <span role="columnheader">Original</span><span role="columnheader">Repaired</span>
        </div>
        {visibleRows.length === 0 ? <p className="empty-diff">No lines to compare.</p> : visibleRows.map((row, index) => <DiffLine key={`${row.beforeLine}-${row.afterLine}-${index}`} row={row} />)}
      </div>
      {rows.length > visibleRows.length && <p className="diff-limit">Showing the first {MAX_DETAIL_ITEMS} diff rows. Download the repaired JSON to inspect the full document.</p>}
    </section>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  return (
    <div className={`diff-row diff-${row.kind}`} role="row">
      <div className="diff-side" role="cell"><span className="line-number">{row.beforeLine ?? '·'}</span><code>{renderFragments(row.before, 'removed')}</code></div>
      <div className="diff-side" role="cell"><span className="line-number">{row.afterLine ?? '·'}</span><code>{renderFragments(row.after, 'added')}</code></div>
    </div>
  );
}

function renderFragments(fragments: DiffFragment[], changedClass: 'removed' | 'added') {
  if (fragments.length === 0) return <span className="diff-blank"> </span>;
  return fragments.map((fragment, index) => fragment.changed
    ? <mark className={changedClass} key={`${fragment.text}-${index}`}>{fragment.text || ' '}</mark>
    : <React.Fragment key={`${fragment.text}-${index}`}>{fragment.text}</React.Fragment>);
}

function previewValue(value: string): string {
  const escaped = value.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  return escaped.length > 100 ? `${escaped.slice(0, 97)}…` : escaped;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

createRoot(document.getElementById('repair-root')!).render(<RepairApp />);
