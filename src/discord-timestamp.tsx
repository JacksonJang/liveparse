import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MAX_BULK_DISCORD_LINES,
  allDiscordTimestampCodes,
  dateTimeInputForZone,
  decodeDiscordSnowflake,
  DISCORD_STYLE_DEFINITIONS,
  discordTimestampCode,
  discordTimestampPreview,
  isValidTimeZone,
  parseBulkDiscordTimestamps,
  MAX_DISCORD_INPUT_CHARACTERS,
  parseDiscordTimestampInput,
  parseWallClockInput,
  resolveWallClock,
  timeZoneOffsetLabel,
  type DiscordTimestampStyle,
} from './lib/discord-timestamp';
import {
  discordUiLocaleFromBody,
  localizedDiscordStyleDefinitions,
  localizedDiscordUnitLabel,
  localizeDiscordDiagnostic,
  type DiscordUiLocale,
} from './lib/discord-timestamp-i18n';
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

const COMMON_TIME_ZONES = [
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Sydney',
];

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
  const uiLocale: DiscordUiLocale = discordUiLocaleFromBody(document.body?.dataset.uiLocale);
  const isSpanish = uiLocale === 'es';
  const localizedStyles = localizedDiscordStyleDefinitions(uiLocale);
  const pick = (english: string, spanish: string) => (isSpanish ? spanish : english);
  const initialSeconds = useRef(Math.floor(Date.now() / 1_000));
  const localZone = useMemo(browserTimeZone, []);
  const timeZones = useMemo(supportedTimeZones, []);
  const commonZones = useMemo(
    () => COMMON_TIME_ZONES.filter((zone) => isValidTimeZone(zone)),
    [],
  );
  const commonZoneSet = useMemo(() => new Set(commonZones), [commonZones]);
  const otherTimeZones = useMemo(
    () => timeZones.filter((zone) => zone !== localZone && !commonZoneSet.has(zone)),
    [commonZoneSet, localZone, timeZones],
  );
  const [sourceZoneChoice, setSourceZoneChoice] = useState('local');
  const sourceZone = sourceZoneChoice === 'local' ? localZone : sourceZoneChoice;
  const [previewZoneChoice, setPreviewZoneChoice] = useState('local');
  const previewZone = previewZoneChoice === 'local' ? localZone : previewZoneChoice === 'source' ? sourceZone : previewZoneChoice;
  const [previewLocale, setPreviewLocale] = useState(() => {
    const browserLocale = navigator.language || (isSpanish ? 'es-ES' : 'en-US');
    return PREVIEW_LOCALES.some(([value]) => value === browserLocale) ? browserLocale : 'en-US';
  });
  const [seconds, setSeconds] = useState(initialSeconds.current);
  const [dateInput, setDateInput] = useState(() => dateTimeInputForZone(initialSeconds.current * 1_000, localZone));
  const [dateOrigin, setDateOrigin] = useState<'instant' | 'wall'>('instant');
  const [dateIsValid, setDateIsValid] = useState(true);
  const [decodeInput, setDecodeInput] = useState(() => discordTimestampCode(String(initialSeconds.current), 'F'));
  const [snowflakeInput, setSnowflakeInput] = useState('');
  const [activeStyle, setActiveStyle] = useState<DiscordTimestampStyle>('F');
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<number[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);
  const [bulkInput, setBulkInput] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activity, setActivity] = useState(() => pick(
    'Ready. Date and timestamp processing stays in this browser tab.',
    'Listo. El procesamiento de fecha y timestamp permanece en esta pestaña del navegador.',
  ));
  const [nowMilliseconds, setNowMilliseconds] = useState(Date.now());
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMilliseconds(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const decoded = useMemo(() => {
    const result = parseDiscordTimestampInput(decodeInput);
    return result.ok
      ? { ...result, warning: localizeDiscordDiagnostic(result.warning, uiLocale) }
      : { ...result, error: localizeDiscordDiagnostic(result.error, uiLocale) };
  }, [decodeInput, uiLocale]);
  const decodedSnowflake = useMemo(() => {
    const result = decodeDiscordSnowflake(snowflakeInput);
    return result.ok ? result : { ...result, error: localizeDiscordDiagnostic(result.error, uiLocale) };
  }, [snowflakeInput, uiLocale]);
  const codes = useMemo(() => allDiscordTimestampCodes(String(seconds)), [seconds]);
  const bulk = useMemo(() => parseBulkDiscordTimestamps(bulkInput, sourceZone), [bulkInput, sourceZone]);
  const bulkEntries = bulk.ok
    ? bulk.entries.map((entry) => entry.ok
      ? { ...entry, warning: localizeDiscordDiagnostic(entry.warning, uiLocale) }
      : { ...entry, error: localizeDiscordDiagnostic(entry.error, uiLocale) })
    : [];
  const validBulkEntries = bulkEntries.filter((entry) => entry.ok);
  const bulkHasErrors = !bulk.ok || bulkEntries.some((entry) => !entry.ok);
  const bulkSelectedText = validBulkEntries.map((entry) => discordTimestampCode(entry.seconds, activeStyle)).join('\n');
  const bulkAllText = validBulkEntries.map((entry) => [
    `${entry.line}. ${entry.input}`,
    ...localizedStyles.map(({ style, name }) => `${style} — ${name}: ${discordTimestampCode(entry.seconds, style)}`),
  ].join('\n')).join('\n\n');
  const bulkLineNoun = bulkEntries.length === 1 ? pick('line', 'línea') : pick('lines', 'líneas');
  const selectedCode = codes[activeStyle];
  const sourceOffset = useMemo(() => {
    try {
      return timeZoneOffsetLabel(seconds * 1_000, sourceZone);
    } catch {
      return pick('UTC offset unavailable', 'Desfase UTC no disponible');
    }
  }, [isSpanish, seconds, sourceZone]);

  const setInstant = (nextSeconds: number, style?: DiscordTimestampStyle, label = pick('Timestamp updated.', 'Timestamp actualizado.')) => {
    if (!Number.isSafeInteger(nextSeconds)) {
      setActivity(pick('That timestamp cannot be represented safely in this browser.', 'Ese timestamp no puede representarse de forma segura en este navegador.'));
      return;
    }
    setSeconds(nextSeconds);
    setDecodeInput(String(nextSeconds));
    let nextDateError: string | null = null;
    try {
      setDateInput(dateTimeInputForZone(nextSeconds * 1_000, sourceZone));
    } catch {
      nextDateError = pick('The selected timezone could not format this instant.', 'La zona horaria seleccionada no pudo formatear este instante.');
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
      setDateError(localizeDiscordDiagnostic(resolution.error, uiLocale));
      setAmbiguousCandidates([]);
      setDateIsValid(false);
      return;
    }
    const candidateSeconds = resolution.candidates.map((value) => Math.floor(value / 1_000));
    setAmbiguousCandidates(candidateSeconds);
    setSeconds(candidateSeconds[0]);
    setDecodeInput(String(candidateSeconds[0]));
    setDateError(localizeDiscordDiagnostic(resolution.warning, uiLocale));
    setDateIsValid(true);
    setActivity(resolution.warning
      ? pick('The earlier occurrence is selected. Choose later if needed.', 'Se seleccionó la aparición anterior. Elige la posterior si es necesario.')
      : pick(`Converted the wall-clock time in ${timeZone}.`, `Se convirtió la hora local en ${timeZone}.`));
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
      setActivity(pick(`Showing the selected instant in ${nextZone}.`, `Mostrando el instante seleccionado en ${nextZone}.`));
    } catch {
      setDateError(pick('The selected timezone could not format this instant.', 'La zona horaria seleccionada no pudo formatear este instante.'));
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
      setInstant(parsedSuggestion.milliseconds / 1_000, decoded.ok ? decoded.style : activeStyle, pick(
        `Converted the likely ${localizedDiscordUnitLabel(decoded.suggestedUnit, uiLocale)} value to Discord Unix seconds.`,
        `Se convirtió el probable valor en ${localizedDiscordUnitLabel(decoded.suggestedUnit, uiLocale)} a segundos Unix de Discord.`,
      ));
      return;
    }
    if (!decoded.ok) return;
    if (mode !== 'force' && decoded.warning && decoded.suggestedSeconds) {
      setActivity(pick('Review the unit warning or use the suggested seconds conversion.', 'Revisa la advertencia de unidad o usa la conversión sugerida a segundos.'));
      return;
    }
    setInstant(decoded.milliseconds / 1_000, decoded.style, decoded.source === 'tag'
      ? pick('Decoded the Discord timestamp tag.', 'Se decodificó la etiqueta de timestamp de Discord.')
      : pick('Loaded the Unix seconds value.', 'Se cargó el valor en segundos Unix.'));
  };

  const applyRelativePreset = (offsetSeconds: number, label: string) => {
    setInstant(Math.floor(Date.now() / 1_000) + offsetSeconds, activeStyle, label);
  };

  const applyCalendarPreset = (kind: 'tomorrow' | 'monday') => {
    try {
      resolveDateInput(calendarPreset(sourceZone, kind));
    } catch {
      setDateError(pick('The calendar preset could not be generated in this timezone.', 'No se pudo generar el ajuste preestablecido de calendario en esta zona horaria.'));
    }
  };

  const selectAmbiguousCandidate = (candidate: number, label: string) => {
    setSeconds(candidate);
    setDecodeInput(String(candidate));
    setDateIsValid(true);
    setActivity(isSpanish ? `Aparición de horario de verano ${label.toLowerCase()} seleccionada.` : `${label} daylight-saving occurrence selected.`);
  };

  const copyValue = async (value: string, key: string, label: string) => {
    try {
      await copyText(value);
      setCopiedKey(key);
      setActivity(pick(`${label} copied.`, `Se copió: ${label}.`));
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1_700);
    } catch {
      setActivity(pick('Clipboard access failed. Select the code and copy it manually.', 'No se pudo acceder al portapapeles. Selecciona el código y cópialo manualmente.'));
    }
  };

  const allCodesText = localizedStyles
    .map(({ style, name }) => `${style} — ${name}: ${codes[style]}`)
    .join('\n');
  const templates = [
    { key: 'event', label: pick('Event', 'Evento'), text: pick(`Event starts ${codes.F} (${codes.R}).`, `El evento empieza ${codes.F} (${codes.R}).`) },
    { key: 'deadline', label: pick('Deadline', 'Fecha límite'), text: pick(`Deadline: ${codes.F} — ${codes.R}.`, `Fecha límite: ${codes.F} — ${codes.R}.`) },
    { key: 'release', label: pick('Release', 'Lanzamiento'), text: pick(`Going live ${codes.R} at ${codes.F}.`, `Disponible ${codes.R} a las ${codes.F}.`) },
    { key: 'maintenance', label: pick('Maintenance', 'Mantenimiento'), text: pick(`Maintenance begins ${codes.F} (${codes.R}).`, `El mantenimiento empieza ${codes.F} (${codes.R}).`) },
  ];

  return (
    <section className="discord-app" aria-label={pick('Discord timestamp generator', 'Generador de timestamps de Discord')}>
      <header className="discord-toolbar">
        <div className="discord-local-badge">
          <span aria-hidden="true" />
          <div><strong>{pick('Local-only generator', 'Generador solo local')}</strong><small>{pick('No date, timezone, or message text is uploaded', 'No se sube ninguna fecha, zona horaria ni texto del mensaje')}</small></div>
        </div>
        <div className="discord-now" aria-label={pick('Current Unix seconds', 'Segundos Unix actuales')}><span>{pick('Unix now', 'Unix ahora')}</span><code>{Math.floor(nowMilliseconds / 1_000)}</code></div>
      </header>

      <div className="discord-builder">
        <section className="discord-panel discord-input-panel" aria-labelledby="discord-date-heading">
          <div className="discord-panel-heading">
            <div><p>{pick('Choose an instant', 'Elige un instante')}</p><h2 id="discord-date-heading">{pick('Date, time, and source timezone', 'Fecha, hora y zona horaria de origen')}</h2></div>
            <span className="discord-offset">{sourceOffset}</span>
          </div>
          <div className="discord-panel-body">
            <label className="discord-field">
              <span>{pick('Date and time', 'Fecha y hora')}</span>
              <input type="datetime-local" step="1" value={dateInput} onChange={(event) => resolveDateInput(event.target.value)} />
            </label>
            <label className="discord-field">
              <span>{pick('Source timezone', 'Zona horaria de origen')}</span>
              <select value={sourceZoneChoice} onChange={(event) => changeSourceZone(event.target.value)}>
                <option value="local">{pick('My browser', 'Mi navegador')} — {localZone}</option>
                <option value="UTC">UTC</option>
                <optgroup label={pick('Common timezones', 'Zonas horarias comunes')}>
                  {commonZones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                </optgroup>
                <optgroup label={pick('IANA timezones', 'Zonas horarias IANA')}>
                  {otherTimeZones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                </optgroup>
              </select>
            </label>
            <div className="discord-presets" aria-label={pick('Quick date presets', 'Ajustes rápidos de fecha')}>
              <button type="button" onClick={() => applyRelativePreset(0, pick('Loaded the current time.', 'Se cargó la hora actual.'))}>{pick('Now', 'Ahora')}</button>
              <button type="button" onClick={() => applyRelativePreset(300, pick('Loaded five minutes from now.', 'Se cargó dentro de cinco minutos.'))}>+5 min</button>
              <button type="button" onClick={() => applyRelativePreset(1_800, pick('Loaded thirty minutes from now.', 'Se cargó dentro de 30 minutos.'))}>+30 min</button>
              <button type="button" onClick={() => applyRelativePreset(3_600, pick('Loaded one hour from now.', 'Se cargó dentro de una hora.'))}>+1 h</button>
              <button type="button" onClick={() => applyCalendarPreset('tomorrow')}>{pick('Tomorrow 09:00', 'Mañana 09:00')}</button>
              <button type="button" onClick={() => applyCalendarPreset('monday')}>{pick('Next Monday', 'Próximo lunes')}</button>
            </div>
            {dateError && <p className={ambiguousCandidates.length > 1 ? 'discord-notice warning' : 'discord-notice error'} role={ambiguousCandidates.length > 1 ? 'note' : 'alert'}>{dateError}</p>}
            {ambiguousCandidates.length > 1 && (
              <div className="discord-ambiguity" aria-label={pick('Choose daylight-saving occurrence', 'Elige la aparición en horario de verano')}>
                <button type="button" onClick={() => selectAmbiguousCandidate(ambiguousCandidates[0], pick('Earlier', 'anterior'))}>{pick('Use earlier', 'Usar la anterior')} · {new Date(ambiguousCandidates[0] * 1_000).toISOString()}</button>
                <button type="button" onClick={() => selectAmbiguousCandidate(ambiguousCandidates[ambiguousCandidates.length - 1], pick('Later', 'posterior'))}>{pick('Use later', 'Usar la posterior')} · {new Date(ambiguousCandidates[ambiguousCandidates.length - 1] * 1_000).toISOString()}</button>
              </div>
            )}
          </div>
        </section>

        <section className="discord-panel discord-decode-panel" aria-labelledby="discord-decode-heading">
          <div className="discord-panel-heading"><div><p>{pick('Paste or decode', 'Pegar o decodificar')}</p><h2 id="discord-decode-heading">{pick('Unix seconds or an existing tag', 'Segundos Unix o etiqueta existente')}</h2></div></div>
          <div className="discord-panel-body">
            <label className="discord-field">
              <span>{pick('Timestamp input', 'Entrada de timestamp')}</span>
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
              <small id="discord-decode-help">{pick('Accepts whole Unix seconds or', 'Acepta segundos Unix enteros o')} <code>&lt;t:SEGUNDOS_UNIX:ESTILO&gt;</code>.</small>
            </label>
            {decoded.ok && (
              <div className="discord-decoded">
                <span>{decoded.source === 'tag' ? `${pick('Style', 'Estilo')} ${decoded.style}` : pick('Unix seconds', 'Segundos Unix')}</span>
                <strong>{new Date(decoded.milliseconds).toISOString()}</strong>
              </div>
            )}
            {(decoded.ok ? decoded.warning : decoded.error) && (
              <p className={decoded.ok ? 'discord-notice warning' : 'discord-notice error'} role={decoded.ok ? 'note' : 'alert'}>
                {decoded.ok ? decoded.warning : decoded.error}
              </p>
            )}
            <div className="discord-action-row">
              <button type="button" className="discord-button primary" onClick={() => applyDecoded('input')} disabled={!decoded.ok || Boolean(decoded.ok && decoded.warning)}>{pick('Use timestamp', 'Usar timestamp')}</button>
              {decoded.suggestedSeconds && (
                <button type="button" className="discord-button" onClick={() => applyDecoded('suggestion')}>{pick('Use as', 'Usar como')} {localizedDiscordUnitLabel(decoded.suggestedUnit, uiLocale)}</button>
              )}
              {decoded.ok && decoded.warning && <button type="button" className="discord-button" onClick={() => applyDecoded('force')}>{pick('Use as seconds anyway', 'Usar como segundos de todos modos')}</button>}
            </div>
            <p className="discord-seconds-output"><span>{dateIsValid ? pick('Selected Unix seconds', 'Segundos Unix seleccionados') : pick('Last valid Unix seconds', 'Últimos segundos Unix válidos')}</span><code>{seconds}</code><button type="button" disabled={!dateIsValid} onClick={() => copyValue(String(seconds), 'seconds', pick('Unix seconds', 'segundos Unix'))}>{copiedKey === 'seconds' ? pick('Copied', 'Copiado') : pick('Copy', 'Copiar')}</button></p>
          </div>
        </section>
      </div>

      <section className="discord-snowflake" aria-labelledby="discord-snowflake-heading">
        <div className="discord-panel-heading">
          <div>
            <p>{pick('Message and channel IDs', 'IDs de mensajes y canales')}</p>
            <h2 id="discord-snowflake-heading">{pick('Decode a Discord snowflake', 'Decodifica un snowflake de Discord')}</h2>
            <small>{pick('Read a creation time, worker, process, and increment without uploading the ID.', 'Lee una hora de creación, worker, proceso e increment sin subir el ID.')}</small>
          </div>
        </div>
        <div className="discord-panel-body">
          <label className="discord-field">
            <span>{pick('Discord snowflake or message ID', 'Snowflake o ID de mensaje de Discord')}</span>
            <input
              className="discord-mono"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              spellCheck={false}
              maxLength={20}
              value={snowflakeInput}
              onChange={(event) => setSnowflakeInput(event.target.value)}
              placeholder="1199835124667021433"
              aria-describedby="discord-snowflake-help"
            />
            <small id="discord-snowflake-help">{pick('Enter a decimal ID. Discord exposes IDs as strings to preserve every 64-bit digit.', 'Introduce un ID decimal. Discord expone los IDs como cadenas para conservar cada dígito de 64 bits.')}</small>
          </label>
          {decodedSnowflake.ok && (
            <dl className="discord-snowflake-details">
              <div><dt>{pick('Created (UTC)', 'Creación (UTC)')}</dt><dd><code>{decodedSnowflake.iso}</code></dd></div>
              <div><dt>{pick('Selected Discord tag', 'Etiqueta de Discord seleccionada')}</dt><dd><code>{discordTimestampCode(decodedSnowflake.seconds, activeStyle)}</code></dd></div>
              <div><dt>{pick('Worker / process / increment', 'Worker / proceso / increment')}</dt><dd><code>{decodedSnowflake.workerId} / {decodedSnowflake.processId} / {decodedSnowflake.increment}</code></dd></div>
            </dl>
          )}
          {!decodedSnowflake.ok && snowflakeInput.trim() && decodedSnowflake.error && (
            <p className="discord-notice error" role="alert">{decodedSnowflake.error}</p>
          )}
          <div className="discord-action-row">
            <button
              type="button"
              className="discord-button primary"
              disabled={!decodedSnowflake.ok}
              onClick={() => {
                if (!decodedSnowflake.ok) return;
                setInstant(Number(decodedSnowflake.seconds), activeStyle, pick('Loaded the snowflake creation time.', 'Se cargó la hora de creación del snowflake.'));
              }}
            >
              {pick('Use creation time', 'Usar hora de creación')}
            </button>
            <button
              type="button"
              className="discord-button"
              disabled={!decodedSnowflake.ok}
              onClick={() => decodedSnowflake.ok && copyValue(decodedSnowflake.iso, 'snowflake-iso', pick('snowflake creation time', 'hora de creación del snowflake'))}
            >
              {copiedKey === 'snowflake-iso' ? pick('ISO time copied', 'Hora ISO copiada') : pick('Copy ISO time', 'Copiar hora ISO')}
            </button>
          </div>
        </div>
      </section>

      <section className="discord-formats" aria-labelledby="discord-formats-heading">
        <div className="discord-formats-heading">
          <div><p>{pick('Current documented set', 'Conjunto documentado actual')}</p><h2 id="discord-formats-heading">{pick('All 9 Discord timestamp formats', 'Los 9 formatos de timestamp de Discord')}</h2><small>{pick('Choose a card to make it the selected format. Every code is ready to paste.', 'Elige una tarjeta para seleccionar el formato. Cada código está listo para pegar.')}</small></div>
          <div className="discord-preview-settings">
            <label><span>{pick('Preview timezone', 'Zona horaria de vista previa')}</span><select value={previewZoneChoice} onChange={(event) => setPreviewZoneChoice(event.target.value)}><option value="local">{pick('My browser', 'Mi navegador')} — {localZone}</option><option value="source">{pick('Source', 'Origen')} — {sourceZone}</option><option value="UTC">UTC</option></select></label>
            <label><span>{pick('Preview locale', 'Configuración regional de vista previa')}</span><select value={previewLocale} onChange={(event) => setPreviewLocale(event.target.value)}>{PREVIEW_LOCALES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </div>
        <p className={dateIsValid ? 'discord-preview-note' : 'discord-preview-note invalid'} role={dateIsValid ? undefined : 'alert'}>{dateIsValid
          ? pick('These are browser approximations. Discord controls the final wording and renders the same timestamp for each viewer’s locale, timezone, and time-format settings.', 'Estas son aproximaciones del navegador. Discord controla la redacción final y muestra el mismo timestamp según la configuración regional, zona horaria y formato horario de cada lector.')
          : pick('Fix the date or timezone error before copying. The cards below show the last valid instant and all output copy controls are paused.', 'Corrige el error de fecha o zona horaria antes de copiar. Las tarjetas muestran el último instante válido y todos los controles de copia están pausados.')}</p>
        <div className="discord-format-grid">
          {localizedStyles.map(({ style, name, description }) => {
            const selected = activeStyle === style;
            return (
              <article className={selected ? 'discord-format-card selected' : 'discord-format-card'} key={style}>
                <button type="button" className="discord-card-select" onClick={() => setActiveStyle(style)} aria-pressed={selected}>
                  <span className="discord-style-token">:{style}</span>
                  <span><strong>{name}</strong><small>{description}</small></span>
                  {style === 'f' && <em>{pick('Default', 'Predeterminado')}</em>}
                </button>
                <p className="discord-rendered">{discordTimestampPreview(seconds * 1_000, style, previewLocale, previewZone, nowMilliseconds)}</p>
                <div className="discord-code-row"><code>{codes[style]}</code><button type="button" disabled={!dateIsValid} onClick={() => copyValue(codes[style], `style-${style}`, pick(`${name} code`, `código ${name}`))}>{copiedKey === `style-${style}` ? pick('Copied', 'Copiado') : pick('Copy', 'Copiar')}</button></div>
              </article>
            );
          })}
        </div>
        <div className="discord-format-actions">
          <button type="button" className="discord-button primary" disabled={!dateIsValid} onClick={() => copyValue(selectedCode, 'selected', pick(`${activeStyle} timestamp code`, `timestamp ${activeStyle}`))}>{copiedKey === 'selected' ? pick('Selected code copied', 'Código seleccionado copiado') : pick(`Copy selected :${activeStyle}`, `Copiar :${activeStyle} seleccionado`)}</button>
          <button type="button" className="discord-button" disabled={!dateIsValid} onClick={() => copyValue(discordTimestampCode(String(seconds)), 'default', pick('Default timestamp code', 'código de timestamp predeterminado'))}>{copiedKey === 'default' ? pick('Default code copied', 'Código predeterminado copiado') : pick('Copy default tag (no :f)', 'Copiar etiqueta predeterminada (sin :f)')}</button>
          <button type="button" className="discord-button" disabled={!dateIsValid} onClick={() => copyValue(allCodesText, 'all', pick('All nine timestamp codes', 'los nueve códigos de timestamp'))}>{copiedKey === 'all' ? pick('All codes copied', 'Todos los códigos copiados') : pick('Copy all 9 formats', 'Copiar los 9 formatos')}</button>
        </div>
      </section>

      <section className="discord-composer" aria-labelledby="discord-composer-heading">
        <div className="discord-panel-heading"><div><p>{pick('Ready-made messages', 'Mensajes listos para usar')}</p><h2 id="discord-composer-heading">{pick('Copy a full date plus relative countdown', 'Copia una fecha completa y cuenta regresiva relativa')}</h2><small>{pick('Pairing', 'Combinar')} <code>:F</code> {pick('with', 'con')} <code>:R</code> {pick('gives readers both a calendar anchor and relative context.', 'ofrece a los lectores un anclaje de calendario y contexto relativo.')}</small></div></div>
        <div className="discord-template-grid">
          {templates.map((template) => (
            <article key={template.key}><span>{template.label}</span><code>{template.text}</code><button type="button" disabled={!dateIsValid} onClick={() => copyValue(template.text, `template-${template.key}`, pick(`${template.label} message`, `mensaje de ${template.label.toLowerCase()}`))}>{copiedKey === `template-${template.key}` ? pick('Copied', 'Copiado') : pick('Copy message', 'Copiar mensaje')}</button></article>
          ))}
        </div>
      </section>

      <section className="discord-bulk" aria-labelledby="discord-bulk-heading">
        <div className="discord-panel-heading">
          <div>
            <p>{pick('Many dates at once', 'Muchas fechas a la vez')}</p>
            <h2 id="discord-bulk-heading">{pick('Bulk Discord timestamp generator', 'Generador de timestamps de Discord en lote')}</h2>
            <small>{pick(`Paste up to ${MAX_BULK_DISCORD_LINES} lines: Unix seconds, <t:…> tags, dates, or date and time.`, `Pega hasta ${MAX_BULK_DISCORD_LINES} líneas: segundos Unix, etiquetas <t:…>, fechas o fecha y hora.`)}</small>
          </div>
        </div>
        <div className="discord-bulk-grid">
          <label className="discord-field">
            <span>{pick('One input per line', 'Una entrada por línea')}</span>
            <textarea
              className="discord-mono"
              rows={7}
              value={bulkInput}
              onChange={(event) => setBulkInput(event.target.value)}
              placeholder={'1754208000\n<t:1754208000:F>\n2026-08-03\n2026-08-03 21:00'}
              aria-describedby="discord-bulk-help"
              spellCheck={false}
              autoComplete="off"
            />
            <small id="discord-bulk-help">
              {pick(
                'Dates without a time use 00:00 in the source timezone. Offset forms such as 2026-08-03T21:00+09:00 are also accepted.',
                'Las fechas sin hora usan 00:00 en la zona horaria de origen. También se aceptan formas como 2026-08-03T21:00+09:00.',
              )}
            </small>
          </label>
          <div className="discord-bulk-output">
            <label className="discord-field">
              <span>{pick(`Selected :${activeStyle} output`, `Salida :${activeStyle} seleccionada`)}</span>
              <textarea
                className="discord-mono"
                rows={7}
                readOnly
                value={bulkSelectedText}
                placeholder={pick('Generated tags appear here.', 'Aquí aparecen las etiquetas generadas.')}
                aria-label={pick(`Generated :${activeStyle} Discord tags`, `Etiquetas de Discord :${activeStyle} generadas`)}
              />
            </label>
            <div className="discord-bulk-meta">
              <span>{pick(`${validBulkEntries.length} valid / ${bulkEntries.length}`, `${validBulkEntries.length} válidas / ${bulkEntries.length}`)} {bulkLineNoun}</span>
              <button
                type="button"
                className="discord-button primary"
                disabled={bulkHasErrors || validBulkEntries.length === 0}
                onClick={() => copyValue(bulkSelectedText, 'bulk-selected', pick(`all selected :${activeStyle} lines`, `todas las líneas :${activeStyle} seleccionadas`))}
              >
                {copiedKey === 'bulk-selected' ? pick('Selected lines copied', 'Líneas seleccionadas copiadas') : pick(`Copy selected :${activeStyle}`, `Copiar :${activeStyle} seleccionado`)}
              </button>
              <button
                type="button"
                className="discord-button"
                disabled={bulkHasErrors || validBulkEntries.length === 0}
                onClick={() => copyValue(bulkAllText, 'bulk-all', pick('all formats for every valid line', 'todos los formatos de cada línea válida'))}
              >
                {copiedKey === 'bulk-all' ? pick('All formats copied', 'Todos los formatos copiados') : pick('Copy all 9 formats', 'Copiar los 9 formatos')}
              </button>
            </div>
          </div>
        </div>
        {!bulk.ok && bulk.error && <p className="discord-notice error" role="alert">{localizeDiscordDiagnostic(bulk.error, uiLocale)}</p>}
        {bulk.ok && bulkEntries.some((entry) => !entry.ok) && (
          <ul className="discord-bulk-errors">
            {bulkEntries.filter((entry) => !entry.ok).slice(0, 8).map((entry) => (
              <li key={entry.line}><strong>{pick(`Line ${entry.line}`, `Línea ${entry.line}`)}:</strong> {entry.ok ? '' : entry.error}</li>
            ))}
            {bulkEntries.filter((entry) => !entry.ok).length > 8 && <li>{pick('Fix these lines first; more errors may follow.', 'Corrige estas líneas primero; pueden aparecer más errores.')}</li>}
          </ul>
        )}
        {bulk.ok && bulkEntries.some((entry) => entry.ok && entry.warning) && (
          <ul className="discord-bulk-warnings">
            {bulkEntries.filter((entry) => entry.ok && entry.warning).slice(0, 4).map((entry) => (
              <li key={entry.line}><strong>{pick(`Line ${entry.line}`, `Línea ${entry.line}`)}:</strong> {entry.ok ? entry.warning : ''}</li>
            ))}
          </ul>
        )}
      </section>

      <p className="discord-activity" aria-live="polite"><strong>{pick('Generator status:', 'Estado del generador:')}</strong><span>{activity}</span></p>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
