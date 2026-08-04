import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MAX_TEXT_INPUT_CODE_UNITS, type TextAnalysis } from './lib/text-analysis';
import {
  calculateJapaneseManuscriptEstimate,
  calculateKoreanAsciiWeightedCount,
  formatTextCounterMessage,
  getTextCounterMessages,
  getTextCounterNumberLocale,
  resolveTextCounterAnalysisLocale,
  resolveTextCounterCharacterLimit,
  resolveTextCounterUiLocale,
  type TextCounterMessages,
  type TextCounterUiLocale,
} from './lib/text-counter-i18n';
import type { TextCounterWorkerResponse } from './lib/text-counter-worker-protocol';
import './styles.css';
import './text-counter.css';

type PageMode = 'word-counter' | 'character-counter';
type AnalysisState = 'starting' | 'analyzing' | 'ready' | 'error';

interface AnalysisFailure {
  readonly code: string;
}

const STANDARD_ANALYSIS_LOCALES = ['auto', 'en', 'es', 'ko', 'ja', 'zh', 'th'] as const;

function pageMode(): PageMode {
  return document.body.dataset.page === 'character-counter' ? 'character-counter' : 'word-counter';
}

function localeForWorker(locale: string): string {
  if (locale !== 'auto') return locale;
  return navigator.languages?.[0] || navigator.language || 'en';
}

function formatNumber(
  value: number | null,
  numberLocale: string,
  messages: TextCounterMessages,
): string {
  return value === null ? messages.unavailable : value.toLocaleString(numberLocale);
}

function formatDuration(
  seconds: number,
  numberLocale: string,
  messages: TextCounterMessages,
): string {
  const duration = (template: string, value: number) => formatTextCounterMessage(template, {
    value: value.toLocaleString(numberLocale),
  });
  if (!Number.isFinite(seconds) || seconds <= 0) return duration(messages.durationSeconds, 0);
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) return duration(messages.durationSeconds, rounded);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (minutes < 60) {
    return remaining === 0
      ? duration(messages.durationMinutes, minutes)
      : `${duration(messages.durationMinutes, minutes)} ${duration(messages.durationSeconds, remaining)}`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder === 0
    ? duration(messages.durationHours, hours)
    : `${duration(messages.durationHours, hours)} ${duration(messages.durationMinutes, minuteRemainder)}`;
}

function boundedInteger(value: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function analysisFailureMessage(failure: AnalysisFailure | null, messages: TextCounterMessages): string {
  switch (failure?.code) {
    case 'WORKER_STOPPED':
      return messages.workerStopped;
    case 'INVALID_REQUEST':
      return messages.invalidWorkerRequest;
    case 'REQUEST_DESERIALIZATION_FAILED':
      return messages.workerRequestUnreadable;
    case 'INPUT_TOO_LARGE':
      return messages.inputTooLargeAnalysis;
    case 'INVALID_LOCALE':
      return messages.invalidAnalysisLocale;
    case 'SEGMENTER_UNAVAILABLE':
      return messages.segmenterUnavailable;
    default:
      return messages.analysisFailed;
  }
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
  failure: AnalysisFailure | null;
} {
  const workerRef = useRef<Worker | null>(null);
  const latestJobRef = useRef(0);
  const [workerReady, setWorkerReady] = useState(false);
  const [analysis, setAnalysis] = useState<TextAnalysis | null>(null);
  const [state, setState] = useState<AnalysisState>('starting');
  const [failure, setFailure] = useState<AnalysisFailure | null>(null);

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
        setFailure({ code: response.code });
        return;
      }
      if (response.jobId !== latestJobRef.current) return;
      if (response.ok) {
        setAnalysis(response.analysis);
        setState('ready');
        setFailure(null);
      } else {
        setAnalysis(null);
        setState('error');
        setFailure({ code: response.code });
      }
    });
    worker.addEventListener('error', () => {
      workerRef.current = null;
      setWorkerReady(false);
      setAnalysis(null);
      setState('error');
      setFailure({ code: 'WORKER_STOPPED' });
    });
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    const jobId = latestJobRef.current + 1;
    latestJobRef.current = jobId;
    if (!workerReady || !workerRef.current) return;
    setState('analyzing');
    setFailure(null);
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

  return { analysis, state, failure };
}

