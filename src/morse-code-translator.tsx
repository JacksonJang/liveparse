import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  decodeMorse,
  encodeMorse,
  MAX_MORSE_INPUT_CODE_UNITS,
  MORSE_LETTER_SEPARATOR,
  MORSE_WORD_SEPARATOR,
  type MorseConversionResult,
} from './lib/morse-code';
import { buildToneTimeline } from './lib/morse-audio';
import './styles.css';
import './morse-code-translator.css';

type Direction = 'encode' | 'decode';

interface DirectionSession {
  input: string;
  result: MorseConversionResult | null;
  convertedInput: string;
}

type Sessions = Record<Direction, DirectionSession>;

interface MorseMetrics {
  characters: number;
  groups: number;
  words: number;
  signals: number;
}

interface ActivePlayback {
  context: AudioContext;
  oscillator: OscillatorNode;
  timer: number;
}

const TEXT_SAMPLE = 'HELLO WORLD';
const MORSE_SAMPLE = '.... . .-.. .-.. --- / .-- --- .-. .-.. -..';
const MAX_AUDIO_SIGNALS = 2_000;
const MAX_AUDIO_SECONDS = 300;

const directionCopy = {
  encode: {
    tab: 'Text → Morse',
    inputTitle: 'Text input',
    inputHelp: 'Enter supported letters, digits, or ITU punctuation.',
    inputPlaceholder: 'Type text to encode, such as HELLO WORLD',
    outputTitle: 'Morse code output',
    outputHelp: 'Spaces separate letters; a spaced slash separates words.',
    convert: 'Convert text to Morse',
    sample: TEXT_SAMPLE,
  },
  decode: {
    tab: 'Morse → Text',
    inputTitle: 'Written Morse input',
    inputHelp: 'Separate letters with spaces and words with a spaced slash.',
    inputPlaceholder: '.... . .-.. .-.. --- / .-- --- .-. .-.. -..',
    outputTitle: 'Decoded text output',
    outputHelp: 'Unknown or ambiguous groups are reported below.',
    convert: 'Decode Morse to text',
    sample: MORSE_SAMPLE,
  },
} as const;

function convert(direction: Direction, input: string): MorseConversionResult {
  return direction === 'encode'
    ? encodeMorse(input)
    : decodeMorse(input, { ambiguity: 'prefer-letter' });
}

function createInitialSessions(): Sessions {
  return {
    encode: {
      input: TEXT_SAMPLE,
      result: encodeMorse(TEXT_SAMPLE),
      convertedInput: TEXT_SAMPLE,
    },
    decode: {
      input: MORSE_SAMPLE,
      result: decodeMorse(MORSE_SAMPLE, { ambiguity: 'prefer-letter' }),
      convertedInput: MORSE_SAMPLE,
    },
  };
}

function countMorse(normalized: string, characters: number): MorseMetrics {
  if (!normalized.trim()) return { characters, groups: 0, words: 0, signals: 0 };

  const words = normalized
    .split(MORSE_WORD_SEPARATOR)
    .map((word) => word.trim())
    .filter(Boolean);
  const groups = words.reduce(
    (total, word) => total + word.split(MORSE_LETTER_SEPARATOR).filter(Boolean).length,
    0,
  );
  const signals = Array.from(normalized).reduce(
    (total, symbol) => total + (symbol === '.' || symbol === '-' ? 1 : 0),
    0,
  );

  return { characters, groups, words: words.length, signals };
}

function diagnosticSummary(result: MorseConversionResult | null): string {
  if (!result) return 'No diagnostics';
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  if (errors === 0 && warnings === 0) return 'None';
  return `${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'}`;
}

