import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  compareJson,
  type JsonCompareOptions,
  type JsonCompareResult,
} from './lib/json-diff';
import './styles.css';
import './json-compare.css';

const MAX_DIFFERENCES = 1_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const SAMPLE_LEFT = `{
  "release": "2026.07",
  "service": {
    "status": "beta",
    "region": "ap-northeast-2"
  },
  "account_id": 9007199254740993,
  "ratio": 1.0,
  "features": ["parser", "repair"],
  "limits": { "requests": 1000 },
  "label": "primary",
  "label": "legacy"
}`;

const SAMPLE_RIGHT = `{
  "release": "2026.08",
  "service": {
    "status": "stable"
  },
  "account_id": 9007199254740995,
  "ratio": 1,
  "features": ["repair", "parser", "compare"],
  "limits": { "requests": "1000" },
  "retention_days": 30,
  "label": "primary",
  "label": "current"
}`;

type SuccessfulResult = Extract<JsonCompareResult, { ok: true }>;
type JsonDifference = SuccessfulResult['differences'][number];
type DifferenceKind = JsonDifference['kind'];
type DifferenceFilter = 'all' | 'changed' | 'added' | 'removed' | 'type';
type Side = 'left' | 'right';

interface ComparedSnapshot {
  left: string;
  right: string;
  exactNumbers: boolean;
  ignoreArrayOrder: boolean;
}

const kindLabels: Record<DifferenceKind, string> = {
  'type-changed': 'Type changed',
  'value-changed': 'Value changed',
  'property-added': 'Property added',
  'property-removed': 'Property removed',
  'array-item-added': 'Array item added',
  'array-item-removed': 'Array item removed',
};

const filterLabels: Record<DifferenceFilter, string> = {
  all: 'All',
  changed: 'Changed',
  added: 'Added',
  removed: 'Removed',
  type: 'Type',
};

function buildOptions(exactNumbers: boolean, ignoreArrayOrder: boolean): JsonCompareOptions {
  return {
    numberMode: exactNumbers ? 'exact' : 'semantic',
    arrayMode: ignoreArrayOrder ? 'unordered' : 'positional',
    maxDifferences: MAX_DIFFERENCES,
  };
}

function matchesFilter(difference: JsonDifference, filter: DifferenceFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'changed') return difference.kind === 'value-changed';
  if (filter === 'type') return difference.kind === 'type-changed';
  if (filter === 'added') return difference.kind === 'property-added' || difference.kind === 'array-item-added';
  return difference.kind === 'property-removed' || difference.kind === 'array-item-removed';
}

function countLines(value: string): number {
  if (!value) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    if (character === 10) lines += 1;
    else if (character === 13) {
      lines += 1;
      if (value.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return lines;
}

function differenceDescription(difference: JsonDifference): string {
  const path = difference.pathText || '$';
  switch (difference.kind) {
    case 'type-changed':
      return `The value at ${path} changed type from ${difference.leftType ?? 'missing'} to ${difference.rightType ?? 'missing'}.`;
    case 'value-changed':
      return `The value at ${path} is different.`;
    case 'property-added':
      return `A property was added at ${path}.`;
    case 'property-removed':
      return `A property was removed from ${path}.`;
    case 'array-item-added':
      return `An array item was added at ${path}.`;
    case 'array-item-removed':
      return `An array item was removed from ${path}.`;
  }
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard permissions can be denied even on secure origins; try the local selection fallback.
    }
  }

  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Copy command was rejected.');
}

