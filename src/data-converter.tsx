import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  csvToJson,
  jsonToCsv,
  type CsvToJsonResult,
  type JsonToCsvResult,
  type TableDelimiter,
} from './lib/tabular';
import './styles.css';
import './data-converter.css';

type Direction = 'json-to-csv' | 'csv-to-json';
type ConversionResult = JsonToCsvResult | CsvToJsonResult;

const direction = (document.body.dataset.converter === 'csv-to-json' ? 'csv-to-json' : 'json-to-csv') as Direction;

const content = {
  'json-to-csv': {
    inputLabel: 'JSON input',
    inputHelp: 'Paste a JSON array, a JSON object, or open a .json file.',
    inputPlaceholder: '[{"id": 1, "name": "Ada"}]',
    outputLabel: 'CSV output',
    outputHelp: 'Spreadsheet-safe CSV is generated locally in your browser.',
    convertLabel: 'Convert JSON to CSV',
    downloadName: 'liveparse-json-to-csv.csv',
    mime: 'text/csv;charset=utf-8',
    accept: '.json,application/json,text/json,text/plain',
    sample: `[
  {
    "id": 9007199254740993,
    "name": "Ada Lovelace",
    "active": true,
    "address": { "city": "London", "country": "UK" }
  },
  {
    "id": 9007199254740995,
    "name": "Grace Hopper",
    "active": true,
    "address": { "city": "New York", "country": "US" }
  }
]`,
    otherHref: '/csv-to-json/',
    otherLabel: 'Need the reverse? Open CSV to JSON',
  },
  'csv-to-json': {
    inputLabel: 'CSV input',
    inputHelp: 'Paste CSV text or open a .csv file. Quoted and multiline cells are supported.',
    inputPlaceholder: 'id,name\n1,Ada',
    outputLabel: 'JSON output',
    outputHelp: 'Values stay as strings unless type inference is enabled.',
    convertLabel: 'Convert CSV to JSON',
    downloadName: 'liveparse-csv-to-json.json',
    mime: 'application/json;charset=utf-8',
    accept: '.csv,text/csv,text/plain',
    sample: `id,name,active,note
9007199254740993,Ada Lovelace,true,"first programmer"
9007199254740995,Grace Hopper,true,"compiler pioneer"`,
    otherHref: '/json-to-csv/',
    otherLabel: 'Need the reverse? Open JSON to CSV',
  },
} as const;

const page = content[direction];

function conversionOptionsKey(
  delimiter: TableDelimiter,
  flattenNestedObjects: boolean,
  inferTypes: boolean,
  indent: 0 | 2 | 4,
): string {
  return JSON.stringify({ delimiter, flattenNestedObjects, inferTypes, indent });
}

function convert(
  input: string,
  delimiter: TableDelimiter,
  flattenNestedObjects: boolean,
  inferTypes: boolean,
  indent: 0 | 2 | 4,
): ConversionResult {
  return direction === 'json-to-csv'
    ? jsonToCsv(input, { delimiter, flattenNestedObjects, protectSpreadsheetFormulas: true })
    : csvToJson(input, { delimiter, firstRowHeaders: true, inferTypes, indent });
}

