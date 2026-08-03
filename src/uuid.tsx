import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  generateUuidBatch,
  formatUuid,
  parseUuid,
  UuidParseError,
  type ParsedUuid,
  type UuidCase,
  type UuidFormat,
} from './lib/uuid';
import './styles.css';
import './uuid.css';

type PageMode = 'generator' | 'v7' | 'validator';
type GeneratorVersion = 4 | 7;
type OutputShape = 'lines' | 'comma' | 'json' | 'sql';
type ValidationMode = 'strict' | 'normalized';

interface ValidationResult {
  input: string;
  parsed: ParsedUuid | null;
  error: string | null;
  errorOffset: number | null;
}

interface InitialGeneration {
  values: string[];
  version: GeneratorVersion;
  error: string | null;
}

const MAX_UUID_COUNT = 10_000;
const MAX_VALIDATION_CHARACTERS = 500_000;
const MAX_VISIBLE_VALIDATION_RESULTS = 200;
const STRICT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pageMode(): PageMode {
  const value = document.body.dataset.mode;
  return value === 'v7' || value === 'validator' ? value : 'generator';
}

function createInitialGeneration(mode: PageMode): InitialGeneration {
  const version: GeneratorVersion = mode === 'v7' ? 7 : 4;
  try {
    return {
      values: generateUuidBatch({ version, count: 1 }),
      version,
      error: null,
    };
  } catch (error) {
    return {
      values: [],
      version,
      error: error instanceof Error ? error.message : 'UUID generation failed.',
    };
  }
}

function serializeUuids(values: readonly string[], shape: OutputShape): string {
  if (shape === 'comma') return values.join(',');
  if (shape === 'json') return JSON.stringify(values, null, 2);
  if (shape === 'sql') return values.map((value) => `('${value}')`).join(',\n');
  return values.join('\n');
}

function outputExtension(shape: OutputShape): string {
  if (shape === 'json') return 'json';
  if (shape === 'sql') return 'sql';
  if (shape === 'comma') return 'csv';
  return 'txt';
}

function outputMimeType(shape: OutputShape): string {
  if (shape === 'json') return 'application/json;charset=utf-8';
  if (shape === 'comma') return 'text/csv;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

function downloadText(contents: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
  await navigator.clipboard.writeText(value);
}

function candidateValues(input: string): string[] {
  if (!input) return [];
  const possibleJson = input.trim();

  if (possibleJson.startsWith('[')) {
    try {
      const parsed = JSON.parse(possibleJson) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
        return parsed.filter((value) => value.length > 0);
      }
    } catch {
      // Fall back to line and comma parsing so each malformed value gets a useful result.
    }
  }

  return input
    .split(/[\r\n,]+/)
    .filter((value) => value.length > 0);
}

function validateCandidate(input: string, mode: ValidationMode): ValidationResult {
  try {
    const parsed = parseUuid(input);
    if (mode === 'strict' && !STRICT_UUID_PATTERN.test(input)) {
      const lowerInput = input.toLowerCase();
      const strictError = lowerInput.startsWith('urn:uuid:')
        ? { message: 'Strict mode does not accept the urn:uuid: prefix.', offset: 0 }
        : input.startsWith('{') || input.endsWith('}')
          ? { message: 'Strict mode does not accept braces around a UUID.', offset: input.startsWith('{') ? 0 : input.length - 1 }
          : input.length === 32
            ? { message: 'Strict mode requires hyphens at offsets 8, 13, 18, and 23.', offset: 8 }
            : { message: 'Strict mode requires the 8-4-4-4-12 hyphenated form.', offset: null };
      return {
        input,
        parsed: null,
        error: strictError.message,
        errorOffset: strictError.offset,
      };
    }
    return { input, parsed, error: null, errorOffset: null };
  } catch (error) {
    if (error instanceof UuidParseError) {
      return { input, parsed: null, error: error.message, errorOffset: error.offset };
    }
    return { input, parsed: null, error: 'The value could not be inspected.', errorOffset: null };
  }
}

function versionLabel(parsed: ParsedUuid): string {
  if (parsed.isNil) return 'Nil UUID';
  if (parsed.isMax) return 'Max UUID';
  return parsed.version === null ? 'No RFC version' : `UUID v${parsed.version}`;
}

function variantLabel(parsed: ParsedUuid): string {
  if (parsed.variant === 'rfc9562') return 'RFC 9562 (10xx)';
  if (parsed.variant === 'ncs') return 'NCS reserved (0xxx)';
  if (parsed.variant === 'microsoft') return 'Microsoft reserved (110x)';
  return 'Future reserved (111x)';
}

