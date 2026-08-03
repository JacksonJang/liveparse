import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  allDiscordTimestampCodes,
  dateTimeInputForZone,
  DISCORD_STYLE_DEFINITIONS,
  discordTimestampCode,
  discordTimestampPreview,
  MAX_DISCORD_INPUT_CHARACTERS,
  parseDiscordTimestampInput,
  parseWallClockInput,
  resolveWallClock,
  timeZoneOffsetLabel,
  type DiscordTimestampStyle,
} from './lib/discord-timestamp';
import './styles.css';
import './discord-timestamp.css';

const PREVIEW_LOCALES = [
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['de-DE', 'Deutsch'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['pt-BR', 'Português (Brasil)'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
] as const;

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function supportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  if (typeof intl.supportedValuesOf === 'function') return intl.supportedValuesOf('timeZone');
  return [
    'Africa/Johannesburg', 'America/Chicago', 'America/Los_Angeles', 'America/New_York',
    'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Seoul', 'Asia/Shanghai',
    'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/Berlin', 'Europe/London',
    'Europe/Paris', 'Pacific/Auckland',
  ];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers deny clipboard access outside a trusted user gesture.
    }
  }
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.readOnly = true;
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Copy command rejected');
}

function calendarPreset(timeZone: string, kind: 'tomorrow' | 'monday'): string {
  const current = parseWallClockInput(dateTimeInputForZone(Date.now(), timeZone));
  if (!current) throw new Error('Unable to read the current date');
  const calendar = new Date(0);
  calendar.setUTCFullYear(current.year, current.month - 1, current.day);
  calendar.setUTCHours(0, 0, 0, 0);
  const addDays = kind === 'tomorrow' ? 1 : ((8 - calendar.getUTCDay()) % 7 || 7);
  calendar.setUTCDate(calendar.getUTCDate() + addDays);
  return `${String(calendar.getUTCFullYear()).padStart(4, '0')}-${pad(calendar.getUTCMonth() + 1)}-${pad(calendar.getUTCDate())}T09:00:00`;
}