function resultText(result: ConversionResult): string {
  if (!result.ok) return '';
  return 'csv' in result ? result.csv : result.json;
}

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [input, setInput] = useState<string>(page.sample);
  const [delimiter, setDelimiter] = useState<TableDelimiter>(',');
  const [flattenNestedObjects, setFlattenNestedObjects] = useState(true);
  const [inferTypes, setInferTypes] = useState(false);
  const [indent, setIndent] = useState<0 | 2 | 4>(2);
  const [result, setResult] = useState<ConversionResult>(() => convert(page.sample, ',', true, false, 2));
  const [convertedSource, setConvertedSource] = useState<string>(page.sample);
  const [convertedOptions, setConvertedOptions] = useState(() => conversionOptionsKey(',', true, false, 2));
  const [activity, setActivity] = useState('Sample converted. Replace it with your own data when ready.');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const output = useMemo(() => resultText(result), [result]);
  const currentOptions = conversionOptionsKey(delimiter, flattenNestedObjects, inferTypes, indent);
  const stale = input !== convertedSource || currentOptions !== convertedOptions;

  const runConversion = () => {
    const next = convert(input, delimiter, flattenNestedObjects, inferTypes, indent);
    setResult(next);
    setConvertedSource(input);
    setConvertedOptions(currentOptions);
    if (next.ok) {
      setActivity(`Converted ${next.rowCount.toLocaleString()} row${next.rowCount === 1 ? '' : 's'} and ${next.columnCount.toLocaleString()} column${next.columnCount === 1 ? '' : 's'}.`);
    } else {
      const location = next.error.line ? ` Line ${next.error.line}${next.error.column ? `, column ${next.error.column}` : ''}.` : '';
      setActivity(`${next.error.message}${location}`);
    }
  };

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (text.length === 0) {
      setInput('');
      setResult({ ok: false, error: { message: 'The selected file is empty.' } });
      setConvertedSource('');
      setConvertedOptions(currentOptions);
      setActivity(`${file.name} is empty. Choose another file or paste data to begin.`);
      event.target.value = '';
      return;
    }
    setInput(text);
    setConvertedSource('');
    setActivity(`${file.name} loaded. Choose Convert to create the output.`);
    event.target.value = '';
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setActivity(`${direction === 'json-to-csv' ? 'CSV' : 'JSON'} copied to the clipboard.`);
    } catch {
      setActivity('Clipboard access failed. Use Download instead.');
    }
  };

  const clear = () => {
    setInput('');
    setConvertedSource('');
    setConvertedOptions(currentOptions);
    setResult({ ok: false, error: { message: 'Paste or open a file to begin.' } });
    setActivity('Cleared. Paste or open a file to begin.');
  };

  const statusClass = stale ? 'converter-stale' : result.ok ? 'converter-valid' : 'converter-error';
  const statusLabel = stale ? 'Ready to convert' : result.ok ? 'Converted' : 'Check input';

  return (
    <section className="converter-app" aria-label={page.convertLabel}>
      <div className="converter-toolbar">
        <div className="local-badge"><span aria-hidden="true" /><strong>Local conversion</strong><small>Your files and pasted data never leave this tab</small></div>
        <div className="converter-options" aria-label="Conversion settings">
          <label>
            Delimiter
            <select value={delimiter} onChange={(event) => setDelimiter(event.target.value as TableDelimiter)}>
              <option value=",">Comma (,)</option>
              <option value=";">Semicolon (;)</option>
              <option value="\t">Tab</option>
              <option value="|">Pipe (|)</option>
            </select>
          </label>
          {direction === 'json-to-csv' ? (
            <label className="converter-check"><input type="checkbox" checked={flattenNestedObjects} onChange={(event) => setFlattenNestedObjects(event.target.checked)} /> Flatten nested objects</label>
          ) : (
            <>
              <label className="converter-check"><input type="checkbox" checked={inferTypes} onChange={(event) => setInferTypes(event.target.checked)} /> Infer numbers, booleans, and null</label>
              <label>
                Indent
                <select value={indent} onChange={(event) => setIndent(Number(event.target.value) as 0 | 2 | 4)}>
                  <option value={2}>2 spaces</option>
                  <option value={4}>4 spaces</option>
                  <option value={0}>Minified</option>
                </select>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="converter-workspace">
        <section className="converter-panel" aria-labelledby="converter-input-title">
          <div className="converter-panel-header">
            <div><h3 id="converter-input-title">{page.inputLabel}</h3><p>{page.inputHelp}</p></div>
            <div className="converter-actions">
              <input ref={fileInputRef} className="visually-hidden" type="file" aria-label="Open a local file" accept={page.accept} onChange={loadFile} tabIndex={-1} />
              <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>Open file</button>
              <button type="button" className="ghost-button danger" onClick={clear}>Clear</button>
            </div>
          </div>
          <textarea
            className="converter-textarea mono"
            value={input}
            placeholder={page.inputPlaceholder}
            spellCheck={false}
            aria-label={page.inputLabel}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                runConversion();
              }
            }}
          />
          <div className="converter-run-row">
            <button type="button" className="converter-run" onClick={runConversion} disabled={!input.trim()}>{page.convertLabel}</button>
            <span>Ctrl/⌘ + Enter</span>
          </div>
        </section>

        <section className="converter-panel converter-output" aria-labelledby="converter-output-title">
          <div className="converter-panel-header">
            <div><h3 id="converter-output-title">{page.outputLabel}</h3><p>{page.outputHelp}</p></div>
            <div className="converter-actions">
              <button type="button" className="ghost-button" onClick={copyOutput} disabled={!output || stale}>Copy</button>
              <button type="button" className="primary-button" onClick={() => downloadText(output, page.downloadName, page.mime)} disabled={!output || stale}>Download</button>
            </div>
          </div>
          <div className={`converter-status ${statusClass}`} aria-live="polite">
            <strong>{statusLabel}</strong><span>{stale ? 'Input or settings changed. Convert again for a fresh result.' : activity}</span>
          </div>
          <textarea className="converter-textarea mono" value={output} readOnly aria-label={page.outputLabel} placeholder="Converted output appears here." spellCheck={false} />
          {direction === 'json-to-csv' && result.ok && 'warningCount' in result && result.warningCount > 0 && !stale && (
            <p className="converter-warning">{result.warningCount} precision or duplicate-key warning{result.warningCount === 1 ? '' : 's'} detected. Original JSON number tokens are preserved in the CSV.</p>
          )}
        </section>
      </div>

      <div className="converter-switch"><a href={page.otherHref}>{page.otherLabel} <span aria-hidden="true">→</span></a></div>
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