function WordResults({ analysis, readingWpm, speakingWpm, messages, numberLocale }: {
  analysis: TextAnalysis;
  readingWpm: number;
  speakingWpm: number;
  messages: TextCounterMessages;
  numberLocale: string;
}): React.JSX.Element {
  const readingSeconds = analysis.words / readingWpm * 60;
  const speakingSeconds = analysis.words / speakingWpm * 60;
  const number = (value: number | null) => formatNumber(value, numberLocale, messages);
  const timeDetail = (wpm: number) => formatTextCounterMessage(messages.timeFormula, {
    words: number(analysis.words),
    wpm: wpm.toLocaleString(numberLocale),
  });
  return <>
    <div className="text-metrics">
      <Metric primary label={messages.wordsLabel} value={number(analysis.words)} detail={messages.wordsDetail} />
      <Metric label={messages.charactersLabel} value={number(analysis.graphemeClusters)} detail={messages.graphemeDetail} />
      <Metric label={messages.sentencesLabel} value={number(analysis.sentences)} detail={messages.sentencesDetail} />
      <Metric label={messages.paragraphsLabel} value={number(analysis.paragraphs)} detail={messages.paragraphsDetail} />
      <Metric label={messages.linesLabel} value={number(analysis.lines)} detail={formatTextCounterMessage(messages.recognizedLineBreaks, { count: number(analysis.lineBreaks) })} />
      <Metric label={messages.utf8BytesLabel} value={number(analysis.utf8Bytes)} detail={analysis.utf8Bytes === null ? messages.utf8IllFormedDetail : messages.utf8CurrentDomDetail} />
    </div>
    <div className="text-time-grid">
      <article><span>{messages.estimatedReadingTime}</span><strong>{formatDuration(readingSeconds, numberLocale, messages)}</strong><small>{timeDetail(readingWpm)}</small></article>
      <article><span>{messages.estimatedSpeakingTime}</span><strong>{formatDuration(speakingSeconds, numberLocale, messages)}</strong><small>{timeDetail(speakingWpm)}</small></article>
    </div>
  </>;
}

function CharacterResults({ analysis, input, limit, messages, numberLocale, uiLocale }: {
  analysis: TextAnalysis;
  input: string;
  limit: number;
  messages: TextCounterMessages;
  numberLocale: string;
  uiLocale: TextCounterUiLocale;
}): React.JSX.Element {
  const difference = limit - analysis.graphemeClusters;
  const progress = limit > 0 ? Math.min(100, analysis.graphemeClusters / limit * 100) : 0;
  const number = (value: number | null) => formatNumber(value, numberLocale, messages);
  const differenceText = difference < 0
    ? formatTextCounterMessage(messages.overLimit, { count: number(Math.abs(difference)) })
    : formatTextCounterMessage(messages.remainingLimit, { count: number(difference) });
  const japaneseEstimate = uiLocale === 'ja'
    ? calculateJapaneseManuscriptEstimate(analysis.graphemeClusters)
    : null;
  const koreanWeighted = uiLocale === 'ko'
    ? calculateKoreanAsciiWeightedCount(input)
    : null;

  return <>
    <div className="text-metrics">
      <Metric primary label={messages.graphemeCharactersLabel} value={number(analysis.graphemeClusters)} detail={messages.graphemeDetail} />
      <Metric label={messages.withoutWhitespaceLabel} value={number(analysis.graphemesWithoutWhitespace)} detail={messages.withoutWhitespaceDetail} />
      <Metric label={messages.codePointsLabel} value={number(analysis.codePoints)} detail={formatTextCounterMessage(messages.scalarValuesDetail, { count: number(analysis.unicodeScalars) })} />
      <Metric label={messages.utf16UnitsLabel} value={number(analysis.utf16CodeUnits)} detail={messages.utf16UnitsDetail} />
      <Metric label={messages.utf8BytesLabel} value={number(analysis.utf8Bytes)} detail={analysis.utf8Bytes === null ? messages.utf8UnavailableDetail : messages.utf8StrictDomDetail} />
      <Metric label={messages.linesLabel} value={number(analysis.lines)} detail={formatTextCounterMessage(messages.recognizedLineBreaks, { count: number(analysis.lineBreaks) })} />
      {japaneseEstimate ? <Metric
        label={messages.japaneseSheetsLabel}
        value={formatTextCounterMessage(messages.japaneseSheetsValue, {
          sheets: number(japaneseEstimate.fullSheets),
          remainder: number(japaneseEstimate.remainderCharacters),
        })}
        detail={messages.japaneseSheetsDetail}
      /> : null}
      {koreanWeighted ? <Metric
        label={messages.koreanWeightedLabel}
        value={number(koreanWeighted.weightedCount)}
        detail={messages.koreanWeightedDetail}
      /> : null}
    </div>
    <section className={difference < 0 ? 'text-limit over' : 'text-limit'} aria-label={messages.customLimitStatusAria}>
      <div><span>{messages.customGraphemeLimit}</span><strong>{differenceText}</strong></div>
      <div
        className="text-progress"
        role="progressbar"
        aria-label={messages.progressAria}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(analysis.graphemeClusters, limit)}
        aria-valuetext={formatTextCounterMessage(messages.progressValue, {
          current: number(analysis.graphemeClusters),
          limit: number(limit),
          difference: differenceText,
        })}
      ><span style={{ width: `${progress}%` }} /></div>
      <small>{formatTextCounterMessage(messages.limitSummary, {
        current: number(analysis.graphemeClusters),
        limit: number(limit),
      })}</small>
    </section>
    {analysis.loneSurrogates > 0 ? <p className="text-warning" role="alert">
      <strong>{messages.strictBytesUnavailable}</strong>{' '}
      {formatTextCounterMessage(messages.loneSurrogateWarning, {
        count: number(analysis.loneSurrogates),
        offsets: analysis.loneSurrogateOffsets.slice(0, 8).map((offset) => offset.toLocaleString(numberLocale)).join(', '),
        ellipsis: analysis.loneSurrogateOffsets.length > 8 ? '…' : '',
      })}
    </p> : null}
  </>;
}