function JsonCompareApp() {
  const [left, setLeft] = useState(SAMPLE_LEFT);
  const [right, setRight] = useState(SAMPLE_RIGHT);
  const [leftName, setLeftName] = useState('before.json');
  const [rightName, setRightName] = useState('after.json');
  const [exactNumbers, setExactNumbers] = useState(true);
  const [ignoreArrayOrder, setIgnoreArrayOrder] = useState(false);
  const [result, setResult] = useState<JsonCompareResult | null>(() => compareJson(
    SAMPLE_LEFT,
    SAMPLE_RIGHT,
    buildOptions(true, false),
  ));
  const [snapshot, setSnapshot] = useState<ComparedSnapshot>({
    left: SAMPLE_LEFT,
    right: SAMPLE_RIGHT,
    exactNumbers: true,
    ignoreArrayOrder: false,
  });
  const [filter, setFilter] = useState<DifferenceFilter>('all');
  const [activity, setActivity] = useState('Sample JSON compared locally. Replace either side when ready.');
  const [internalError, setInternalError] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const leftFileRef = useRef<HTMLInputElement>(null);
  const rightFileRef = useRef<HTMLInputElement>(null);
  const comparisonTokenRef = useRef(0);

  const stale = Boolean(
    result && (
      snapshot.left !== left
      || snapshot.right !== right
      || snapshot.exactNumbers !== exactNumbers
      || snapshot.ignoreArrayOrder !== ignoreArrayOrder
    ),
  );

  const currentResult = stale ? null : result;
  const leftErrors = currentResult && !currentResult.ok
    ? currentResult.errors.filter((item) => item.side === 'left')
    : [];
  const rightErrors = currentResult && !currentResult.ok
    ? currentResult.errors.filter((item) => item.side === 'right')
    : [];

  const cancelPendingComparison = () => {
    comparisonTokenRef.current += 1;
    setIsComparing(false);
  };

  const updateSide = (side: Side, value: string, name?: string) => {
    cancelPendingComparison();
    setInternalError(null);
    if (side === 'left') {
      setLeft(value);
      if (name) setLeftName(name);
    } else {
      setRight(value);
      if (name) setRightName(name);
    }
  };

  const runComparison = () => {
    const comparedLeft = left;
    const comparedRight = right;
    const comparedExactNumbers = exactNumbers;
    const comparedIgnoreArrayOrder = ignoreArrayOrder;
    const token = comparisonTokenRef.current + 1;
    comparisonTokenRef.current = token;
    setIsComparing(true);
    setInternalError(null);
    setActivity('Comparing both JSON documents locally…');

    window.setTimeout(() => {
      if (comparisonTokenRef.current !== token) return;
      try {
        const nextResult = compareJson(
          comparedLeft,
          comparedRight,
          buildOptions(comparedExactNumbers, comparedIgnoreArrayOrder),
        );
        if (comparisonTokenRef.current !== token) return;
        setResult(nextResult);
        setSnapshot({
          left: comparedLeft,
          right: comparedRight,
          exactNumbers: comparedExactNumbers,
          ignoreArrayOrder: comparedIgnoreArrayOrder,
        });
        setFilter('all');
        if (nextResult.ok) {
          const total = nextResult.summary.totalDifferences;
          setActivity(total === 0
            ? 'The documents are equal with the selected options.'
            : `Comparison complete: ${total.toLocaleString()} difference${total === 1 ? '' : 's'} found.`);
        } else {
          const sides = new Set(nextResult.errors.map((item) => item.side));
          setActivity(`Invalid JSON found on ${sides.size === 2 ? 'both sides' : `${[...sides][0]} side`}. Review the line and column below the editor.`);
        }
      } catch (error) {
        if (comparisonTokenRef.current !== token) return;
        setResult(null);
        setInternalError(error instanceof Error ? error.message : 'An unexpected comparison error occurred.');
        setActivity('The comparison could not finish. Your JSON is still in this tab.');
      } finally {
        if (comparisonTokenRef.current === token) setIsComparing(false);
      }
    }, 20);
  };

  const openFile = async (side: Side, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setActivity(`${file.name} is larger than the 20 MB interactive file limit.`);
      return;
    }
    try {
      const text = await file.text();
      updateSide(side, text, file.name);
      setActivity(`${file.name} loaded on the ${side} side. Choose Compare JSON to update the results.`);
    } catch {
      setActivity(`${file.name} could not be read. Try opening the file again.`);
    }
  };

  const loadSample = () => {
    cancelPendingComparison();
    setLeft(SAMPLE_LEFT);
    setRight(SAMPLE_RIGHT);
    setLeftName('before.json');
    setRightName('after.json');
    setInternalError(null);
    setActivity('Sample restored. Choose Compare JSON to use the current options.');
  };

  const swapSides = () => {
    cancelPendingComparison();
    setLeft(right);
    setRight(left);
    setLeftName(rightName);
    setRightName(leftName);
    setInternalError(null);
    setActivity('Left and right inputs swapped. Choose Compare JSON to update the results.');
  };

  const clearBoth = () => {
    cancelPendingComparison();
    setLeft('');
    setRight('');
    setLeftName('Left input');
    setRightName('Right input');
    setResult(null);
    setInternalError(null);
    setFilter('all');
    setActivity('Both editors cleared. Paste JSON or open files to begin.');
  };

  const handleOptionChange = (option: 'exact' | 'arrays', checked: boolean) => {
    cancelPendingComparison();
    setInternalError(null);
    if (option === 'exact') setExactNumbers(checked);
    else setIgnoreArrayOrder(checked);
    setActivity('Comparison options changed. Choose Compare JSON to update the results.');
  };

  const successfulResult = currentResult?.ok ? currentResult : null;

  const copySummary = async () => {
    if (!successfulResult) return;
    const counts = getCategoryCounts(successfulResult);
    const lines = [
      'LiveParse JSON comparison summary',
      `Total differences: ${successfulResult.summary.totalDifferences}`,
      `Changed values: ${counts.changed}`,
      `Added: ${counts.added}`,
      `Removed: ${counts.removed}`,
      `Type changes: ${counts.type}`,
      `Number comparison: ${exactNumbers ? 'exact tokens' : 'semantic values'}`,
      `Array comparison: ${ignoreArrayOrder ? 'ignore order' : 'match by position'}`,
    ];
    if (successfulResult.summary.truncated) {
      lines.push(`Detailed results limited to ${successfulResult.summary.returnedDifferences} entries.`);
    }
    try {
      await copyText(lines.join('\n'));
      setActivity('Comparison summary copied to the clipboard.');
    } catch {
      setActivity('Clipboard access was unavailable. Use Download diff JSON instead.');
    }
  };

  const downloadDiff = () => {
    if (!successfulResult) return;
    const payload = {
      tool: 'LiveParse JSON Compare',
      exportedAt: new Date().toISOString(),
      files: { left: leftName, right: rightName },
      options: buildOptions(exactNumbers, ignoreArrayOrder),
      summary: successfulResult.summary,
      differences: successfulResult.differences,
    };
    downloadText(JSON.stringify(payload, null, 2), 'liveparse-json-diff.json');
    setActivity('Diff JSON downloaded. The original documents were not included.');
  };

  return (
    <section
      className="json-compare-app"
      aria-label="Local JSON comparison workspace"
      aria-busy={isComparing}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          if (!isComparing) runComparison();
        }
      }}
    >
      <div className="compare-toolbar">
        <div className="compare-local-badge">
          <span aria-hidden="true" />
          <div><strong>Local comparison</strong><small>Your files and pasted JSON never leave this tab</small></div>
        </div>
        <div className="compare-toolbar-actions" aria-label="Workspace actions">
          <button type="button" className="compare-button subtle" onClick={loadSample}>Load sample</button>
          <button type="button" className="compare-button subtle" onClick={swapSides}>Swap sides</button>
          <button type="button" className="compare-button danger" onClick={clearBoth}>Clear both</button>
        </div>
      </div>

      <div className="compare-options-bar">
        <fieldset className="compare-options">
          <legend>Comparison options</legend>
          <label className="compare-toggle">
            <input
              type="checkbox"
              checked={exactNumbers}
              onChange={(event) => handleOptionChange('exact', event.target.checked)}
            />
            <span><strong>Exact number tokens</strong><small>Treat 1 and 1.0 as different</small></span>
          </label>
          <label className="compare-toggle">
            <input
              type="checkbox"
              checked={ignoreArrayOrder}
              onChange={(event) => handleOptionChange('arrays', event.target.checked)}
            />
            <span><strong>Ignore array order</strong><small>Match equivalent items in any position</small></span>
          </label>
        </fieldset>
        <div className="compare-run-group">
          <button type="button" className="compare-button primary" onClick={runComparison} disabled={isComparing}>
            {isComparing ? 'Comparing…' : 'Compare JSON'}
          </button>
          <span><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></span>
        </div>
      </div>

      <div className="compare-editors">
        <JsonEditor
          side="left"
          title="Left JSON"
          filename={leftName}
          value={left}
          errors={leftErrors}
          fileInputRef={leftFileRef}
          onChange={(value) => updateSide('left', value)}
          onOpenFile={(event) => void openFile('left', event)}
          onClear={() => {
            updateSide('left', '');
            setLeftName('Left input');
            setActivity('Left editor cleared.');
          }}
        />
        <JsonEditor
          side="right"
          title="Right JSON"
          filename={rightName}
          value={right}
          errors={rightErrors}
          fileInputRef={rightFileRef}
          onChange={(value) => updateSide('right', value)}
          onOpenFile={(event) => void openFile('right', event)}
          onClear={() => {
            updateSide('right', '');
            setRightName('Right input');
            setActivity('Right editor cleared.');
          }}
        />
      </div>

      <div className="compare-live-status" role="status" aria-live="polite" aria-atomic="true">
        <strong>{stale ? 'Results out of date' : isComparing ? 'Working locally' : 'Ready'}</strong>
        <span>{activity}</span>
      </div>

      <ComparisonResults
        result={result}
        stale={stale}
        filter={filter}
        internalError={internalError}
        onFilter={setFilter}
        onCopySummary={() => void copySummary()}
        onDownload={downloadDiff}
      />
    </section>
  );
}

