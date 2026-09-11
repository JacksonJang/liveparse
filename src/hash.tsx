import React, { useMemo, useRef, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  analyzeTextInput,
  compareDigests,
  digestBlob,
  digestText,
  DIGEST_BYTE_LENGTH,
  HASH_ALGORITHMS,
  MAX_HASH_FILE_BYTES,
  MAX_HASH_TEXT_CODE_UNITS,
  MAX_DIGEST_INPUT_CHARS,
  type HashAlgorithm,
  type HashEncoding,
  type HashInputEncoding,
  type HashResult,
  type TextInputAnalysis,
} from './lib/hash';
import './styles.css';
import './hash.css';

type PageMode = 'hash-generator' | 'sha256-generator' | 'md5-generator' | 'file-checksum';
type SourceMode = 'text' | 'file';

interface ModeCopy {
  kicker: string;
  title: string;
  description: string;
  defaultAlgorithm: HashAlgorithm;
  fixedAlgorithm: HashAlgorithm | null;
  defaultSource: SourceMode;
}

interface CompletedHash {
  result: HashResult;
  sourceKind: SourceMode;
  sourceLabel: string;
  completedAt: string;
}

interface ComparisonState {
  matches: boolean | null;
  detail: string;
  error: string | null;
}

const MODE_COPY: Readonly<Record<PageMode, ModeCopy>> = {
  'hash-generator': {
    kicker: 'Text and file hashing',
    title: 'Hash generator workspace',
    description: 'Calculate SHA-256, SHA-384, SHA-512, or MD5 from exact local bytes.',
    defaultAlgorithm: 'SHA-256',
    fixedAlgorithm: null,
    defaultSource: 'text',
  },
  'sha256-generator': {
    kicker: 'SHA-2 · 256-bit digest',
    title: 'SHA-256 generator',
    description: 'Hash UTF-8 text or an exact file into a 32-byte SHA-256 digest.',
    defaultAlgorithm: 'SHA-256',
    fixedAlgorithm: 'SHA-256',
    defaultSource: 'text',
  },
  'md5-generator': {
    kicker: 'Legacy checksum compatibility',
    title: 'MD5 generator',
    description: 'Reproduce legacy 128-bit checksums while keeping MD5 security limits visible.',
    defaultAlgorithm: 'MD5',
    fixedAlgorithm: 'MD5',
    defaultSource: 'text',
  },
  'file-checksum': {
    kicker: 'Exact local file bytes',
    title: 'File checksum calculator',
    description: 'Calculate and compare a file checksum without uploading the selected file.',
    defaultAlgorithm: 'SHA-256',
    fixedAlgorithm: null,
    defaultSource: 'file',
  },
};

function pageMode(): PageMode {
  const value = document.body.dataset.page;
  return value === 'sha256-generator' || value === 'md5-generator' || value === 'file-checksum'
    ? value
    : 'hash-generator';
}