function TextCounterApp(): React.JSX.Element {
  const mode = useMemo(pageMode, []);
  const uiLocale = useMemo(() => resolveTextCounterUiLocale(document.body.dataset.uiLocale), []);
  const messages = useMemo(() => getTextCounterMessages(uiLocale), [uiLocale]);
  const numberLocale = useMemo(() => getTextCounterNumberLocale(uiLocale), [uiLocale]);
  const initialAnalysisLocale = useMemo(
    () => resolveTextCounterAnalysisLocale(document.body.dataset.analysisLocale),
    [],
  );
  const defaultCharacterLimit = useMemo(
    () => resolveTextCounterCharacterLimit(document.body.dataset.characterLimit),
    [],
  );
  const wordPage = mode === 'word-counter';
  const [input, setInput] = useState('');
  const [locale, setLocale] = useState(initialAnalysisLocale);
  const [readingWpmInput, setReadingWpmInput] = useState('238');
  const [speakingWpmInput, setSpeakingWpmInput] = useState('130');
  const [limitInput, setLimitInput] = useState(String(defaultCharacterLimit));
  const [editError, setEditError] = useState<string | null>(null);
  const { analysis, state, failure } = useTextAnalysis(input, locale);
  const readingWpm = boundedInteger(readingWpmInput, 238, 50, 1000);
  const speakingWpm = boundedInteger(speakingWpmInput, 130, 50, 1000);
  const limit = boundedInteger(limitInput, defaultCharacterLimit, 1, 1_000_000);
  const number = (value: number | null) => formatNumber(value, numberLocale, messages);
  const analysisError = analysisFailureMessage(failure, messages);
  const localeOptions = useMemo(() => {
    const labels: Record<(typeof STANDARD_ANALYSIS_LOCALES)[number], string> = {
      auto: messages.localeAuto,
      en: messages.localeEnglish,
      es: messages.localeSpanish,
      ko: messages.localeKorean,
      ja: messages.localeJapanese,
      zh: messages.localeChinese,
      th: messages.localeThai,
    };
    const options: Array<readonly [string, string]> = STANDARD_ANALYSIS_LOCALES.map((value) => [value, labels[value]]);
    if (!STANDARD_ANALYSIS_LOCALES.some((value) => value === initialAnalysisLocale)) {
      options.unshift([
        initialAnalysisLocale,
        formatTextCounterMessage(messages.localeConfigured, { locale: initialAnalysisLocale }),
      ]);
    }
    return options;
  }, [initialAnalysisLocale, messages]);

  const updateInput = (next: string) => {
    if (next.length > MAX_TEXT_INPUT_CODE_UNITS) {
      setEditError(formatTextCounterMessage(messages.editTooLarge, {
        limit: MAX_TEXT_INPUT_CODE_UNITS.toLocaleString(numberLocale),
      }));
      return;
    }
    setInput(next);
    setEditError(null);
  };

  const loadSample = () => updateInput(wordPage ? messages.wordSample : messages.characterSample);
  const statusText = state === 'starting'
    ? messages.statusStarting
    : state === 'analyzing'
      ? messages.statusAnalyzing
      : state === 'ready'
        ? formatTextCounterMessage(
          wordPage ? messages.statusWordReady : messages.statusCharacterReady,
          {
            count: number(wordPage ? analysis?.words ?? 0 : analysis?.graphemeClusters ?? 0),
            locale: analysis?.resolvedLocale ?? messages.unknown,
          },
        )
        : failure ? analysisError : messages.statusUnavailable;
  const stateLabel = state === 'ready'
    ? messages.ready
    : state === 'analyzing'
      ? messages.counting
      : state === 'starting'
        ? messages.starting
        : messages.error;

  return <section
    className="text-counter-app"
    aria-label={wordPage ? messages.interactiveWordCounter : messages.interactiveCharacterCounter}
    lang={uiLocale}
  >
    <header className="text-counter-toolbar">
      <div className="text-local-badge"><span aria-hidden="true" /><strong>{messages.localWorker}</strong><small>{messages.privacyBadge}</small></div>
      <div className="text-tool-badge"><span>{wordPage ? messages.wordsAndStructure : messages.unicodeLengths}</span><strong>{formatTextCounterMessage(messages.inputCapBadge, { limit: MAX_TEXT_INPUT_CODE_UNITS.toLocaleString(numberLocale) })}</strong></div>
    </header>
    <div className="text-counter-body">
      <div className="text-counter-intro"><div><p>{messages.currentDomString}</p><h2>{wordPage ? messages.wordIntroTitle : messages.characterIntroTitle}</h2></div><span>{wordPage ? messages.wordIntroDetail : messages.characterIntroDetail}</span></div>
      <div className="text-counter-grid">
        <section className="text-input-card" aria-labelledby="text-input-heading">
          <header><div><p>{messages.textInput}</p><h3 id="text-input-heading">{messages.pasteOrType}</h3></div><span>{formatTextCounterMessage(messages.inputCounter, {
            current: input.length.toLocaleString(numberLocale),
            limit: MAX_TEXT_INPUT_CODE_UNITS.toLocaleString(numberLocale),
          })}</span></header>
          <div className="text-input-body">
            <textarea
              value={input}
              onChange={(event) => updateInput(event.target.value)}
              rows={16}
              spellCheck={false}
              placeholder={wordPage ? messages.wordPlaceholder : messages.characterPlaceholder}
              aria-labelledby="text-input-heading"
              aria-describedby="text-input-note"
            />
            <div className="text-actions"><button className="text-button primary" type="button" onClick={loadSample}>{messages.loadSample}</button><button className="text-button" type="button" onClick={() => updateInput('')}>{messages.clear}</button></div>
            <p id="text-input-note" className="text-note">{messages.inputNote}</p>
            {editError ? <p className="text-error" role="alert">{editError}</p> : null}
          </div>
        </section>

        <section className="text-results-card" aria-labelledby="text-results-heading">
          <header><div><p>{messages.liveResults}</p><h3 id="text-results-heading">{wordPage ? messages.wordResultsTitle : messages.characterResultsTitle}</h3></div><span className={`text-state ${state}`}>{stateLabel}</span></header>
          <div className="text-results-body">
            <div className="text-controls">
              <label><span>{messages.segmentationLocale}</span><select value={locale} onChange={(event) => setLocale(event.target.value)}>{localeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              {wordPage ? <>
                <label><span>{messages.readingWpm}</span><input type="number" min="50" max="1000" value={readingWpmInput} onChange={(event) => setReadingWpmInput(event.target.value)} onBlur={() => setReadingWpmInput(String(readingWpm))} /></label>
                <label><span>{messages.speakingWpm}</span><input type="number" min="50" max="1000" value={speakingWpmInput} onChange={(event) => setSpeakingWpmInput(event.target.value)} onBlur={() => setSpeakingWpmInput(String(speakingWpm))} /></label>
              </> : <label><span>{messages.graphemeLimit}</span><input type="number" min="1" max="1000000" value={limitInput} onChange={(event) => setLimitInput(event.target.value)} onBlur={() => setLimitInput(String(limit))} /></label>}
            </div>
            {failure ? <p className="text-error" role="alert"><strong>{messages.cannotAnalyze}</strong>{' '}{analysisError}</p> : null}
            {analysis ? wordPage
              ? <WordResults analysis={analysis} readingWpm={readingWpm} speakingWpm={speakingWpm} messages={messages} numberLocale={numberLocale} />
              : <CharacterResults analysis={analysis} input={input} limit={limit} messages={messages} numberLocale={numberLocale} uiLocale={uiLocale} />
              : <p className="text-empty"><strong>{state === 'error' ? messages.resultsUnavailable : messages.preparingCounter}</strong><span>{messages.emptyResultsDetail}</span></p>}
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
