import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Layout = 'side' | 'top';
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

type ParseResult =
  | { ok: true; value: unknown; kind: string; pretty: string; minified: string; stats: string }
  | { ok: false; error: string; line?: number; column?: number; position?: number };

const samples: Record<string, string> = {
  'Jackson Jang Profile': JSON.stringify({
    name: 'Jackson Jang',
    project: 'LiveParse',
    role: 'Creator',
    github: 'https://github.com/JacksonJang',
    domain: 'liveparse.com',
    focus: ['JSON parsing', 'developer tools', 'local-first web apps'],
    active: true
  }, null, 2),
  'LiveParse Project': JSON.stringify({
    repository: 'https://github.com/JacksonJang/liveparse',
    owner: 'Jackson Jang',
    app: {
      name: 'LiveParse',
      tagline: 'Local-first JSON parsing as you type',
      deployment: 'Cloudflare Tunnel',
      hostnames: ['liveparse.com', 'www.liveparse.com']
    },
    features: [
      { name: 'Tree View', enabled: true },
      { name: 'Syntax Colorizing', enabled: true },
      { name: 'Minify JSON', enabled: true },
      { name: 'Array Index Display', enabled: true }
    ]
  }, null, 2),
  'Jackson Jang Workspace': `{
  "developer": "Jackson Jang",
  "workspace": "/Users/jhw/Documents/GitHub/liveparse",
  "tools": ["React", "Vite", "TypeScript", "Cloudflare Tunnel"],
  "localOnlyParsing": true,
  "release": {
    "domain": "liveparse.com",
    "status": "online"
  }
}`,
  'Invalid Jackson Sample': `{
  "developer": "Jackson Jang",
  "project": "LiveParse",
  "items": ["parser", "tree", "colorize",],
  "fixed": false
}`,
};

const initialJson = samples['Jackson Jang Profile'];

