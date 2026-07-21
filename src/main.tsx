import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Layout = 'side' | 'top';
type OutputMode = 'text' | 'tree';
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

type ParseResult =
  | { ok: true; value: unknown; kind: string; minified: string; stats: JsonStats }
  | { ok: false; error: string; line?: number; column?: number; position?: number };

type JsonStats = {
  objects: number;
  arrays: number;
  properties: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  characters: number;
};

const samples: Record<string, string> = {
  'Developer profile': JSON.stringify({
    name: 'Jackson Jang',
    project: 'LiveParse',
    role: 'Creator',
    github: 'https://github.com/JacksonJang',
    website: 'https://liveparse.com',
    focus: ['JSON parser', 'developer tools', 'local-first web apps'],
    privacy: 'JSON is parsed in the browser only',
    active: true,
  }, null, 2),
  'API response': JSON.stringify({
    status: 'success',
    tool: 'LiveParse',
    generatedAt: '2026-07-21T00:00:00Z',
    data: {
      localFirst: true,
      features: ['validate JSON', 'format JSON', 'tree view', 'minify JSON', 'syntax highlighting'],
      limits: null,
    },
  }, null, 2),
  'Nested product data': JSON.stringify({
    app: {
      name: 'LiveParse',
      tagline: 'A fast online JSON parser that keeps your data local',
      domain: 'liveparse.com',
    },
    workflow: {
      input: 'Paste strict JSON',
      output: ['formatted text', 'interactive tree'],
    },
    privacy: {
      processing: 'local browser tab',
      uploads: false,
    },
  }, null, 2),
  'Invalid JSON example': `{
  "project": "LiveParse",
  "features": ["parser", "tree", "colorize",],
  "valid": false
}`,
};

const initialJson = samples['Developer profile'];