function MorseCodeTranslator() {
  const [direction, setDirection] = useState<Direction>('encode');
  const [sessions, setSessions] = useState<Sessions>(createInitialSessions);
  const [activity, setActivity] = useState('Text sample converted. Replace it or choose the other direction.');
  const [wpm, setWpm] = useState(20);
  const [pitch, setPitch] = useState(600);
  const [isPlaying, setIsPlaying] = useState(false);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const playbackRef = useRef<ActivePlayback | null>(null);

  const page = directionCopy[direction];
  const session = sessions[direction];
  const stale = session.result !== null && session.input !== session.convertedInput;
  const result = session.result;
  const errors = result?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error') ?? [];
  const canUseResult = result !== null && !stale && result.ok;
  const output = result?.output ?? '';
  const normalizedMorse = canUseResult ? result.normalized : '';
  const metrics = useMemo(
    () => countMorse(stale ? '' : (result?.normalized ?? ''), Array.from(session.input).length),
    [result, session.input, stale],
  );
  const audioSignalLimitExceeded = metrics.signals > MAX_AUDIO_SIGNALS;
  const toneTimeline = useMemo(
    () => audioSignalLimitExceeded
      ? buildToneTimeline('')
      : buildToneTimeline(normalizedMorse, { maxSignals: MAX_AUDIO_SIGNALS }),
    [audioSignalLimitExceeded, normalizedMorse],
  );
  const playbackSeconds = toneTimeline.totalUnits * (1.2 / wpm);
  const audioDurationLimitExceeded = playbackSeconds > MAX_AUDIO_SECONDS;
  const canPlayAudio = canUseResult
    && toneTimeline.segments.length > 0
    && !audioSignalLimitExceeded
    && !audioDurationLimitExceeded;

  const disposePlayback = (announce: boolean) => {
    const active = playbackRef.current;
    playbackRef.current = null;
    if (active) {
      window.clearTimeout(active.timer);
      active.oscillator.onended = null;
      try {
        active.oscillator.stop();
      } catch {
        // The oscillator may already have reached its scheduled stop time.
      }
      void active.context.close().catch(() => undefined);
    }
    setIsPlaying(false);
    if (announce) setActivity('Tone playback stopped.');
  };

  useEffect(() => () => {
    const active = playbackRef.current;
    playbackRef.current = null;
    if (!active) return;
    window.clearTimeout(active.timer);
    active.oscillator.onended = null;
    try {
      active.oscillator.stop();
    } catch {
      // The oscillator may already have ended during unmount.
    }
    void active.context.close().catch(() => undefined);
  }, []);

  const updateInput = (nextInput: string) => {
    if (nextInput.length > MAX_MORSE_INPUT_CODE_UNITS) {
      setActivity(`Input is limited to ${MAX_MORSE_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units.`);
      return;
    }
    if (isPlaying) disposePlayback(false);
    setSessions((current) => ({
      ...current,
      [direction]: { ...current[direction], input: nextInput },
    }));
    setActivity('Input changed. Choose Convert to refresh the result.');
  };

  const chooseDirection = (nextDirection: Direction) => {
    if (nextDirection === direction) return;
    if (isPlaying) disposePlayback(false);
    setDirection(nextDirection);
    const nextSession = sessions[nextDirection];
    const nextIsStale = nextSession.result !== null && nextSession.input !== nextSession.convertedInput;
    setActivity(nextIsStale
      ? 'Your saved input has changed. Choose Convert to refresh its result.'
      : `${directionCopy[nextDirection].tab} input restored.`);
  };

  const runConversion = () => {
    if (!session.input) {
      setActivity('Enter text or written Morse code before converting.');
      return;
    }
    if (isPlaying) disposePlayback(false);
    const nextResult = convert(direction, session.input);
    setSessions((current) => ({
      ...current,
      [direction]: {
        ...current[direction],
        result: nextResult,
        convertedInput: session.input,
      },
    }));
    const errorCount = nextResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    const warningCount = nextResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
    if (errorCount > 0) {
      setActivity(`Conversion stopped with ${errorCount} error${errorCount === 1 ? '' : 's'}. Review the diagnostics before copying.`);
    } else if (warningCount > 0) {
      setActivity(`Converted with ${warningCount} warning${warningCount === 1 ? '' : 's'}. Review the diagnostic before using the result.`);
    } else {
      setActivity(direction === 'encode' ? 'Text converted to Morse code.' : 'Written Morse code decoded to text.');
    }
  };

  const loadSample = () => {
    if (isPlaying) disposePlayback(false);
    setSessions((current) => ({
      ...current,
      [direction]: { input: page.sample, result: null, convertedInput: '' },
    }));
    setActivity('Sample loaded. Choose Convert to create a fresh result.');
  };

  const clear = () => {
    if (isPlaying) disposePlayback(false);
    setSessions((current) => ({
      ...current,
      [direction]: { input: '', result: null, convertedInput: '' },
    }));
    setActivity('Cleared. Enter a message to begin.');
  };

  const copyOutput = async () => {
    if (!canUseResult || !output) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(output);
      setActivity('Result copied to the clipboard.');
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      outputRef.current?.setSelectionRange(0, output.length);
      setActivity('Clipboard access was unavailable. The result is selected; press Ctrl/⌘ + C to copy it.');
    }
  };

  const playAudio = async () => {
    if (!canPlayAudio) return;
    disposePlayback(false);

    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      setActivity('Web Audio is not available in this browser. The written Morse result is still available.');
      return;
    }

    let context: AudioContext | null = null;
    try {
      context = new AudioContextConstructor();
      if (context.state === 'suspended') await context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const unitSeconds = 1.2 / wpm;
      const startTime = context.currentTime + 0.04;
      const attack = Math.min(0.004, unitSeconds * 0.12);
      const release = attack;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(pitch, startTime);
      gain.gain.setValueAtTime(0, context.currentTime);

      toneTimeline.segments.forEach((segment) => {
        const toneStart = startTime + segment.startUnits * unitSeconds;
        const toneEnd = toneStart + segment.durationUnits * unitSeconds;
        gain.gain.setValueAtTime(0, toneStart);
        gain.gain.linearRampToValueAtTime(0.16, toneStart + attack);
        gain.gain.setValueAtTime(0.16, Math.max(toneStart + attack, toneEnd - release));
        gain.gain.linearRampToValueAtTime(0, toneEnd);
      });

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startTime);
      const durationSeconds = toneTimeline.totalUnits * unitSeconds;
      oscillator.stop(startTime + durationSeconds + 0.02);

      const playback: ActivePlayback = { context, oscillator, timer: 0 };
      const finishPlayback = () => {
        if (playbackRef.current !== playback) return;
        playbackRef.current = null;
        window.clearTimeout(playback.timer);
        oscillator.onended = null;
        void context?.close().catch(() => undefined);
        setIsPlaying(false);
        setActivity('Tone playback finished.');
      };
      oscillator.onended = finishPlayback;
      playback.timer = window.setTimeout(finishPlayback, (durationSeconds + 0.35) * 1000);
      playbackRef.current = playback;
      setIsPlaying(true);
      setActivity(`Playing synthesized Morse at ${wpm} WPM and ${pitch} Hz. Audio stays in this tab.`);
    } catch {
      if (context) void context.close().catch(() => undefined);
      setIsPlaying(false);
      setActivity('The browser could not start tone playback. The written result is unchanged.');
    }
  };

  const hasFreshResult = result !== null && !stale;
  const diagnostics = hasFreshResult ? result.diagnostics : [];

  return (
    <section className="morse-app" aria-label="Morse code translator workspace">
      <div className="morse-toolbar">
        <div className="morse-local-badge">
          <span aria-hidden="true" />
          <strong>Local written conversion</strong>
          <small>Text and Morse stay in this browser tab</small>
        </div>
        <div className="morse-tool-badge"><span>ITU repertoire</span><strong>Explicit boundaries</strong></div>
      </div>

      <div className="morse-body">
        <div className="morse-intro">
          <div><p>Choose a direction</p><h2>Translate with boundaries intact</h2></div>
          <span>Conversion is explicit: edit an input, then choose Convert. Each direction keeps its own input while you switch tabs.</span>
        </div>

        <div className="morse-tabs" role="tablist" aria-label="Translation direction">
          {(['encode', 'decode'] as const).map((option) => (
            <button
              key={option}
              type="button"
              id={`morse-tab-${option}`}
              role="tab"
              aria-controls="morse-workspace-panel"
              aria-selected={direction === option}
              aria-pressed={direction === option}
              tabIndex={direction === option ? 0 : -1}
              onClick={() => chooseDirection(option)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const next = option === 'encode' ? 'decode' : 'encode';
                chooseDirection(next);
                window.requestAnimationFrame(() => document.getElementById(`morse-tab-${next}`)?.focus());
              }}
            >
              {directionCopy[option].tab}
            </button>
          ))}
        </div>

        <div
          className="morse-workspace"
          id="morse-workspace-panel"
          role="tabpanel"
          aria-labelledby={`morse-tab-${direction}`}
        >
          <section className="morse-card" aria-labelledby="morse-input-heading">
            <header className="morse-card-heading">
              <div><p>{direction === 'encode' ? 'Source text' : 'Separated signals'}</p><h3 id="morse-input-heading">{page.inputTitle}</h3></div>
              <span className={session.input.length >= MAX_MORSE_INPUT_CODE_UNITS ? 'over' : undefined}>
                {session.input.length.toLocaleString('en-US')} / {MAX_MORSE_INPUT_CODE_UNITS.toLocaleString('en-US')} code units
              </span>
            </header>
            <div className="morse-card-body">
              <label className="morse-text-field">
                <span>{page.inputHelp}</span>
                <textarea
                  value={session.input}
                  maxLength={MAX_MORSE_INPUT_CODE_UNITS}
                  placeholder={page.inputPlaceholder}
                  spellCheck={false}
                  onChange={(event) => updateInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      runConversion();
                    }
                  }}
                />
              </label>
              <div className="morse-actions between">
                <div className="morse-actions">
                  <button type="button" className="morse-button primary" onClick={runConversion} disabled={!session.input}>{page.convert}</button>
                  <button type="button" className="morse-button" onClick={loadSample}>Load sample</button>
                </div>
                <button type="button" className="morse-link-button" onClick={clear} disabled={!session.input && !result}>Clear</button>
              </div>
              <p className="morse-note"><strong>Keyboard:</strong> press Ctrl/⌘ + Enter to convert. A normal space separates decoded groups; use <code> / </code> between words.</p>
            </div>
          </section>

          <section className="morse-card output" aria-labelledby="morse-output-heading">
            <header className="morse-card-heading">
              <div><p>{stale ? 'Refresh required' : canUseResult ? 'Ready to use' : 'Validation visible'}</p><h3 id="morse-output-heading">{page.outputTitle}</h3></div>
              <span>{page.outputHelp}</span>
            </header>
            <div className="morse-card-body">
              <label className="morse-text-field output">
                <span>{stale ? 'Input changed. Convert again before copying or playing this result.' : 'Read-only result'}</span>
                <textarea
                  ref={outputRef}
                  value={output}
                  readOnly
                  aria-invalid={hasFreshResult && errors.length > 0 ? true : undefined}
                  placeholder="The converted result appears here."
                  spellCheck={false}
                />
              </label>

              <div className="morse-actions">
                <button type="button" className="morse-button primary" onClick={() => void copyOutput()} disabled={!canUseResult || !output}>Copy result</button>
              </div>

              {!hasFreshResult ? (
                <p className="morse-empty"><strong>{stale ? 'Result is out of date' : 'No current result'}</strong><span>{stale ? 'Choose Convert to validate the edited input.' : 'Enter a message and choose Convert.'}</span></p>
              ) : diagnostics.length > 0 ? (
                <ul className="morse-diagnostics" aria-label="Conversion diagnostics" role={errors.length > 0 ? 'alert' : undefined}>
                  {diagnostics.map((diagnostic, index) => (
                    <li className={`morse-diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
                      <strong>{diagnostic.severity === 'error' ? 'Error' : 'Warning'}:</strong>{' '}
                      <code>{diagnostic.code}</code> — {diagnostic.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="morse-note"><strong>Validated:</strong> no unsupported characters, unknown groups, or ambiguities were reported.</p>
              )}

              <div className="morse-summary" aria-label="Current conversion metrics">
                <div><span>Input characters</span><strong>{metrics.characters.toLocaleString('en-US')}</strong></div>
                <div><span>Morse groups</span><strong>{metrics.groups.toLocaleString('en-US')}</strong></div>
                <div><span>Morse words</span><strong>{metrics.words.toLocaleString('en-US')}</strong></div>
                <div><span>Dot/dash signals</span><strong>{metrics.signals.toLocaleString('en-US')}</strong></div>
                <div><span>Diagnostics</span><strong>{diagnosticSummary(hasFreshResult ? result : null)}</strong></div>
              </div>

              <section className="morse-audio" aria-labelledby="morse-audio-heading">
                <header><strong id="morse-audio-heading">Synthesized tone playback</strong><span>Manual playback only</span></header>
                <div className="morse-audio-controls">
                  <label className="morse-field">
                    <span>Speed (5–40 WPM)</span>
                    <input
                      type="number"
                      min={5}
                      max={40}
                      step={1}
                      value={wpm}
                      disabled={isPlaying}
                      onChange={(event) => {
                        const next = event.currentTarget.valueAsNumber;
                        if (Number.isFinite(next)) setWpm(Math.min(40, Math.max(5, next)));
                      }}
                    />
                  </label>
                  <label className="morse-field">
                    <span>Pitch (300–1,000 Hz)</span>
                    <input
                      type="number"
                      min={300}
                      max={1000}
                      step={10}
                      value={pitch}
                      disabled={isPlaying}
                      onChange={(event) => {
                        const next = event.currentTarget.valueAsNumber;
                        if (Number.isFinite(next)) setPitch(Math.min(1000, Math.max(300, next)));
                      }}
                    />
                  </label>
                </div>
                <div className="morse-actions">
                  <button type="button" className="morse-button primary" onClick={() => void playAudio()} disabled={!canPlayAudio || isPlaying}>Play tone</button>
                  <button type="button" className="morse-button" onClick={() => disposePlayback(true)} disabled={!isPlaying}>Stop</button>
                </div>
                <p className="morse-status">
                  {audioSignalLimitExceeded
                    ? `Playback is limited to ${MAX_AUDIO_SIGNALS.toLocaleString('en-US')} dot/dash signals so a very large conversion cannot schedule excessive browser audio work.`
                    : audioDurationLimitExceeded
                      ? `At ${wpm} WPM this result would exceed the ${MAX_AUDIO_SECONDS / 60}-minute playback limit. Increase the speed or shorten the input.`
                      : 'Timing uses a 1:3 dot-to-dash ratio and 1:3:7 intra-character, character, and word gaps.'}
                </p>
              </section>

              <p className="morse-status" role="status" aria-live="polite" aria-atomic="true">{activity}</p>
            </div>
          </section>
        </div>

        <p className="morse-boundary"><strong>Written input only:</strong> tone playback is synthesized from the normalized result after you press Play. This tool does not record a microphone or decode audio files.</p>
      </div>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><MorseCodeTranslator /></React.StrictMode>);
