import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import VirtualJsonTree from './components/VirtualJsonTree';
import type { JsonStats, JsonWarning } from './lib/lossless-json';
import { useLosslessJsonWorker } from './useLosslessJsonWorker';
import './styles.css';

type Layout = 'side' | 'top';
type OutputMode = 'text' | 'tree';

const samples = {
  'SEO metadata': `{
  "title": "JSON Formatter, Validator & Viewer Online | LiveParse",
  "description": "Format, validate, beautify, minify, and explore JSON locally while preserving 64-bit numbers and duplicate keys.",
  "canonicalUrl": "https://liveparse.com/json-formatter/",
  "robots": {
    "index": true,
    "follow": true,
    "maxImagePreview": "large"
  },
  "openGraph": {
    "type": "website",
    "siteName": "LiveParse",
    "title": "JSON Formatter & Validator",
    "description": "A private browser-based JSON tool that preserves the original data.",
    "url": "https://liveparse.com/json-formatter/",
    "image": "https://liveparse.com/og.png",
    "imageAlt": "LiveParse lossless JSON parser"
  },
  "twitter": {
    "card": "summary_large_image",
    "title": "Lossless JSON Parser & Formatter",
    "description": "Validate and format JSON locally without losing numeric precision.",
    "image": "https://liveparse.com/og.png"
  },
  "structuredData": {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "LiveParse JSON Formatter, Validator, and Viewer",
    "url": "https://liveparse.com/json-formatter/",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Any",
    "isAccessibleForFree": true
  }
}`,
  'Lossless safety checks': `{
  "safeInteger": 9007199254740991,
  "snowflakeId": 9007199254740993,
  "largeExponent": 1e400,
  "decimalToken": 1.2300,
  "event": "created",
  "event": "updated"
}`,
  'Developer profile': `{
  "name": "Jackson Jang",
  "project": "LiveParse",
  "role": "Creator",
  "github": "https://github.com/JacksonJang",
  "focus": ["lossless JSON", "developer tools", "local-first web apps"],
  "active": true
}`,
  'API response': `{
  "status": "success",
  "requestId": 7443251909984833537,
  "data": {
    "localFirst": true,
    "features": ["validate", "format", "virtual tree", "warnings"],
    "limits": null
  }
}`,
  'Nested product data': `{
  "app": {
    "name": "LiveParse",
    "tagline": "Lossless JSON tools that keep data local",
    "domain": "liveparse.com"
  },
  "workflow": {
    "input": "Paste strict JSON",
    "output": ["formatted text", "virtualized tree"]
  },
  "privacy": { "processing": "browser worker", "uploads": false }
}`,
  'Invalid JSON example': `{
  "project": "LiveParse",
  "features": ["parser", "tree", "warnings",],
  "valid": false
}`,
} as const;

type SampleName = keyof typeof samples;

type UiText = {
  sampleLabels: Record<SampleName, string>;
  appAria: string;
  localProcessing: string;
  localPrivacy: string;
  parserSettings: string;
  example: string;
  editorLayout: string;
  sideBySide: string;
  stacked: string;
  inputTitle: string;
  inputMeta: (lines: string, characters: string) => string;
  openFile: string;
  format: string;
  minify: string;
  clear: string;
  inputAria: string;
  inputPlaceholder: string;
  outputTitle: string;
  outputLocalMeta: string;
  outputView: string;
  textView: string;
  treeView: string;
  download: string;
  copyOutput: string;
  copied: string;
  copyFailed: string;
  validStatus: (kind: string, warnings: number) => string;
  jsonError: string;
  parsing: string;
  workerError: string;
  waitingForInput: string;
  statsSummary: (stats: JsonStats, durationMs: number) => string;
  valueStats: (stats: JsonStats) => string;
  warningSummary: (count: number) => string;
  viewOptions: string;
  losslessStrictJson: string;
  indent: string;
  formattingIndentation: string;
  twoSpaces: string;
  fourSpaces: string;
  minifiedOutput: string;
  color: string;
  types: string;
  arrayIndexes: string;
  formattedOutputAria: string;
  treeOutputAria: string;
  emptyInput: string;
  errorLocation: (line: number, column: number, position: number) => string;
  warningsHeading: (count: number) => string;
  moreWarnings: (count: number) => string;
  warningAt: (line: number, column: number, path: string) => string;
  warningUnsafe: (raw: string) => string;
  warningOverflow: (raw: string) => string;
  warningRepresentation: (raw: string, representation: string, changed: boolean) => string;
  warningDuplicate: (key: string, occurrence: number) => string;
  largeTextPlain: string;
  kindNames: Record<string, string>;
};

