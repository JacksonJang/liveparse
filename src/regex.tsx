import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MAX_REGEX_MATCHES,
  MAX_REGEX_PATTERN_CODE_UNITS,
  MAX_REGEX_TEXT_CODE_UNITS,
  REGEX_FLAG_DETAILS,
  normalizeRegexFlags,
  javascriptRegexSource,
  regexHighlightSegments,
  type RegexFlag,
  type RegexMatch,
} from './lib/regex-tools';
import type { RegexWorkerResponse } from './lib/regex-worker-protocol';
import './styles.css';
import './regex.css';

type WorkerState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ready'; matches: readonly RegexMatch[]; truncated: boolean; replacement: string | null }
  | { status: 'error'; message: string };

interface RegexPreset {
  readonly label: string;
  readonly pattern: string;
  readonly flags: readonly RegexFlag[];
  readonly text: string;
  readonly replacement: string | null;
}

const FLAG_ORDER: readonly RegexFlag[] = ['g', 'i', 'm', 's', 'u', 'y', 'd'];
const MAX_VISIBLE_MATCHES = 50;
const MAX_HIGHLIGHT_CHARACTERS = 20_000;
const WORKER_TIMEOUT_MS = 1_000;

const PRESETS: readonly RegexPreset[] = [
  {
    label: 'Log levels',
    pattern: '^(?<timestamp>\\d{4}-\\d{2}-\\d{2}T[^ ]+Z) (?<level>INFO|WARN|ERROR) (?<message>.+)$',
    flags: ['g', 'm'],
    text: [
      '2026-09-16T01:02:03Z INFO service started',
      '2026-09-16T01:02:09Z WARN cache miss',
      '2026-09-16T01:03:20Z ERROR database timeout',
    ].join('\n'),
    replacement: '$<level>: $<message>',
  },
  {
    label: 'URLs',
    pattern: 'https?://[^\\s<>"\')]+',
    flags: ['g', 'i'],
    text: 'Read https://example.com/docs and https://liveparse.com/json-formatter/ before filing the issue.',
    replacement: '<a href="$&">$&</a>',
  },
  {
    label: 'ISO dates',
    pattern: '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?',
    flags: ['g'],
    text: 'Created 2026-09-16 and updated 2026-09-15T19:45:00+09:00.',
    replacement: null,
  },
  {
    label: 'Emoji',
    pattern: '\\p{Extended_Pictographic}',
    flags: ['g', 'u'],
    text: 'Ship it 🚀 then review ✅ and relax 🍵.',
    replacement: '[$&]',
  },
];

function formatOffset(value: number): string {
  return value.toLocaleString('en-US');
}

function visibleMatchText(match: RegexMatch): string {
  return match.text.length > 160 ? `${match.text.slice(0, 157)}…` : match.text;
}