function formatBytes(value: number): string {
  if (value < 1_000) return `${value.toLocaleString('en-US')} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

function newlineSummary(analysis: TextInputAnalysis): string {
  if (analysis.newlineStyle === 'none') return 'None';
  return `${analysis.newlineStyle} × ${analysis.newlineCount.toLocaleString('en-US')}`;
}

function sourceDescription(source: SourceMode, analysis: TextInputAnalysis, file: File | null): string {
  if (source === 'file') return file ? `${file.name} · ${formatBytes(file.size)}` : 'No file selected';
  if (analysis.isEmpty) return 'Empty text · zero-byte message';
  return `${analysis.codePointCount.toLocaleString('en-US')} code points · ${formatBytes(analysis.utf8ByteCount)}`;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The input could not be hashed.';
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // A browser can deny clipboard access; the temporary textarea is a local fallback.
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
  if (!copied) throw new Error('The browser rejected the copy command.');
}

function expectedComparison(
  result: CompletedHash | null,
  expected: string,
  algorithm: HashAlgorithm,
  expectedEncoding: HashInputEncoding,
): ComparisonState {
  if (!result) return { matches: null, detail: 'Calculate a digest before comparing it.', error: null };
  if (!expected.trim()) return { matches: null, detail: 'Paste an expected hex or Base64 digest.', error: null };

  try {
    const comparison = compareDigests(result.result.hex, expected, {
      algorithm,
      actualEncoding: 'hex',
      expectedEncoding,
    });
    return {
      matches: comparison.matches,
      detail: comparison.matches
        ? `Match after ${comparison.expected.detectedEncoding} normalization.`
        : `Different ${algorithm} digest bytes after ${comparison.expected.detectedEncoding} normalization.`,
      error: null,
    };
  } catch (error) {
    return { matches: null, detail: 'The expected digest is not valid for this algorithm.', error: friendlyError(error) };
  }
}

function FilePicker({
  file,
  busy,
  onFile,
}: {
  file: File | null;
  busy: boolean;
  onFile: (file: File | null) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const choose = () => {
    if (busy || !inputRef.current) return;
    inputRef.current.value = '';
    inputRef.current.click();
  };
  const remove = () => {
    if (busy) return;
    if (inputRef.current) inputRef.current.value = '';
    onFile(null);
  };

  return (
    <div
      className={`hash-drop-zone${file ? ' selected' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (busy) return;
        onFile(event.dataTransfer.files.item(0));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        disabled={busy}
        onChange={(event) => onFile(event.target.files?.item(0) ?? null)}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="hash-drop-icon" aria-hidden="true">#</div>
      {file ? (
        <div className="hash-file-copy">
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)} · {file.type || 'Unknown media type'}</span>
          <small>Last modified {new Date(file.lastModified).toLocaleString()}</small>
        </div>
      ) : (
        <div className="hash-file-copy">
          <strong>Drop a file here</strong>
          <span>or choose one from this device</span>
          <small>Up to 64 MiB · read only after you press Calculate checksum.</small>
        </div>
      )}
      <div className="hash-file-actions">
        <button className="hash-button quiet" type="button" disabled={busy} onClick={choose}>{file ? 'Choose another' : 'Choose file'}</button>
        {file ? <button className="hash-link-button" type="button" disabled={busy} onClick={remove}>Remove</button> : null}
      </div>
    </div>
  );
}