const t: UiText = {
  sampleLabels: {
    'SEO metadata': 'SEO metadata',
    'Lossless safety checks': '64-bit & duplicate key checks',
    'Developer profile': 'Developer profile',
    'API response': 'API response with Snowflake ID',
    'Nested product data': 'Nested product data',
    'Invalid JSON example': 'Invalid JSON example',
  },
  appAria: 'Interactive JSON formatter and validator',
  localProcessing: 'Local worker',
  localPrivacy: 'Your JSON never leaves this tab',
  parserSettings: 'Parser settings',
  example: 'Example',
  editorLayout: 'Editor layout',
  sideBySide: 'Side by side',
  stacked: 'Stacked',
  inputTitle: 'JSON input',
  inputMeta: (lines, characters) => `${lines} lines · ${characters} characters`,
  openFile: 'Open file',
  format: 'Format',
  minify: 'Minify',
  clear: 'Clear',
  inputAria: 'Paste JSON input',
  inputPlaceholder: 'Paste JSON here. Number tokens and duplicate keys stay intact.',
  outputTitle: 'Lossless output',
  outputLocalMeta: 'Parsing and formatting stay in your browser',
  outputView: 'Output view',
  textView: 'Text',
  treeView: 'Tree',
  download: 'Download',
  copyOutput: 'Copy output',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  validStatus: (kind, warnings) => warnings > 0 ? `Valid ${kind} · ${warnings} warning${warnings === 1 ? '' : 's'}` : `Valid ${kind} · lossless`,
  jsonError: 'JSON error',
  parsing: 'Checking…',
  workerError: 'Parser unavailable',
  waitingForInput: 'Waiting for input',
  statsSummary: (stats, durationMs) => `${stats.objects} objects · ${stats.arrays} arrays · ${stats.properties} properties · ${stats.characters.toLocaleString()} chars · ${Math.max(1, Math.round(durationMs))} ms worker`,
  valueStats: (stats) => `${stats.strings} strings · ${stats.numbers} numbers · ${stats.booleans} booleans · ${stats.nulls} nulls`,
  warningSummary: (count) => `${count} data-integrity warning${count === 1 ? '' : 's'} — output still preserves the original tokens`,
  viewOptions: 'View options',
  losslessStrictJson: 'Lossless strict JSON',
  indent: 'Indent',
  formattingIndentation: 'Formatting indentation',
  twoSpaces: '2 spaces',
  fourSpaces: '4 spaces',
  minifiedOutput: 'Minified output',
  color: 'Color',
  types: 'Types',
  arrayIndexes: 'Array indexes',
  formattedOutputAria: 'Losslessly formatted JSON output',
  treeOutputAria: 'Virtualized JSON tree output',
  emptyInput: 'Empty input: paste or type JSON to begin.',
  errorLocation: (line, column, position) => `Line ${line}, column ${column}, position ${position}`,
  warningsHeading: (count) => `Data integrity warnings (${count})`,
  moreWarnings: (count) => `${count} more warnings are not shown. Download or search the tree to inspect the complete document.`,
  warningAt: (line, column, path) => `Line ${line}, column ${column} · ${path}`,
  warningUnsafe: (raw) => `${raw} is outside JavaScript's safe integer range. LiveParse preserved it exactly.`,
  warningOverflow: (raw) => `${raw} would overflow a JavaScript Number and stringify as null. LiveParse preserved the token.`,
  warningRepresentation: (raw, representation, changed) => changed
    ? `${raw} would become ${representation} after a JavaScript Number round-trip.`
    : `${raw} would be rewritten as ${representation}; the numeric value is equivalent but its spelling would change.`,
  warningDuplicate: (key, occurrence) => `Duplicate key ${JSON.stringify(key)} (occurrence ${occurrence}) was preserved instead of replacing an earlier value.`,
  largeTextPlain: 'Syntax color is disabled above 100 KB to keep the page responsive.',
  kindNames: {},
};
const sampleNames = Object.keys(samples) as SampleName[];
const initialSample: SampleName = 'SEO metadata';
const initialJson = samples[initialSample];
const MAX_HIGHLIGHT_CHARACTERS = 100_000;
const MAX_VISIBLE_WARNINGS = 40;