function App() {
  const initialSeconds = useRef(Math.floor(Date.now() / 1_000));
  const localZone = useMemo(browserTimeZone, []);
  const timeZones = useMemo(supportedTimeZones, []);
  const [sourceZoneChoice, setSourceZoneChoice] = useState('local');
  const sourceZone = sourceZoneChoice === 'local' ? localZone : sourceZoneChoice;
  const [previewZoneChoice, setPreviewZoneChoice] = useState('local');
  const previewZone = previewZoneChoice === 'local' ? localZone : previewZoneChoice === 'source' ? sourceZone : previewZoneChoice;
  const [previewLocale, setPreviewLocale] = useState(() => {
    const browserLocale = navigator.language || 'en-US';
    return PREVIEW_LOCALES.some(([value]) => value === browserLocale) ? browserLocale : 'en-US';
  });
  const [seconds, setSeconds] = useState(initialSeconds.current);
  const [dateInput, setDateInput] = useState(() => dateTimeInputForZone(initialSeconds.current * 1_000, localZone));
  const [dateOrigin, setDateOrigin] = useState<'instant' | 'wall'>('instant');
  const [dateIsValid, setDateIsValid] = useState(true);
  const [decodeInput, setDecodeInput] = useState(() => discordTimestampCode(String(initialSeconds.current), 'F'));
  const [activeStyle, setActiveStyle] = useState<DiscordTimestampStyle>('F');
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<number[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activity, setActivity] = useState('Ready. Date and timestamp processing stays in this browser tab.');
  const [nowMilliseconds, setNowMilliseconds] = useState(Date.now());
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMilliseconds(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const decoded = useMemo(() => parseDiscordTimestampInput(decodeInput), [decodeInput]);
  const codes = useMemo(() => allDiscordTimestampCodes(String(seconds)), [seconds]);
  const selectedCode = codes[activeStyle];
  const sourceOffset = useMemo(() => {
    try {
      return timeZoneOffsetLabel(seconds * 1_000, sourceZone);
    } catch {
      return 'UTC offset unavailable';
    }
  }, [seconds, sourceZone]);

  const setInstant = (nextSeconds: number, style?: DiscordTimestampStyle, label = 'Timestamp updated.') => {
    if (!Number.isSafeInteger(nextSeconds)) {
      setActivity('That timestamp cannot be represented safely in this browser.');
      return;
    }
    setSeconds(nextSeconds);
    setDecodeInput(String(nextSeconds));
    let nextDateError: string | null = null;
    try {
      setDateInput(dateTimeInputForZone(nextSeconds * 1_000, sourceZone));
    } catch {
      nextDateError = 'The selected timezone could not format this instant.';
    }
    if (style) setActiveStyle(style);
    setDateError(nextDateError);
    setDateOrigin('instant');
    setDateIsValid(nextDateError === null);
    setAmbiguousCandidates([]);
    setActivity(label);
  };

  const applyWallClock = (value: string, timeZone: string) => {
    const resolution = resolveWallClock(value, timeZone);
    if (!resolution.ok) {
      setDateError(resolution.error);
      setAmbiguousCandidates([]);
      setDateIsValid(false);
      return;
    }
    const candidateSeconds = resolution.candidates.map((value) => Math.floor(value / 1_000));
    setAmbiguousCandidates(candidateSeconds);
    setSeconds(candidateSeconds[0]);
    setDecodeInput(String(candidateSeconds[0]));
    setDateError(resolution.warning);
    setDateIsValid(true);
    setActivity(resolution.warning ? 'The earlier occurrence is selected. Choose later if needed.' : `Converted the wall-clock time in ${timeZone}.`);
  };

  const resolveDateInput = (value: string) => {
    setDateInput(value);
    setDateOrigin('wall');
    applyWallClock(value, sourceZone);
  };

  const changeSourceZone = (nextChoice: string) => {
    const nextZone = nextChoice === 'local' ? localZone : nextChoice;
    setSourceZoneChoice(nextChoice);
    if (dateOrigin === 'wall') {
      applyWallClock(dateInput, nextZone);
      return;
    }
    try {
      setDateInput(dateTimeInputForZone(seconds * 1_000, nextZone));
      setDateError(null);
      setDateIsValid(true);
      setAmbiguousCandidates([]);
      setActivity(`Showing the selected instant in ${nextZone}.`);
    } catch {
      setDateError('The selected timezone could not format this instant.');
      setDateIsValid(false);
      setAmbiguousCandidates([]);
    }
  };

  const applyDecoded = (mode: 'input' | 'suggestion' | 'force' = 'input') => {
    const suggested = mode === 'suggestion';
    if (suggested) {
      const suggestedSeconds = decoded.suggestedSeconds;
      if (!suggestedSeconds) return;
      const parsedSuggestion = parseDiscordTimestampInput(suggestedSeconds);
      if (!parsedSuggestion.ok) return;
      setInstant(parsedSuggestion.milliseconds / 1_000, decoded.ok ? decoded.style : activeStyle, `Converted the likely ${decoded.suggestedUnit} value to Discord Unix seconds.`);
      return;
    }
    if (!decoded.ok) return;
    if (mode !== 'force' && decoded.warning && decoded.suggestedSeconds) {
      setActivity('Review the unit warning or use the suggested seconds conversion.');
      return;
    }
    setInstant(decoded.milliseconds / 1_000, decoded.style, decoded.source === 'tag' ? 'Decoded the Discord timestamp tag.' : 'Loaded the Unix seconds value.');
  };

  const applyRelativePreset = (offsetSeconds: number, label: string) => {
    setInstant(Math.floor(Date.now() / 1_000) + offsetSeconds, activeStyle, label);
  };

  const applyCalendarPreset = (kind: 'tomorrow' | 'monday') => {
    try {
      resolveDateInput(calendarPreset(sourceZone, kind));
    } catch {
      setDateError('The calendar preset could not be generated in this timezone.');
    }
  };

  const selectAmbiguousCandidate = (candidate: number, label: string) => {
    setSeconds(candidate);
    setDecodeInput(String(candidate));
    setDateIsValid(true);
    setActivity(`${label} daylight-saving occurrence selected.`);
  };

  const copyValue = async (value: string, key: string, label: string) => {
    try {
      await copyText(value);
      setCopiedKey(key);
      setActivity(`${label} copied.`);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1_700);
    } catch {
      setActivity('Clipboard access failed. Select the code and copy it manually.');
    }
  };

  const allCodesText = DISCORD_STYLE_DEFINITIONS
    .map(({ style, name }) => `${style} — ${name}: ${codes[style]}`)
    .join('\n');
  const templates = [
    { key: 'event', label: 'Event', text: `Event starts ${codes.F} (${codes.R}).` },
    { key: 'deadline', label: 'Deadline', text: `Deadline: ${codes.F} — ${codes.R}.` },
    { key: 'release', label: 'Release', text: `Going live ${codes.R} at ${codes.F}.` },
    { key: 'maintenance', label: 'Maintenance', text: `Maintenance begins ${codes.F} (${codes.R}).` },
  ];

  return (
    <section className="discord-app" aria-label="Discord timestamp generator">
      <header className="discord-toolbar">
        <div className="discord-local-badge">
          <span aria-hidden="true" />
          <div><strong>Local-only generator</strong><small>No date, timezone, or message text is uploaded</small></div>
        </div>
        <div className="discord-now" aria-label="Current Unix seconds"><span>Unix now</span><code>{Math.floor(nowMilliseconds / 1_000)}</code></div>
      </header>

      <div className="discord-builder">
        <section className="discord-panel discord-input-panel" aria-labelledby="discord-date-heading">
          <div className="discord-panel-heading">
            <div><p>Choose an instant</p><h2 id="discord-date-heading">Date, time, and source timezone</h2></div>
            <span className="discord-offset">{sourceOffset}</span>
          </div>
          <div className="discord-panel-body">
            <label className="discord-field">
              <span>Date and time</span>
              <input type="datetime-local" step="1" value={dateInput} onChange={(event) => resolveDateInput(event.target.value)} />
            </label>
            <label className="discord-field">
              <span>Source timezone</span>
              <select value={sourceZoneChoice} onChange={(event) => changeSourceZone(event.target.value)}>
                <option value="local">My browser — {localZone}</option>
                <option value="UTC">UTC</option>
                <optgroup label="IANA timezones">
                  {timeZones.filter((zone) => zone !== localZone).map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                </optgroup>
              </select>
            </label>
            <div className="discord-presets" aria-label="Quick date presets">
              <button type="button" onClick={() => applyRelativePreset(0, 'Loaded the current time.')}>Now</button>
              <button type="button" onClick={() => applyRelativePreset(300, 'Loaded five minutes from now.')}>+5 min</button>
              <button type="button" onClick={() => applyRelativePreset(1_800, 'Loaded thirty minutes from now.')}>+30 min</button>
              <button type="button" onClick={() => applyRelativePreset(3_600, 'Loaded one hour from now.')}>+1 hour</button>
              <button type="button" onClick={() => applyCalendarPreset('tomorrow')}>Tomorrow 09:00</button>
              <button type="button" onClick={() => applyCalendarPreset('monday')}>Next Monday</button>
            </div>
            {dateError && <p className={ambiguousCandidates.length > 1 ? 'discord-notice warning' : 'discord-notice error'} role={ambiguousCandidates.length > 1 ? 'note' : 'alert'}>{dateError}</p>}
            {ambiguousCandidates.length > 1 && (
              <div className="discord-ambiguity" aria-label="Choose daylight-saving occurrence">
                <button type="button" onClick={() => selectAmbiguousCandidate(ambiguousCandidates[0], 'Earlier')}>Use earlier · {new Date(ambiguousCandidates[0] * 1_000).toISOString()}</button>
                <button type="button" onClick={() => selectAmbiguousCandidate(ambiguousCandidates[ambiguousCandidates.length - 1], 'Later')}>Use later · {new Date(ambiguousCandidates[ambiguousCandidates.length - 1] * 1_000).toISOString()}</button>
              </div>
            )}
          </div>
        </section>

        <section className="discord-panel discord-decode-panel" aria-labelledby="discord-decode-heading">
          <div className="discord-panel-heading"><div><p>Paste or decode</p><h2 id="discord-decode-heading">Unix seconds or an existing tag</h2></div></div>
          <div className="discord-panel-body">
            <label className="discord-field">
              <span>Timestamp input</span>
              <input
                className="discord-mono"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAX_DISCORD_INPUT_CHARACTERS}
                value={decodeInput}
                onChange={(event) => setDecodeInput(event.target.value)}
                placeholder="<t:1754208000:F> or 1754208000"
                aria-describedby="discord-decode-help"
              />
              <small id="discord-decode-help">Accepts whole Unix seconds or <code>&lt;t:UNIX_SECONDS:STYLE&gt;</code>.</small>
            </label>
            {decoded.ok && (
              <div className="discord-decoded">
                <span>{decoded.source === 'tag' ? `Style ${decoded.style}` : 'Unix seconds'}</span>
                <strong>{new Date(decoded.milliseconds).toISOString()}</strong>
              </div>
            )}
            {(decoded.ok ? decoded.warning : decoded.error) && (
              <p className={decoded.ok ? 'discord-notice warning' : 'discord-notice error'} role={decoded.ok ? 'note' : 'alert'}>
                {decoded.ok ? decoded.warning : decoded.error}
              </p>
            )}
            <div className="discord-action-row">
              <button type="button" className="discord-button primary" onClick={() => applyDecoded('input')} disabled={!decoded.ok || Boolean(decoded.ok && decoded.warning)}>Use timestamp</button>
              {decoded.suggestedSeconds && (
                <button type="button" className="discord-button" onClick={() => applyDecoded('suggestion')}>Use as {decoded.suggestedUnit}</button>
              )}
              {decoded.ok && decoded.warning && <button type="button" className="discord-button" onClick={() => applyDecoded('force')}>Use as seconds anyway</button>}
            </div>
            <p className="discord-seconds-output"><span>{dateIsValid ? 'Selected Unix seconds' : 'Last valid Unix seconds'}</span><code>{seconds}</code><button type="button" disabled={!dateIsValid} onClick={() => copyValue(String(seconds), 'seconds', 'Unix seconds')}>{copiedKey === 'seconds' ? 'Copied' : 'Copy'}</button></p>
          </div>
        </section>
      </div>

      <section className="discord-formats" aria-labelledby="discord-formats-heading">
        <div className="discord-formats-heading">
          <div><p>Current documented set</p><h2 id="discord-formats-heading">All 9 Discord timestamp formats</h2><small>Choose a card to make it the selected format. Every code is ready to paste.</small></div>
          <div className="discord-preview-settings">
            <label><span>Preview timezone</span><select value={previewZoneChoice} onChange={(event) => setPreviewZoneChoice(event.target.value)}><option value="local">My browser — {localZone}</option><option value="source">Source — {sourceZone}</option><option value="UTC">UTC</option></select></label>
            <label><span>Preview locale</span><select value={previewLocale} onChange={(event) => setPreviewLocale(event.target.value)}>{PREVIEW_LOCALES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </div>
        <p className={dateIsValid ? 'discord-preview-note' : 'discord-preview-note invalid'} role={dateIsValid ? undefined : 'alert'}>{dateIsValid ? 'These are browser approximations. Discord controls the final wording and renders the same timestamp for each viewer’s locale, timezone, and time-format settings.' : 'Fix the date or timezone error before copying. The cards below show the last valid instant and all output copy controls are paused.'}</p>
        <div className="discord-format-grid">
          {DISCORD_STYLE_DEFINITIONS.map(({ style, name, description }) => {
            const selected = activeStyle === style;
            return (
              <article className={selected ? 'discord-format-card selected' : 'discord-format-card'} key={style}>
                <button type="button" className="discord-card-select" onClick={() => setActiveStyle(style)} aria-pressed={selected}>
                  <span className="discord-style-token">:{style}</span>
                  <span><strong>{name}</strong><small>{description}</small></span>
                  {style === 'f' && <em>Default</em>}
                </button>
                <p className="discord-rendered">{discordTimestampPreview(seconds * 1_000, style, previewLocale, previewZone, nowMilliseconds)}</p>
                <div className="discord-code-row"><code>{codes[style]}</code><button type="button" disabled={!dateIsValid} onClick={() => copyValue(codes[style], `style-${style}`, `${name} code`)}>{copiedKey === `style-${style}` ? 'Copied' : 'Copy'}</button></div>
              </article>
            );
          })}
        </div>
        <div className="discord-format-actions">
          <button type="button" className="discord-button primary" disabled={!dateIsValid} onClick={() => copyValue(selectedCode, 'selected', `${activeStyle} timestamp code`)}>{copiedKey === 'selected' ? 'Selected code copied' : `Copy selected :${activeStyle}`}</button>
          <button type="button" className="discord-button" disabled={!dateIsValid} onClick={() => copyValue(discordTimestampCode(String(seconds)), 'default', 'Default timestamp code')}>{copiedKey === 'default' ? 'Default code copied' : 'Copy default tag (no :f)'}</button>
          <button type="button" className="discord-button" disabled={!dateIsValid} onClick={() => copyValue(allCodesText, 'all', 'All nine timestamp codes')}>{copiedKey === 'all' ? 'All codes copied' : 'Copy all 9 formats'}</button>
        </div>
      </section>

      <section className="discord-composer" aria-labelledby="discord-composer-heading">
        <div className="discord-panel-heading"><div><p>Ready-made messages</p><h2 id="discord-composer-heading">Copy a full date plus relative countdown</h2><small>Pairing <code>:F</code> with <code>:R</code> gives readers both a calendar anchor and relative context.</small></div></div>
        <div className="discord-template-grid">
          {templates.map((template) => (
            <article key={template.key}><span>{template.label}</span><code>{template.text}</code><button type="button" disabled={!dateIsValid} onClick={() => copyValue(template.text, `template-${template.key}`, `${template.label} message`)}>{copiedKey === `template-${template.key}` ? 'Copied' : 'Copy message'}</button></article>
          ))}
        </div>
      </section>

      <p className="discord-activity" aria-live="polite"><strong>Generator status:</strong><span>{activity}</span></p>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
