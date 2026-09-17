import React, { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ASCII_TABLE,
  MAX_BINARY_BYTES,
  MAX_BINARY_INPUT_CODE_UNITS,
  MAX_BINARY_TEXT_CODE_UNITS,
  MAX_HEX_INPUT_CODE_UNITS,
  MAX_RADIX_DIGITS,
  MAX_RADIX_INPUT_CODE_UNITS,
  binaryToUtf8Text,
  decodeTwosComplement,
  encodeTwosComplement,
  formatRadixInteger,
  hexToUtf8Text,
  parseRadixInteger,
  signedRange,
  utf8TextToBinary,
  utf8TextToHex,
} from './lib/binary-tools';
import './styles.css';
import './binary.css';

type PageMode = 'binary-converter' | 'hex-converter' | 'binary-translator' | 'ascii-table';
type LetterCase = 'upper' | 'lower';
type ByteDirection = 'decode' | 'encode';
type TwosMode = 'signed-value' | 'bit-pattern';

const RADICES = Array.from({ length: 35 }, (_, index) => index + 2);
const WORD_WIDTHS = [8, 16, 32, 64, 128, 256] as const;

interface NumericSnapshot {
  value: bigint;
  sourceRadix: number;
}

interface TwosSnapshot {
  pattern: bigint;
  signed: bigint;
  bits: string;
  hex: string;
  width: number;
  mode: TwosMode;
}

interface ByteSnapshot {
  bytes: Uint8Array;
  text: string;
  binary: string;
  hex: string;
  direction: ByteDirection;
}

function pageMode(): PageMode {
  const candidate = document.body.dataset.page;
  if (candidate === 'hex-converter' || candidate === 'binary-translator' || candidate === 'ascii-table') return candidate;
  return 'binary-converter';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The local conversion failed.';
}

function groupFromLeft(value: string, size: number): string {
  if (size <= 0 || value.length <= size) return value;
  const chunks: string[] = [];
  for (let start = 0; start < value.length; start += size) chunks.push(value.slice(start, start + size));
  return chunks.join(' ');
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Continue to the selectable fallback when browser permission is denied.
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
  if (!copied) throw new Error('Copy was blocked. Select the output and copy it manually.');
}

function Counter({ value, maximum, unit = 'UTF-16' }: { value: string; maximum: number; unit?: string }): React.JSX.Element {
  return <span className={value.length > maximum ? 'binary-counter over' : 'binary-counter'}>{value.length.toLocaleString('en-US')} / {maximum.toLocaleString('en-US')} {unit}</span>;
}

function RadixSelect({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }): React.JSX.Element {
  return <label className="binary-field"><span>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))}>{RADICES.map((radix) => <option value={radix} key={radix}>Base {radix}{radix === 2 ? ' · binary' : radix === 8 ? ' · octal' : radix === 10 ? ' · decimal' : radix === 16 ? ' · hexadecimal' : ''}</option>)}</select></label>;
}

function ErrorNotice({ error }: { error: string | null }): React.JSX.Element | null {
  return error ? <p className="binary-error" role="alert"><strong>Cannot complete this conversion</strong><span>{error}</span></p> : null;
}

