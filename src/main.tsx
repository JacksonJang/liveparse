import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './coupang-banner';
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

type SampleName = keyof typeof samples;
type Locale = 'en' | 'ko';

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
  inputMeta: (lines: number, characters: string) => string;
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
  validStatus: (kind: string) => string;
  jsonError: string;
  waitingForInput: string;
  statsSummary: (stats: JsonStats) => string;
  valueStats: (stats: JsonStats) => string;
  viewOptions: string;
  strictJson: string;
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
  errorLocation: (line: number, column?: number, position?: number) => string;
  expandNode: string;
  collapseNode: string;
  itemCount: (count: number) => string;
  kindNames: Record<string, string>;
};

const translations: Record<Locale, UiText> = {
  en: {
    sampleLabels: {
      'Developer profile': 'Developer profile',
      'API response': 'API response',
      'Nested product data': 'Nested product data',
      'Invalid JSON example': 'Invalid JSON example',
    },
    appAria: 'Interactive JSON parser',
    localProcessing: 'Local processing',
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
    inputPlaceholder: 'Paste JSON here. LiveParse validates and formats it instantly.',
    outputTitle: 'Parsed output',
    outputLocalMeta: 'Processing stays local in your browser',
    outputView: 'Output view',
    textView: 'Text',
    treeView: 'Tree',
    download: 'Download',
    copyOutput: 'Copy output',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    validStatus: (kind) => `Valid ${kind}`,
    jsonError: 'JSON error',
    waitingForInput: 'Waiting for input',
    statsSummary: (stats) => `${stats.objects} objects · ${stats.arrays} arrays · ${stats.properties} properties · ${stats.characters.toLocaleString()} chars`,
    valueStats: (stats) => `${stats.strings} strings · ${stats.numbers} numbers · ${stats.booleans} booleans · ${stats.nulls} nulls`,
    viewOptions: 'View options',
    strictJson: 'Strict JSON',
    indent: 'Indent',
    formattingIndentation: 'Formatting indentation',
    twoSpaces: '2 spaces',
    fourSpaces: '4 spaces',
    minifiedOutput: 'Minified output',
    color: 'Color',
    types: 'Types',
    arrayIndexes: 'Array indexes',
    formattedOutputAria: 'Formatted JSON output',
    treeOutputAria: 'JSON tree output',
    emptyInput: 'Empty input: paste or type JSON to begin.',
    errorLocation: (line, column, position) => `\nLine ${line}, column ${column}${position !== undefined ? `, position ${position}` : ''}`,
    expandNode: 'Expand node',
    collapseNode: 'Collapse node',
    itemCount: (count) => `… ${count} items`,
    kindNames: {},
  },
  ko: {
    sampleLabels: {
      'Developer profile': '개발자 프로필',
      'API response': 'API 응답',
      'Nested product data': '중첩 상품 데이터',
      'Invalid JSON example': '잘못된 JSON 예시',
    },
    appAria: '대화형 JSON 파서',
    localProcessing: '로컬 처리',
    localPrivacy: 'JSON 데이터는 이 탭 밖으로 나가지 않습니다',
    parserSettings: '파서 설정',
    example: '예시',
    editorLayout: '편집기 배치',
    sideBySide: '나란히',
    stacked: '위아래',
    inputTitle: 'JSON 입력',
    inputMeta: (lines, characters) => `${lines}줄 · ${characters}자`,
    openFile: '파일 열기',
    format: '정렬',
    minify: '압축',
    clear: '지우기',
    inputAria: 'JSON 입력 붙여넣기',
    inputPlaceholder: '여기에 JSON을 붙여넣으세요. LiveParse가 즉시 검증하고 정렬합니다.',
    outputTitle: '파싱 결과',
    outputLocalMeta: '브라우저 안에서만 처리됩니다',
    outputView: '결과 보기',
    textView: '텍스트',
    treeView: '트리',
    download: '다운로드',
    copyOutput: '결과 복사',
    copied: '복사됨',
    copyFailed: '복사 실패',
    validStatus: (kind) => `유효한 ${kind}`,
    jsonError: 'JSON 오류',
    waitingForInput: '입력 대기 중',
    statsSummary: (stats) => `객체 ${stats.objects}개 · 배열 ${stats.arrays}개 · 속성 ${stats.properties}개 · 문자 ${stats.characters.toLocaleString()}자`,
    valueStats: (stats) => `문자열 ${stats.strings}개 · 숫자 ${stats.numbers}개 · 불리언 ${stats.booleans}개 · null ${stats.nulls}개`,
    viewOptions: '보기 옵션',
    strictJson: '엄격한 JSON',
    indent: '들여쓰기',
    formattingIndentation: '정렬 들여쓰기',
    twoSpaces: '공백 2칸',
    fourSpaces: '공백 4칸',
    minifiedOutput: '압축 결과',
    color: '색상',
    types: '타입',
    arrayIndexes: '배열 인덱스',
    formattedOutputAria: '정렬된 JSON 결과',
    treeOutputAria: 'JSON 트리 결과',
    emptyInput: '입력이 비어 있습니다. JSON을 붙여넣거나 입력해 시작하세요.',
    errorLocation: (line, column, position) => `\n${line}행, ${column}열${position !== undefined ? `, 위치 ${position}` : ''}`,
    expandNode: '노드 펼치기',
    collapseNode: '노드 접기',
    itemCount: (count) => `… 항목 ${count}개`,
    kindNames: {
      object: '객체',
      array: '배열',
      string: '문자열',
      number: '숫자',
      boolean: '불리언',
      null: 'null',
    },
  },
};

