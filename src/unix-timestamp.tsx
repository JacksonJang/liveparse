import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  dateToEpoch,
  MAX_EPOCH_INPUT_CHARACTERS,
  parseEpoch,
  type EpochConversionResult,
  type EpochUnit,
} from './lib/epoch';
import './styles.css';
import './unix-timestamp.css';

type SuccessfulConversion = Extract<EpochConversionResult, { ok: true }>;
type DateInterpretation = 'local' | 'utc';

const MAX_BATCH_LINES = 100;
const MAX_BATCH_CHARACTERS = 10_000;
const SAMPLE_TIMESTAMP = '1754265600123456';
const BATCH_SAMPLE = `1754265600
1754265600123
1754265600123456
1754265600123456789`;

const unitOptions: Array<{ value: EpochUnit; short: string; label: string }> = [
  { value: 'auto', short: 'Auto', label: 'Detect unit automatically' },
  { value: 'seconds', short: 's', label: 'Seconds' },
  { value: 'milliseconds', short: 'ms', label: 'Milliseconds' },
  { value: 'microseconds', short: 'µs', label: 'Microseconds' },
  { value: 'nanoseconds', short: 'ns', label: 'Nanoseconds' },
];

const unitLabels: Record<Exclude<EpochUnit, 'auto'>, string> = {
  seconds: 'Seconds',
  milliseconds: 'Milliseconds',
  microseconds: 'Microseconds',
  nanoseconds: 'Nanoseconds',
};

