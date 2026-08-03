import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MAX_TEXT_INPUT_CODE_UNITS, type TextAnalysis } from './lib/text-analysis';
import type { TextCounterWorkerResponse } from './lib/text-counter-worker-protocol';
import './styles.css';
import './text-counter.css';

type PageMode = 'word-counter' | 'character-counter';
type AnalysisState = 'starting' | 'analyzing' | 'ready' | 'error';

const WORD_SAMPLE = `A reliable word count begins with an explicit boundary rule. English uses spaces often, but 日本語 and ภาษาไทย need language-aware segmentation.

LiveParse keeps the current text local and reports the resolved locale beside the result.`;
const CHARACTER_SAMPLE = `Café · Cafe\u0301 · 😀 · 👨‍👩‍👧‍👦 · 🇰🇷 · 한 · 한`;
const LOCALES = [
  ['auto', 'Auto · browser preference'],
  ['en', 'English · en'],
  ['ko', 'Korean · ko'],
  ['ja', 'Japanese · ja'],
  ['zh', 'Chinese · zh'],
  ['th', 'Thai · th'],
] as const;

function pageMode(): PageMode {
  return document.body.dataset.page === 'character-counter' ? 'character-counter' : 'word-counter';
}

function localeForWorker(locale: string): string {
  if (locale !== 'auto') return locale;
  return navigator.languages?.[0] || navigator.language || 'en';
}

function formatNumber(value: number | null): string {
  return value === null ? 'Unavailable' : value.toLocaleString('en-US');
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 sec';
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) return `${rounded} sec`;
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (minutes < 60) return remaining === 0 ? `${minutes} min` : `${minutes} min ${remaining} sec`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder === 0 ? `${hours} hr` : `${hours} hr ${minuteRemainder} min`;
}