const locale: Locale = document.documentElement.lang === 'ko' ? 'ko' : 'en';
const t = translations[locale];
const sampleNames = Object.keys(samples) as SampleName[];
const initialJson = samples['Developer profile'];

function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseWithPosition(input: string): ParseResult {
  if (!input.trim()) return { ok: false, error: t.emptyInput };
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
  return t.statsSummary(stats);
}

function App() {
  const [input, setInput] = useState(initialJson);
  const [layout, setLayout] = useState<Layout>('side');
  const [outputMode, setOutputMode] = useState<OutputMode>('tree');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [minify, setMinify] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [showTypes, setShowTypes] = useState(false);
  const [showIndex, setShowIndex] = useState(false);
  const [copyLabel, setCopyLabel] = useState<string>(t.copyOutput);
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
      setCopyLabel(t.copied);
      window.setTimeout(() => setCopyLabel(t.copyOutput), 1300);
    } catch {
      setCopyLabel(t.copyFailed);
      window.setTimeout(() => setCopyLabel(t.copyOutput), 1300);
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
    <section className="parser-app" aria-label={t.appAria}>
      <div className="tool-toolbar">
        <div className="local-badge"><span aria-hidden="true"></span><strong>{t.localProcessing}</strong><small>{t.localPrivacy}</small></div>
        <div className="tool-settings" aria-label={t.parserSettings}>
          <label className="select-label">
            {t.example}
            <select onChange={(event) => { setInput(samples[event.target.value]); setMinify(false); }} defaultValue="Developer profile">
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
              <input ref={fileInputRef} className="visually-hidden" type="file" accept=".json,application/json,text/json,text/plain" onChange={loadFile} tabIndex={-1} />
              <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>{t.openFile}</button>
              <button type="button" className="ghost-button" onClick={formatInput} disabled={!result.ok}>{t.format}</button>
              <button type="button" className="ghost-button" onClick={minifyInput} disabled={!result.ok}>{t.minify}</button>
              <button type="button" className="ghost-button danger" onClick={() => setInput('')}>{t.clear}</button>
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

        <section className={`panel output-card ${result.ok ? 'json-valid' : input.trim() ? 'json-error' : 'json-empty'} ${colorize ? 'color' : ''} ${showTypes ? 'show-types' : ''} ${showIndex ? 'show-index' : ''}`} aria-labelledby="output-title">
          <PanelHeader
            id="output-title"
            title={t.outputTitle}
            meta={result.ok ? statsSummary(result.stats) : t.outputLocalMeta}
            actions={<>
              <Segmented label={t.outputView} value={outputMode} options={[["text", t.textView], ["tree", t.treeView]]} onChange={(value) => setOutputMode(value as OutputMode)} compact />
              <button type="button" className="ghost-button" onClick={downloadOutput}>{t.download}</button>
              <button type="button" className="primary-button" onClick={copyOutput}>{copyLabel}</button>
            </>}
          />

          <div className="status-strip" role="status" aria-live="polite">
            <span className="status-pill">{result.ok ? t.validStatus(t.kindNames[result.kind] ?? result.kind) : input.trim() ? t.jsonError : t.waitingForInput}</span>
            <span>{result.ok ? t.valueStats(result.stats) : formatError(result)}</span>
          </div>

          <div className="option-row" aria-label={t.viewOptions}>
            <span className="strict-badge">{t.strictJson}</span>
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

          <div className="output-views mono">
            {outputMode === 'text'
              ? <div className="text-view" aria-label={t.formattedOutputAria}>{result.ok && colorize ? <HighlightedJson text={outputText} /> : <pre>{outputText}</pre>}</div>
              : <div className="tree-view" aria-label={t.treeOutputAria}>{result.ok ? <TreeNode value={result.value as JsonValue} name="root" root showIndex={showIndex} /> : <pre className="error-block">{formatError(result)}</pre>}</div>}
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
  const where = result.line ? t.errorLocation(result.line, result.column, result.position) : '';
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
    <div className="tree-line"><button className="tree-toggle" type="button" onClick={() => setCollapsed((current) => !current)} aria-label={collapsed ? t.expandNode : t.collapseNode} aria-expanded={!collapsed}>{collapsed ? '+' : '−'}</button>{label}<span className="bracket">{open}</span>{collapsed && <span className="collapsed-count">{t.itemCount(entries.length)}</span>}<span className="bracket">{collapsed ? close : ''}</span></div>
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