function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseWithPosition(input: string, useEval: boolean): ParseResult {
  if (!input.trim()) return { ok: false, error: 'Empty input: paste or type JSON on the left.' };
  try {
    const value = useEval
      ? Function(`"use strict"; return (${input});`)()
      : JSON.parse(input);
    const minified = JSON.stringify(value);
    return {
      ok: true,
      value,
      kind: getType(value),
      pretty: JSON.stringify(value, null, 2),
      minified: minified ?? String(value),
      stats: buildStats(value),
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

function buildStats(value: unknown): string {
  let objects = 0, arrays = 0, strings = 0, numbers = 0, booleans = 0, nulls = 0, properties = 0;
  const walk = (v: unknown) => {
    if (v === null) { nulls += 1; return; }
    if (Array.isArray(v)) { arrays += 1; v.forEach(walk); return; }
    if (typeof v === 'object') {
      objects += 1;
      Object.values(v as Record<string, unknown>).forEach((item) => { properties += 1; walk(item); });
      return;
    }
    if (typeof v === 'string') strings += 1;
    if (typeof v === 'number') numbers += 1;
    if (typeof v === 'boolean') booleans += 1;
  };
  walk(value);
  return `${objects} objects · ${arrays} arrays · ${properties} properties · ${strings} strings · ${numbers} numbers · ${booleans} booleans · ${nulls} nulls`;
}

function App() {
  const [input, setInput] = useState(initialJson);
  const [layout, setLayout] = useState<Layout>('side');
  const [parseJson, setParseJson] = useState(true);
  const [evalJson, setEvalJson] = useState(false);
  const [minify, setMinify] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [showTypes, setShowTypes] = useState(false);
  const [showIndex, setShowIndex] = useState(false);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [optionOpen, setOptionOpen] = useState(false);

  const result = useMemo(() => parseWithPosition(input, evalJson && !parseJson), [input, parseJson, evalJson]);
  const outputText = result.ok ? (minify ? result.minified : result.pretty) : formatError(result);

  return (
    <div className="app-shell">
      <header className="header">
        <b>LiveParse</b>
        <nav className="toolbar" aria-label="Parser controls">
          <a className="beta-link" href="https://github.com/JacksonJang/liveparse" target="_blank">LiveParse</a>
          <Menu label="Samples" open={sampleOpen} setOpen={setSampleOpen}>
            {Object.entries(samples).map(([name, value]) => (
              <button key={name} className="menu-item" onClick={() => { setInput(value); setSampleOpen(false); }}>{name}</button>
            ))}
          </Menu>
          <Menu label="Options" open={optionOpen} setOpen={setOptionOpen} alignRight>
            <button className={`menu-item radio ${layout === 'side' ? 'on' : ''}`} onClick={() => setLayout('side')}>Side-by-side</button>
            <button className={`menu-item radio ${layout === 'top' ? 'on' : ''}`} onClick={() => setLayout('top')}>Top-bottom</button>
            <div className="separator" />
            <button className={`menu-item check ${parseJson ? 'on' : ''}`} onClick={() => { setParseJson(true); setEvalJson(false); }}>Parse Json</button>
            <button className={`menu-item check ${evalJson ? 'on' : ''}`} onClick={() => { setEvalJson(true); setParseJson(false); }}>Eval Json</button>
            <div className="separator" />
            <button className={`menu-item check ${minify ? 'on' : ''}`} onClick={() => setMinify((v) => !v)}>Minify</button>
            <button className={`menu-item check ${colorize ? 'on' : ''}`} onClick={() => setColorize((v) => !v)}>Colorize</button>
            <button className={`menu-item check ${showTypes ? 'on' : ''}`} onClick={() => setShowTypes((v) => !v)}>Show JS Types</button>
            <button className={`menu-item check ${showIndex ? 'on' : ''}`} onClick={() => setShowIndex((v) => !v)}>Show Array Index</button>
          </Menu>
        </nav>
      </header>

      <main className={`split ${layout}`}>
        <textarea
          className="input-pane bordered mono"
          spellCheck={false}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="JSON input"
        />
        <div className="splitter" aria-hidden />
        <section className={`output-pane bordered ${result.ok ? '' : input.trim() ? 'json-error' : 'json-empty'} ${colorize ? 'color' : ''} ${showTypes ? 'show-types' : ''} ${showIndex ? 'show-index' : ''}`}>
          <div className="status-bar">
            <span>{result.ok ? `Valid ${result.kind}` : input.trim() ? 'JSON error' : 'Waiting for input'}</span>
            <span>{result.ok ? result.stats : 'Processing is local in your browser'}</span>
          </div>
          <div className="views">
            <div className="text-view mono" aria-label="Formatted output">
              {result.ok && colorize ? <HighlightedJson text={outputText} /> : <pre>{outputText}</pre>}
            </div>
            <div className="tree-view mono" aria-label="Tree output">
              {result.ok ? <TreeNode value={result.value as JsonValue} name="root" root showIndex={showIndex} /> : <pre className="error-block">{formatError(result)}</pre>}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>LiveParse · Local-first JSON parser by Jackson Jang</span>
        <a href="/">FAQ</a><a href="/">Privacy Policy</a><a href="/">Changelog</a><a href="https://github.com/JacksonJang/liveparse">GitHub</a>
      </footer>
    </div>
  );
}

function Menu({ label, open, setOpen, alignRight = false, children }: { label: string; open: boolean; setOpen: (open: boolean) => void; alignRight?: boolean; children: React.ReactNode }) {
  return <div className={`menu ${open ? 'open' : ''}`}><button className="menu-trigger" onClick={() => setOpen(!open)}>{label} <span>▼</span></button><div className={`menu-list ${alignRight ? 'right' : ''}`}>{children}</div></div>;
}

function formatError(result: ParseResult): string {
  if (result.ok) return '';
  const where = result.line ? `\nLine ${result.line}, column ${result.column}${result.position !== undefined ? `, position ${result.position}` : ''}` : '';
  return `${result.error}${where}`;
}

function HighlightedJson({ text }: { text: string }) {
  const tokens = text.split(/("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g);
  return <pre>{tokens.map((token, i) => {
    let cls = '';
    if (/^".*"$/.test(token)) cls = token.match(/^"(?:\\.|[^"\\])*"(?=\s*$)/) ? 'string' : 'property';
    if (/^-?\d/.test(token)) cls = 'number';
    if (/^(true|false)$/.test(token)) cls = 'boolean';
    if (token === 'null') cls = 'null';
    return cls ? <span key={i} className={cls}>{token}</span> : <React.Fragment key={i}>{token}</React.Fragment>;
  })}</pre>;
}

function TreeNode({ value, name, root = false, showIndex = false }: { value: JsonValue; name: string; root?: boolean; showIndex?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const type = getType(value);
  const isComplex = type === 'object' || type === 'array';
  const label = root ? '' : <><span className="property">{name}</span>: </>;
  if (!isComplex) return <div className={`tree-line ${type}`}>{label}<Scalar value={value} /></div>;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, JsonValue>);
  const open = Array.isArray(value) ? '[' : '{';
  const close = Array.isArray(value) ? ']' : '}';
  return <div className={`tree-node ${type} ${collapsed ? 'collapsed' : ''}`}>
    <div className="tree-line"><button className="toggle" onClick={() => setCollapsed((v) => !v)}>{collapsed ? '+' : '-'}</button>{label}<span className="bracket">{open}</span>{collapsed && <span className="collapsed-count">… {entries.length} items</span>}<span className="bracket">{collapsed ? close : ''}</span></div>
    {!collapsed && <ol>
      {entries.map(([key, val]) => <li key={key}>{Array.isArray(value) && showIndex && <span className="index">{key}</span>}<TreeNode value={val} name={key} showIndex={showIndex} /></li>)}
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
