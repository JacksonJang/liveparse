import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MAX_BASE_URL_CODE_UNITS,
  MAX_PARSED_URL_CODE_UNITS,
  MAX_QUERY_PAIRS,
  MAX_URL_TEXT_CODE_UNITS,
  UrlToolError,
  decodeUrlText,
  encodeUrlText,
  firstLoneSurrogateOffset,
  parseQueryString,
  parseUrl,
  type ParsedQueryString,
  type ParsedUrl,
  type QueryPair,
  type UrlDecodeMode,
  type UrlEncodeMode,
} from './lib/url-tools';
import './styles.css';
import './url.css';

type PageMode = 'url-encoder' | 'url-decoder' | 'url-parser' | 'query-string-parser';
type QueryOutputView = 'pairs' | 'map' | 'rebuilt';

interface Calculation<T> {
  value: T | null;
  error: string | null;
}

interface ModeOption<T extends string> {
  value: T;
  label: string;
  detail: string;
}

const MAX_VISIBLE_QUERY_PAIRS = 200;

const ENCODE_OPTIONS: readonly ModeOption<UrlEncodeMode>[] = [
  { value: 'component', label: 'URL component', detail: 'encodeURIComponent-compatible' },
  { value: 'rfc3986-component', label: 'RFC 3986', detail: "Also escapes ! ' ( ) *" },
  { value: 'full-uri', label: 'Full URI', detail: 'Preserves trusted delimiters' },
  { value: 'form', label: 'Form field', detail: 'Space becomes +' },
];

const DECODE_OPTIONS: readonly ModeOption<UrlDecodeMode>[] = [
  { value: 'component', label: 'URL component', detail: 'Decode all valid escapes' },
  { value: 'full-uri', label: 'Full URI', detail: 'Keep reserved delimiters escaped' },
  { value: 'form', label: 'Form field', detail: 'Plus becomes space' },
];

const ENCODE_SAMPLES: Record<UrlEncodeMode, string> = {
  component: 'café & tea / 한글 😀',
  'rfc3986-component': "report!'()*~ 2026",
  'full-uri': 'https://example.com/search?q=café & tea#results',
  form: 'café & tea + biscuits',
};

const DECODE_SAMPLES: Record<UrlDecodeMode, string> = {
  component: '%ED%95%9C%EA%B8%80%20%26%20tea%2Fcoffee',
  'full-uri': 'https://example.com/a%20b%2Fc?q=hello%20world%26more',
  form: 'café+%26+tea+%2B+biscuits',
};

function pageMode(): PageMode {
  const candidate = document.body.dataset.page;
  if (candidate === 'url-decoder' || candidate === 'url-parser' || candidate === 'query-string-parser') return candidate;
  return 'url-encoder';
}

function attempt<T>(operation: () => T): Calculation<T> {
  try {
    return { value: operation(), error: null };
  } catch (error) {
    if (error instanceof UrlToolError) return { value: null, error: error.message };
    return { value: null, error: error instanceof Error ? error.message : 'The local operation failed.' };
  }
}

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function textBytes(value: string): number | null {
  if (firstLoneSurrogateOffset(value) !== null) return null;
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return null;
  }
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // The selectable fallback below remains available when permission is denied.
    }
  }
  const fallback = document.createElement('textarea');
  fallback.value = value;
  fallback.readOnly = true;
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('The browser rejected clipboard access. Select the output and copy it manually.');
}

function visibleValue(value: string): string {
  return value === '' ? '— empty —' : value;
}

function sourceLabel(source: ParsedQueryString['sourceKind']): string {
  if (source === 'absolute-url') return 'Query extracted from a scheme:// absolute URL';
  if (source === 'question-mark-query') return 'Leading ? removed';
  return 'Raw query string';
}