function visibleReplacement(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 1_997)}…` : value;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Continue to the fallback when a browser rejects the async clipboard API.
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
  if (!copied) throw new Error('Copy was blocked. Select the text and copy it manually.');
}

function FlagToggle({
  flag,
  selected,
  onToggle,
}: {
  flag: RegexFlag;
  selected: boolean;
  onToggle: (flag: RegexFlag) => void;
}): React.JSX.Element {
  const details = REGEX_FLAG_DETAILS[flag];
  return (
    <button
      type="button"
      className="regex-flag"
      aria-pressed={selected}
      onClick={() => onToggle(flag)}
    >
      <span aria-hidden="true">{flag}</span>
      <strong>{details.label}</strong>
      <small>{details.detail}</small>
    </button>
  );
}

function App(): React.JSX.Element {
  const [pattern, setPattern] = useState(PRESETS[0].pattern);
  const [text, setText] = useState(PRESETS[0].text);
  const [replacementEnabled, setReplacementEnabled] = useState(false);
  const [replacement, setReplacement] = useState(PRESETS[0].replacement ?? '');
  const [selectedFlags, setSelectedFlags] = useState<ReadonlySet<RegexFlag>>(new Set(PRESETS[0].flags));
  const [state, setState] = useState<WorkerState>({ status: 'running' });
  const [selectedMatch, setSelectedMatch] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('Testing the initial pattern in a local worker.');
  const jobCounter = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  const flags = useMemo(() => normalizeRegexFlags(selectedFlags), [selectedFlags]);
  const activeReplacement = replacementEnabled ? replacement : null;

  useEffect(() => {
    const jobId = jobCounter.current + 1;
    jobCounter.current = jobId;
    setSelectedMatch(null);
    setState({ status: 'running' });

    let completed = false;
    let worker = workerRef.current;
    if (!worker) {
      worker = new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
    }

    const timer = setTimeout(() => {
      const timeout = setTimeout(() => {
        if (completed) return;
        completed = true;
        worker?.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        setState({
          status: 'error',
          message: 'This regex took longer than 1 second. Make it less backtracking-heavy or shorten the test text.',
        });
        setStatusMessage('The local regex worker was stopped after one second.');
      }, WORKER_TIMEOUT_MS);

      const finish = () => {
        clearTimeout(timeout);
      };

      worker.addEventListener('message', (event: MessageEvent<RegexWorkerResponse>) => {
        const response = event.data;
        if (response.type !== 'result' || response.jobId !== jobId || completed) return;
        completed = true;
        finish();
        if (response.ok) {
          setState({
            status: 'ready',
            matches: response.analysis.matches,
            truncated: response.analysis.truncated,
            replacement: activeReplacement === null ? null : response.analysis.replacement,
          });
          setStatusMessage(
            response.analysis.truncated
              ? `Found the first ${formatOffset(response.analysis.matchCount)} local matches.`
              : response.analysis.matchCount === 1
                ? 'Found 1 local match.'
                : `Found ${formatOffset(response.analysis.matchCount)} local matches.`,
          );
        } else {
          setState({ status: 'error', message: response.message });
          setStatusMessage('The pattern could not be evaluated.');
        }
      });

      worker.postMessage({
        type: 'analyze',
        jobId,
        pattern,
        flags,
        text,
        replacement: activeReplacement,
      });

    }, 80);

    return () => {
      clearTimeout(timer);
      if (!completed) {
        worker?.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };
  }, [activeReplacement, flags, pattern, text]);

  const toggleFlag = (flag: RegexFlag) => {
    setSelectedFlags((current) => {
      const next = new Set(current);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  const applyPreset = (preset: RegexPreset) => {
    setPattern(preset.pattern);
    setText(preset.text);
    setSelectedFlags(new Set(preset.flags));
    setReplacement(preset.replacement ?? '');
    setReplacementEnabled(preset.replacement !== null);
  };

  const copy = async (label: string, value: string) => {
    try {
      await copyText(value);
      setStatusMessage(`${label} copied only after you pressed the button.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  const ready = state.status === 'ready' ? state : null;
  const error = state.status === 'error' ? state : null;
  const segments = useMemo(() => {
    if (!ready) return [];
    return regexHighlightSegments(text, ready.matches, MAX_HIGHLIGHT_CHARACTERS);
  }, [ready, text]);
  const visibleMatches = ready?.matches.slice(0, MAX_VISIBLE_MATCHES) ?? [];

  return (
    <section className="regex-app parser-app" aria-label="Regex tester">
      <div className="regex-topbar">
        <div>
          <p className="regex-local-label">JavaScript RegExp · local Web Worker</p>
          <p role="status" aria-live="polite">{statusMessage}</p>
        </div>
        <output aria-label="Active flags"><code>/{flags || 'no flags'}</code></output>
      </div>

      <div className="regex-workspace">
        <div className="regex-input-column">
          <div className="regex-panel regex-pattern-panel">
            <div className="regex-panel-heading">
              <label htmlFor="regex-pattern">Regular expression</label>
              <span>{pattern.length.toLocaleString('en-US')} / {MAX_REGEX_PATTERN_CODE_UNITS.toLocaleString('en-US')} UTF-16</span>
            </div>
            <div className="regex-pattern-row">
              <span aria-hidden="true">/</span>
              <input
                id="regex-pattern"
                value={pattern}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onChange={(event) => setPattern(event.target.value)}
                placeholder="\\b(?<word>\\w+)\\b"
                aria-describedby="regex-pattern-help"
              />
              <code>{flags}</code>
            </div>
            <p id="regex-pattern-help">Enter JavaScript RegExp source without delimiters. Slash escaping is not added automatically.</p>
            <div className="regex-pattern-actions">
              <button type="button" onClick={() => void copy('RegExp code', javascriptRegexSource(pattern, flags))}>
                Copy RegExp code
              </button>
            </div>
          </div>

          <fieldset className="regex-flags">
            <legend>Flags</legend>
            {FLAG_ORDER.map((flag) => (
              <FlagToggle
                key={flag}
                flag={flag}
                selected={selectedFlags.has(flag)}
                onToggle={toggleFlag}
              />
            ))}
          </fieldset>

          <div className="regex-panel regex-text-panel">
            <div className="regex-panel-heading">
              <label htmlFor="regex-text">Test text</label>
              <span>{text.length.toLocaleString('en-US')} / {MAX_REGEX_TEXT_CODE_UNITS.toLocaleString('en-US')} UTF-16</span>
            </div>
            <textarea
              id="regex-text"
              value={text}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste text to test the pattern against…"
            />
          </div>

          <div className="regex-replacement">
            <label className="regex-replacement-toggle">
              <input
                type="checkbox"
                checked={replacementEnabled}
                onChange={(event) => setReplacementEnabled(event.target.checked)}
              />
              <span>Enable JavaScript replacement</span>
            </label>
            <label htmlFor="regex-replacement-pattern">Replacement</label>
            <input
              id="regex-replacement-pattern"
              value={replacement}
              disabled={!replacementEnabled}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="For example: $<name> or $1"
            />
            <small>Use <code>$&</code>, <code>$1</code>, or <code>$&lt;name&gt;</code>. Leave replacement disabled to inspect matches only.</small>
          </div>

          <div className="regex-presets" aria-label="Example patterns">
            <span>Examples</span>
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" onClick={() => applyPreset(preset)}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="regex-output-column">
          <div className="regex-panel regex-highlight-panel">
            <div className="regex-panel-heading">
              <h3>Highlighted matches</h3>
              {ready?.truncated ? <span>First {MAX_REGEX_MATCHES.toLocaleString('en-US')} matches</span> : null}
            </div>
            {error ? (
              <p className="regex-error" role="alert"><strong>Cannot evaluate this regex</strong><span>{error.message}</span></p>
            ) : state.status === 'running' ? (
              <p className="regex-empty">Evaluating locally…</p>
            ) : ready && ready.matches.length > 0 ? (
              <pre><code>{segments.map((segment, index) => segment.match
                ? (
                  <mark
                    key={`${segment.match.index}-${index}`}
                    className={selectedMatch === segment.match.index ? 'selected' : undefined}
                  >
                    {segment.text}
                  </mark>
                )
                : <span key={`text-${index}`}>{segment.text}</span>)}</code></pre>
            ) : (
              <p className="regex-empty"><strong>No matches</strong><span>Change the pattern, flags, or test text.</span></p>
            )}
            {text.length > MAX_HIGHLIGHT_CHARACTERS ? (
              <p className="regex-render-note">Highlighting shows the first {MAX_HIGHLIGHT_CHARACTERS.toLocaleString('en-US')} characters; match cards remain complete.</p>
            ) : null}
          </div>

          {ready && ready.matches.length > 0 ? (
            <div className="regex-panel regex-match-panel">
              <div className="regex-panel-heading">
                <h3>Matches and groups</h3>
                <span>{ready.matches.length.toLocaleString('en-US')} shown · {ready.truncated ? 'limit reached' : 'complete'}</span>
              </div>
              <ul>
                {visibleMatches.map((match, index) => (
                  <li key={`${match.index}-${index}`}>
                    <button type="button" onClick={() => setSelectedMatch(match.index)}>
                      <span>#{index + 1}</span>
                      <strong>{visibleMatchText(match)}</strong>
                      <small>offset {formatOffset(match.index)} · length {formatOffset(match.text.length)}</small>
                    </button>
                    {match.groups.length > 0 ? (
                      <dl>
                        {match.groups.map((group) => (
                          <div key={group.index}>
                            <dt>{group.name ?? `$${group.index}`}</dt>
                            <dd><code>{group.text === null ? 'undefined' : group.text === '' ? 'empty' : group.text}</code></dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </li>
                ))}
              </ul>
              {ready.matches.length > visibleMatches.length ? (
                <p className="regex-render-note">Showing the first {visibleMatches.length.toLocaleString('en-US')} of {ready.matches.length.toLocaleString('en-US')} matches.</p>
              ) : null}
              <div className="regex-actions">
                <button type="button" onClick={() => void copy('Matched text', ready.matches.map((match) => match.text).join('\n'))}>
                  Copy matches
                </button>
                {ready.replacement !== null ? (
                  <button type="button" onClick={() => void copy('Replacement', ready.replacement ?? '')}>
                    Copy replacement
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {ready?.replacement !== null && ready?.replacement !== undefined ? (
            <div className="regex-panel regex-replacement-output">
              <div className="regex-panel-heading">
                <h3>Replacement preview</h3>
                <button type="button" onClick={() => void copy('Replacement', ready.replacement ?? '')}>Copy</button>
              </div>
              <pre><code>{visibleReplacement(ready.replacement ?? '')}</code></pre>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root container');
createRoot(container).render(<App />);
