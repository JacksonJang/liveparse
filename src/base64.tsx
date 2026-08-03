import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Base64DecodeError,
  bytesToHex,
  bytesToUtf8,
  decodeBase64,
  detectSafeRasterMime,
  encodeBase64,
  parseDataUrl,
  utf8ToBytes,
  type Base64Alphabet,
  type Base64PaddingMode,
  type Base64WhitespaceMode,
} from './lib/base64';
import './styles.css';
import './base64.css';

type ToolMode = 'decode' | 'encode';
type DecodeAlphabet = Base64Alphabet | 'auto';
type OutputView = 'text' | 'hex';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DECODE_CHARACTERS = 14 * 1024 * 1024;
const MAX_ENCODE_TEXT_CHARACTERS = 4 * 1024 * 1024;
const MAX_PREVIEW_CHARACTERS = 200_000;
const MAX_HEX_PREVIEW_BYTES = Math.floor(MAX_PREVIEW_CHARACTERS / 3);

const EXAMPLES = {
  decode: [
    { label: 'Hello', value: 'SGVsbG8sIFdvcmxkIQ==' },
    { label: 'Unicode', value: '8J+MjSDslYjrhZXtlZjshLjsmpQ=' },
    { label: 'Base64URL', value: 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkxpdmVQYXJzZSJ9' },
    { label: 'Data URL', value: 'data:text/plain;charset=utf-8;base64,TG9jYWwgb25seS4=' },
  ],
  encode: [
    { label: 'Hello', value: 'Hello, World!' },
    { label: 'Unicode', value: '🌍 안녕하세요' },
    { label: 'JSON', value: '{"tool":"LiveParse","private":true}' },
    { label: 'URL text', value: 'https://liveparse.com/base64-encoder/?source=example' },
  ],
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function wrapText(value: string, width: number): string {
  if (!width || value.length <= width) return value;
  const lines: string[] = [];
  for (let offset = 0; offset < value.length; offset += width) lines.push(value.slice(offset, offset + width));
  return lines.join('\n');
}

function previewText(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_PREVIEW_CHARACTERS) return { value, truncated: false };
  return { value: `${value.slice(0, MAX_PREVIEW_CHARACTERS)}\n\n… preview stopped after ${MAX_PREVIEW_CHARACTERS.toLocaleString()} characters …`, truncated: true };
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Browsers can deny Clipboard API access; the textarea fallback still works.
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

function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeDownloadName(sourceName: string | null, fallback: string): string {
  if (!sourceName) return fallback;
  const cleaned = sourceName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 160);
  return cleaned || fallback;
}

function decodedFilename(sourceName: string | null, mime: string | null, validUtf8: boolean): string {
  if (sourceName) {
    const withoutBase64Extension = sourceName.replace(/\.(?:b64|base64|txt)$/i, '');
    if (withoutBase64Extension && withoutBase64Extension !== sourceName) return safeDownloadName(withoutBase64Extension, 'decoded.bin');
  }
  const extension = mime === 'image/png' ? 'png'
    : mime === 'image/jpeg' ? 'jpg'
      : mime === 'image/gif' ? 'gif'
        : mime === 'image/webp' ? 'webp'
          : validUtf8 ? 'txt' : 'bin';
  return `decoded.${extension}`;
}

function encodeFileName(sourceName: string | null): string {
  return safeDownloadName(sourceName ? `${sourceName}.base64.txt` : 'encoded.base64.txt', 'encoded.base64.txt');
}

function errorMessage(error: unknown): string {
  if (error instanceof Base64DecodeError) {
    const location = typeof error.offset === 'number' && !/\boffset\s+\d+/i.test(error.message)
      ? ` at character ${error.offset + 1}`
      : '';
    return `${error.message}${location}`;
  }
  if (error instanceof Error) return error.message;
  return 'The input could not be processed.';
}

function dataUrlMediaTypeError(value: string): string | null {
  const metadata = value.trim();
  if (!metadata) return 'Enter a media type such as text/plain;charset=utf-8 or application/octet-stream.';
  if (metadata !== value) return 'Remove leading or trailing whitespace from the Data URL media type.';
  if (!/^[A-Za-z0-9!$%&'*+./:;=_^`|~-]+$/.test(metadata)) {
    return 'Use an ASCII media type and token-style parameters. Percent-encode spaces; commas, controls, quotes, fragments, and raw non-ASCII characters are not allowed here.';
  }
  try {
    const parsed = parseDataUrl(`data:${metadata},`);
    if (parsed.isBase64) return 'Do not include ;base64 in the media-type field; the encoder adds that marker.';
    return null;
  } catch (error) {
    return `The Data URL media type is invalid: ${errorMessage(error)}`;
  }
}

interface FileSource {
  name: string;
  type: string;
  bytes: Uint8Array;
}

interface DecodeSuccess {
  ok: true;
  bytes: Uint8Array;
  normalized: string | null;
  alphabet: Base64Alphabet | 'data-url';
  alphabetAmbiguous: boolean;
  padding: string;
  hadWhitespace: boolean;
  addedPadding: number;
  mediaType: string | null;
  dataUrl: boolean;
  dataUrlUsesBase64: boolean;
  utf8Text: string | null;
  safeRasterMime: string | null;
  hex: string;
}

interface DecodeFailure {
  ok: false;
  error: string;
}

type DecodeState = DecodeSuccess | DecodeFailure;

function paddingDiagnostic(decoded: DecodeSuccess, policy: Base64PaddingMode): string {
  let detail: string;
  if (policy === 'forbid') {
    detail = decoded.padding === 'missing'
      ? 'Padding omitted under the selected policy'
      : 'No padding needed or supplied';
  } else if (decoded.addedPadding > 0) {
    detail = `${decoded.addedPadding} padding character${decoded.addedPadding === 1 ? '' : 's'} restored`;
  } else {
    detail = `Padding ${decoded.padding}`;
  }
  return decoded.hadWhitespace ? `${detail} · whitespace ignored` : detail;
}

function App({ mode }: { mode: ToolMode }) {
  const [input, setInput] = useState<string>(EXAMPLES[mode][0].value);
  const [fileSource, setFileSource] = useState<FileSource | null>(null);
  const [alphabet, setAlphabet] = useState<DecodeAlphabet | Base64Alphabet>(mode === 'decode' ? 'auto' : 'standard');
  const [whitespacePolicy, setWhitespacePolicy] = useState<Base64WhitespaceMode>('ignore');
  const [paddingPolicy, setPaddingPolicy] = useState<Base64PaddingMode>('allow-missing');
  const [includePadding, setIncludePadding] = useState(mode === 'encode');
  const [lineWidth, setLineWidth] = useState<0 | 76>(0);
  const [asDataUrl, setAsDataUrl] = useState(false);
  const [dataUrlMime, setDataUrlMime] = useState('text/plain;charset=utf-8');
  const [outputView, setOutputView] = useState<OutputView>('text');
  const [copied, setCopied] = useState<string | null>(null);
  const [activity, setActivity] = useState(`Ready. ${mode === 'decode' ? 'Decoding' : 'Encoding'} stays in this browser tab.`);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const sourceBytes = useMemo(
    () => mode === 'encode' ? fileSource?.bytes ?? utf8ToBytes(input) : new Uint8Array(),
    [fileSource, input, mode],
  );
  const mimeError = useMemo(() => asDataUrl ? dataUrlMediaTypeError(dataUrlMime) : null, [asDataUrl, dataUrlMime]);

  const encoded = useMemo(() => {
    if (mode !== 'encode') return null;
    if (mimeError) return null;
    const selectedAlphabet = alphabet === 'url' ? 'url' : 'standard';
    const effectivePadding = asDataUrl ? true : includePadding;
    const raw = encodeBase64(sourceBytes, { alphabet: asDataUrl ? 'standard' : selectedAlphabet, padding: effectivePadding });
    const payload = asDataUrl ? raw : wrapText(raw, lineWidth);
    const mime = dataUrlMime.trim();
    return asDataUrl ? `data:${mime};base64,${payload}` : payload;
  }, [alphabet, asDataUrl, dataUrlMime, includePadding, lineWidth, mimeError, mode, sourceBytes]);

  const decoded = useMemo<DecodeState | null>(() => {
    if (mode !== 'decode') return null;
    try {
      const candidate = input;
      let bytes: Uint8Array;
      let normalized: string | null = null;
      let detectedAlphabet: Base64Alphabet | 'data-url' = 'standard';
      let alphabetAmbiguous = false;
      let padding = 'not needed';
      let hadWhitespace = false;
      let addedPadding = 0;
      let mediaType: string | null = null;
      let dataUrl = false;
      let dataUrlUsesBase64 = false;

      const dataUrlCandidate = candidate;
      if (dataUrlCandidate.slice(0, 5).toLowerCase() === 'data:') {
        const parsed = parseDataUrl(dataUrlCandidate, {
          whitespace: whitespacePolicy,
          padding: paddingPolicy,
        });
        bytes = parsed.bytes;
        mediaType = parsed.mediaType || 'text/plain';
        dataUrl = true;
        dataUrlUsesBase64 = parsed.isBase64;
        detectedAlphabet = 'data-url';
        if (parsed.base64Diagnostics) {
          padding = parsed.base64Diagnostics.padding.replace('-', ' ');
          hadWhitespace = parsed.base64Diagnostics.hadWhitespace;
          addedPadding = parsed.base64Diagnostics.addedPadding;
        }
      } else {
        const result = decodeBase64(candidate, {
          alphabet: alphabet === 'standard' || alphabet === 'url' ? alphabet : 'auto',
          whitespace: whitespacePolicy,
          padding: paddingPolicy,
        });
        bytes = result.bytes;
        normalized = result.normalized;
        detectedAlphabet = result.diagnostics.alphabet;
        alphabetAmbiguous = result.diagnostics.alphabetWasAmbiguous;
        padding = result.diagnostics.padding.replace('-', ' ');
        hadWhitespace = result.diagnostics.hadWhitespace;
        addedPadding = result.diagnostics.addedPadding;
      }

      let utf8Text: string | null = null;
      try {
        utf8Text = bytesToUtf8(bytes, { fatal: true });
      } catch {
        utf8Text = null;
      }
      const safeRasterMime = detectSafeRasterMime(bytes);
      return {
        ok: true,
        bytes,
        normalized,
        alphabet: detectedAlphabet,
        alphabetAmbiguous,
        padding,
        hadWhitespace,
        addedPadding,
        mediaType,
        dataUrl,
        dataUrlUsesBase64,
        utf8Text,
        safeRasterMime,
        hex: bytesToHex(bytes, { limit: MAX_HEX_PREVIEW_BYTES }),
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }, [alphabet, input, mode, paddingPolicy, whitespacePolicy]);

  useEffect(() => {
    if (mode === 'decode' && decoded?.ok && decoded.utf8Text === null) setOutputView('hex');
  }, [decoded, mode]);

  const output = mode === 'encode'
    ? encoded ?? ''
    : decoded?.ok
      ? outputView === 'text' && decoded.utf8Text !== null ? decoded.utf8Text : decoded.hex
      : '';
  const hexPreviewWasLimited = mode === 'decode'
    && decoded?.ok
    && outputView === 'hex'
    && decoded.bytes.byteLength > MAX_HEX_PREVIEW_BYTES;
  const preview = hexPreviewWasLimited
    ? { value: `${output}\n\n… hex preview stopped after ${MAX_HEX_PREVIEW_BYTES.toLocaleString()} bytes …`, truncated: true }
    : previewText(output);
  const resultBytes = mode === 'encode' ? sourceBytes.byteLength : decoded?.ok ? decoded.bytes.byteLength : 0;

  const chooseExample = (value: string) => {
    setFileSource(null);
    setDataUrlMime('text/plain;charset=utf-8');
    setFileError(null);
    setInput(value);
    setActivity('Loaded an example. Processing stayed local.');
  };

  const clear = () => {
    setInput('');
    setFileSource(null);
    setDataUrlMime('text/plain;charset=utf-8');
    setFileError(null);
    setActivity('Cleared the current input from this tab.');
    if (fileInput.current) fileInput.current.value = '';
  };

  const loadFile = async (file: File | null) => {
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      const message = `Choose a file no larger than ${formatBytes(MAX_FILE_BYTES)}. This limit prevents a browser tab from freezing.`;
      setFileError(message);
      setActivity(message);
      return;
    }
    try {
      if (mode === 'encode') {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setFileSource({ name: file.name, type: file.type, bytes });
        setDataUrlMime(file.type || 'application/octet-stream');
      } else {
        const text = await file.text();
        if (text.length > MAX_DECODE_CHARACTERS) throw new Error('The Base64 text is too large for this browser tool.');
        setInput(text);
        setFileSource({ name: file.name, type: file.type, bytes: new Uint8Array() });
      }
      setActivity(`Loaded ${file.name} (${formatBytes(file.size)}) locally.`);
    } catch (error) {
      const message = errorMessage(error);
      setFileError(message);
      setActivity(message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const updateInput = (value: string) => {
    const maximum = mode === 'decode' ? MAX_DECODE_CHARACTERS : MAX_ENCODE_TEXT_CHARACTERS;
    if (value.length > maximum) {
      const message = `Text input is limited to ${maximum.toLocaleString()} characters to protect the browser tab.`;
      setFileError(message);
      setActivity(message);
      return;
    }
    setFileSource(null);
    setFileError(null);
    setInput(value);
  };

  const copyValue = async (value: string, key: string, label: string) => {
    try {
      await copyText(value);
      setCopied(key);
      setActivity(`${label} copied to the clipboard.`);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1_800);
    } catch (error) {
      setActivity(errorMessage(error));
    }
  };

  const copyCompleteResult = () => {
    if (mode === 'encode') {
      void copyValue(encoded ?? '', 'result', 'Complete result');
      return;
    }
    if (!decoded?.ok) return;
    const complete = outputView === 'text' && decoded.utf8Text !== null
      ? decoded.utf8Text
      : bytesToHex(decoded.bytes);
    void copyValue(complete, 'result', 'Complete result');
  };

  const downloadResult = () => {
    if (mode === 'encode') {
      downloadBytes(utf8ToBytes(encoded ?? ''), encodeFileName(fileSource?.name ?? null), 'text/plain;charset=utf-8');
      setActivity('Downloaded the complete encoded result as a text file.');
      return;
    }
    if (!decoded?.ok) return;
    const mime = decoded.safeRasterMime || decoded.mediaType || (decoded.utf8Text !== null ? 'text/plain;charset=utf-8' : 'application/octet-stream');
    downloadBytes(decoded.bytes, decodedFilename(fileSource?.name ?? null, decoded.safeRasterMime, decoded.utf8Text !== null), mime);
    setActivity('Downloaded the decoded bytes without interpreting executable content.');
  };

  const standardVersion = decoded?.ok ? encodeBase64(decoded.bytes, { alphabet: 'standard', padding: true }) : '';
  const urlVersion = decoded?.ok ? encodeBase64(decoded.bytes, { alphabet: 'url', padding: false }) : '';
  const imagePreview = decoded?.ok && decoded.safeRasterMime
    ? `data:${decoded.safeRasterMime};base64,${standardVersion}`
    : null;
  const outputError = mode === 'encode' ? mimeError : decoded && !decoded.ok ? decoded.error : null;
  const valid = outputError === null;

  return (
    <section className="base64-app" aria-label={`Base64 ${mode === 'decode' ? 'decoder' : 'encoder'}`}>
      <div className="base64-toolbar">
        <div className="base64-local-badge"><span aria-hidden="true"></span><div><strong>Local browser processing</strong><small>Input is not sent to a conversion API</small></div></div>
        <nav className="base64-mode-tabs" aria-label="Base64 tool mode">
          <a className={mode === 'decode' ? 'active' : ''} href="/base64-decoder/" aria-current={mode === 'decode' ? 'page' : undefined}>Decode</a>
          <a className={mode === 'encode' ? 'active' : ''} href="/base64-encoder/" aria-current={mode === 'encode' ? 'page' : undefined}>Encode</a>
        </nav>
      </div>

      <div className="base64-workspace">
        <section className="base64-panel base64-input-panel" aria-labelledby="base64-input-heading">
          <div className="base64-panel-heading">
            <div><p>{mode === 'decode' ? 'Encoded input' : 'Plain-text or file input'}</p><h2 id="base64-input-heading">{mode === 'decode' ? 'Paste Base64 or a Data URL' : 'Enter UTF-8 text or choose a file'}</h2></div>
            <button type="button" className="base64-quiet-button danger" onClick={clear}>Clear</button>
          </div>

          {fileSource && mode === 'encode' ? (
            <div className="base64-file-card">
              <span aria-hidden="true">01</span><div><strong>{fileSource.name}</strong><small>{formatBytes(fileSource.bytes.byteLength)} · {fileSource.type || 'unknown media type'}</small></div><button type="button" onClick={clear}>Remove</button>
            </div>
          ) : (
            <label className="base64-text-label">
              <span className="visually-hidden">{mode === 'decode' ? 'Base64 input' : 'Text to encode'}</span>
              <textarea className="base64-textarea" value={input} onChange={(event) => updateInput(event.target.value)} spellCheck={false} placeholder={mode === 'decode' ? 'Paste SGVsbG8… or data:…;base64,…' : 'Type text to encode as UTF-8'} />
            </label>
          )}

          <div className="base64-presets" aria-label="Examples">
            <strong>Examples</strong>
            {EXAMPLES[mode].map((example) => <button type="button" key={example.label} onClick={() => chooseExample(example.value)}>{example.label}</button>)}
          </div>

          <div className="base64-file-row">
            <label className="base64-file-button"><input ref={fileInput} type="file" onChange={(event) => void loadFile(event.target.files?.[0] ?? null)} /><span>{mode === 'decode' ? 'Load a Base64 text file' : 'Choose a local file'}</span></label>
            <small>Up to {formatBytes(MAX_FILE_BYTES)} · read only in this tab</small>
          </div>
          {fileError && <p className="base64-notice error" role="alert">{fileError}</p>}
        </section>

        <section className="base64-panel base64-settings-panel" aria-labelledby="base64-settings-heading">
          <div className="base64-panel-heading"><div><p>Explicit controls</p><h2 id="base64-settings-heading">{mode === 'decode' ? 'Validation settings' : 'Output settings'}</h2></div></div>
          <div className="base64-settings-grid">
            <label className="base64-field"><span>Alphabet</span><select value={asDataUrl ? 'standard' : alphabet} disabled={mode === 'encode' && asDataUrl} onChange={(event) => setAlphabet(event.target.value as DecodeAlphabet)}>{mode === 'decode' && <option value="auto">Auto-detect</option>}<option value="standard">Standard Base64 (+ /)</option><option value="url">Base64URL (- _)</option></select><small>{mode === 'decode' ? 'Auto mode rejects mixed alphabets and reports ambiguous values.' : asDataUrl ? 'Data URLs use standard Base64.' : 'Base64URL uses the URL/filename-safe alphabet; surrounding URL encoding can still apply.'}</small></label>
            {mode === 'decode' ? (
              <><label className="base64-field"><span>Whitespace policy</span><select value={whitespacePolicy} onChange={(event) => setWhitespacePolicy(event.target.value as Base64WhitespaceMode)}><option value="ignore">Ignore ASCII whitespace</option><option value="reject">Reject all whitespace</option></select><small>JWT/JWS segments require rejection; wrapped MIME data may permit whitespace.</small></label><label className="base64-field"><span>Padding policy</span><select value={paddingPolicy} onChange={(event) => setPaddingPolicy(event.target.value as Base64PaddingMode)}><option value="allow-missing">Allow omitted padding</option><option value="require">Require padding when needed</option><option value="forbid">Forbid = padding</option></select><small>Invalid placement, excess padding, and non-zero pad bits are always rejected.</small></label></>
            ) : (
              <label className="base64-check-row"><input type="checkbox" checked={asDataUrl || includePadding} disabled={asDataUrl} onChange={(event) => setIncludePadding(event.target.checked)} /><span><strong>Include = padding</strong><small>Data URLs always use padded standard Base64 here.</small></span></label>
            )}
            {mode === 'encode' && <label className="base64-field"><span>Line wrapping</span><select value={asDataUrl ? 0 : lineWidth} disabled={asDataUrl} onChange={(event) => setLineWidth(Number(event.target.value) as 0 | 76)}><option value="0">No wrapping</option><option value="76">Wrap at 76 characters</option></select><small>RFC 4648 does not add line feeds unless another specification requires them.</small></label>}
            {mode === 'encode' && <label className="base64-check-row"><input type="checkbox" checked={asDataUrl} onChange={(event) => setAsDataUrl(event.target.checked)} /><span><strong>Generate a Data URL</strong><small>Add a media type and <code>;base64,</code> prefix.</small></span></label>}
            {mode === 'encode' && asDataUrl && <label className="base64-field base64-full-field"><span>Data URL media type</span><input value={dataUrlMime} onChange={(event) => setDataUrlMime(event.target.value)} spellCheck={false} /><small>Use a correct media type from a trusted source; the label does not validate file contents.</small></label>}
          </div>
          {mimeError && <p className="base64-notice error" role="alert">{mimeError}</p>}
          <div className="base64-safety-note"><strong>Base64 is encoding, not encryption.</strong><span>Anyone can reverse it. Never use Base64 alone to protect passwords, access tokens, personal data, or secrets.</span></div>
        </section>
      </div>

      <section className="base64-output" aria-labelledby="base64-output-heading">
        <div className="base64-output-heading">
          <div><p>{valid ? 'Result ready' : 'Input needs attention'}</p><h2 id="base64-output-heading">{mode === 'decode' ? 'Decoded bytes' : 'Encoded Base64'}</h2><small>{resultBytes ? `${formatBytes(resultBytes)} ${mode === 'decode' ? 'decoded' : 'in the source'}` : 'Empty input'}</small></div>
          <div className="base64-output-actions">
            {mode === 'decode' && decoded?.ok && <div className="base64-view-tabs" aria-label="Decoded output view"><button type="button" className={outputView === 'text' ? 'active' : ''} aria-pressed={outputView === 'text'} disabled={decoded.utf8Text === null} onClick={() => setOutputView('text')}>UTF-8 text</button><button type="button" className={outputView === 'hex' ? 'active' : ''} aria-pressed={outputView === 'hex'} onClick={() => setOutputView('hex')}>Hex</button></div>}
            <button type="button" className="base64-quiet-button" disabled={!valid} onClick={copyCompleteResult}>{copied === 'result' ? 'Copied' : 'Copy result'}</button>
            <button type="button" className="base64-primary-button" disabled={!valid} onClick={downloadResult}>Download result</button>
          </div>
        </div>

        {outputError ? (
          <div className="base64-error-output" role="alert"><strong>{mode === 'decode' ? 'Cannot decode this input' : 'Cannot create this Data URL'}</strong><p>{outputError}</p><span>{mode === 'decode' ? 'Check the explicit alphabet, whitespace, and padding policies plus the reported character. Invalid characters and non-canonical pad bits are never ignored.' : 'Enter a valid media type without the ;base64 marker. Copy and download remain disabled until the output is valid.'}</span></div>
        ) : (
          <>
            {preview.truncated && <p className="base64-preview-warning">The on-page preview is shortened to keep the tab responsive. Copy and download still use the complete result.</p>}
            <textarea className="base64-output-text" value={preview.value} readOnly spellCheck={false} aria-label={mode === 'decode' ? 'Decoded output' : 'Encoded output'} />
          </>
        )}

        {decoded?.ok && (
          <div className="base64-diagnostics">
            <article><span>Alphabet</span><strong>{decoded.alphabet === 'data-url' ? 'Data URL' : decoded.alphabetAmbiguous ? 'Shared Base64 alphabet' : decoded.alphabet === 'url' ? 'Base64URL' : 'Standard Base64'}</strong><small>{decoded.dataUrl ? decoded.mediaType : decoded.alphabetAmbiguous ? 'No +, /, -, or _ character distinguishes the variants' : 'Detected from the encoded characters'}</small></article>
            <article><span>Canonical form</span><strong>{decoded.dataUrl && !decoded.dataUrlUsesBase64 ? 'Percent-decoded Data URL' : 'Valid Base64 pad bits'}</strong><small>{decoded.dataUrl && !decoded.dataUrlUsesBase64 ? 'This payload uses percent escapes rather than Base64' : paddingDiagnostic(decoded, paddingPolicy)}</small></article>
            <article><span>Decoded content</span><strong>{decoded.utf8Text !== null ? 'Valid UTF-8' : 'Binary / invalid UTF-8'}</strong><small>{decoded.safeRasterMime || `${decoded.bytes.byteLength.toLocaleString()} bytes`}</small></article>
            <article><span>Preview policy</span><strong>No HTML or SVG rendering</strong><small>Only bytes with recognized PNG, JPEG, GIF, or WebP signatures are eligible.</small></article>
          </div>
        )}

        {decoded?.ok && <div className="base64-conversions"><div><span>Canonical standard Base64</span><code>{previewText(standardVersion).value}</code><button type="button" onClick={() => void copyValue(standardVersion, 'standard', 'Standard Base64')}>{copied === 'standard' ? 'Copied' : 'Copy'}</button></div><div><span>Unpadded Base64URL</span><code>{previewText(urlVersion).value}</code><button type="button" onClick={() => void copyValue(urlVersion, 'url', 'Base64URL')}>{copied === 'url' ? 'Copied' : 'Copy'}</button></div></div>}

        {imagePreview && decoded?.ok && <figure className="base64-image-preview"><figcaption><strong>Restricted raster preview</strong><span>Magic bytes match {decoded.safeRasterMime}; this does not prove the file is benign. SVG and HTML are never rendered.</span></figcaption><img src={imagePreview} alt="Decoded raster image preview" /></figure>}
      </section>

      <p className="base64-activity" aria-live="polite"><strong>Tool status:</strong><span>{activity}</span></p>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
const mode: ToolMode = document.body.dataset.base64Mode === 'encode' ? 'encode' : 'decode';
createRoot(root).render(<React.StrictMode><App mode={mode} /></React.StrictMode>);