function ResultRows({ rows, onStatus }: { rows: readonly { label: string; value: string }[]; onStatus: (message: string) => void }): React.JSX.Element {
  const copy = async (label: string, value: string) => {
    try {
      await copyText(value);
      onStatus(`${label} copied on explicit request.`);
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };
  return <dl className="binary-results">{rows.map((row) => <div className="binary-result" key={row.label}><dt>{row.label}</dt><dd><code>{row.value}</code></dd><button className="binary-copy-button" type="button" onClick={() => void copy(row.label, row.value)}>Copy</button></div>)}</dl>;
}

function EmptyResult({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return <p className="binary-empty"><strong>{title}</strong><span>{detail}</span></p>;
}

function NumericWorkbench({
  page,
  onStatus,
}: {
  page: 'binary-converter' | 'hex-converter';
  onStatus: (message: string) => void;
}): React.JSX.Element {
  const binaryPage = page === 'binary-converter';
  const [input, setInput] = useState(binaryPage ? '1101 0110 1011' : '7FFF_FFFF');
  const [sourceRadix, setSourceRadix] = useState(binaryPage ? 2 : 16);
  const [customRadix, setCustomRadix] = useState(36);
  const [allowSeparators, setAllowSeparators] = useState(true);
  const [letterCase, setLetterCase] = useState<LetterCase>('upper');
  const [includePrefix, setIncludePrefix] = useState(true);
  const [groupSize, setGroupSize] = useState(4);
  const [snapshot, setSnapshot] = useState<NumericSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = (message?: string) => {
    setSnapshot(null);
    setError(null);
    if (message) onStatus(message);
  };

  useEffect(() => {
    if (!input.trim()) return;
    const timer = window.setTimeout(() => convert(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sourceRadix, customRadix, allowSeparators]);

  const convert = () => {
    try {
      const effectiveRadix = binaryPage ? sourceRadix : 16;
      const value = parseRadixInteger(input, effectiveRadix, allowSeparators);
      setSnapshot({ value, sourceRadix: effectiveRadix });
      setError(null);
      onStatus(`Converted one exact base-${effectiveRadix} integer with BigInt. No text or bytes were inferred.`);
    } catch (caught) {
      const message = errorMessage(caught);
      setSnapshot(null);
      setError(message);
      onStatus(message);
    }
  };

  const rows = snapshot ? [
    { label: 'Binary · base 2', radix: 2 },
    { label: 'Octal · base 8', radix: 8 },
    { label: 'Decimal · base 10', radix: 10 },
    { label: 'Hex · base 16', radix: 16 },
    ...(binaryPage ? [{ label: `Custom · base ${customRadix}`, radix: customRadix }] : []),
  ].map(({ label, radix }) => ({
    label,
    value: formatRadixInteger(snapshot.value, radix, {
      uppercase: letterCase === 'upper',
      prefix: includePrefix,
      groupSize,
    }),
  })) : [];

  return <>
    <div className="binary-workspace">
      <section className="binary-card" aria-labelledby={`${page}-numeric-input-heading`}>
        <header className="binary-card-heading"><div><p>Integer input</p><h3 id={`${page}-numeric-input-heading`}>{binaryPage ? 'Enter a whole number in base 2–36' : 'Enter a hexadecimal integer'}</h3></div><Counter value={input} maximum={MAX_RADIX_INPUT_CODE_UNITS} /></header>
        <div className="binary-card-body">
          <label className="binary-text-field"><span>{binaryPage ? 'ASCII digits with an optional sign and matching 0b, 0o, or 0x prefix' : 'Hex digits represent one mathematical integer here—not a sequence of text bytes'}</span><textarea value={input} maxLength={MAX_RADIX_INPUT_CODE_UNITS} onChange={(event) => { setInput(event.target.value); invalidate(); }} rows={8} spellCheck={false} inputMode="text" /></label>
          <div className="binary-control-grid">
            {binaryPage ? <RadixSelect value={sourceRadix} label="Input radix" onChange={(value) => { setSourceRadix(value); invalidate(`Input radix changed to base ${value}; press Convert to calculate a new value.`); }} /> : <label className="binary-field"><span>Input radix</span><input value="Base 16 · hexadecimal integer" readOnly /></label>}
            {binaryPage ? <RadixSelect value={customRadix} label="Additional output radix" onChange={setCustomRadix} /> : <label className="binary-field"><span>Example distinction</span><input value="41₁₆ = 65₁₀; hex byte 41 = text A" readOnly /></label>}
          </div>
          <label className="binary-check"><input type="checkbox" checked={allowSeparators} onChange={(event) => { setAllowSeparators(event.target.checked); invalidate('Separator policy changed; press Convert to validate the current integer again.'); }} /><span><strong>Allow presentation separators</strong><small>Underscores or ASCII whitespace may appear only between digits. Matching 0b, 0o, and 0x prefixes are accepted for bases 2, 8, and 16.</small></span></label>
          <div className="binary-actions between"><button className="binary-button primary" type="button" onClick={convert}>Convert exact integer</button><button className="binary-link-button" type="button" onClick={() => { setInput(''); invalidate('Integer input cleared from this tab.'); }}>Clear</button></div>
          <ErrorNotice error={error} />
          <p className="binary-note"><strong>Integer-only contract:</strong> up to {MAX_RADIX_DIGITS.toLocaleString('en-US')} digits. Fractions, exponents, commas, Unicode digits, and automatic text translation are rejected. A leading minus sign remains mathematical sign-and-magnitude unless you explicitly use the fixed-width panel.</p>
        </div>
      </section>

      <section className="binary-card output" aria-labelledby={`${page}-numeric-output-heading`}>
        <header className="binary-card-heading"><div><p>Exact projections</p><h3 id={`${page}-numeric-output-heading`}>Common radix outputs</h3></div><span>{snapshot ? `Source base ${snapshot.sourceRadix}` : 'Waiting for Convert'}</span></header>
        <div className="binary-card-body">
          <div className="binary-control-grid three">
            <label className="binary-field"><span>Letter case</span><select value={letterCase} onChange={(event) => setLetterCase(event.target.value as LetterCase)}><option value="upper">Uppercase A–Z</option><option value="lower">Lowercase a–z</option></select></label>
            <label className="binary-field"><span>Digit grouping</span><select value={groupSize} onChange={(event) => setGroupSize(Number(event.target.value))}><option value="0">No grouping</option><option value="4">Groups of 4</option><option value="8">Groups of 8</option></select></label>
            <label className="binary-check"><input type="checkbox" checked={includePrefix} onChange={(event) => setIncludePrefix(event.target.checked)} /><span><strong>Show prefixes</strong><small>0b, 0o, and 0x only</small></span></label>
          </div>
          {snapshot ? <ResultRows rows={rows} onStatus={onStatus} /> : <EmptyResult title="No converted integer yet" detail="Input changes do not trigger expensive BigInt work. Review the selected radix, then press Convert." />}
        </div>
      </section>
    </div>
    {binaryPage ? <TwosComplementPanel onStatus={onStatus} /> : null}
  </>;
}

function TwosComplementPanel({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [mode, setMode] = useState<TwosMode>('signed-value');
  const [input, setInput] = useState('-42');
  const [radix, setRadix] = useState(10);
  const [width, setWidth] = useState<number>(8);
  const [snapshot, setSnapshot] = useState<TwosSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    setSnapshot(null);
    setError(null);
  };

  const chooseMode = (next: TwosMode) => {
    setMode(next);
    setInput(next === 'signed-value' ? '-42' : '1101 0110');
    setRadix(next === 'signed-value' ? 10 : 2);
    invalidate();
    onStatus(next === 'signed-value' ? 'Signed-value encoding selected. Bit width is now an explicit range contract.' : 'Bit-pattern interpretation selected. A leading sign is not accepted as part of the word.');
  };

  useEffect(() => {
    if (!input.trim()) return;
    const timer = window.setTimeout(() => convert(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, radix, width, mode]);

  const convert = () => {
    try {
      const value = parseRadixInteger(input, radix, true);
      let pattern: bigint;
      let signed: bigint;
      let bits: string;
      let hex: string;
      if (mode === 'signed-value') {
        signed = value;
        pattern = encodeTwosComplement(value, width);
      } else {
        if (value < 0n) throw new RangeError('A fixed-width bit pattern must be unsigned. Remove the leading minus sign.');
        pattern = value;
        signed = decodeTwosComplement(value, width);
      }
      bits = pattern.toString(2).padStart(width, '0');
      hex = pattern.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
      setSnapshot({ pattern, signed, bits, hex, width, mode });
      setError(null);
      onStatus(`${mode === 'signed-value' ? 'Encoded' : 'Interpreted'} one explicit ${width}-bit two’s-complement word without wrapping.`);
    } catch (caught) {
      const message = errorMessage(caught);
      setSnapshot(null);
      setError(message);
      onStatus(message);
    }
  };

  const binaryWord = snapshot ? groupFromLeft(snapshot.bits, 4) : '';
  const hexWord = snapshot ? groupFromLeft(snapshot.hex, 4) : '';
  const { minimum, maximum } = signedRange(width);
  const rows = snapshot ? [
    { label: `${snapshot.width}-bit word`, value: binaryWord },
    { label: 'Hex word', value: `0x${hexWord}` },
    { label: 'Unsigned decimal', value: snapshot.pattern.toString(10) },
    { label: 'Signed decimal', value: snapshot.signed.toString(10) },
  ] : [];

  return <section className="binary-section" aria-labelledby="twos-heading">
    <header className="binary-section-heading"><div><p>Fixed-width signed interpretation</p><h3 id="twos-heading">Two’s complement is a separate operation</h3></div><span>A mathematical negative integer and an unsigned bit pattern are different inputs. The selected width controls the sign bit and valid range; overflow is rejected rather than wrapped.</span></header>
    <div className="binary-section-body">
      <div className="binary-tabs" aria-label="Two's-complement direction"><button type="button" aria-pressed={mode === 'signed-value'} onClick={() => chooseMode('signed-value')}>Encode signed value</button><button type="button" aria-pressed={mode === 'bit-pattern'} onClick={() => chooseMode('bit-pattern')}>Interpret bit pattern</button></div>
      <div className="binary-twos-grid">
        <div className="binary-card"><div className="binary-card-body">
          <label className="binary-text-field"><span>{mode === 'signed-value' ? 'Signed mathematical integer' : 'Unsigned word pattern; shorter input is zero-padded to the selected width'}</span><textarea value={input} maxLength={MAX_RADIX_INPUT_CODE_UNITS} onChange={(event) => { setInput(event.target.value); invalidate(); }} rows={5} spellCheck={false} /></label>
          <RadixSelect value={radix} label="Input radix" onChange={(value) => { setRadix(value); invalidate(); }} />
          <fieldset className="binary-field binary-width-field"><legend>Word width</legend><div className="binary-preset-row">{WORD_WIDTHS.map((candidate) => <button key={candidate} type="button" aria-pressed={width === candidate} onClick={() => { setWidth(candidate); invalidate(); }}>{candidate}</button>)}</div></fieldset>
          <p className="binary-note"><strong>{width}-bit signed range:</strong> {minimum.toString()} through {maximum.toString()}.</p>
          <button className="binary-button primary" type="button" onClick={convert}>{mode === 'signed-value' ? 'Encode fixed-width word' : 'Interpret fixed-width word'}</button>
          <ErrorNotice error={error} />
        </div></div>
        <div className="binary-card output"><div className="binary-card-body">{snapshot ? <ResultRows rows={rows} onStatus={onStatus} /> : <EmptyResult title="No fixed-width result yet" detail="Select a word width and input meaning, then run the explicit operation. Changing width never silently sign-extends or truncates a previous result." />}</div></div>
      </div>
    </div>
  </section>;
}

function ByteWorkbench({
  kind,
  onStatus,
}: {
  kind: 'binary' | 'hex';
  onStatus: (message: string) => void;
}): React.JSX.Element {
  const [direction, setDirection] = useState<ByteDirection>('decode');
  const [decodeInput, setDecodeInput] = useState(kind === 'binary'
    ? '01001000 01100101 01101100 01101100 01101111'
    : '48 65 6C 6C 6F');
  const [encodeInput, setEncodeInput] = useState('Hello, 한글 👋');
  const [snapshot, setSnapshot] = useState<ByteSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = direction === 'decode' ? decodeInput : encodeInput;
  const maximum = direction === 'encode'
    ? MAX_BINARY_TEXT_CODE_UNITS
    : kind === 'binary' ? MAX_BINARY_INPUT_CODE_UNITS : MAX_HEX_INPUT_CODE_UNITS;

  const invalidate = () => {
    setSnapshot(null);
    setError(null);
  };

  const chooseDirection = (next: ByteDirection) => {
    setDirection(next);
    invalidate();
    onStatus(next === 'decode'
      ? `Strict ${kind === 'binary' ? '8-bit binary' : 'hex byte'} decoding selected. Invalid UTF-8 will be rejected.`
      : `UTF-8 text encoding selected. Unicode is not normalized and a BOM is not added.`);
  };

  useEffect(() => {
    if (!input.trim()) return;
    const timer = window.setTimeout(() => convert(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decodeInput, encodeInput, direction, kind]);

  const convert = () => {
    try {
      const result = direction === 'decode'
        ? kind === 'binary' ? binaryToUtf8Text(decodeInput) : hexToUtf8Text(decodeInput, { uppercase: true })
        : kind === 'binary' ? utf8TextToBinary(encodeInput) : utf8TextToHex(encodeInput, { uppercase: true });
      setSnapshot({
        bytes: result.bytes,
        text: result.text,
        binary: result.binary,
        hex: result.hex,
        direction,
      });
      setError(null);
      onStatus(`${result.byteLength.toLocaleString('en-US')} UTF-8 byte${result.byteLength === 1 ? '' : 's'} converted locally with strict validation.`);
    } catch (caught) {
      const message = errorMessage(caught);
      setSnapshot(null);
      setError(message);
      onStatus(message);
    }
  };

  const updateInput = (value: string) => {
    if (direction === 'decode') setDecodeInput(value);
    else setEncodeInput(value);
    invalidate();
  };

  const output = snapshot
    ? snapshot.direction === 'decode' ? snapshot.text : kind === 'binary' ? snapshot.binary : snapshot.hex
    : '';
  const outputLabel = direction === 'decode' ? 'Strict UTF-8 text result' : kind === 'binary' ? '8-bit binary bytes' : 'Hex bytes';
  const hasBom = Boolean(snapshot && snapshot.bytes.length >= 3
    && snapshot.bytes[0] === 0xef && snapshot.bytes[1] === 0xbb && snapshot.bytes[2] === 0xbf);
  const empty = snapshot?.bytes.length === 0;

  const copyOutput = async () => {
    if (!snapshot) return;
    try {
      await copyText(output);
      onStatus(`${outputLabel} copied on explicit request.`);
    } catch (caught) {
      onStatus(errorMessage(caught));
    }
  };

  return <>
    <div className="binary-tabs" aria-label={`${kind} byte conversion direction`}>
      <button type="button" aria-pressed={direction === 'decode'} onClick={() => chooseDirection('decode')}>{kind === 'binary' ? 'Binary bytes → UTF-8 text' : 'Hex bytes → UTF-8 text'}</button>
      <button type="button" aria-pressed={direction === 'encode'} onClick={() => chooseDirection('encode')}>UTF-8 text → {kind === 'binary' ? 'binary bytes' : 'hex bytes'}</button>
    </div>
    <div className="binary-workspace">
      <section className="binary-card" aria-labelledby={`${kind}-bytes-input-heading`}>
        <header className="binary-card-heading"><div><p>{direction === 'decode' ? 'Encoded bytes' : 'Unicode text'}</p><h3 id={`${kind}-bytes-input-heading`}>{direction === 'decode' ? `Enter ${kind === 'binary' ? 'complete 8-bit binary' : 'two-digit hex'} bytes` : 'Enter text to encode as UTF-8'}</h3></div><Counter value={input} maximum={maximum} /></header>
        <div className="binary-card-body">
          <label className="binary-text-field"><span>{direction === 'decode'
            ? kind === 'binary'
              ? 'Only 0, 1, and ASCII whitespace; significant bit count must be divisible by 8'
              : 'Use compact pairs, two-digit whitespace/colon/hyphen tokens, 0xNN tokens, or \\xNN escapes; formats cannot be mixed'
            : `Up to ${MAX_BINARY_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units and ${MAX_BINARY_BYTES.toLocaleString('en-US')} encoded bytes`}</span><textarea value={input} maxLength={maximum} onChange={(event) => updateInput(event.target.value)} rows={10} spellCheck={false} /></label>
          <div className="binary-actions between"><button className="binary-button primary" type="button" onClick={convert}>{direction === 'decode' ? `Decode strict ${kind === 'binary' ? 'binary' : 'hex'} bytes` : `Encode text as ${kind === 'binary' ? 'binary' : 'hex'} bytes`}</button><button className="binary-link-button" type="button" onClick={() => { updateInput(''); onStatus('Current byte input cleared from this tab.'); }}>Clear</button></div>
          <ErrorNotice error={error} />
          {kind === 'hex' ? <p className="binary-note"><strong>Two separate meanings:</strong> numeric <code>41</code> is the integer sixty-five. In this byte workflow, hex byte <code>41</code> decodes to UTF-8/ASCII text <code>A</code>. No meaning is guessed between the two areas.</p> : <p className="binary-note"><strong>Byte contract:</strong> every output group is one 8-bit byte. This is UTF-8 translation, not conversion of one large binary integer.</p>}
        </div>
      </section>

      <section className="binary-card output" aria-labelledby={`${kind}-bytes-output-heading`}>
        <header className="binary-card-heading"><div><p>{snapshot ? 'Result ready' : 'Explicit operation required'}</p><h3 id={`${kind}-bytes-output-heading`}>{outputLabel}</h3></div><span>{snapshot ? `${snapshot.bytes.length.toLocaleString('en-US')} bytes` : 'Waiting'}</span></header>
        <div className="binary-card-body">
          {snapshot ? <>
            <label className="binary-text-field output"><span>{empty ? 'Intentional empty result' : 'Complete inert output; control characters are never interpreted as markup'}</span><textarea value={output} readOnly rows={10} spellCheck={false} /></label>
            <div className="binary-actions"><button className="binary-button primary" type="button" onClick={() => void copyOutput()}>Copy complete output</button></div>
            <div className="binary-summary" aria-label="Byte diagnostics">
              <div><span>Bytes</span><strong>{snapshot.bytes.length.toLocaleString('en-US')}</strong></div>
              <div><span>Bits</span><strong>{(snapshot.bytes.length * 8).toLocaleString('en-US')}</strong></div>
              <div><span>UTF-8 policy</span><strong>Fatal · no replacement</strong></div>
              <div><span>Leading BOM</span><strong>{hasBom ? 'Preserved as U+FEFF' : 'Not present'}</strong></div>
            </div>
            <ResultRows rows={[
              { label: 'Canonical hex', value: snapshot.hex || '— empty —' },
              { label: 'Canonical binary', value: snapshot.binary || '— empty —' },
            ]} onStatus={onStatus} />
          </> : <EmptyResult title="No byte result yet" detail="Input remains ordinary page state until you press the conversion button. Invalid UTF-8, incomplete bytes, and lone surrogates are rejected rather than repaired." />}
        </div>
      </section>
    </div>
    {kind === 'binary' ? <p className="binary-boundary"><strong>Need a numerical value?</strong> This translator treats bits as UTF-8 bytes. Use the <a href="/binary-converter/">Binary Converter</a> for signed or unsigned integers, arbitrary radices, and fixed-width two’s complement.</p> : null}
  </>;
}

function HexConverter({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [area, setArea] = useState<'integer' | 'bytes'>('integer');
  const choose = (next: 'integer' | 'bytes') => {
    setArea(next);
    onStatus(next === 'integer'
      ? 'Hex integer conversion selected. Every digit contributes to one exact BigInt value.'
      : 'Hex byte translation selected. Every pair of digits is one byte in a strict UTF-8 sequence.');
  };
  return <>
    <div className="binary-tabs" aria-label="Hex converter area">
      <button type="button" aria-pressed={area === 'integer'} onClick={() => choose('integer')}>Hex integer conversion</button>
      <button type="button" aria-pressed={area === 'bytes'} onClick={() => choose('bytes')}>Hex bytes ↔ UTF-8 text</button>
    </div>
    {area === 'integer' ? <NumericWorkbench page="hex-converter" onStatus={onStatus} /> : <ByteWorkbench kind="hex" onStatus={onStatus} />}
  </>;
}

function AsciiTable({ onStatus }: { onStatus: (message: string) => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<'all' | 'control' | 'printable'>('all');
  const normalized = query.trim().toLowerCase();
  const rows = useMemo(() => ASCII_TABLE.filter((row) => {
    if (range === 'control' && !row.control) return false;
    if (range === 'printable' && !row.printable) return false;
    if (!normalized) return true;
    return [row.code, row.dec, row.hex, row.octal, row.binary, row.abbr, row.display, row.label, row.name]
      .some((value) => String(value).toLowerCase().includes(normalized));
  }), [normalized, range]);

  const copyValue = async (label: string, value: string) => {
    try {
      await copyText(value);
      onStatus(`${label} copied on explicit request.`);
    } catch (caught) {
      onStatus(errorMessage(caught));
    }
  };

  const visibleSymbol = (row: (typeof ASCII_TABLE)[number]): string => row.control
    ? row.label
    : row.code === 32 ? '<SP>' : row.display;

  const copyRow = (row: (typeof ASCII_TABLE)[number]) => {
    const value = [visibleSymbol(row), row.abbr || '—', row.name, row.dec, row.hex, row.octal, row.binary].join('\t');
    void copyValue(`ASCII ${row.dec} row`, value);
  };

  return <>
    <div className="binary-table-tools">
      <label className="binary-search"><span>Search by symbol label, control abbreviation, name, or exact base value</span><input type="search" value={query} maxLength={64} onChange={(event) => setQuery(event.target.value)} placeholder="Try LF, line feed, 65, 41, 101, or 01000001" /></label>
      <div className="binary-tabs binary-range-tabs" aria-label="ASCII range filter"><button type="button" aria-pressed={range === 'all'} onClick={() => setRange('all')}>All 128</button><button type="button" aria-pressed={range === 'control'} onClick={() => setRange('control')}>Controls</button><button type="button" aria-pressed={range === 'printable'} onClick={() => setRange('printable')}>Printable</button></div>
    </div>
    <div className="binary-summary" aria-label="ASCII table summary">
      <div><span>Visible rows</span><strong>{rows.length} of 128</strong></div>
      <div><span>Code range</span><strong>0 through 127</strong></div>
      <div><span>Character width</span><strong>7 significant bits</strong></div>
      <div><span>Beyond 127</span><strong>Not ASCII</strong></div>
    </div>
    <p className="visually-hidden" aria-live="polite">{rows.length} of 128 ASCII rows match the current search and range filter.</p>
    <div className="binary-table-wrap">
      <table className="binary-ascii-table">
        <caption className="visually-hidden">ASCII codes 0 through 127 in decimal, hexadecimal, octal, and eight-bit binary display</caption>
        <thead><tr><th scope="col">Symbol / control</th><th scope="col">Abbreviation</th><th scope="col">Name</th><th scope="col">Decimal</th><th scope="col">Hex</th><th scope="col">Octal</th><th scope="col">8-bit binary</th><th scope="col">Copy row</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.code}>
          <td data-label="Symbol / control"><button className="binary-value-copy binary-ascii-symbol" type="button" onClick={() => void copyValue(`ASCII ${row.dec} symbol label`, visibleSymbol(row))}>{visibleSymbol(row)}</button></td>
          <td data-label="Abbreviation"><code>{row.abbr || '—'}</code><span className="binary-ascii-sub">{row.control ? 'Control code' : row.code === 32 ? 'Space' : 'Printable'}</span></td>
          <td data-label="Name"><span className="binary-ascii-name">{row.name}</span></td>
          <td data-label="Decimal"><button className="binary-value-copy" type="button" onClick={() => void copyValue('Decimal value', row.dec)}>{row.dec}</button></td>
          <td data-label="Hex"><button className="binary-value-copy" type="button" onClick={() => void copyValue('Hex value', row.hex)}>{row.hex}</button></td>
          <td data-label="Octal"><button className="binary-value-copy" type="button" onClick={() => void copyValue('Octal value', row.octal)}>{row.octal}</button></td>
          <td data-label="8-bit binary"><button className="binary-value-copy" type="button" onClick={() => void copyValue('Binary value', row.binary)}>{row.binary}</button></td>
          <td data-label="Complete row"><button className="binary-copy-button" type="button" onClick={() => copyRow(row)}>Copy row</button></td>
        </tr>)}</tbody>
      </table>
      {rows.length === 0 ? <p className="binary-table-empty">No ASCII row matches this search and range filter.</p> : null}
    </div>
    <p className="binary-note"><strong>No raw controls are emitted:</strong> NUL, tabs, line breaks, escape, DEL, and other control codes are displayed and copied as labels. ASCII is exactly codes 0–127; byte values 128–255 depend on a separate character encoding.</p>
  </>;
}

const PAGE_COPY: Record<PageMode, { badge: string; kicker: string; heading: string; detail: string }> = {
  'binary-converter': {
    badge: 'Exact integer conversion',
    kicker: 'Radix 2 through 36',
    heading: 'Convert integers without precision loss',
    detail: 'Parse one signed whole number with bounded BigInt arithmetic, then produce binary, octal, decimal, hexadecimal, and a chosen custom base. Text translation stays a separate tool.',
  },
  'hex-converter': {
    badge: 'Integers or UTF-8 bytes',
    kicker: 'Two explicit hex meanings',
    heading: 'Choose numeric value or byte sequence',
    detail: 'The integer area treats all digits as one exact number. The byte area treats each pair as an octet and requires the full sequence to decode as well-formed UTF-8.',
  },
  'binary-translator': {
    badge: 'Strict UTF-8 bytes',
    kicker: 'Text and 8-bit binary',
    heading: 'Translate explicit UTF-8 byte sequences',
    detail: 'Encode Unicode text to eight-bit groups or decode complete binary bytes with fatal UTF-8 validation. A leading BOM is preserved and invalid sequences are never replaced.',
  },
  'ascii-table': {
    badge: 'Codes 0 through 127',
    kicker: 'Seven-bit ASCII reference',
    heading: 'Search all 128 ASCII code points',
    detail: 'Inspect safe labels for controls and exact decimal, hexadecimal, octal, and eight-bit binary representations. Values above 127 are intentionally excluded.',
  },
};

function App(): React.JSX.Element {
  const page = pageMode();
  const copy = PAGE_COPY[page];
  const [status, setStatus] = useState('Ready. Input remains in this browser tab until an explicit local operation.');
  return <section className={`binary-app ${page}`} aria-label={copy.heading}>
    <header className="binary-toolbar">
      <div className="binary-local-badge"><span aria-hidden="true" /><div><strong>Local browser processing</strong><small>No upload, fetch, storage, URL persistence, or automatic clipboard access</small></div></div>
      <div className="binary-tool-badge"><span>{copy.badge}</span><strong>Explicit Convert</strong></div>
    </header>
    <div className="binary-body">
      <div className="binary-intro"><div><p>{copy.kicker}</p><h2>{copy.heading}</h2></div><span>{copy.detail}</span></div>
      {page === 'binary-converter' ? <NumericWorkbench page="binary-converter" onStatus={setStatus} /> : null}
      {page === 'hex-converter' ? <HexConverter onStatus={setStatus} /> : null}
      {page === 'binary-translator' ? <ByteWorkbench kind="binary" onStatus={setStatus} /> : null}
      {page === 'ascii-table' ? <AsciiTable onStatus={setStatus} /> : null}
    </div>
    <aside className="binary-safety">
      <div><strong>Exact scope, explicit meaning</strong><span>Integer radix conversion, fixed-width words, and UTF-8 bytes are separate operations. The page does not infer one from another.</span></div>
      <div><strong>Inert results</strong><span>Outputs are rendered as ordinary text. Copy happens only after a button click, and no input is persisted by this tool.</span></div>
    </aside>
    <p className="binary-status" aria-live="polite"><strong>Status</strong><span>{status}</span></p>
  </section>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