function HashToolApp({ mode }: { mode: PageMode }): React.JSX.Element {
  const config = MODE_COPY[mode];
  const [sourceMode, setSourceMode] = useState<SourceMode>(config.defaultSource);
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>(config.defaultAlgorithm);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [outputEncoding, setOutputEncoding] = useState<HashEncoding>('hex');
  const [expectedEncoding, setExpectedEncoding] = useState<HashInputEncoding>('auto');
  const [completed, setCompleted] = useState<CompletedHash | null>(null);
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState('Ready. Input bytes stay in this browser tab.');
  const requestId = useRef(0);

  const textAnalysis = useMemo(() => analyzeTextInput(text), [text]);
  const comparison = useMemo(
    () => expectedComparison(completed, expected, algorithm, expectedEncoding),
    [algorithm, completed, expected, expectedEncoding],
  );
  const output = completed
    ? outputEncoding === 'hex' ? completed.result.hex : completed.result.base64
    : '';
  const fileTooLarge = Boolean(file && file.size > MAX_HASH_FILE_BYTES);
  const textTooLarge = text.length > MAX_HASH_TEXT_CODE_UNITS;

  const invalidate = (message?: string) => {
    requestId.current += 1;
    setBusy(false);
    setCompleted(null);
    setError(null);
    if (message) setActivity(message);
  };

  const chooseSource = (source: SourceMode) => {
    if (busy) return;
    setSourceMode(source);
    invalidate(source === 'text'
      ? 'Text mode selected. The exact textarea value will be encoded as UTF-8.'
      : 'File mode selected. Choose a file to hash its exact bytes locally.');
  };

  const chooseAlgorithm = (next: HashAlgorithm) => {
    if (busy || config.fixedAlgorithm) return;
    setAlgorithm(next);
    invalidate(`${next} selected. Calculate again to produce a ${DIGEST_BYTE_LENGTH[next]}-byte digest.`);
  };

  const updateText = (value: string) => {
    if (busy) return;
    setText(value);
    invalidate('Text changed. Calculate again to refresh the digest.');
    if (value.length > MAX_HASH_TEXT_CODE_UNITS) {
      setError(`Text input exceeds the ${MAX_HASH_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code-unit limit.`);
    }
  };

  const updateFile = (next: File | null) => {
    if (busy) return;
    setFile(next);
    invalidate(next
      ? `${next.name} selected locally. Press Calculate checksum when ready.`
      : 'File selection cleared.');
    if (next && next.size > MAX_HASH_FILE_BYTES) {
      setError('Choose a file no larger than 64 MiB. This tool buffers the complete file for the browser digest API.');
    }
  };

  // Hash text as you type; file hashing stays explicit because it reads the whole file.
  useEffect(() => {
    if (sourceMode !== 'text' || !text || textTooLarge) return;
    const timer = window.setTimeout(() => { void calculate(); }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, algorithm, sourceMode]);

  const calculate = async () => {
    if (sourceMode === 'file' && !file) {
      setError('Choose a file before calculating its checksum.');
      setActivity('No file was selected.');
      return;
    }
    if (sourceMode === 'file' && fileTooLarge) {
      setError('Choose a file no larger than 64 MiB.');
      setActivity('The selected file exceeds the in-memory hashing limit.');
      return;
    }
    if (sourceMode === 'text' && textTooLarge) {
      setError(`Text input exceeds the ${MAX_HASH_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code-unit limit.`);
      setActivity('The text input exceeds the in-memory hashing limit.');
      return;
    }

    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setBusy(true);
    setError(null);
    setActivity(sourceMode === 'file'
      ? `Reading ${file!.name} locally and calculating ${algorithm}…`
      : `Encoding the exact text as UTF-8 and calculating ${algorithm}…`);

    try {
      const result = sourceMode === 'file'
        ? await digestBlob(file!, algorithm)
        : await digestText(text, algorithm);
      if (requestId.current !== currentRequest) return;

      const sourceLabel = sourceMode === 'file'
        ? file!.name
        : textAnalysis.isEmpty ? 'empty UTF-8 text' : 'UTF-8 text';
      setCompleted({
        result,
        sourceKind: sourceMode,
        sourceLabel,
        completedAt: new Date().toISOString(),
      });
      setActivity(`${algorithm} calculated from ${result.inputByteLength.toLocaleString('en-US')} exact input bytes. Nothing was uploaded.`);
    } catch (caught) {
      if (requestId.current !== currentRequest) return;
      setCompleted(null);
      setError(friendlyError(caught));
      setActivity('Hash calculation failed. The input was not sent anywhere.');
    } finally {
      if (requestId.current === currentRequest) setBusy(false);
    }
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await copyText(output);
      setActivity(`${algorithm} ${outputEncoding} digest copied.`);
    } catch (caught) {
      setActivity(`Copy failed: ${friendlyError(caught)}`);
    }
  };

  const useSample = () => updateText('abc');
  const appendLf = () => updateText(`${text}\n`);

  return (
    <section className={`hash-app hash-mode-${mode}`} aria-label="Local hash and checksum calculator">
      <header className="hash-toolbar">
        <div className="hash-local-badge"><span aria-hidden="true" /><div><strong>Local byte processing</strong><small>No upload, analytics payload, server log, or tool-side persistence</small></div></div>
        <div className="hash-algorithm-badge"><span>{algorithm}</span><strong>{DIGEST_BYTE_LENGTH[algorithm] * 8}-bit output</strong></div>
      </header>

      <div className="hash-intro">
        <div><p>{config.kicker}</p><h2>{config.title}</h2><span>{config.description}</span></div>
        <div className="hash-exactness"><strong>Exact bytes</strong><span>No trimming, Unicode normalization, case conversion, or hidden newline is added.</span></div>
      </div>

      <div className="hash-workspace">
        <section className="hash-card hash-input-card" aria-labelledby="hash-input-heading">
          <header className="hash-card-heading"><div><p>Input</p><h3 id="hash-input-heading">Choose the bytes to hash</h3></div><span>{sourceDescription(sourceMode, textAnalysis, file)}</span></header>
          <div className="hash-card-body">
            <fieldset className="hash-fieldset">
              <legend>Input source</legend>
              <div className="hash-segmented two">
                <button type="button" disabled={busy} aria-pressed={sourceMode === 'text'} onClick={() => chooseSource('text')}><strong>UTF-8 text</strong><span>Visible textarea value</span></button>
                <button type="button" disabled={busy} aria-pressed={sourceMode === 'file'} onClick={() => chooseSource('file')}><strong>Local file</strong><span>Exact raw bytes</span></button>
              </div>
            </fieldset>

            <fieldset className="hash-fieldset">
              <legend>Hash algorithm</legend>
              {config.fixedAlgorithm ? (
                <div className="hash-fixed-algorithm"><strong>{algorithm}</strong><span>This page keeps the algorithm fixed for unambiguous results.</span></div>
              ) : (
                <div className="hash-segmented algorithms">
                  {HASH_ALGORITHMS.map((candidate) => (
                    <button type="button" key={candidate} disabled={busy} aria-pressed={algorithm === candidate} onClick={() => chooseAlgorithm(candidate)}>
                      <strong>{candidate}</strong><span>{DIGEST_BYTE_LENGTH[candidate] * 8} bits</span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            {sourceMode === 'text' ? (
              <div className="hash-text-source">
                <label className="hash-text-field">
                  <span>Text to hash · UTF-8 · up to 5,000,000 UTF-16 code units</span>
                  <textarea
                    value={text}
                    disabled={busy}
                    onChange={(event) => updateText(event.target.value)}
                    rows={9}
                    spellCheck={false}
                    placeholder="Type or paste text. Leave empty to hash the valid zero-byte message."
                  />
                </label>
                <div className="hash-actions compact">
                  <button className="hash-button quiet" type="button" disabled={busy} onClick={useSample}>Use “abc” vector</button>
                  <button className="hash-button quiet" type="button" disabled={busy} onClick={appendLf}>Append LF newline</button>
                  <button className="hash-link-button" type="button" disabled={busy} onClick={() => updateText('')}>Clear</button>
                </div>
                <dl className="hash-facts" aria-label="Exact text input diagnostics">
                  <div><dt>Encoding</dt><dd>UTF-8</dd></div>
                  <div><dt>Input bytes</dt><dd>{textAnalysis.utf8ByteCount.toLocaleString('en-US')}</dd></div>
                  <div><dt>Code points</dt><dd>{textAnalysis.codePointCount.toLocaleString('en-US')}</dd></div>
                  <div><dt>Newlines</dt><dd>{newlineSummary(textAnalysis)}</dd></div>
                  <div><dt>Final newline</dt><dd>{textAnalysis.hasTrailingNewline ? 'Included' : 'Not present'}</dd></div>
                  <div><dt>Leading BOM</dt><dd>{textAnalysis.hasUtf8BomCharacter ? 'Included (EF BB BF)' : 'Not present'}</dd></div>
                </dl>
                {textAnalysis.isEmpty ? <p className="hash-notice neutral"><strong>Empty input is intentional:</strong> calculating now hashes zero bytes and returns the standard empty-message digest.</p> : null}
                {textAnalysis.hasNulCharacter ? <p className="hash-notice neutral"><strong>NUL included:</strong> the U+0000 character is encoded as byte 00 and included in this digest.</p> : null}
                <p className="hash-notice neutral"><strong>Textarea scope:</strong> this hashes the exact value shown above. A browser can normalize pasted CR or CRLF line endings to LF; choose file mode when the original newline bytes must be preserved.</p>
                {textTooLarge ? <p className="hash-notice danger"><strong>Input limit exceeded:</strong> shorten the text to {MAX_HASH_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units or fewer.</p> : null}
              </div>
            ) : <FilePicker file={file} busy={busy} onFile={updateFile} />}

            {algorithm === 'MD5' ? (
              <p className="hash-notice danger"><strong>MD5 is cryptographically broken.</strong> Use it only for compatibility with a published legacy checksum. It is unsafe for passwords, signatures, certificates, or security decisions, and an attacker can construct collisions.</p>
            ) : (
              <p className="hash-notice caution"><strong>Integrity needs a trusted reference.</strong> A SHA-2 match only proves useful when the expected digest came through an authenticated channel.</p>
            )}

            <button className="hash-button primary calculate" type="button" disabled={busy || (sourceMode === 'file' && (!file || fileTooLarge)) || (sourceMode === 'text' && textTooLarge)} onClick={calculate}>
              {busy ? `Calculating ${algorithm}…` : sourceMode === 'file' ? `Calculate ${algorithm} checksum` : `Generate ${algorithm} hash`}
            </button>
            {error ? <p className="hash-error" role="alert">{error}</p> : null}
          </div>
        </section>

        <section className="hash-card hash-output-card" aria-labelledby="hash-output-heading">
          <header className="hash-card-heading"><div><p>Digest</p><h3 id="hash-output-heading">Result and checksum match</h3></div><span>{completed ? `${completed.result.inputByteLength.toLocaleString('en-US')} bytes hashed` : 'Waiting for calculation'}</span></header>
          <div className="hash-card-body">
            <fieldset className="hash-fieldset">
              <legend>Output encoding</legend>
              <div className="hash-segmented two">
                <button type="button" aria-pressed={outputEncoding === 'hex'} onClick={() => setOutputEncoding('hex')}><strong>Hex</strong><span>Lowercase, no prefix</span></button>
                <button type="button" aria-pressed={outputEncoding === 'base64'} onClick={() => setOutputEncoding('base64')}><strong>Base64</strong><span>Standard, padded</span></button>
              </div>
            </fieldset>

            {completed ? (
              <article className="hash-result" aria-live="polite">
                <header><div><span>{completed.result.algorithm} · {outputEncoding}</span><small>{completed.sourceLabel}</small></div><button type="button" onClick={copyOutput}>Copy</button></header>
                <code>{output}</code>
                <dl>
                  <div><dt>Digest bytes</dt><dd>{completed.result.digest.byteLength}</dd></div>
                  <div><dt>Input bytes</dt><dd>{completed.result.inputByteLength.toLocaleString('en-US')}</dd></div>
                  <div><dt>Input handling</dt><dd>{completed.sourceKind === 'file' ? 'Raw file bytes' : 'UTF-8 text bytes'}</dd></div>
                  <div><dt>Completed UTC</dt><dd><time dateTime={completed.completedAt}>{completed.completedAt}</time></dd></div>
                </dl>
              </article>
            ) : (
              <div className="hash-empty-result"><div aria-hidden="true">#</div><strong>No digest calculated yet</strong><span>Empty text is valid input. Files require an explicit selection.</span></div>
            )}

            <div className="hash-compare-box">
              <div className="hash-compare-heading"><div><p>Verify checksum</p><h4>Compare with an expected digest</h4></div>{comparison.matches !== null ? <span className={comparison.matches ? 'match' : 'different'}>{comparison.matches ? 'Match' : 'Different'}</span> : null}</div>
              <fieldset className="hash-fieldset">
                <legend>Expected digest encoding</legend>
                <div className="hash-segmented encodings">
                  {(['auto', 'hex', 'base64'] as const).map((encoding) => (
                    <button type="button" key={encoding} aria-pressed={expectedEncoding === encoding} onClick={() => setExpectedEncoding(encoding)}>
                      <strong>{encoding === 'auto' ? 'Auto' : encoding === 'hex' ? 'Hex' : 'Base64'}</strong>
                      <span>{encoding === 'auto' ? 'Length-aware' : 'Explicit'}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="hash-text-field single-line">
                <span>Expected {algorithm} · {expectedEncoding === 'auto' ? 'hex or Base64 auto-detected' : `${expectedEncoding} selected`}</span>
                <textarea value={expected} maxLength={MAX_DIGEST_INPUT_CHARS} onChange={(event) => setExpected(event.target.value)} rows={4} spellCheck={false} placeholder={`${algorithm}: paste the expected digest`} />
              </label>
              <p className={`hash-comparison-status${comparison.matches === true ? ' match' : comparison.matches === false ? ' different' : ''}`} role="status">{comparison.detail}</p>
              {comparison.error ? <p className="hash-error" role="alert">{comparison.error}</p> : null}
              <p className="hash-compare-note">Comparison accepts uppercase hex, byte separators, standard Base64, and Base64URL. Auto detection uses the selected algorithm's exact digest length; choose an explicit encoding if the pasted value is ambiguous. It normalizes to bytes and checks the complete digest without an early mismatch exit. JavaScript cannot guarantee strict constant-time execution.</p>
            </div>
          </div>
        </section>
      </div>

      <aside className="hash-security-strip">
        <div><strong>Do not store passwords with these hashes</strong><span>SHA-2 and MD5 are fast general-purpose hashes. Password storage needs a salted, cost-adjustable password hashing scheme such as Argon2id, scrypt, bcrypt, or PBKDF2.</span></div>
        <div><strong>Private by tool design, not a secure vault</strong><span>LiveParse does not upload or persist this input. Avoid pasting secrets on a device, browser profile, or extension environment you do not trust.</span></div>
      </aside>

      <p className="hash-activity" role="status" aria-live="polite"><strong>Status</strong><span>{activity}</span></p>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Hash tool root element is missing.');
createRoot(root).render(<React.StrictMode><HashToolApp mode={pageMode()} /></React.StrictMode>);