function ModePicker<T extends string>({
  legend,
  options,
  selected,
  onSelect,
}: {
  legend: string;
  options: readonly ModeOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset className="url-fieldset">
      <legend>{legend}</legend>
      <div className={`url-mode-picker count-${options.length}`}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={selected === option.value}
            onClick={() => onSelect(option.value)}
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Counter({ value, maximum }: { value: string; maximum: number }): React.JSX.Element {
  const over = value.length > maximum;
  return (
    <span className={over ? 'url-counter over' : 'url-counter'}>
      {value.length.toLocaleString('en-US')} / {maximum.toLocaleString('en-US')} UTF-16
    </span>
  );
}

function LocalHeader({ page }: { page: PageMode }): React.JSX.Element {
  const labels: Record<PageMode, string> = {
    'url-encoder': 'Percent encoder',
    'url-decoder': 'Strict decoder',
    'url-parser': 'WHATWG parser',
    'query-string-parser': 'Form query parser',
  };
  return (
    <header className="url-toolbar">
      <div className="url-local-badge">
        <span aria-hidden="true" />
        <div><strong>Local text processing</strong><small>No upload, fetch, navigation, DNS lookup, or input persistence</small></div>
      </div>
      <div className="url-tool-badge"><span>{labels[page]}</span><strong>One explicit operation</strong></div>
    </header>
  );
}

function SafetyFooter(): React.JSX.Element {
  return (
    <aside className="url-safety-strip">
      <div><strong>Parsing is not trust</strong><span>A syntactically parsed or encoded URL can still be malicious, misleading, expired, unauthorized, or directed to a private network.</span></div>
      <div><strong>Nothing is opened</strong><span>Results are rendered as inert text. This tool never requests a hostname, follows a redirect, tests a server, or executes a URL scheme.</span></div>
    </aside>
  );
}

function Encoder({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [mode, setMode] = useState<UrlEncodeMode>('component');
  const [input, setInput] = useState(ENCODE_SAMPLES.component);
  const result = useMemo(() => attempt(() => encodeUrlText(input, mode)), [input, mode]);
  const output = result.value ?? '';

  const selectMode = (next: UrlEncodeMode) => {
    setMode(next);
    onStatus(`${ENCODE_OPTIONS.find((option) => option.value === next)?.label ?? next} selected. The input has not left this tab.`);
  };
  const useSample = () => {
    setInput(ENCODE_SAMPLES[mode]);
    onStatus('Loaded a synthetic example locally.');
  };
  const clear = () => {
    setInput('');
    onStatus('Input cleared from this page state.');
  };
  const copy = async () => {
    try {
      await copyText(output);
      onStatus('Copied the complete encoded output.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  return (
    <div className="url-tool-body">
      <div className="url-tool-intro"><div><p>Encoding context</p><h2>Choose which characters are data</h2></div><span>Percent-encoding uses uppercase UTF-8 byte triplets. Input is never normalized or trimmed.</span></div>
      <ModePicker legend="Encoding mode" options={ENCODE_OPTIONS} selected={mode} onSelect={selectMode} />
      <div className="url-workspace">
        <section className="url-card" aria-labelledby="url-encode-input-heading">
          <header className="url-card-heading"><div><p>Input</p><h3 id="url-encode-input-heading">Text to encode</h3></div><Counter value={input} maximum={MAX_URL_TEXT_CODE_UNITS} /></header>
          <div className="url-card-body">
            <label className="url-text-field"><span>Unicode text · up to {MAX_URL_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={12} spellCheck={false} maxLength={MAX_URL_TEXT_CODE_UNITS} /></label>
            <div className="url-actions"><button type="button" className="url-button quiet" onClick={useSample}>Use mode sample</button><button type="button" className="url-link-button" onClick={clear}>Clear</button></div>
            <dl className="url-facts"><div><dt>Code points</dt><dd>{codePointCount(input).toLocaleString('en-US')}</dd></div><div><dt>UTF-8 bytes</dt><dd>{textBytes(input)?.toLocaleString('en-US') ?? 'Invalid Unicode'}</dd></div><div><dt>Whitespace</dt><dd>{mode === 'form' ? 'Space → +' : 'Space → %20'}</dd></div><div><dt>Passes</dt><dd>Exactly one</dd></div></dl>
          </div>
        </section>
        <section className="url-card output" aria-labelledby="url-encode-output-heading">
          <header className="url-card-heading"><div><p>Output</p><h3 id="url-encode-output-heading">Encoded result</h3></div><span>{result.error ? 'Input rejected' : `${output.length.toLocaleString('en-US')} characters`}</span></header>
          <div className="url-card-body">
            {result.error ? <p className="url-error" role="alert"><strong>Cannot encode this input</strong><span>{result.error}</span></p> : <label className="url-text-field output"><span>Complete output · inert text</span><textarea value={output} readOnly rows={12} spellCheck={false} /></label>}
            <div className="url-actions"><button type="button" className="url-button primary" disabled={Boolean(result.error) || output === ''} onClick={() => void copy()}>Copy complete output</button></div>
            <p className="url-notice"><strong>Context matters:</strong> full URI mode preserves structural delimiters and is unsuitable for inserting an untrusted value as one component. Form mode is the only mode here where a literal space becomes <code>+</code>.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Decoder({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [mode, setMode] = useState<UrlDecodeMode>('component');
  const [input, setInput] = useState(DECODE_SAMPLES.component);
  const result = useMemo(() => attempt(() => decodeUrlText(input, mode)), [input, mode]);
  const output = result.value ?? '';
  const stillEncoded = !result.error && /%[0-9A-Fa-f]{2}/.test(output);

  const selectMode = (next: UrlDecodeMode) => {
    setMode(next);
    onStatus(`${DECODE_OPTIONS.find((option) => option.value === next)?.label ?? next} selected. Decoding remains a single explicit round.`);
  };
  const copy = async () => {
    try {
      await copyText(output);
      onStatus('Copied the complete one-round decoded output.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  return (
    <div className="url-tool-body">
      <div className="url-tool-intro"><div><p>Strict decoding policy</p><h2>Decode one UTF-8 round</h2></div><span>Malformed percent triplets, invalid UTF-8, and unpaired UTF-16 surrogates are rejected instead of repaired.</span></div>
      <ModePicker legend="Decoding mode" options={DECODE_OPTIONS} selected={mode} onSelect={selectMode} />
      <div className="url-workspace">
        <section className="url-card" aria-labelledby="url-decode-input-heading">
          <header className="url-card-heading"><div><p>Input</p><h3 id="url-decode-input-heading">Percent-encoded text</h3></div><Counter value={input} maximum={MAX_URL_TEXT_CODE_UNITS} /></header>
          <div className="url-card-body">
            <label className="url-text-field"><span>Encoded text · strict percent syntax</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={12} spellCheck={false} maxLength={MAX_URL_TEXT_CODE_UNITS} /></label>
            <div className="url-actions"><button type="button" className="url-button quiet" onClick={() => { setInput(DECODE_SAMPLES[mode]); onStatus('Loaded a synthetic encoded example.'); }}>Use mode sample</button><button type="button" className="url-link-button" onClick={() => { setInput(''); onStatus('Input cleared from this page state.'); }}>Clear</button></div>
            <dl className="url-facts"><div><dt>Plus sign</dt><dd>{mode === 'form' ? 'Decoded as space' : 'Kept as +'}</dd></div><div><dt>Reserved escapes</dt><dd>{mode === 'full-uri' ? 'Preserved' : 'Decoded'}</dd></div><div><dt>Error policy</dt><dd>Strict rejection</dd></div><div><dt>Passes</dt><dd>Exactly one</dd></div></dl>
          </div>
        </section>
        <section className="url-card output" aria-labelledby="url-decode-output-heading">
          <header className="url-card-heading"><div><p>Output</p><h3 id="url-decode-output-heading">Decoded result</h3></div><span>{result.error ? 'Input rejected' : `${codePointCount(output).toLocaleString('en-US')} code points`}</span></header>
          <div className="url-card-body">
            {result.error ? <p className="url-error" role="alert"><strong>Cannot decode this input</strong><span>{result.error}</span></p> : <label className="url-text-field output"><span>One-round result · never opened</span><textarea value={output} readOnly rows={12} spellCheck={false} /></label>}
            <div className="url-actions"><button type="button" className="url-button primary" disabled={Boolean(result.error) || output === ''} onClick={() => void copy()}>Copy complete output</button></div>
            {stillEncoded ? <p className="url-notice caution"><strong>More escapes remain:</strong> this is not an invitation to decode automatically. Another round can change URL structure or expose a hidden payload; inspect the protocol boundary first.</p> : <p className="url-notice"><strong>No repair mode:</strong> invalid sequences are never replaced with U+FFFD, guessed as another character set, or decoded repeatedly.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function PairTable({ pairs, includeRaw = false }: { pairs: readonly QueryPair[]; includeRaw?: boolean }): React.JSX.Element {
  const visible = pairs.slice(0, MAX_VISIBLE_QUERY_PAIRS);
  return (
    <div className="url-table-wrap">
      <table className="url-pair-table">
        <caption className="visually-hidden">Parsed query parameters in source order</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Value</th>{includeRaw ? <th scope="col">Original field</th> : null}</tr></thead>
        <tbody>
          {visible.map((pair) => (
            <tr key={`${pair.index}-${pair.rawName}-${pair.rawValue}`}>
              <th scope="row">{pair.index + 1}</th>
              <td><code>{visibleValue(pair.name)}</code></td>
              <td><code>{visibleValue(pair.value)}</code></td>
              {includeRaw ? <td><code>{pair.rawName}{pair.hadEquals ? `=${pair.rawValue}` : ''}</code><small>{pair.hadEquals ? '= was present' : 'no = in source'}</small></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {pairs.length > visible.length ? <p className="url-table-limit">Showing the first {visible.length.toLocaleString('en-US')} of {pairs.length.toLocaleString('en-US')} pairs. Copy output still includes all accepted pairs.</p> : null}
    </div>
  );
}

function urlWithoutCredentials(result: ParsedUrl): string {
  if (!result.hasCredentials) return result.href;
  const redacted = new URL(result.href);
  redacted.username = '';
  redacted.password = '';
  return redacted.href;
}

function componentJson(result: ParsedUrl): string {
  return JSON.stringify({
    href: urlWithoutCredentials(result),
    credentialsRedacted: result.hasCredentials,
    origin: result.origin,
    protocol: result.protocol,
    username: result.username ? '[present; redacted by LiveParse]' : '',
    password: result.password ? '[present; redacted by LiveParse]' : '',
    host: result.host,
    hostname: result.hostname,
    port: result.port,
    pathname: result.pathname,
    search: result.search,
    hash: result.hash,
    queryPairs: result.queryPairs.map(({ name, value }) => [name, value]),
  }, null, 2);
}

function Parser({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [input, setInput] = useState('https://user:secret@bücher.example:443/a/../search?q=hello+world&q=%ED%95%9C#results');
  const [base, setBase] = useState('');
  const result = useMemo(() => attempt(() => parseUrl(input, base)), [base, input]);
  const parsed = result.value;
  const components: Array<[string, string]> = parsed ? [
    [parsed.hasCredentials ? 'Serialized URL (credentials removed)' : 'Serialized URL', urlWithoutCredentials(parsed)],
    ['Origin', parsed.origin],
    ['Protocol', parsed.protocol],
    ['Username', parsed.username ? 'Present — redacted in this view' : '— empty —'],
    ['Password', parsed.password ? 'Present — redacted in this view' : '— empty —'],
    ['Host', parsed.host],
    ['Hostname (ASCII)', parsed.hostname],
    ['Port', parsed.port],
    ['Pathname', parsed.pathname],
    ['Search', parsed.search],
    ['Hash', parsed.hash],
  ] : [];

  const copy = async (kind: 'url' | 'json') => {
    if (!parsed) return;
    try {
      await copyText(kind === 'url' ? urlWithoutCredentials(parsed) : componentJson(parsed));
      onStatus(kind === 'url'
        ? parsed.hasCredentials ? 'Copied the serialized URL with username and password removed.' : 'Copied the complete serialized URL.'
        : 'Copied component JSON with credential values redacted and userinfo removed from href.');
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  return (
    <div className="url-tool-body">
      <div className="url-tool-intro"><div><p>Strict input gate, then browser URL semantics</p><h2>Parse without requesting the address</h2></div><span>LiveParse first rejects malformed percent escapes, invalid percent-encoded UTF-8, and unpaired surrogates, then uses the current browser's WHATWG URL implementation. Native URL alone can accept some inputs rejected here.</span></div>
      <div className="url-parser-inputs">
        <label className="url-text-field"><span>Absolute URL or relative reference</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={5} spellCheck={false} maxLength={MAX_PARSED_URL_CODE_UNITS} /></label>
        <label className="url-single-field"><span>Optional absolute base URL · required only for a relative reference</span><input type="text" value={base} onChange={(event) => setBase(event.target.value)} spellCheck={false} maxLength={MAX_BASE_URL_CODE_UNITS} placeholder="https://example.com/docs/start/" /></label>
        <div className="url-actions between"><div><button type="button" className="url-button quiet" onClick={() => { setInput('../api/items?tag=a&tag=b#row'); setBase('https://example.com/docs/start/'); onStatus('Loaded a synthetic relative-reference example.'); }}>Relative URL sample</button><button type="button" className="url-button quiet" onClick={() => { setInput('https://example.com:443/a/../b?q=one&q=two'); setBase(''); onStatus('Loaded a synthetic absolute URL example.'); }}>Absolute URL sample</button><button type="button" className="url-link-button" onClick={() => { setInput(''); setBase(''); onStatus('URL and base cleared.'); }}>Clear</button></div><div><Counter value={input} maximum={MAX_PARSED_URL_CODE_UNITS} />{base ? <Counter value={base} maximum={MAX_BASE_URL_CODE_UNITS} /> : null}</div></div>
      </div>
      {result.error ? <p className="url-error standalone" role="alert"><strong>Cannot parse this URL</strong><span>{result.error}</span></p> : parsed ? (
        <div className="url-parser-results">
          <section className="url-card" aria-labelledby="url-components-heading">
            <header className="url-card-heading"><div><p>Components</p><h3 id="url-components-heading">Strictly validated WHATWG serialization</h3></div><span>{parsed.usedBase ? 'Resolved with explicit base' : base ? 'Absolute input · base ignored' : 'Absolute input'}</span></header>
            <div className="url-card-body">
              <dl className="url-component-list">{components.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{visibleValue(value)}</code></dd></div>)}</dl>
              <div className="url-actions"><button type="button" className="url-button primary" onClick={() => void copy('url')}>{parsed.hasCredentials ? 'Copy URL without credentials' : 'Copy serialized URL'}</button><button type="button" className="url-button quiet" onClick={() => void copy('json')}>Copy redacted component JSON</button></div>
            </div>
          </section>
          <section className="url-card" aria-labelledby="url-query-heading">
            <header className="url-card-heading"><div><p>Query</p><h3 id="url-query-heading">Ordered parameters</h3></div><span>{parsed.queryPairs.length.toLocaleString('en-US')} pairs</span></header>
            <div className="url-card-body">{parsed.queryPairs.length ? <PairTable pairs={parsed.queryPairs} /> : <p className="url-empty"><strong>No query pairs</strong><span>The parsed URL has no non-empty form-style query fields.</span></p>}</div>
          </section>
          {parsed.warnings.length ? <aside className="url-warning-list" aria-label="URL parsing warnings"><h3>Review before using this URL</h3><ul>{parsed.warnings.map((warning) => <li key={warning.code}><strong>{warning.code.replace(/_/g, ' ').toLowerCase()}</strong><span>{warning.message}</span></li>)}</ul></aside> : <p className="url-notice standalone"><strong>No special warning triggered.</strong> This still does not prove the destination is safe, public, reachable, or controlled by the expected party.</p>}
        </div>
      ) : null}
    </div>
  );
}

function queryViewText(result: ParsedQueryString, view: QueryOutputView): string {
  if (view === 'map') return JSON.stringify(result.map, null, 2);
  if (view === 'rebuilt') return result.rebuiltQuery;
  return JSON.stringify(result.pairs, null, 2);
}

function QueryParser({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [input, setInput] = useState('?tag=url&tag=encoding&empty=&bare&message=hello+world&literal=%2B');
  const [view, setView] = useState<QueryOutputView>('pairs');
  const result = useMemo(() => attempt(() => parseQueryString(input)), [input]);
  const parsed = result.value;
  const output = parsed ? queryViewText(parsed, view) : '';

  const copy = async () => {
    try {
      await copyText(output);
      onStatus(view === 'rebuilt' ? 'Copied the complete canonical rebuilt query.' : `Copied complete ${view === 'pairs' ? 'pair-record' : 'map-of-arrays'} JSON.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  return (
    <div className="url-tool-body">
      <div className="url-tool-intro"><div><p>Order and duplicates retained</p><h2>Parse form-style query fields</h2></div><span>Paste a scheme:// absolute URL, a string beginning with ?, or a raw query. The explicit authority marker prevents scheme-shaped raw fields from being misclassified. Plus means space; %2B means a literal plus.</span></div>
      <section className="url-card query-input" aria-labelledby="query-input-heading">
        <header className="url-card-heading"><div><p>Input</p><h3 id="query-input-heading">URL or query string</h3></div><Counter value={input} maximum={MAX_URL_TEXT_CODE_UNITS} /></header>
        <div className="url-card-body">
          <label className="url-text-field"><span>Up to {MAX_URL_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units and {MAX_QUERY_PAIRS.toLocaleString('en-US')} non-empty fields</span><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={7} spellCheck={false} maxLength={MAX_URL_TEXT_CODE_UNITS} /></label>
          <div className="url-actions"><button type="button" className="url-button quiet" onClick={() => { setInput('https://example.com/search?tag=one&tag=two&empty=&bare&message=hello+world#ignored'); onStatus('Loaded a synthetic absolute URL example.'); }}>Full URL sample</button><button type="button" className="url-button quiet" onClick={() => { setInput('a=1&a=2&empty=&bare&plus=a+b&literal=%2B'); onStatus('Loaded a synthetic raw query example.'); }}>Raw query sample</button><button type="button" className="url-link-button" onClick={() => { setInput(''); onStatus('Query input cleared.'); }}>Clear</button></div>
        </div>
      </section>
      {result.error ? <p className="url-error standalone" role="alert"><strong>Cannot parse this query</strong><span>{result.error}</span></p> : parsed ? (
        <div className="url-query-results">
          <div className="url-query-summary"><div><span>Input interpretation</span><strong>{sourceLabel(parsed.sourceKind)}</strong></div><div><span>Ordered pairs</span><strong>{parsed.pairs.length.toLocaleString('en-US')}</strong></div><div><span>Distinct names</span><strong>{Object.keys(parsed.map).length.toLocaleString('en-US')}</strong></div><div><span>Empty &amp; fields ignored</span><strong>{parsed.ignoredEmptySegments.toLocaleString('en-US')}</strong></div></div>
          <section className="url-card" aria-labelledby="query-output-heading">
            <header className="url-card-heading"><div><p>Output</p><h3 id="query-output-heading">Pairs, grouped JSON, and rebuilt query</h3></div><span>Complete copy · {MAX_VISIBLE_QUERY_PAIRS} row preview</span></header>
            <div className="url-card-body">
              <div className="url-view-tabs" role="group" aria-label="Query output view">{([
                ['pairs', 'Lossless pairs'],
                ['map', 'Map of arrays'],
                ['rebuilt', 'Rebuilt query'],
              ] as const).map(([candidate, label]) => <button type="button" key={candidate} aria-pressed={view === candidate} onClick={() => setView(candidate)}>{label}</button>)}</div>
              {view === 'pairs' ? (parsed.pairs.length ? <PairTable pairs={parsed.pairs} includeRaw /> : <p className="url-empty"><strong>No query pairs</strong><span>Empty input and separator-only input produce an empty parameter list.</span></p>) : <label className="url-text-field output"><span>{view === 'map' ? 'Every name maps to an array so duplicates remain visible' : 'Canonical application/x-www-form-urlencoded serialization; a leading ? is not added'}</span><textarea value={output} readOnly rows={14} spellCheck={false} /></label>}
              <div className="url-actions"><button type="button" className="url-button primary" disabled={output === ''} onClick={() => void copy()}>Copy complete {view === 'pairs' ? 'pair JSON' : view === 'map' ? 'map JSON' : 'query'}</button></div>
              <p className="url-notice"><strong>Lossless boundary:</strong> pair JSON retains order, duplicates, original encoded name/value spellings, and whether <code>=</code> appeared. The rebuilt query is intentionally canonical and can change <code>%20</code> to <code>+</code>, <code>~</code> to <code>%7E</code>, or a bare name to <code>name=</code>.</p>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function UrlToolApp(): React.JSX.Element {
  const page = pageMode();
  const [status, setStatus] = useState('Ready. All URL input and output stays in this browser tab.');
  return (
    <section className={`url-app url-${page}`} aria-label="Local URL utility">
      <LocalHeader page={page} />
      {page === 'url-encoder' ? <Encoder onStatus={setStatus} /> : null}
      {page === 'url-decoder' ? <Decoder onStatus={setStatus} /> : null}
      {page === 'url-parser' ? <Parser onStatus={setStatus} /> : null}
      {page === 'query-string-parser' ? <QueryParser onStatus={setStatus} /> : null}
      <SafetyFooter />
      <p className="url-status" role="status" aria-live="polite"><strong>Status</strong><span>{status}</span></p>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('URL tool root element is missing.');
createRoot(root).render(<React.StrictMode><UrlToolApp /></React.StrictMode>);