function boundedInteger(value: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function Metric({ label, value, detail, primary = false }: {
  label: string;
  value: string;
  detail: string;
  primary?: boolean;
}): React.JSX.Element {
  return <article className={primary ? 'text-metric primary' : 'text-metric'}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

function useTextAnalysis(input: string, locale: string): {
  analysis: TextAnalysis | null;
  state: AnalysisState;
  error: string | null;
} {
  const workerRef = useRef<Worker | null>(null);
  const latestJobRef = useRef(0);
  const [workerReady, setWorkerReady] = useState(false);
  const [analysis, setAnalysis] = useState<TextAnalysis | null>(null);
  const [state, setState] = useState<AnalysisState>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./text-counter.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.addEventListener('message', (event: MessageEvent<TextCounterWorkerResponse>) => {
      const response = event.data;
      if (response.type === 'ready') {
        setWorkerReady(true);
        return;
      }
      if (response.type === 'protocol-error') {
        setState('error');
        setError(response.message);
        return;
      }
      if (response.jobId !== latestJobRef.current) return;
      if (response.ok) {
        setAnalysis(response.analysis);
        setState('ready');
        setError(null);
      } else {
        setAnalysis(null);
        setState('error');
        setError(response.message);
      }
    });
    worker.addEventListener('error', () => {
      workerRef.current = null;
      setWorkerReady(false);
      setAnalysis(null);
      setState('error');
      setError('The local text-analysis worker stopped unexpectedly. Reload the page to start a new worker.');
    });
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    if (!workerReady || !workerRef.current) return;
    const jobId = latestJobRef.current + 1;
    latestJobRef.current = jobId;
    setState('analyzing');
    setError(null);
    const timer = window.setTimeout(() => {
      workerRef.current?.postMessage({
        type: 'analyze',
        jobId,
        input,
        locale: localeForWorker(locale),
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [input, locale, workerReady]);

  return { analysis, state, error };
}

function WordResults({ analysis, readingWpm, speakingWpm }: {
  analysis: TextAnalysis;
  readingWpm: number;
  speakingWpm: number;
}): React.JSX.Element {
  const readingSeconds = analysis.words / readingWpm * 60;
  const speakingSeconds = analysis.words / speakingWpm * 60;
  return <>
    <div className="text-metrics">
      <Metric primary label="Words" value={formatNumber(analysis.words)} detail="Intl.Segmenter word-like segments" />
      <Metric label="Characters" value={formatNumber(analysis.graphemeClusters)} detail="Extended grapheme clusters" />
      <Metric label="Sentences" value={formatNumber(analysis.sentences)} detail="Nonblank sentence segments" />
      <Metric label="Paragraphs" value={formatNumber(analysis.paragraphs)} detail="Nonblank blocks separated by blank lines" />
      <Metric label="Lines" value={formatNumber(analysis.lines)} detail={`${formatNumber(analysis.lineBreaks)} recognized line breaks`} />
      <Metric label="UTF-8 bytes" value={formatNumber(analysis.utf8Bytes)} detail={analysis.utf8Bytes === null ? 'Ill-formed UTF-16 cannot be encoded strictly' : 'Current DOM text, without Unicode normalization'} />
    </div>
    <div className="text-time-grid">
      <article><span>Estimated reading time</span><strong>{formatDuration(readingSeconds)}</strong><small>{formatNumber(analysis.words)} words ÷ {readingWpm.toLocaleString('en-US')} WPM</small></article>
      <article><span>Estimated speaking time</span><strong>{formatDuration(speakingSeconds)}</strong><small>{formatNumber(analysis.words)} words ÷ {speakingWpm.toLocaleString('en-US')} WPM</small></article>
    </div>
  </>;
}

function CharacterResults({ analysis, limit }: { analysis: TextAnalysis; limit: number }): React.JSX.Element {
  const difference = limit - analysis.graphemeClusters;
  const progress = limit > 0 ? Math.min(100, analysis.graphemeClusters / limit * 100) : 0;
  return <>
    <div className="text-metrics">
      <Metric primary label="Characters · graphemes" value={formatNumber(analysis.graphemeClusters)} detail="Extended grapheme clusters" />
      <Metric label="Without whitespace" value={formatNumber(analysis.graphemesWithoutWhitespace)} detail="Graphemes not made entirely of Unicode whitespace" />
      <Metric label="Unicode code points" value={formatNumber(analysis.codePoints)} detail={`${formatNumber(analysis.unicodeScalars)} scalar values`} />
      <Metric label="UTF-16 code units" value={formatNumber(analysis.utf16CodeUnits)} detail="The value reported by JavaScript string.length" />
      <Metric label="UTF-8 bytes" value={formatNumber(analysis.utf8Bytes)} detail={analysis.utf8Bytes === null ? 'Unavailable for ill-formed UTF-16' : 'Strict encoding of the current DOM text'} />
      <Metric label="Lines" value={formatNumber(analysis.lines)} detail={`${formatNumber(analysis.lineBreaks)} recognized line breaks`} />
    </div>
    <section className={difference < 0 ? 'text-limit over' : 'text-limit'} aria-label="Custom grapheme limit status">
      <div><span>Custom grapheme limit</span><strong>{difference < 0 ? `${formatNumber(Math.abs(difference))} over` : `${formatNumber(difference)} remaining`}</strong></div>
      <div className="text-progress" role="progressbar" aria-label="Grapheme limit usage" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(analysis.graphemeClusters, limit)} aria-valuetext={`${formatNumber(analysis.graphemeClusters)} of ${formatNumber(limit)} grapheme clusters; ${difference < 0 ? `${formatNumber(Math.abs(difference))} over` : `${formatNumber(difference)} remaining`}`}><span style={{ width: `${progress}%` }} /></div>
      <small>{formatNumber(analysis.graphemeClusters)} of {formatNumber(limit)} grapheme clusters. The tool never clips the input.</small>
    </section>
    {analysis.loneSurrogates > 0 ? <p className="text-warning" role="alert"><strong>Strict UTF-8 bytes are unavailable.</strong> Found {formatNumber(analysis.loneSurrogates)} unpaired surrogate code unit{analysis.loneSurrogates === 1 ? '' : 's'} at UTF-16 offset{analysis.loneSurrogates === 1 ? '' : 's'} {analysis.loneSurrogateOffsets.slice(0, 8).join(', ')}{analysis.loneSurrogateOffsets.length > 8 ? '…' : ''}. Repair the string instead of silently encoding replacement characters.</p> : null}
  </>;
}

function TextCounterApp(): React.JSX.Element {
  const mode = useMemo(pageMode, []);
  const wordPage = mode === 'word-counter';
  const [input, setInput] = useState('');
  const [locale, setLocale] = useState('auto');
  const [readingWpmInput, setReadingWpmInput] = useState('238');
  const [speakingWpmInput, setSpeakingWpmInput] = useState('130');
  const [limitInput, setLimitInput] = useState('280');
  const [editError, setEditError] = useState<string | null>(null);
  const { analysis, state, error } = useTextAnalysis(input, locale);
  const readingWpm = boundedInteger(readingWpmInput, 238, 50, 1000);
  const speakingWpm = boundedInteger(speakingWpmInput, 130, 50, 1000);
  const limit = boundedInteger(limitInput, 280, 1, 1_000_000);

  const updateInput = (next: string) => {
    if (next.length > MAX_TEXT_INPUT_CODE_UNITS) {
      setEditError(`That edit was not applied. Text is limited to ${MAX_TEXT_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units so one paste cannot monopolize this tab.`);
      return;
    }
    setInput(next);
    setEditError(null);
  };

  const loadSample = () => updateInput(wordPage ? WORD_SAMPLE : CHARACTER_SAMPLE);
  const statusText = state === 'starting' ? 'Starting local worker…' : state === 'analyzing' ? 'Analyzing after a short pause…' : state === 'ready' ? `${wordPage ? `${formatNumber(analysis?.words ?? 0)} words` : `${formatNumber(analysis?.graphemeClusters ?? 0)} grapheme clusters`} counted locally with resolved locale ${analysis?.resolvedLocale ?? 'unknown'}.` : error ?? 'Analysis unavailable.';

  return <section className="text-counter-app" aria-label={wordPage ? 'Interactive word counter' : 'Interactive character counter'}>
    <header className="text-counter-toolbar">
      <div className="text-local-badge"><span aria-hidden="true" /><strong>Local worker</strong><small>No upload, storage, or automatic clipboard access</small></div>
      <div className="text-tool-badge"><span>{wordPage ? 'Words & structure' : 'Unicode lengths'}</span><strong>{MAX_TEXT_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 unit limit</strong></div>
    </header>
    <div className="text-counter-body">
      <div className="text-counter-intro"><div><p>Current DOM string · No Unicode normalization</p><h2>{wordPage ? 'Count a draft as you type' : 'Measure four definitions of length'}</h2></div><span>{wordPage ? 'Word and sentence boundaries use the resolved locale and the browser engine’s current internationalization data.' : 'Graphemes, code points, UTF-16 units, and UTF-8 bytes stay separate so the receiving contract remains visible.'}</span></div>
      <div className="text-counter-grid">
        <section className="text-input-card" aria-labelledby="text-input-heading">
          <header><div><p>Text input</p><h3 id="text-input-heading">Paste or type text</h3></div><span>{input.length.toLocaleString('en-US')} / {MAX_TEXT_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16</span></header>
          <div className="text-input-body">
            <textarea value={input} onChange={(event) => updateInput(event.target.value)} rows={16} spellCheck={false} placeholder={wordPage ? 'Paste an article, essay, caption, script, or draft here…' : 'Paste text with accents, emoji, combining marks, or multiple scripts here…'} aria-labelledby="text-input-heading" aria-describedby="text-input-note" />
            <div className="text-actions"><button className="text-button primary" type="button" onClick={loadSample}>Load Unicode sample</button><button className="text-button" type="button" onClick={() => updateInput('')}>Clear</button></div>
            <p id="text-input-note" className="text-note">Input changes are analyzed in a dedicated worker after a 150 ms pause. Text is not put in the URL or local storage. The browser textarea exposes CRLF and CR line endings as LF; no Unicode normalization is applied.</p>
            {editError ? <p className="text-error" role="alert">{editError}</p> : null}
          </div>
        </section>

        <section className="text-results-card" aria-labelledby="text-results-heading">
          <header><div><p>Live results</p><h3 id="text-results-heading">{wordPage ? 'Words, structure, and time' : 'Visible and encoded length'}</h3></div><span className={`text-state ${state}`}>{state === 'ready' ? 'Ready' : state === 'analyzing' ? 'Counting' : state === 'starting' ? 'Starting' : 'Error'}</span></header>
          <div className="text-results-body">
            <div className="text-controls">
              <label><span>Segmentation locale</span><select value={locale} onChange={(event) => setLocale(event.target.value)}>{LOCALES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              {wordPage ? <>
                <label><span>Reading WPM</span><input type="number" min="50" max="1000" value={readingWpmInput} onChange={(event) => setReadingWpmInput(event.target.value)} onBlur={() => setReadingWpmInput(String(readingWpm))} /></label>
                <label><span>Speaking WPM</span><input type="number" min="50" max="1000" value={speakingWpmInput} onChange={(event) => setSpeakingWpmInput(event.target.value)} onBlur={() => setSpeakingWpmInput(String(speakingWpm))} /></label>
              </> : <label><span>Grapheme limit</span><input type="number" min="1" max="1000000" value={limitInput} onChange={(event) => setLimitInput(event.target.value)} onBlur={() => setLimitInput(String(limit))} /></label>}
            </div>
            {error ? <p className="text-error" role="alert"><strong>Cannot analyze this text.</strong> {error}</p> : null}
            {analysis ? wordPage ? <WordResults analysis={analysis} readingWpm={readingWpm} speakingWpm={speakingWpm} /> : <CharacterResults analysis={analysis} limit={limit} /> : <p className="text-empty"><strong>{state === 'error' ? 'Results unavailable' : 'Preparing the counter'}</strong><span>The worker will return the first local snapshot without sending the text to a server.</span></p>}
            <p className="text-status" aria-live="polite">{statusText}</p>
          </div>
        </section>
      </div>
    </div>
  </section>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Text counter root element not found.');
createRoot(root).render(<TextCounterApp />);