function JsonEditor({
  side,
  title,
  filename,
  value,
  errors,
  fileInputRef,
  onChange,
  onOpenFile,
  onClear,
}: {
  side: Side;
  title: string;
  filename: string;
  value: string;
  errors: Extract<JsonCompareResult, { ok: false }>['errors'];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onOpenFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  const editorId = `compare-${side}-input`;
  const errorId = `compare-${side}-errors`;
  const lineCount = useMemo(() => countLines(value), [value]);
  return (
    <section className={`compare-editor-panel ${errors.length ? 'has-error' : ''}`} aria-labelledby={`${editorId}-heading`}>
      <div className="compare-editor-heading">
        <div>
          <p>{side === 'left' ? 'Before' : 'After'}</p>
          <h2 id={`${editorId}-heading`}>{title}</h2>
          <small title={filename}>{filename} · {lineCount.toLocaleString()} lines · {value.length.toLocaleString()} characters</small>
        </div>
        <div className="compare-editor-actions">
          <input
            ref={fileInputRef}
            className="compare-visually-hidden"
            type="file"
            accept=".json,.jsonc,.txt,application/json,text/json,text/plain"
            onChange={onOpenFile}
            tabIndex={-1}
          />
          <button type="button" className="compare-button subtle" onClick={() => fileInputRef.current?.click()}>Open file</button>
          <button type="button" className="compare-button quiet-danger" onClick={onClear}>Clear</button>
        </div>
      </div>
      <label className="compare-visually-hidden" htmlFor={editorId}>{title} editor</label>
      <textarea
        id={editorId}
        className="compare-code-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length ? errorId : undefined}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={`Paste ${side} JSON here`}
      />
      {errors.length > 0 && (
        <div id={errorId} className="compare-parse-errors" role="alert">
          <strong>{title} is not valid JSON</strong>
          {errors.map(({ error }, index) => (
            <p key={`${error.location.offset}-${error.code}-${index}`}>
              <span>Line {error.location.line}, column {error.location.column}</span>
              {error.message}
              {error.pathText && error.pathText !== '$' ? <small>Near {error.pathText}</small> : null}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function getCategoryCounts(result: SuccessfulResult) {
  const byKind = result.summary.byKind;
  return {
    all: result.summary.totalDifferences,
    changed: byKind['value-changed'],
    added: byKind['property-added'] + byKind['array-item-added'],
    removed: byKind['property-removed'] + byKind['array-item-removed'],
    type: byKind['type-changed'],
  };
}

function ComparisonResults({
  result,
  stale,
  filter,
  internalError,
  onFilter,
  onCopySummary,
  onDownload,
}: {
  result: JsonCompareResult | null;
  stale: boolean;
  filter: DifferenceFilter;
  internalError: string | null;
  onFilter: (filter: DifferenceFilter) => void;
  onCopySummary: () => void;
  onDownload: () => void;
}) {
  if (internalError) {
    return <div className="compare-empty-state error" role="alert"><strong>Comparison unavailable</strong><p>{internalError}</p></div>;
  }
  if (!result) {
    return <div className="compare-empty-state"><strong>Ready for two JSON documents</strong><p>Paste JSON above or open local files, then choose Compare JSON.</p></div>;
  }
  if (!result.ok) {
    return (
      <div className={`compare-empty-state invalid ${stale ? 'stale' : ''}`}>
        <strong>{stale ? 'Inputs changed since the last check' : 'Fix invalid JSON before comparing'}</strong>
        <p>{stale ? 'Choose Compare JSON to validate the current text.' : 'The precise line and column are shown under each invalid editor.'}</p>
      </div>
    );
  }

  const counts = getCategoryCounts(result);
  const visibleDifferences = result.differences.filter((difference) => matchesFilter(difference, filter));
  const isEqual = result.summary.totalDifferences === 0;
  const leftDuplicateCount = result.left.warnings.filter((warning) => warning.code === 'duplicate-key').length;
  const rightDuplicateCount = result.right.warnings.filter((warning) => warning.code === 'duplicate-key').length;

  return (
    <section className={`compare-results ${stale ? 'stale' : ''}`} aria-labelledby="compare-results-heading">
      <div className="compare-results-heading">
        <div>
          <p>Structural comparison</p>
          <h2 id="compare-results-heading">{isEqual ? 'The JSON documents match' : 'Comparison results'}</h2>
          <small>{isEqual ? 'No structural differences with the selected options.' : `${result.summary.totalDifferences.toLocaleString()} total difference${result.summary.totalDifferences === 1 ? '' : 's'}`}</small>
        </div>
        <div className="compare-export-actions">
          <button type="button" className="compare-button subtle" onClick={onCopySummary} disabled={stale}>Copy summary</button>
          <button type="button" className="compare-button primary" onClick={onDownload} disabled={stale}>Download diff JSON</button>
        </div>
      </div>

      {stale && <p className="compare-stale-note" role="note"><strong>These results are from the previous inputs or options.</strong> Compare again before copying or downloading.</p>}

      <div className="compare-summary" aria-label="Difference summary">
        <SummaryItem label="All differences" value={counts.all} tone="all" />
        <SummaryItem label="Changed values" value={counts.changed} tone="changed" />
        <SummaryItem label="Added" value={counts.added} tone="added" />
        <SummaryItem label="Removed" value={counts.removed} tone="removed" />
        <SummaryItem label="Type changes" value={counts.type} tone="type" />
      </div>

      {(leftDuplicateCount > 0 || rightDuplicateCount > 0) && (
        <p className="compare-duplicate-note" role="note">
          <strong>Duplicate keys preserved.</strong>
          Left: {leftDuplicateCount.toLocaleString()} · Right: {rightDuplicateCount.toLocaleString()}.
          Repeated members use occurrence suffixes such as <code>#2</code> in their paths.
        </p>
      )}

      {!isEqual && (
        <>
          <div className="compare-filter-bar">
            <div>
              <strong>Filter differences</strong>
              <small>Paths preserve duplicate-key occurrence numbers such as <code>#2</code>.</small>
            </div>
            <div className="compare-filters" role="group" aria-label="Filter differences by category">
              {(Object.keys(filterLabels) as DifferenceFilter[]).map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={filter === item}
                  onClick={() => onFilter(item)}
                >
                  {filterLabels[item]} <span>{counts[item].toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>

          {result.summary.truncated && (
            <p className="compare-limit-note" role="note">
              The summary counts all discovered differences. Detailed cards are limited to {result.summary.returnedDifferences.toLocaleString()} entries to keep this page responsive.
            </p>
          )}

          <div id="json-difference-list" className="compare-difference-list">
            {visibleDifferences.length > 0 ? visibleDifferences.map((difference, index) => (
              <DifferenceCard difference={difference} key={`${difference.kind}-${difference.pathText}-${index}`} />
            )) : (
              <div className="compare-no-filter-results">
                No loaded difference cards match this filter{result.summary.truncated ? '. Some matching differences may be beyond the detail limit.' : '.'}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone: DifferenceFilter }) {
  return <article className={`compare-summary-item ${tone}`}><span>{label}</span><strong>{value.toLocaleString()}</strong></article>;
}

function DifferenceCard({ difference }: { difference: JsonDifference }) {
  const separatePaths = difference.leftPathText
    && difference.rightPathText
    && difference.leftPathText !== difference.rightPathText;
  return (
    <article className={`compare-difference-card kind-${difference.kind}`}>
      <div className="compare-difference-heading">
        <div>
          <span className="compare-kind-label">{kindLabels[difference.kind]}</span>
          <code>{difference.pathText || '$'}</code>
        </div>
        <p>{differenceDescription(difference)}</p>
      </div>

      {separatePaths && (
        <dl className="compare-path-pair">
          <div><dt>Left path</dt><dd><code>{difference.leftPathText}</code></dd></div>
          <div><dt>Right path</dt><dd><code>{difference.rightPathText}</code></dd></div>
        </dl>
      )}

      <div className="compare-snippets">
        <Snippet label="Left" type={difference.leftType} value={difference.leftSnippet} missing="Not present on the left" />
        <Snippet label="Right" type={difference.rightType} value={difference.rightSnippet} missing="Not present on the right" />
      </div>
    </article>
  );
}

function Snippet({
  label,
  type,
  value,
  missing,
}: {
  label: string;
  type: JsonDifference['leftType'];
  value: string | null;
  missing: string;
}) {
  return (
    <section className={`compare-snippet ${value === null ? 'missing' : ''}`} aria-label={`${label} JSON value`}>
      <div><strong>{label}</strong>{type && <span>{type}</span>}</div>
      {value === null ? <p>{missing}</p> : <pre><code>{value}</code></pre>}
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><JsonCompareApp /></React.StrictMode>);