const exactFields: Array<{ key: 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'; label: string }> = [
  { key: 'seconds', label: 'Seconds' },
  { key: 'milliseconds', label: 'Milliseconds' },
  { key: 'microseconds', label: 'Microseconds' },
  { key: 'nanoseconds', label: 'Nanoseconds' },
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateTimeInputValue(date: Date, interpretation: DateInterpretation): string {
  if (interpretation === 'utc') return date.toISOString().slice(0, 19);
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseLocalDateParts(value: string): LocalDateParts | null {
  const match = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
}

function hasLocalParts(date: Date, parts: LocalDateParts): boolean {
  return date.getFullYear() === parts.year
    && date.getMonth() + 1 === parts.month
    && date.getDate() === parts.day
    && date.getHours() === parts.hour
    && date.getMinutes() === parts.minute
    && date.getSeconds() === parts.second;
}

function localDateWarning(value: string, date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = parseLocalDateParts(value);
  if (!parts) return null;
  if (!hasLocalParts(date, parts)) {
    return `That wall-clock time does not exist in this browser timezone. The browser normalized it to ${dateTimeInputValue(date, 'local')}.`;
  }

  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 15) {
    if (offsetMinutes === 0) continue;
    const alternate = new Date(date.getTime() + offsetMinutes * 60_000);
    if (hasLocalParts(alternate, parts) && alternate.getTimezoneOffset() !== date.getTimezoneOffset()) {
      return 'That local wall-clock time occurs more than once during a daylight-saving transition. The browser selected one offset; use UTC or verify the intended offset before relying on the result.';
    }
  }
  return null;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard permission can be denied; keep the local selection fallback available.
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

function csvCell(value: string): string {
  const protectedValue = /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(protectedValue) ? `"${protectedValue.replace(/"/g, '""')}"` : protectedValue;
}

function ExactRows({
  result,
  copyValue,
  copiedKey,
  keyPrefix,
}: {
  result: SuccessfulConversion;
  copyValue: (value: string, key: string, label: string) => void;
  copiedKey: string | null;
  keyPrefix: string;
}) {
  return (
    <dl className="epoch-exact-list">
      {exactFields.map(({ key, label }) => {
        const copyKey = `${keyPrefix}-${key}`;
        return (
          <div className="epoch-exact-row" key={key}>
            <dt>{label}</dt>
            <dd className="epoch-mono" title={result[key]}>{result[key]}</dd>
            <button
              type="button"
              className="epoch-copy-button"
              onClick={() => copyValue(result[key], copyKey, `${label} timestamp`)}
              aria-label={`Copy ${label.toLowerCase()} timestamp`}
            >
              {copiedKey === copyKey ? 'Copied' : 'Copy'}
            </button>
          </div>
        );
      })}
    </dl>
  );
}

function TimestampResults({
  result,
  copyValue,
  copiedKey,
}: {
  result: SuccessfulConversion;
  copyValue: (value: string, key: string, label: string) => void;
  copiedKey: string | null;
}) {
  const dates = [
    { key: 'iso', label: 'ISO 8601', value: result.iso },
    { key: 'utc', label: 'UTC', value: result.utc },
    { key: 'local', label: 'Your local time', value: result.local },
    { key: 'rfc', label: 'JavaScript UTC string', value: result.rfc },
  ] as const;

  return (
    <div className="epoch-result-content">
      <div className="epoch-date-grid">
        <article className="epoch-output-card primary-output">
          <div><span>Relative time</span><code>{result.relative}</code></div>
          <button type="button" className="epoch-copy-button" onClick={() => copyValue(result.relative, 'relative', 'Relative time')} aria-label="Copy relative time">
            {copiedKey === 'relative' ? 'Copied' : 'Copy'}
          </button>
        </article>
        {dates.map((item) => (
          <article className="epoch-output-card" key={item.key}>
            <div><span>{item.label}</span><code>{item.value}</code></div>
            <button
              type="button"
              className="epoch-copy-button"
              onClick={() => copyValue(item.value, item.key, item.label)}
              aria-label={`Copy ${item.label}`}
            >
              {copiedKey === item.key ? 'Copied' : 'Copy'}
            </button>
          </article>
        ))}
      </div>
      <section className="epoch-exact-block" aria-labelledby="epoch-exact-title">
        <div className="epoch-exact-heading">
          <strong id="epoch-exact-title">Exact Unix values</strong>
          <small>Integer math preserves sub-millisecond digits instead of rounding them through JavaScript numbers.</small>
        </div>
        <ExactRows result={result} copyValue={copyValue} copiedKey={copiedKey} keyPrefix="timestamp" />
      </section>
    </div>
  );
}

function UnixTimestampApp() {
  const initialNow = useRef(Date.now());
  const [nowMs, setNowMs] = useState(initialNow.current);
  const [timestamp, setTimestamp] = useState(() => String(Math.floor(initialNow.current / 1_000)));
  const [unit, setUnit] = useState<EpochUnit>('auto');
  const [dateInput, setDateInput] = useState(() => dateTimeInputValue(new Date(initialNow.current), 'local'));
  const [dateInterpretation, setDateInterpretation] = useState<DateInterpretation>('local');
  const [batchInput, setBatchInput] = useState(BATCH_SAMPLE);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activity, setActivity] = useState('Ready. Every conversion stays in this browser tab.');
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const timestampResult = useMemo<EpochConversionResult | null>(() => {
    if (!timestamp.trim()) return null;
    // nowMs refreshes human-readable relative time even while the timestamp itself is unchanged.
    void nowMs;
    return parseEpoch(timestamp, unit);
  }, [timestamp, unit, nowMs]);

  const dateConversion = useMemo<{ result: EpochConversionResult | null; warning: string | null }>(() => {
    if (!dateInput) return { result: null, warning: null };
    const parsed = new Date(dateInterpretation === 'utc' ? `${dateInput}Z` : dateInput);
    return {
      result: dateToEpoch(parsed),
      warning: dateInterpretation === 'local' ? localDateWarning(dateInput, parsed) : null,
    };
  }, [dateInput, dateInterpretation]);
  const dateResult = dateConversion.result;

  const batch = useMemo(() => {
    const allLines = batchInput.split(/\r?\n/)
      .map((value, index) => ({ line: index + 1, value: value.trim() }))
      .filter((item) => item.value.length > 0);
    return {
      total: allLines.length,
      skipped: Math.max(0, allLines.length - MAX_BATCH_LINES),
      rows: allLines.slice(0, MAX_BATCH_LINES).map((item) => ({ ...item, result: parseEpoch(item.value, 'auto') })),
    };
  }, [batchInput]);

  const copyValue = async (value: string, key: string, label: string) => {
    try {
      await copyText(value);
      setCopiedKey(key);
      setActivity(`${label} copied to the clipboard.`);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1_600);
    } catch {
      setActivity('Clipboard access failed. Select the value and copy it manually.');
    }
  };

  const useCurrentTimestamp = () => {
    const current = Date.now();
    setNowMs(current);
    setUnit('seconds');
    setTimestamp(String(Math.floor(current / 1_000)));
    setActivity('Loaded the current Unix timestamp in seconds.');
  };

  const useSample = () => {
    setTimestamp(SAMPLE_TIMESTAMP);
    setUnit('auto');
    setActivity('Loaded a microsecond sample for automatic unit detection.');
  };

  const clearTimestamp = () => {
    setTimestamp('');
    setActivity('Timestamp cleared. Paste a value to convert.');
  };

  const useCurrentDate = () => {
    setDateInput(dateTimeInputValue(new Date(), dateInterpretation));
    setActivity(`Loaded the current ${dateInterpretation === 'utc' ? 'UTC' : 'local'} date and time.`);
  };

  const copyBatchCsv = () => {
    const header = ['line', 'input', 'detected_unit', 'utc', 'seconds', 'milliseconds', 'microseconds', 'nanoseconds', 'error'];
    const rows = batch.rows.map((row) => row.result.ok
      ? [
        String(row.line), row.value, row.result.detectedUnit, row.result.utc,
        row.result.seconds, row.result.milliseconds, row.result.microseconds, row.result.nanoseconds, '',
      ]
      : [String(row.line), row.value, '', '', '', '', '', '', row.result.error]);
    void copyValue([header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n'), 'batch-csv', 'Batch CSV');
  };

  return (
    <section className="epoch-app" aria-label="Unix timestamp converter">
      <header className="epoch-toolbar">
        <div className="epoch-local-badge">
          <span aria-hidden="true" />
          <div><strong>Private, local conversion</strong><small>Timestamps and dates never leave this browser tab</small></div>
        </div>
        <div className="epoch-live-clock" aria-label="Current Unix timestamp">
          <span>Unix now</span>
          <code>{Math.floor(nowMs / 1_000)}</code>
        </div>
      </header>

      <div className="epoch-primary">
        <section className="epoch-panel epoch-input-panel" aria-labelledby="epoch-input-title">
          <div className="epoch-panel-heading">
            <div>
              <p>Timestamp → date</p>
              <h2 id="epoch-input-title">Enter an epoch timestamp</h2>
              <small>Use automatic detection or specify seconds, milliseconds, microseconds, or nanoseconds.</small>
            </div>
          </div>
          <div className="epoch-input-body">
            <label className="epoch-field">
              <span>Unix timestamp</span>
              <input
                className="epoch-text-input epoch-mono"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={timestamp}
                onChange={(event) => setTimestamp(event.target.value)}
                maxLength={MAX_EPOCH_INPUT_CHARACTERS}
                placeholder="e.g. 1754265600123"
                aria-describedby="epoch-input-help"
              />
              <small id="epoch-input-help">Signed integers are accepted for every unit. Seconds may include up to nine decimal places.</small>
            </label>

            <fieldset className="epoch-fieldset">
              <legend>Input unit</legend>
              <div className="epoch-unit-choices">
                {unitOptions.map((option) => (
                  <label className="epoch-unit-option" key={option.value} title={option.label}>
                    <input type="radio" name="epoch-unit" value={option.value} checked={unit === option.value} onChange={() => setUnit(option.value)} aria-label={option.label} />
                    <span>{option.short}</span>
                  </label>
                ))}
              </div>
              <small>Auto uses digit length as a practical heuristic. Choose a unit when historical or far-future values are ambiguous.</small>
            </fieldset>

            {timestampResult?.ok && timestampResult.warning && (
              <p className="epoch-message warning" role="note"><strong>Check:</strong>{timestampResult.warning}</p>
            )}
            {timestampResult && !timestampResult.ok && (
              <p className="epoch-message error" role="alert"><strong>Cannot convert:</strong>{timestampResult.error}</p>
            )}

            <div className="epoch-input-actions">
              <button type="button" className="epoch-button primary" onClick={useCurrentTimestamp}>Use now</button>
              <button type="button" className="epoch-button" onClick={useSample}>Load sample</button>
              <button type="button" className="epoch-button danger" onClick={clearTimestamp} disabled={!timestamp}>Clear</button>
            </div>
          </div>
        </section>

        <section className="epoch-panel epoch-result-panel" aria-labelledby="epoch-result-title">
          <p className="visually-hidden" aria-live="polite">
            {!timestampResult ? '' : timestampResult.ok ? `Converted as ${unitLabels[timestampResult.detectedUnit]}: ${timestampResult.iso}` : `Conversion error: ${timestampResult.error}`}
          </p>
          <div className="epoch-result-heading">
            <div><p>Conversion result</p><h2 id="epoch-result-title">Readable date and exact units</h2></div>
            {timestampResult?.ok && (
              <div className="epoch-detected-unit"><span>{unit === 'auto' ? 'Detected unit' : 'Input unit'}</span><strong>{unitLabels[timestampResult.detectedUnit]}</strong></div>
            )}
          </div>
          {!timestampResult ? (
            <div className="epoch-empty"><span aria-hidden="true">t</span><strong>Paste a timestamp to begin</strong><p>The readable UTC, local, ISO, JavaScript UTC, and exact Unix values will appear here.</p></div>
          ) : timestampResult.ok ? (
            <TimestampResults result={timestampResult} copyValue={copyValue} copiedKey={copiedKey} />
          ) : (
            <div className="epoch-empty error"><span aria-hidden="true">!</span><strong>That timestamp is not valid</strong><p>{timestampResult.error}</p></div>
          )}
        </section>
      </div>

      <div className="epoch-secondary">
        <section className="epoch-panel" aria-labelledby="date-to-epoch-title">
          <div className="epoch-panel-heading">
            <div>
              <p>Date → timestamp</p>
              <h2 id="date-to-epoch-title">Convert a date to Unix time</h2>
              <small>Interpret the entered wall-clock time in your current local timezone or as UTC.</small>
            </div>
          </div>
          <div className="epoch-date-body">
            <div className="epoch-date-settings">
              <label className="epoch-field">
                <span>Date and time</span>
                <input className="epoch-date-input" type="datetime-local" step="1" value={dateInput} onChange={(event) => setDateInput(event.target.value)} />
              </label>
              <label className="epoch-select-field">
                <span>Interpret as</span>
                <select className="epoch-unit-select" value={dateInterpretation} onChange={(event) => setDateInterpretation(event.target.value as DateInterpretation)}>
                  <option value="local">My local time</option>
                  <option value="utc">UTC</option>
                </select>
              </label>
            </div>
            <div className="epoch-input-actions">
              <button type="button" className="epoch-button" onClick={useCurrentDate}>Use current date</button>
              <button type="button" className="epoch-button danger" onClick={() => setDateInput('')} disabled={!dateInput}>Clear</button>
            </div>
            <p className="epoch-message" role="note"><strong>Timezone note:</strong>Local mode follows this browser’s timezone and daylight-saving rules. Choose UTC for a zone-independent value.</p>
            {dateConversion.warning && <p className="epoch-message warning" role="alert"><strong>DST warning:</strong>{dateConversion.warning}</p>}
            {dateResult?.ok ? (
              <div className="epoch-date-output">
                <ExactRows result={dateResult} copyValue={copyValue} copiedKey={copiedKey} keyPrefix="date" />
              </div>
            ) : dateResult ? (
              <p className="epoch-message error" role="alert"><strong>Cannot convert:</strong>{dateResult.error}</p>
            ) : (
              <p className="epoch-message">Choose a date and time to generate exact Unix values.</p>
            )}
          </div>
        </section>

        <section className="epoch-panel" aria-labelledby="epoch-batch-title">
          <div className="epoch-panel-heading">
            <div>
              <p>Mixed-unit batch</p>
              <h2 id="epoch-batch-title">Convert one timestamp per line</h2>
              <small>Each line is detected independently, so seconds, milliseconds, microseconds, and nanoseconds can be mixed.</small>
            </div>
          </div>
          <div className="epoch-batch-body">
            <label className="epoch-field">
              <span>Timestamp lines</span>
              <textarea
                className="epoch-batch-input"
                value={batchInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setBatchInput(value.slice(0, MAX_BATCH_CHARACTERS));
                  if (value.length > MAX_BATCH_CHARACTERS) setActivity(`Batch input is limited to ${MAX_BATCH_CHARACTERS.toLocaleString()} characters.`);
                }}
                maxLength={MAX_BATCH_CHARACTERS}
                placeholder={'1754265600\n1754265600123'}
                spellCheck={false}
                aria-describedby="epoch-batch-help"
              />
              <small id="epoch-batch-help">Up to {MAX_BATCH_LINES} non-empty lines and {MAX_BATCH_CHARACTERS.toLocaleString()} characters are accepted in one pass.</small>
            </label>
            <div className="epoch-batch-actions">
              <span>{batch.total.toLocaleString()} non-empty line{batch.total === 1 ? '' : 's'}{batch.skipped > 0 ? ` · ${batch.skipped.toLocaleString()} beyond the limit not shown` : ''}</span>
              <div className="epoch-input-actions">
                <button type="button" className="epoch-button" onClick={() => setBatchInput(BATCH_SAMPLE)}>Load sample</button>
                <button type="button" className="epoch-button" onClick={copyBatchCsv} disabled={batch.rows.length === 0}>{copiedKey === 'batch-csv' ? 'CSV copied' : 'Copy CSV'}</button>
                <button type="button" className="epoch-button danger" onClick={() => setBatchInput('')} disabled={!batchInput}>Clear</button>
              </div>
            </div>
            {batch.rows.length > 0 ? (
              <div className="epoch-batch-table-wrap">
                <table className="epoch-batch-table">
                  <thead><tr><th scope="col">Line</th><th scope="col">Input</th><th scope="col">Unit</th><th scope="col">UTC date</th><th scope="col">Seconds</th></tr></thead>
                  <tbody>
                    {batch.rows.map((row) => (
                      <tr key={`${row.line}-${row.value}`}>
                        <td>{row.line}</td>
                        <td><code title={row.value}>{row.value}</code></td>
                        {row.result.ok ? (
                          <><td>{unitLabels[row.result.detectedUnit]}</td><td><code title={row.result.utc}>{row.result.utc}</code></td><td><code title={row.result.seconds}>{row.result.seconds}</code></td></>
                        ) : (
                          <td className="epoch-batch-error" colSpan={3}>{row.result.error}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="epoch-batch-empty">Add one timestamp per line to build a mixed-unit result table.</p>
            )}
          </div>
        </section>
      </div>

      <p className="epoch-privacy-note" aria-live="polite"><strong>Local-only:</strong><span>{activity}</span></p>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><UnixTimestampApp /></React.StrictMode>);