function UuidApp({ mode, initialGeneration }: { mode: PageMode; initialGeneration: InitialGeneration }): React.JSX.Element {
  const [version, setVersion] = useState<GeneratorVersion>(mode === 'v7' ? 7 : 4);
  const [countInput, setCountInput] = useState('1');
  const [format, setFormat] = useState<UuidFormat>('hyphenated');
  const [letterCase, setLetterCase] = useState<UuidCase>('lower');
  const [outputShape, setOutputShape] = useState<OutputShape>('lines');
  const [values, setValues] = useState<string[]>(initialGeneration.values);
  const [generatedVersion, setGeneratedVersion] = useState<GeneratorVersion | null>(
    initialGeneration.values.length > 0 ? initialGeneration.version : null,
  );
  const [activity, setActivity] = useState(
    initialGeneration.error ?? 'Ready. UUIDs are generated locally with the browser cryptography API.',
  );
  const [validationMode, setValidationMode] = useState<ValidationMode>('strict');
  const [validationInput, setValidationInput] = useState(
    mode === 'v7'
      ? '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
      : '919108f7-52d1-4320-9bac-f847db4148a8',
  );
  const outputRef = useRef<HTMLTextAreaElement>(null);

  const serialized = useMemo(() => serializeUuids(values, outputShape), [values, outputShape]);
  const validationCandidates = useMemo(() => candidateValues(validationInput), [validationInput]);
  const validationResults = useMemo(
    () => validationCandidates.slice(0, MAX_UUID_COUNT).map((value) => validateCandidate(value, validationMode)),
    [validationCandidates, validationMode],
  );
  const validResults = validationResults.filter((result) => result.parsed !== null);
  const invalidCount = validationResults.length - validResults.length;
  const firstParsed = values.length > 0 ? (() => {
    try { return parseUuid(values[0]); } catch { return null; }
  })() : null;
  const outputVersion = generatedVersion ?? version;

  const chooseVersion = (nextVersion: GeneratorVersion) => {
    setVersion(nextVersion);
    if (values.length > 0 && generatedVersion !== null && generatedVersion !== nextVersion) {
      setActivity(`UUID v${nextVersion} selected. Generate again to replace the existing UUID v${generatedVersion} output.`);
    }
  };

  const changePresentation = (nextFormat: UuidFormat, nextCase: UuidCase) => {
    setFormat(nextFormat);
    setLetterCase(nextCase);
    if (values.length === 0) return;
    try {
      setValues(values.map((value) => formatUuid(parseUuid(value).bytes, nextFormat, nextCase)));
      setActivity(`Reformatted ${values.length.toLocaleString('en-US')} generated value${values.length === 1 ? '' : 's'} locally.`);
    } catch {
      setActivity('The existing output could not be reformatted. Generate a fresh batch.');
    }
  };

  const generate = () => {
    const count = Number(countInput);
    if (!Number.isInteger(count) || count < 1 || count > MAX_UUID_COUNT) {
      setActivity(`Enter a whole count from 1 to ${MAX_UUID_COUNT.toLocaleString('en-US')}.`);
      return;
    }

    try {
      const nextValues = generateUuidBatch({ version, count, format, case: letterCase });
      setValues(nextValues);
      setGeneratedVersion(version);
      setActivity(`Generated ${count.toLocaleString('en-US')} UUID v${version} value${count === 1 ? '' : 's'} locally.`);
    } catch (error) {
      setActivity(error instanceof Error ? error.message : 'UUID generation failed.');
    }
  };

  const copyOutput = async () => {
    if (!serialized) return;
    try {
      await copyText(serialized);
      setActivity(`Copied ${values.length.toLocaleString('en-US')} generated value${values.length === 1 ? '' : 's'}.`);
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      setActivity('Clipboard access failed. The output is selected for manual copying.');
    }
  };

  const copyNormalized = async () => {
    const normalized = validResults.map((result) => result.parsed?.canonical ?? '').filter(Boolean).join('\n');
    if (!normalized) return;
    try {
      await copyText(normalized);
      setActivity(`Copied ${validResults.length.toLocaleString('en-US')} normalized UUID value${validResults.length === 1 ? '' : 's'}.`);
    } catch {
      setActivity('Clipboard access failed. Copy the normalized values individually.');
    }
  };

  const generator = (
    <section className="uuid-panel uuid-generator-panel" aria-labelledby="uuid-generator-heading">
      <header className="uuid-panel-heading">
        <div><p>Generate locally</p><h2 id="uuid-generator-heading">{mode === 'v7' ? 'UUID v7 generator' : mode === 'validator' ? 'Generate a test UUID' : 'UUID v4 and v7 generator'}</h2></div>
        <span className="uuid-secure-badge">CSPRNG</span>
      </header>
      <div className="uuid-panel-body">
        <fieldset className="uuid-choice-fieldset">
          <legend>UUID version</legend>
          {mode === 'v7' ? (
            <div className="uuid-segmented uuid-segmented-single"><div className="uuid-selected-version"><strong>v7</strong><span>Time ordered RFC 9562 layout</span></div></div>
          ) : (
            <div className="uuid-segmented">
              <button type="button" aria-pressed={version === 4} onClick={() => chooseVersion(4)}><strong>v4</strong><span>Random</span></button>
              <button type="button" aria-pressed={version === 7} onClick={() => chooseVersion(7)}><strong>v7</strong><span>Time ordered</span></button>
            </div>
          )}
        </fieldset>

        <div className="uuid-control-grid">
          <label className="uuid-field"><span>How many?</span><input type="number" min="1" max={MAX_UUID_COUNT} step="1" inputMode="numeric" value={countInput} onChange={(event) => setCountInput(event.target.value)} /></label>
          <label className="uuid-field"><span>Text format</span><select value={format} onChange={(event) => changePresentation(event.target.value as UuidFormat, letterCase)}><option value="hyphenated">Hyphenated</option><option value="compact">Compact, no hyphens</option><option value="braced">Braces {'{…}'}</option><option value="urn">URN urn:uuid:</option></select></label>
          <label className="uuid-field"><span>Letter case</span><select value={letterCase} onChange={(event) => changePresentation(format, event.target.value as UuidCase)}><option value="lower">Lowercase</option><option value="upper">Uppercase</option></select></label>
          <label className="uuid-field"><span>Output layout</span><select value={outputShape} onChange={(event) => setOutputShape(event.target.value as OutputShape)}><option value="lines">One per line</option><option value="comma">Comma separated</option><option value="json">JSON array</option><option value="sql">SQL VALUES rows</option></select></label>
        </div>

        <div className="uuid-actions">
          <button className="uuid-button primary" type="button" onClick={generate}>Generate UUID v{version}</button>
          <button className="uuid-button" type="button" onClick={copyOutput} disabled={!serialized}>{values.length === 1 ? 'Copy UUID' : 'Copy all'}</button>
          <button className="uuid-button" type="button" onClick={() => downloadText(serialized, `uuid-v${outputVersion}-${values.length}.${outputExtension(outputShape)}`, outputMimeType(outputShape))} disabled={!serialized}>Download</button>
        </div>

        <label className="uuid-output-field"><span>Generated output</span><textarea ref={outputRef} readOnly spellCheck={false} value={serialized} rows={Math.min(12, Math.max(5, values.length + 1))} /></label>

        <div className="uuid-output-summary" aria-label="Generated UUID details">
          <div><span>Version</span><strong>UUID v{outputVersion}</strong></div>
          <div><span>Variant</span><strong>RFC 9562</strong></div>
          <div><span>Count</span><strong>{values.length.toLocaleString('en-US')}</strong></div>
          <div><span>{outputVersion === 7 ? 'First UTC time' : 'Random payload'}</span><strong>{outputVersion === 7 && firstParsed?.timestampIso ? firstParsed.timestampIso : '122 bits'}</strong></div>
        </div>
        <p className="uuid-panel-note">{outputVersion === 7
          ? 'UUID v7 embeds Unix milliseconds. Each batch uses a randomly seeded 14-bit counter plus 60 fresh random bits to stay lexically increasing; separate tabs and devices do not share generator state.'
          : 'UUID v4 uses 122 random bits after the required version and variant bits. It is an identifier, not a secret or proof of authenticity.'}</p>
      </div>
    </section>
  );

  const validator = (
    <section className="uuid-panel uuid-validator-panel" aria-labelledby="uuid-validator-heading">
      <header className="uuid-panel-heading">
        <div><p>Validate and inspect</p><h2 id="uuid-validator-heading">UUID checker with exact diagnostics</h2></div>
        <span className="uuid-count-badge">{validResults.length} structurally valid · {invalidCount} invalid</span>
      </header>
      <div className="uuid-panel-body">
        <fieldset className="uuid-choice-fieldset">
          <legend>Input policy</legend>
          <div className="uuid-segmented">
            <button type="button" aria-pressed={validationMode === 'strict'} onClick={() => setValidationMode('strict')}><strong>Strict</strong><span>8-4-4-4-12 only</span></button>
            <button type="button" aria-pressed={validationMode === 'normalized'} onClick={() => setValidationMode('normalized')}><strong>Normalize</strong><span>URN, braces, compact</span></button>
          </div>
        </fieldset>
        <label className="uuid-output-field"><span>UUID values — one per line, comma separated, or a JSON string array</span><textarea spellCheck={false} maxLength={MAX_VALIDATION_CHARACTERS} value={validationInput} onChange={(event) => setValidationInput(event.target.value)} rows={6} placeholder="0191f7d0-e7b7-7cc3-98c4-dc0c0c07398f" /></label>
        <div className="uuid-actions">
          <button className="uuid-button" type="button" onClick={() => setValidationInput(values.join('\n'))}>Inspect generated</button>
          <button className="uuid-button" type="button" onClick={copyNormalized} disabled={validResults.length === 0}>Copy normalized</button>
          <button className="uuid-button quiet" type="button" onClick={() => setValidationInput('')}>Clear</button>
        </div>
        {validationCandidates.length > MAX_UUID_COUNT && <p className="uuid-alert error" role="alert">Only the first {MAX_UUID_COUNT.toLocaleString('en-US')} values are checked.</p>}
        {validationResults.length === 0 ? (
          <div className="uuid-empty-result"><strong>Paste a UUID to inspect it.</strong><span>Validation checks text structure, variant, version, special values, and a v7 timestamp when present.</span></div>
        ) : (
          <div className="uuid-validation-results" aria-live="polite">
            {validationResults.slice(0, MAX_VISIBLE_VALIDATION_RESULTS).map((result, index) => result.parsed ? (
              <article className="uuid-result valid" key={`${result.input}-${index}`}>
                <header><span>Valid structure</span><strong>{versionLabel(result.parsed)}</strong></header>
                <code>{result.parsed.canonical}</code>
                <dl>
                  <div><dt>Variant</dt><dd>{variantLabel(result.parsed)}</dd></div>
                  <div><dt>Variant bits</dt><dd><code>{result.parsed.variantBits}</code></dd></div>
                  <div><dt>Normalized</dt><dd>{result.input === result.parsed.canonical ? 'Already in lowercase standard form' : 'Input normalized'}</dd></div>
                  {result.parsed.timestampIso && <div><dt>v7 timestamp</dt><dd><time dateTime={result.parsed.timestampIso}>{result.parsed.timestampIso}</time></dd></div>}
                </dl>
              </article>
            ) : (
              <article className="uuid-result invalid" key={`${result.input}-${index}`}>
                <header><span>Invalid structure</span><strong>Check input</strong></header>
                <code>{result.input}</code>
                <p>{result.error}{result.errorOffset === null ? '' : ` Offset ${result.errorOffset}.`}</p>
              </article>
            ))}
            {validationResults.length > MAX_VISIBLE_VALIDATION_RESULTS && <p className="uuid-result-limit">Showing the first {MAX_VISIBLE_VALIDATION_RESULTS} results. The summary and normalized copy action cover all {validationResults.length.toLocaleString('en-US')} checked values.</p>}
          </div>
        )}
        <p className="uuid-panel-note">A structurally valid UUID is not proof that it was generated randomly, is globally unique, exists in a database, belongs to a trusted issuer, or is safe to use as an authorization token.</p>
      </div>
    </section>
  );

  return (
    <section className={`uuid-app ${mode === 'validator' ? 'validator-first' : ''}`} aria-label="UUID generator and validator">
      <header className="uuid-toolbar">
        <div className="uuid-local-badge"><span aria-hidden="true" /><div><strong>Local UUID workspace</strong><small>Generated and inspected values stay in this browser tab</small></div></div>
        <div className="uuid-rfc"><span>Current standard</span><a href="https://www.rfc-editor.org/rfc/rfc9562" target="_blank" rel="noreferrer">RFC 9562</a></div>
      </header>
      <div className="uuid-workspace">{mode === 'validator' ? <>{validator}{generator}</> : <>{generator}{validator}</>}</div>
      <p className="uuid-activity" role="status" aria-live="polite"><strong>Status</strong><span>{activity}</span></p>
    </section>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('UUID tool root element is missing.');
const mode = pageMode();
createRoot(rootElement).render(<UuidApp mode={mode} initialGeneration={createInitialGeneration(mode)} />);