function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseWithPosition(input: string): ParseResult {
  if (!input.trim()) return { ok: false, error: 'Empty input: paste or type JSON to begin.' };
  try {
    const value = JSON.parse(input);
    const minified = JSON.stringify(value);
    return {
      ok: true,
      value,
      kind: getType(value),
      minified: minified ?? String(value),
      stats: buildStats(value, input.length),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const match = message.match(/position (\d+)/i);
    const position = match ? Number(match[1]) : undefined;
    const loc = position === undefined ? {} : positionToLineColumn(input, position);
    return { ok: false, error: message, position, ...loc };
  }
}

function positionToLineColumn(text: string, position: number) {
  const before = text.slice(0, position);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function buildStats(value: unknown, characters: number): JsonStats {
  const stats: JsonStats = { objects: 0, arrays: 0, properties: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, characters };
  const walk = (v: unknown) => {
    if (v === null) { stats.nulls += 1; return; }
    if (Array.isArray(v)) { stats.arrays += 1; v.forEach(walk); return; }
    if (typeof v === 'object') {
      stats.objects += 1;
      Object.values(v as Record<string, unknown>).forEach((item) => { stats.properties += 1; walk(item); });
      return;
    }
    if (typeof v === 'string') stats.strings += 1;
    if (typeof v === 'number') stats.numbers += 1;
    if (typeof v === 'boolean') stats.booleans += 1;
  };
  walk(value);
  return stats;
}

function statsSummary(stats: JsonStats): string {
  return `${stats.objects} objects · ${stats.arrays} arrays · ${stats.properties} properties · ${stats.characters.toLocaleString()} chars`;
}

function App() {
  const [input, setInput] = useState(initialJson);
  const [layout, setLayout] = useState<Layout>('side');
  const [outputMode, setOutputMode] = useState<OutputMode>('text');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [minify, setMinify] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [showTypes, setShowTypes] = useState(false);
  const [showIndex, setShowIndex] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy output');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => parseWithPosition(input), [input]);
  const formatted = result.ok ? JSON.stringify(result.value, null, indent) : '';
  const outputText = result.ok ? (minify ? result.minified : formatted) : formatError(result);
  const lineCount = input ? input.split('\n').length : 0;

  const formatInput = () => {
    if (result.ok) {
      setInput(formatted);
      setMinify(false);
    }
  };

  const minifyInput = () => {
    if (result.ok) {
      setInput(result.minified);
      setMinify(true);
    }
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy output'), 1300);
    } catch {
      setCopyLabel('Copy failed');
      window.setTimeout(() => setCopyLabel('Copy output'), 1300);
    }
  };

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setInput(await file.text());
    setMinify(false);
    event.target.value = '';
  };

  const downloadOutput = () => {
    const blob = new Blob([outputText], { type: result.ok ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.ok ? 'parsed.json' : 'json-error.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="parser-app" aria-label="Interactive JSON parser">
      <div className="tool-toolbar">
        <div className="local-badge"><span aria-hidden="true"></span><strong>Local processing</strong><small>Your JSON never leaves this tab</small></div>
        <div className="tool-settings" aria-label="Parser settings">
          <label className="select-label">
            Example
            <select onChange={(event) => { setInput(samples[event.target.value]); setMinify(false); }} defaultValue="Developer profile">
              {Object.keys(samples).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <Segmented label="Editor layout" value={layout} options={[["side", "Side by side"], ["top", "Stacked"]]} onChange={(value) => setLayout(value as Layout)} />
        </div>
      </div>

      <div className={`workspace ${layout}`}>
        <section className="panel input-card" aria-labelledby="input-title">
          <PanelHeader
            id="input-title"
            title="JSON input"
            meta={`${lineCount} lines · ${input.length.toLocaleString()} characters`}
            actions={<>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept=".json,application/json,text/json,text/plain" onChange={loadFile} tabIndex={-1} />
              <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>Open file</button>
              <button type="button" className="ghost-button" onClick={formatInput} disabled={!result.ok}>Format</button>
              <button type="button" className="ghost-button" onClick={minifyInput} disabled={!result.ok}>Minify</button>
              <button type="button" className="ghost-button danger" onClick={() => setInput('')}>Clear</button>
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
            aria-label="Paste JSON input"
            placeholder="Paste JSON here. LiveParse validates and formats it instantly."
          />
        </section>

        <section className={`panel output-card ${result.ok ? 'json-valid' : input.trim() ? 'json-error' : 'json-empty'} ${colorize ? 'color' : ''} ${showTypes ? 'show-types' : ''} ${showIndex ? 'show-index' : ''}`} aria-labelledby="output-title">
          <PanelHeader
            id="output-title"
            title="Parsed output"
            meta={result.ok ? statsSummary(result.stats) : 'Processing stays local in your browser'}
            actions={<>
              <Segmented label="Output view" value={outputMode} options={[["text", "Text"], ["tree", "Tree"]]} onChange={(value) => setOutputMode(value as OutputMode)} compact />
              <button type="button" className="ghost-button" onClick={downloadOutput}>Download</button>
              <button type="button" className="primary-button" onClick={copyOutput}>{copyLabel}</button>
            </>}
          />

          <div className="status-strip" role="status" aria-live="polite">
            <span className="status-pill">{result.ok ? `Valid ${result.kind}` : input.trim() ? 'JSON error' : 'Waiting for input'}</span>
            <span>{result.ok ? `${result.stats.strings} strings · ${result.stats.numbers} numbers · ${result.stats.booleans} booleans · ${result.stats.nulls} nulls` : formatError(result)}</span>
          </div>

          <div className="option-row" aria-label="View options">
            <span className="strict-badge">Strict JSON</span>
            <label className="indent-label">Indent
              <select value={indent} onChange={(event) => setIndent(Number(event.target.value) as 2 | 4)} aria-label="Formatting indentation">
                <option value={2}>2 spaces</option>
                <option value={4}>4 spaces</option>
              </select>
            </label>
            <Toggle checked={minify} onChange={() => setMinify((value) => !value)} label="Minified output" />
            <Toggle checked={colorize} onChange={() => setColorize((value) => !value)} label="Color" />
            <Toggle checked={showTypes} onChange={() => setShowTypes((value) => !value)} label="Types" />
            <Toggle checked={showIndex} onChange={() => setShowIndex((value) => !value)} label="Array indexes" />
          </div>

          <div className="output-views mono">
            {outputMode === 'text'
              ? <div className="text-view" aria-label="Formatted JSON output">{result.ok && colorize ? <HighlightedJson text={outputText} /> : <pre>{outputText}</pre>}</div>
              : <div className="tree-view" aria-label="JSON tree output">{result.ok ? <TreeNode value={result.value as JsonValue} name="root" root showIndex={showIndex} /> : <pre className="error-block">{formatError(result)}</pre>}</div>}
          </div>
        </section>
      </div>
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

function formatError(result: ParseResult): string {
  if (result.ok) return '';
  const where = result.line ? `\nLine ${result.line}, column ${result.column}${result.position !== undefined ? `, position ${result.position}` : ''}` : '';
  return `${result.error}${where}`;
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
    return cls ? <span key={`${token}-${index}`} className={cls}>{token}</span> : <React.Fragment key={`${token}-${index}`}>{token}</React.Fragment>;
  })}</pre>;
}

function TreeNode({ value, name, root = false, showIndex = false }: { value: JsonValue; name: string; root?: boolean; showIndex?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const type = getType(value);
  const isComplex = type === 'object' || type === 'array';
  const label = root ? '' : <><span className="property">{name}</span>: </>;
  if (!isComplex) return <div className={`tree-line ${type}`}>{label}<Scalar value={value} /></div>;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as Record<string, JsonValue>);
  const open = Array.isArray(value) ? '[' : '{';
  const close = Array.isArray(value) ? ']' : '}';
  return <div className={`tree-node ${type} ${collapsed ? 'collapsed' : ''}`}>
    <div className="tree-line"><button className="tree-toggle" type="button" onClick={() => setCollapsed((current) => !current)} aria-label={collapsed ? 'Expand node' : 'Collapse node'} aria-expanded={!collapsed}>{collapsed ? '+' : '−'}</button>{label}<span className="bracket">{open}</span>{collapsed && <span className="collapsed-count">… {entries.length} items</span>}<span className="bracket">{collapsed ? close : ''}</span></div>
    {!collapsed && <ol>
      {entries.map(([key, child]) => <li key={key}>{Array.isArray(value) && showIndex && <span className="index">{key}</span>}<TreeNode value={child} name={key} showIndex={showIndex} /></li>)}
    </ol>}
    {!collapsed && <div className="tree-line"><span className="bracket">{close}</span></div>}
  </div>;
}

function Scalar({ value }: { value: JsonValue }) {
  if (typeof value === 'string') return <span className="string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="number">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="boolean">{String(value)}</span>;
  return <span className="null">null</span>;
}

createRoot(document.getElementById('root')!).render(<App />);