function warningMessage(warning: JsonWarning): string {
  switch (warning.code) {
    case 'unsafe-integer': return t.warningUnsafe(warning.raw);
    case 'number-overflow': return t.warningOverflow(warning.raw);
    case 'number-representation-change': return t.warningRepresentation(
      warning.raw,
      warning.javascriptRepresentation,
      warning.valueChanged,
    );
    case 'duplicate-key': return t.warningDuplicate(warning.key, warning.occurrence);
  }
}

function App() {
  const [input, setInput] = useState<string>(initialJson);
  const [layout, setLayout] = useState<Layout>('side');
  const [outputMode, setOutputMode] = useState<OutputMode>('tree');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [minify, setMinify] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [showTypes, setShowTypes] = useState(false);
  const [showIndex, setShowIndex] = useState(true);
  const [copyLabel, setCopyLabel] = useState(t.copyOutput);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerState = useLosslessJsonWorker(input);

  const inputEmpty = !input.trim();
  const stateMatchesInput = workerState.source === input;
  const response = stateMatchesInput && workerState.status === 'ready' ? workerState.response : undefined;
  const result = response?.result;
  const jsonDocument = result?.ok ? result.document : undefined;
  const formatted = indent === 2 ? response?.formatted2 ?? '' : response?.formatted4 ?? '';
  const outputText = useMemo(() => {
    if (inputEmpty) return t.emptyInput;
    if (!stateMatchesInput) return t.parsing;
    if (workerState.status === 'empty') return t.emptyInput;
    if (workerState.status === 'pending') return t.parsing;
    if (workerState.status === 'failed') return workerState.message;
    if (!workerState.response.result.ok) {
      const error = workerState.response.result.error;
      return `${error.message}\n${t.errorLocation(error.location.line, error.location.column, error.location.offset)}`;
    }
    return minify ? workerState.response.minified ?? '' : indent === 2
      ? workerState.response.formatted2 ?? ''
      : workerState.response.formatted4 ?? '';
  }, [indent, inputEmpty, minify, stateMatchesInput, workerState]);
  const lineCount = response ? response.lineCount.toLocaleString() : input ? '…' : '0';
  const isReady = stateMatchesInput && workerState.status === 'ready';
  const isValid = jsonDocument !== undefined;
  const warningCount = jsonDocument?.warnings.length ?? 0;

  const formatInput = () => {
    if (!jsonDocument) return;
    setInput(formatted);
    setMinify(false);
  };

  const minifyInput = () => {
    if (!jsonDocument || !response?.minified) return;
    setInput(response.minified);
    setMinify(true);
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopyLabel(t.copied);
    } catch {
      setCopyLabel(t.copyFailed);
    }
    window.setTimeout(() => setCopyLabel(t.copyOutput), 1300);
  };

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setInput(await file.text());
    setMinify(false);
    event.target.value = '';
  };

  const downloadOutput = () => {
    const blob = new Blob([outputText], { type: isValid ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = isValid ? 'liveparse-lossless.json' : 'json-error.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const isPending = !inputEmpty && (!stateMatchesInput || workerState.status === 'pending');
  const statusClass = isPending
    ? 'json-pending'
    : jsonDocument
      ? warningCount > 0 ? 'json-warning' : 'json-valid'
      : inputEmpty ? 'json-empty' : 'json-error';
  const statusLabel = isPending
    ? t.parsing
    : workerState.status === 'failed'
      ? t.workerError
      : jsonDocument
        ? t.validStatus(t.kindNames[jsonDocument.root.type] ?? jsonDocument.root.type, warningCount)
        : inputEmpty ? t.waitingForInput : t.jsonError;
  const statusDetail = isPending
    ? t.outputLocalMeta
    : jsonDocument
      ? warningCount > 0 ? t.warningSummary(warningCount) : t.valueStats(jsonDocument.stats)
      : outputText;

  return (
    <section className="parser-app" aria-label={t.appAria}>
      <div className="tool-toolbar">
        <div className="local-badge"><span aria-hidden="true" /><strong>{t.localProcessing}</strong><small>{t.localPrivacy}</small></div>
        <div className="tool-settings" aria-label={t.parserSettings}>
          <label className="select-label">
            {t.example}
            <select
              onChange={(event) => {
                setInput(samples[event.target.value as SampleName]);
                setMinify(false);
              }}
              defaultValue={initialSample}
            >
              {sampleNames.map((name) => <option key={name} value={name}>{t.sampleLabels[name]}</option>)}
            </select>
          </label>
          <Segmented label={t.editorLayout} value={layout} options={[["side", t.sideBySide], ["top", t.stacked]]} onChange={(value) => setLayout(value as Layout)} />
        </div>
      </div>

      <div className={`workspace ${layout}`}>
        <section className="panel input-card" aria-labelledby="input-title">
          <PanelHeader
            id="input-title"
            title={t.inputTitle}
            meta={t.inputMeta(lineCount, input.length.toLocaleString())}
            actions={<>
              <input ref={fileInputRef} className="visually-hidden" type="file" aria-label="Open a local file" accept=".json,application/json,text/json,text/plain" onChange={loadFile} tabIndex={-1} />
              <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>{t.openFile}</button>
              <button type="button" className="ghost-button" onClick={formatInput} disabled={!isValid}>{t.format}</button>
              <button type="button" className="ghost-button" onClick={minifyInput} disabled={!isValid}>{t.minify}</button>
              <button type="button" className="ghost-button danger" onClick={() => { setInput(''); setMinify(false); }}>{t.clear}</button>
            </>}
          />
          <textarea
            id="json-input"
            className="input-pane mono"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                formatInput();
              }
            }}
            aria-label={t.inputAria}
            placeholder={t.inputPlaceholder}
          />
        </section>

        <section className={`panel output-card ${statusClass} ${colorize ? 'color' : ''}`} aria-labelledby="output-title">
          <PanelHeader
            id="output-title"
            title={t.outputTitle}
            meta={jsonDocument && response ? t.statsSummary(jsonDocument.stats, response.durationMs) : t.outputLocalMeta}
            actions={<>
              <Segmented label={t.outputView} value={outputMode} options={[["text", t.textView], ["tree", t.treeView]]} onChange={(value) => setOutputMode(value as OutputMode)} compact />
              <button type="button" className="ghost-button" onClick={downloadOutput} disabled={!isReady}>{t.download}</button>
              <button type="button" className="primary-button" onClick={() => void copyOutput()} disabled={!isReady}>{copyLabel}</button>
            </>}
          />

          <div className="status-strip" role="status" aria-live="polite">
            <span className="status-pill">{statusLabel}</span>
            <span>{statusDetail}</span>
          </div>

          {jsonDocument && warningCount > 0 && (
            <WarningPanel warnings={jsonDocument.warnings} />
          )}

          <div className="option-row" aria-label={t.viewOptions}>
            <span className="strict-badge">{t.losslessStrictJson}</span>
            <label className="indent-label">{t.indent}
              <select value={indent} onChange={(event) => setIndent(Number(event.target.value) as 2 | 4)} aria-label={t.formattingIndentation}>
                <option value={2}>{t.twoSpaces}</option>
                <option value={4}>{t.fourSpaces}</option>
              </select>
            </label>
            <Toggle checked={minify} onChange={() => setMinify((value) => !value)} label={t.minifiedOutput} />
            <Toggle checked={colorize} onChange={() => setColorize((value) => !value)} label={t.color} />
            <Toggle checked={showTypes} onChange={() => setShowTypes((value) => !value)} label={t.types} />
            <Toggle checked={showIndex} onChange={() => setShowIndex((value) => !value)} label={t.arrayIndexes} />
          </div>

          <div className={`output-views ${outputMode === 'tree' ? 'tree-active' : ''} mono`}>
            {outputMode === 'text' ? (
              <div className="text-view" aria-label={t.formattedOutputAria}>
                {isValid && outputText.length > MAX_HIGHLIGHT_CHARACTERS && colorize && <p className="large-output-note">{t.largeTextPlain}</p>}
                {isValid && colorize && outputText.length <= MAX_HIGHLIGHT_CHARACTERS
                  ? <HighlightedJson text={outputText} />
                  : <pre>{outputText}</pre>}
              </div>
            ) : (
              <div className="tree-view" aria-label={t.treeOutputAria}>
                {jsonDocument
                  ? <VirtualJsonTree document={jsonDocument} showTypes={showTypes} showArrayIndexes={showIndex} />
                  : <pre className={isReady ? 'error-block' : 'pending-block'}>{outputText}</pre>}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function WarningPanel({ warnings }: { warnings: JsonWarning[] }) {
  const visibleWarnings = warnings.slice(0, MAX_VISIBLE_WARNINGS);
  return (
    <section className="warning-panel" aria-labelledby="warning-heading">
      <h4 id="warning-heading">{t.warningsHeading(warnings.length)}</h4>
      <ol>
        {visibleWarnings.map((warning, index) => (
          <li key={`${warning.code}-${warning.range.start}-${index}`}>
            <strong>{warningMessage(warning)}</strong>
            <span>{t.warningAt(warning.location.line, warning.location.column, warning.pathText)}</span>
          </li>
        ))}
      </ol>
      {warnings.length > visibleWarnings.length && <p>{t.moreWarnings(warnings.length - visibleWarnings.length)}</p>}
    </section>
  );
}

function PanelHeader({ id, title, meta, actions }: { id: string; title: string; meta: string; actions?: React.ReactNode }) {
  return <div className="panel-header"><div><h3 id={id}>{title}</h3><p>{meta}</p></div>{actions && <div className="panel-actions">{actions}</div>}</div>;
}

function Segmented({ label, value, options, onChange, compact = false }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void; compact?: boolean }) {
  return <div className={`segmented ${compact ? 'compact' : ''}`} role="group" aria-label={label}>{options.map(([optionValue, text]) => <button key={optionValue} type="button" className={value === optionValue ? 'active' : ''} aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}>{text}</button>)}</div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={`toggle-chip ${checked ? 'on' : ''}`} onClick={onChange} aria-pressed={checked}>{label}</button>;
}

function HighlightedJson({ text }: { text: string }) {
  const tokens = text.split(/("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g);
  return <pre>{tokens.map((token, index) => {
    let cls = '';
    const nextToken = tokens[index + 1] ?? '';
    if (/^".*"$/.test(token)) cls = nextToken.trimStart().startsWith(':') ? 'property' : 'string';
    if (/^-?\d/.test(token)) cls = 'number';
    if (/^(true|false)$/.test(token)) cls = 'boolean';
    if (token === 'null') cls = 'null';
    return cls ? <span key={index} className={cls}>{token}</span> : <React.Fragment key={index}>{token}</React.Fragment>;
  })}</pre>;
}

createRoot(document.getElementById('root')!).render(<App />);
