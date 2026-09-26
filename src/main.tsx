import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import VirtualJsonTree from './components/VirtualJsonTree';
import { selectJsonDropFile } from './lib/json-file';
import type { JsonStats, JsonWarning } from './lib/lossless-json';
import { useLosslessJsonWorker } from './useLosslessJsonWorker';
import './styles.css';

type Layout = 'side' | 'top';
type OutputMode = 'text' | 'tree';

const samples = {
  'SEO metadata': `{
  "title": "JSON Formatter, Validator & Viewer Online | LiveParse",
  "description": "Format, validate, beautify, minify, and explore JSON locally while preserving 64-bit numbers and duplicate keys.",
  "canonicalUrl": "https://liveparse.com/json-formatter/",
  "robots": {
    "index": true,
    "follow": true,
    "maxImagePreview": "large"
  },
  "openGraph": {
    "type": "website",
    "siteName": "LiveParse",
    "title": "JSON Formatter & Validator",
    "description": "A private browser-based JSON tool that preserves the original data.",
    "url": "https://liveparse.com/json-formatter/",
    "image": "https://liveparse.com/og.png",
    "imageAlt": "LiveParse lossless JSON parser"
  },
  "twitter": {
    "card": "summary_large_image",
    "title": "Lossless JSON Parser & Formatter",
    "description": "Validate and format JSON locally without losing numeric precision.",
    "image": "https://liveparse.com/og.png"
  },
  "structuredData": {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "LiveParse JSON Formatter, Validator, and Viewer",
    "url": "https://liveparse.com/json-formatter/",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Any",
    "isAccessibleForFree": true
  }
}`,
  'Lossless safety checks': `{
  "safeInteger": 9007199254740991,
  "snowflakeId": 9007199254740993,
  "largeExponent": 1e400,
  "decimalToken": 1.2300,
  "event": "created",
  "event": "updated"
}`,
  'Developer profile': `{
  "name": "Jackson Jang",
  "project": "LiveParse",
  "role": "Creator",
  "github": "https://github.com/JacksonJang",
  "focus": ["lossless JSON", "developer tools", "local-first web apps"],
  "active": true
}`,
  'API response': `{
  "status": "success",
  "requestId": 7443251909984833537,
  "data": {
    "localFirst": true,
    "features": ["validate", "format", "virtual tree", "warnings"],
    "limits": null
  }
}`,
  'Nested product data': `{
  "app": {
    "name": "LiveParse",
    "tagline": "Lossless JSON tools that keep data local",
    "domain": "liveparse.com"
  },
  "workflow": {
    "input": "Paste strict JSON",
    "output": ["formatted text", "virtualized tree"]
  },
  "privacy": { "processing": "browser worker", "uploads": false }
}`,
  'Invalid JSON example': `{
  "project": "LiveParse",
  "features": ["parser", "tree", "warnings",],
  "valid": false
}`,
} as const;

type SampleName = keyof typeof samples;

type UiText = {
  sampleLabels: Record<SampleName, string>;
  appAria: string;
  localProcessing: string;
  localPrivacy: string;
  parserSettings: string;
  example: string;
  editorLayout: string;
  sideBySide: string;
  stacked: string;
  inputTitle: string;
  inputMeta: (lines: string, characters: string) => string;
  openFile: string;
  format: string;
  minify: string;
  clear: string;
  dropHint: string;
  fileLoaded: (name: string) => string;
  fileRejected: (message: string) => string;
  inputAria: string;
  inputPlaceholder: string;
  outputTitle: string;
  outputLocalMeta: string;
  outputView: string;
  textView: string;
  treeView: string;
  download: string;
  copyOutput: string;
  copied: string;
  copyFailed: string;
  validStatus: (kind: string, warnings: number) => string;
  jsonError: string;
  parsing: string;
  workerError: string;
  waitingForInput: string;
  statsSummary: (stats: JsonStats, durationMs: number) => string;
  valueStats: (stats: JsonStats) => string;
  warningSummary: (count: number) => string;
  viewOptions: string;
  losslessStrictJson: string;
  indent: string;
  formattingIndentation: string;
  twoSpaces: string;
  fourSpaces: string;
  minifiedOutput: string;
  color: string;
  sortKeys: string;
  types: string;
  arrayIndexes: string;
  formattedOutputAria: string;
  treeOutputAria: string;
  emptyInput: string;
  errorLocation: (line: number, column: number, position: number) => string;
  warningsHeading: (count: number) => string;
  moreWarnings: (count: number) => string;
  warningAt: (line: number, column: number, path: string) => string;
  warningUnsafe: (raw: string) => string;
  warningOverflow: (raw: string) => string;
  warningRepresentation: (raw: string, representation: string, changed: boolean) => string;
  warningDuplicate: (key: string, occurrence: number) => string;
  largeTextPlain: string;
  kindNames: Record<string, string>;
};

const en: UiText = {
  sampleLabels: {
    'SEO metadata': 'SEO metadata',
    'Lossless safety checks': '64-bit & duplicate key checks',
    'Developer profile': 'Developer profile',
    'API response': 'API response with Snowflake ID',
    'Nested product data': 'Nested product data',
    'Invalid JSON example': 'Invalid JSON example',
  },
  appAria: 'Interactive JSON formatter and validator',
  localProcessing: 'Local worker',
  localPrivacy: 'Your JSON never leaves this tab',
  parserSettings: 'Parser settings',
  example: 'Example',
  editorLayout: 'Editor layout',
  sideBySide: 'Side by side',
  stacked: 'Stacked',
  inputTitle: 'JSON input',
  inputMeta: (lines, characters) => `${lines} lines · ${characters} characters`,
  openFile: 'Open file',
  format: 'Format',
  minify: 'Minify',
  clear: 'Clear',
  dropHint: 'Drag and drop one .json, .jsonl, or text file here',
  fileLoaded: (name) => `Loaded ${name} locally.`,
  fileRejected: (message) => message,
  inputAria: 'Paste JSON input',
  inputPlaceholder: 'Paste JSON here. Number tokens and duplicate keys stay intact.',
  outputTitle: 'Lossless output',
  outputLocalMeta: 'Parsing and formatting stay in your browser',
  outputView: 'Output view',
  textView: 'Text',
  treeView: 'Tree',
  download: 'Download',
  copyOutput: 'Copy output',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  validStatus: (kind, warnings) => warnings > 0 ? `Valid ${kind} · ${warnings} warning${warnings === 1 ? '' : 's'}` : `Valid ${kind} · lossless`,
  jsonError: 'JSON error',
  parsing: 'Checking…',
  workerError: 'Parser unavailable',
  waitingForInput: 'Waiting for input',
  statsSummary: (stats, durationMs) => `${stats.objects} objects · ${stats.arrays} arrays · ${stats.properties} properties · ${stats.characters.toLocaleString()} chars · ${Math.max(1, Math.round(durationMs))} ms worker`,
  valueStats: (stats) => `${stats.strings} strings · ${stats.numbers} numbers · ${stats.booleans} booleans · ${stats.nulls} nulls`,
  warningSummary: (count) => `${count} data-integrity warning${count === 1 ? '' : 's'} — output still preserves the original tokens`,
  viewOptions: 'View options',
  losslessStrictJson: 'Lossless strict JSON',
  indent: 'Indent',
  formattingIndentation: 'Formatting indentation',
  twoSpaces: '2 spaces',
  fourSpaces: '4 spaces',
  minifiedOutput: 'Minified output',
  color: 'Color',
  sortKeys: 'Sort keys',
  types: 'Types',
  arrayIndexes: 'Array indexes',
  formattedOutputAria: 'Losslessly formatted JSON output',
  treeOutputAria: 'Virtualized JSON tree output',
  emptyInput: 'Empty input: paste or type JSON to begin.',
  errorLocation: (line, column, position) => `Line ${line}, column ${column}, position ${position}`,
  warningsHeading: (count) => `Data integrity warnings (${count})`,
  moreWarnings: (count) => `${count} more warnings are not shown. Download or search the tree to inspect the complete document.`,
  warningAt: (line, column, path) => `Line ${line}, column ${column} · ${path}`,
  warningUnsafe: (raw) => `${raw} is outside JavaScript's safe integer range. LiveParse preserved it exactly.`,
  warningOverflow: (raw) => `${raw} would overflow a JavaScript Number and stringify as null. LiveParse preserved the token.`,
  warningRepresentation: (raw, representation, changed) => changed
    ? `${raw} would become ${representation} after a JavaScript Number round-trip.`
    : `${raw} would be rewritten as ${representation}; the numeric value is equivalent but its spelling would change.`,
  warningDuplicate: (key, occurrence) => `Duplicate key ${JSON.stringify(key)} (occurrence ${occurrence}) was preserved instead of replacing an earlier value.`,
  largeTextPlain: 'Syntax color is disabled above 100 KB to keep the page responsive.',
  kindNames: {},
};
const ko: UiText = {
  sampleLabels: {
    'SEO metadata': 'SEO 메타데이터',
    'Lossless safety checks': '64비트·중복 키 검사',
    'Developer profile': '개발자 프로필',
    'API response': 'Snowflake ID가 포함된 API 응답',
    'Nested product data': '중첩된 상품 데이터',
    'Invalid JSON example': '잘못된 JSON 예시',
  },
  appAria: '대화형 JSON 포매터·검사기',
  localProcessing: '로컬 워커',
  localPrivacy: '입력한 JSON은 이 탭을 떠나지 않습니다',
  parserSettings: '파서 설정',
  example: '예시',
  editorLayout: '편집기 배치',
  sideBySide: '나란히',
  stacked: '위아래로',
  inputTitle: 'JSON 입력',
  inputMeta: (lines, characters) => `${lines}줄 · ${characters}자`,
  openFile: '파일 열기',
  format: '포맷',
  minify: '압축',
  clear: '지우기',
  dropHint: '.json, .jsonl 또는 텍스트 파일 하나를 여기에 끌어다 놓으세요',
  fileLoaded: (name) => `${name} 파일을 로컬에서 불러왔습니다.`,
  fileRejected: (message) => message,
  inputAria: 'JSON 입력 붙여넣기',
  inputPlaceholder: '여기에 JSON을 붙여넣으세요. 숫자 토큰과 중복 키는 그대로 보존됩니다.',
  outputTitle: '무손실 출력',
  outputLocalMeta: '파싱과 포맷팅은 브라우저 안에서만 실행됩니다',
  outputView: '출력 보기',
  textView: '텍스트',
  treeView: '트리',
  download: '다운로드',
  copyOutput: '출력 복사',
  copied: '복사됨',
  copyFailed: '복사 실패',
  validStatus: (kind, warnings) => warnings > 0 ? `유효한 ${kind} · 경고 ${warnings}개` : `유효한 ${kind} · 무손실`,
  jsonError: 'JSON 오류',
  parsing: '검사 중…',
  workerError: '파서를 사용할 수 없음',
  waitingForInput: '입력 대기 중',
  statsSummary: (stats, durationMs) => `객체 ${stats.objects}개 · 배열 ${stats.arrays}개 · 속성 ${stats.properties}개 · 문자 ${stats.characters.toLocaleString()}개 · 워커 ${Math.max(1, Math.round(durationMs))}ms`,
  valueStats: (stats) => `문자열 ${stats.strings}개 · 숫자 ${stats.numbers}개 · 불리언 ${stats.booleans}개 · null ${stats.nulls}개`,
  warningSummary: (count) => `데이터 무결성 경고 ${count}개 — 출력은 원본 토큰을 그대로 보존합니다`,
  viewOptions: '보기 옵션',
  losslessStrictJson: '무손실 엄격 JSON',
  indent: '들여쓰기',
  formattingIndentation: '포맷팅 들여쓰기',
  twoSpaces: '공백 2칸',
  fourSpaces: '공백 4칸',
  minifiedOutput: '압축 출력',
  color: '색상',
  sortKeys: '키 정렬',
  types: '타입',
  arrayIndexes: '배열 인덱스',
  formattedOutputAria: '무손실 포맷팅된 JSON 출력',
  treeOutputAria: '가상화된 JSON 트리 출력',
  emptyInput: '입력이 비어 있습니다. JSON을 붙여넣거나 입력하여 시작하세요.',
  errorLocation: (line, column, position) => `${line}줄 ${column}칸 (위치 ${position})`,
  warningsHeading: (count) => `데이터 무결성 경고 (${count})`,
  moreWarnings: (count) => `나머지 경고 ${count}개는 표시되지 않습니다. 전체 문서를 보려면 다운로드하거나 트리에서 검색하세요.`,
  warningAt: (line, column, path) => `${line}줄 ${column}칸 · ${path}`,
  warningUnsafe: (raw) => `${raw}은(는) JavaScript의 안전한 정수 범위를 벗어납니다. LiveParse는 이 값을 그대로 보존했습니다.`,
  warningOverflow: (raw) => `${raw}은(는) JavaScript Number에서 오버플로되어 null로 직렬화될 수 있습니다. LiveParse는 이 토큰을 보존했습니다.`,
  warningRepresentation: (raw, representation, changed) => changed
    ? `${raw}은(는) JavaScript Number로 왕복한 뒤 ${representation}이(가) 됩니다.`
    : `${raw}은(는) ${representation}으로 다시 쓰일 수 있습니다. 수 값은 같지만 표기가 바뀝니다.`,
  warningDuplicate: (key, occurrence) => `중복 키 ${JSON.stringify(key)}(${occurrence}번째)는 이전 값을 덮어쓰지 않고 보존되었습니다.`,
  largeTextPlain: '페이지 응답성을 위해 100KB를 넘으면 구문 강조가 꺼집니다.',
  kindNames: { object: '객체', array: '배열' },
};
const es: UiText = {
  sampleLabels: {
    'SEO metadata': 'Metadatos SEO',
    'Lossless safety checks': 'Verificaciones de 64 bits y claves duplicadas',
    'Developer profile': 'Perfil de desarrollador',
    'API response': 'Respuesta de API con ID Snowflake',
    'Nested product data': 'Datos de producto anidados',
    'Invalid JSON example': 'Ejemplo de JSON inválido',
  },
  appAria: 'Formateador y validador de JSON interactivo',
  localProcessing: 'Worker local',
  localPrivacy: 'Tu JSON nunca sale de esta pestaña',
  parserSettings: 'Ajustes del analizador',
  example: 'Ejemplo',
  editorLayout: 'Disposición del editor',
  sideBySide: 'Lado a lado',
  stacked: 'Apilado',
  inputTitle: 'Entrada JSON',
  inputMeta: (lines, characters) => `${lines} líneas · ${characters} caracteres`,
  openFile: 'Abrir archivo',
  format: 'Formatear',
  minify: 'Minificar',
  clear: 'Limpiar',
  dropHint: 'Arrastra aquí un archivo .json, .jsonl o de texto',
  fileLoaded: (name) => `${name} cargado localmente.`,
  fileRejected: (message) => message,
  inputAria: 'Pegar la entrada JSON',
  inputPlaceholder: 'Pega JSON aquí. Los tokens numéricos y las claves duplicadas se conservan intactos.',
  outputTitle: 'Salida sin pérdida',
  outputLocalMeta: 'El análisis y el formateo ocurren en tu navegador',
  outputView: 'Vista de salida',
  textView: 'Texto',
  treeView: 'Árbol',
  download: 'Descargar',
  copyOutput: 'Copiar salida',
  copied: 'Copiado',
  copyFailed: 'Error al copiar',
  validStatus: (kind, warnings) => warnings > 0 ? `${kind} válido · ${warnings} advertencia${warnings === 1 ? '' : 's'}` : `${kind} válido · sin pérdida`,
  jsonError: 'Error de JSON',
  parsing: 'Comprobando…',
  workerError: 'Analizador no disponible',
  waitingForInput: 'Esperando entrada',
  statsSummary: (stats, durationMs) => `${stats.objects} objetos · ${stats.arrays} arrays · ${stats.properties} propiedades · ${stats.characters.toLocaleString()} caracteres · worker ${Math.max(1, Math.round(durationMs))} ms`,
  valueStats: (stats) => `${stats.strings} cadenas · ${stats.numbers} números · ${stats.booleans} booleanos · ${stats.nulls} nulos`,
  warningSummary: (count) => `${count} advertencia${count === 1 ? '' : 's'} de integridad — la salida conserva los tokens originales`,
  viewOptions: 'Opciones de vista',
  losslessStrictJson: 'JSON estricto sin pérdida',
  indent: 'Sangría',
  formattingIndentation: 'Sangría del formateo',
  twoSpaces: '2 espacios',
  fourSpaces: '4 espacios',
  minifiedOutput: 'Salida minificada',
  color: 'Color',
  sortKeys: 'Ordenar claves',
  types: 'Tipos',
  arrayIndexes: 'Índices de array',
  formattedOutputAria: 'Salida JSON formateada sin pérdida',
  treeOutputAria: 'Salida JSON en árbol virtualizado',
  emptyInput: 'Entrada vacía: pega o escribe JSON para empezar.',
  errorLocation: (line, column, position) => `Línea ${line}, columna ${column}, posición ${position}`,
  warningsHeading: (count) => `Advertencias de integridad de datos (${count})`,
  moreWarnings: (count) => `${count} advertencias más no se muestran. Descarga o busca en el árbol para inspeccionar el documento completo.`,
  warningAt: (line, column, path) => `Línea ${line}, columna ${column} · ${path}`,
  warningUnsafe: (raw) => `${raw} está fuera del rango seguro de enteros de JavaScript. LiveParse lo conservó exactamente.`,
  warningOverflow: (raw) => `${raw} desbordaría un Number de JavaScript y se serializaría como null. LiveParse conservó el token.`,
  warningRepresentation: (raw, representation, changed) => changed
    ? `${raw} se convertiría en ${representation} tras un viaje de ida y vuelta por Number de JavaScript.`
    : `${raw} se reescribiría como ${representation}; el valor numérico es equivalente pero su escritura cambiaría.`,
  warningDuplicate: (key, occurrence) => `La clave duplicada ${JSON.stringify(key)} (ocurrencia ${occurrence}) se conservó en lugar de reemplazar un valor anterior.`,
  largeTextPlain: 'El resaltado de sintaxis se desactiva por encima de 100 KB para mantener la página fluida.',
  kindNames: { object: 'objeto', array: 'array' },
};
const ja: UiText = {
  sampleLabels: {
    'SEO metadata': 'SEOメタデータ',
    'Lossless safety checks': '64ビット・重複キーの検査',
    'Developer profile': '開発者プロファイル',
    'API response': 'Snowflake ID付きAPIレスポンス',
    'Nested product data': 'ネストした商品データ',
    'Invalid JSON example': '不正なJSONの例',
  },
  appAria: '対話型JSONフォーマッター・バリデーター',
  localProcessing: 'ローカルワーカー',
  localPrivacy: '入力したJSONはこのタブから出ません',
  parserSettings: 'パーサー設定',
  example: '例',
  editorLayout: 'エディターレイアウト',
  sideBySide: '左右並列',
  stacked: '上下重ねて',
  inputTitle: 'JSON入力',
  inputMeta: (lines, characters) => `${lines}行 · ${characters}文字`,
  openFile: 'ファイルを開く',
  format: '整形',
  minify: '圧縮',
  clear: 'クリア',
  dropHint: '.json・.jsonl・テキストファイルを1つここにドロップしてください',
  fileLoaded: (name) => `${name} をローカルで読み込みました。`,
  fileRejected: (message) => message,
  inputAria: 'JSON入力を貼り付け',
  inputPlaceholder: 'ここにJSONを貼り付けてください。数値トークンと重複キーはそのまま保持されます。',
  outputTitle: '可逆出力',
  outputLocalMeta: '解析と整形はブラウザー内で実行されます',
  outputView: '出力ビュー',
  textView: 'テキスト',
  treeView: 'ツリー',
  download: 'ダウンロード',
  copyOutput: '出力をコピー',
  copied: 'コピーしました',
  copyFailed: 'コピーに失敗しました',
  validStatus: (kind, warnings) => warnings > 0 ? `有効な${kind} · 警告${warnings}件` : `有効な${kind} · 可逆`,
  jsonError: 'JSONエラー',
  parsing: '確認中…',
  workerError: 'パーサーを利用できません',
  waitingForInput: '入力待ち',
  statsSummary: (stats, durationMs) => `オブジェクト${stats.objects} · 配列${stats.arrays} · プロパティ${stats.properties} · 文字${stats.characters.toLocaleString()} · ワーカー${Math.max(1, Math.round(durationMs))}ms`,
  valueStats: (stats) => `文字列${stats.strings} · 数値${stats.numbers} · 真偽値${stats.booleans} · null${stats.nulls}`,
  warningSummary: (count) => `データ整合性の警告${count}件 — 出力は元のトークンを保持します`,
  viewOptions: '表示オプション',
  losslessStrictJson: '可逆な厳密JSON',
  indent: 'インデント',
  formattingIndentation: '整形のインデント',
  twoSpaces: '2スペース',
  fourSpaces: '4スペース',
  minifiedOutput: '圧縮出力',
  color: '色',
  sortKeys: 'キー並べ替え',
  types: '型',
  arrayIndexes: '配列インデックス',
  formattedOutputAria: '可逆に整形されたJSON出力',
  treeOutputAria: '仮想化されたJSONツリー出力',
  emptyInput: '入力が空です。JSONを貼り付けるか入力して開始してください。',
  errorLocation: (line, column, position) => `${line}行${column}桁（位置${position}）`,
  warningsHeading: (count) => `データ整合性の警告（${count}）`,
  moreWarnings: (count) => `残りの警告${count}件は表示されません。完全なドキュメントを確認するにはダウンロードするかツリー内を検索してください。`,
  warningAt: (line, column, path) => `${line}行${column}桁 · ${path}`,
  warningUnsafe: (raw) => `${raw} はJavaScriptの安全な整数範囲外です。LiveParseはこの値をそのまま保持しました。`,
  warningOverflow: (raw) => `${raw} はJavaScriptのNumberでオーバーフローしnullとしてシリアライズされます。LiveParseはこのトークンを保持しました。`,
  warningRepresentation: (raw, representation, changed) => changed
    ? `${raw} はJavaScriptのNumberで往復すると ${representation} になります。`
    : `${raw} は ${representation} に書き換わる可能性があります。数値は同じでも表記が変わります。`,
  warningDuplicate: (key, occurrence) => `重複キー ${JSON.stringify(key)}（${occurrence}回目）は以前の値を上書きせず保持されました。`,
  largeTextPlain: 'ページの応答性を保つため、100KBを超えると構文ハイライトが無効になります。',
  kindNames: { object: 'オブジェクト', array: '配列' },
};
function resolveJsonFormatterUiText(locale: string | undefined): UiText {
  const primaryLanguage = locale?.trim().toLowerCase().replace('_', '-').split('-')[0];
  return primaryLanguage === 'ko' ? ko : primaryLanguage === 'es' ? es : primaryLanguage === 'ja' ? ja : en;
}
const t: UiText = resolveJsonFormatterUiText(
  typeof document === 'undefined' ? undefined : document.body.dataset.uiLocale,
);
const sampleNames = Object.keys(samples) as SampleName[];
const initialSample: SampleName = 'SEO metadata';
const initialJson = samples[initialSample];
const MAX_HIGHLIGHT_CHARACTERS = 100_000;
const MAX_VISIBLE_WARNINGS = 40;

function warningMessage(warning: JsonWarning): string {
  switch (warning.code) {
    case 'unsafe-integer': return t.warningUnsafe(warning.raw);
    case 'number-overflow': return t.warningOverflow(warning.raw);
    case 'number-representation-change': return t.warningRepresentation(
      warning.raw,
      warning.javascriptRepresentation,
      warning.valueChanged,
    );
    case 'duplicate-key': return t.warningDuplicate(warning.key, warning.occurrence);
  }
}

function App() {
  const [input, setInput] = useState<string>(initialJson);
  const [layout, setLayout] = useState<Layout>('side');
  const [outputMode, setOutputMode] = useState<OutputMode>('tree');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [minify, setMinify] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [sortKeys, setSortKeys] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const [showIndex, setShowIndex] = useState(true);
  const [copyLabel, setCopyLabel] = useState(t.copyOutput);
  const [dragActive, setDragActive] = useState(false);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerState = useLosslessJsonWorker(input, sortKeys);

  const inputEmpty = !input.trim();
  const stateMatchesInput = workerState.source === input;
  const response = stateMatchesInput && workerState.status === 'ready' ? workerState.response : undefined;
  const result = response?.result;
  const jsonDocument = result?.ok ? result.document : undefined;
  const formatted = indent === 2 ? response?.formatted2 ?? '' : response?.formatted4 ?? '';
  const outputText = useMemo(() => {
    if (inputEmpty) return t.emptyInput;
    if (!stateMatchesInput) return t.parsing;
    if (workerState.status === 'empty') return t.emptyInput;
    if (workerState.status === 'pending') return t.parsing;
    if (workerState.status === 'failed') return workerState.message;
    if (!workerState.response.result.ok) {
      const error = workerState.response.result.error;
      return `${error.message}\n${t.errorLocation(error.location.line, error.location.column, error.location.offset)}`;
    }
    return minify ? workerState.response.minified ?? '' : indent === 2
      ? workerState.response.formatted2 ?? ''
      : workerState.response.formatted4 ?? '';
  }, [indent, inputEmpty, minify, stateMatchesInput, workerState]);
  const lineCount = response ? response.lineCount.toLocaleString() : input ? '…' : '0';
  const isReady = stateMatchesInput && workerState.status === 'ready';
  const isValid = jsonDocument !== undefined;
  const warningCount = jsonDocument?.warnings.length ?? 0;

  const formatInput = () => {
    if (!jsonDocument) return;
    setInput(formatted);
    setMinify(false);
  };

  const minifyInput = () => {
    if (!jsonDocument || !response?.minified) return;
    setInput(response.minified);
    setMinify(true);
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopyLabel(t.copied);
    } catch {
      setCopyLabel(t.copyFailed);
    }
    window.setTimeout(() => setCopyLabel(t.copyOutput), 1300);
  };

  const loadFiles = async (files: readonly File[] | FileList | null) => {
    const selected = selectJsonDropFile(files);
    if (selected === null) return;
    if (selected instanceof Error) {
      setFileMessage(t.fileRejected(selected.message));
      return;
    }
    setInput(await selected.text());
    setMinify(false);
    setFileMessage(t.fileLoaded(selected.name));
  };

  const loadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await loadFiles(event.target.files);
    event.target.value = '';
  };

  const downloadOutput = () => {
    const blob = new Blob([outputText], { type: isValid ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = isValid ? 'liveparse-lossless.json' : 'json-error.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const isPending = !inputEmpty && (!stateMatchesInput || workerState.status === 'pending');
  const statusClass = isPending
    ? 'json-pending'
    : jsonDocument
      ? warningCount > 0 ? 'json-warning' : 'json-valid'
      : inputEmpty ? 'json-empty' : 'json-error';
  const statusLabel = isPending
    ? t.parsing
    : workerState.status === 'failed'
      ? t.workerError
      : jsonDocument
        ? t.validStatus(t.kindNames[jsonDocument.root.type] ?? jsonDocument.root.type, warningCount)
        : inputEmpty ? t.waitingForInput : t.jsonError;
  const statusDetail = isPending
    ? t.outputLocalMeta
    : jsonDocument
      ? warningCount > 0 ? t.warningSummary(warningCount) : t.valueStats(jsonDocument.stats)
      : outputText;

  return (
    <section className="parser-app" aria-label={t.appAria}>
      <div className="tool-toolbar">
        <div className="local-badge"><span aria-hidden="true" /><strong>{t.localProcessing}</strong><small>{t.localPrivacy}</small></div>
        <div className="tool-settings" aria-label={t.parserSettings}>
          <label className="select-label">
            {t.example}
            <select
              onChange={(event) => {
                setInput(samples[event.target.value as SampleName]);
                setMinify(false);
                setFileMessage(null);
              }}
              defaultValue={initialSample}
            >
              {sampleNames.map((name) => <option key={name} value={name}>{t.sampleLabels[name]}</option>)}
            </select>
          </label>
          <Segmented label={t.editorLayout} value={layout} options={[["side", t.sideBySide], ["top", t.stacked]]} onChange={(value) => setLayout(value as Layout)} />
        </div>
      </div>

      <div className={`workspace ${layout}`}>
        <section className={`panel input-card${dragActive ? ' drop-target' : ''}`} aria-labelledby="input-title">
          <PanelHeader
            id="input-title"
            title={t.inputTitle}
            meta={t.inputMeta(lineCount, input.length.toLocaleString())}
            actions={<>
              <input ref={fileInputRef} className="visually-hidden" type="file" aria-label="Open a local file" accept=".json,application/json,text/json,text/plain" onChange={loadFile} tabIndex={-1} />
              <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}>{t.openFile}</button>
              <button type="button" className="ghost-button" onClick={formatInput} disabled={!isValid}>{t.format}</button>
              <button type="button" className="ghost-button" onClick={minifyInput} disabled={!isValid}>{t.minify}</button>
              <button type="button" className="ghost-button danger" onClick={() => { setInput(''); setMinify(false); setFileMessage(null); }}>{t.clear}</button>
            </>}
          />
          <textarea
            id="json-input"
            className="input-pane mono"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void loadFiles(event.dataTransfer.files);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                formatInput();
              }
            }}
            aria-label={t.inputAria}
            placeholder={t.inputPlaceholder}
          />
          <p className="file-drop-note" role="status" aria-live="polite">
            {fileMessage ?? t.dropHint}
          </p>
        </section>

        <section className={`panel output-card ${statusClass} ${colorize ? 'color' : ''}`} aria-labelledby="output-title">
          <PanelHeader
            id="output-title"
            title={t.outputTitle}
            meta={jsonDocument && response ? t.statsSummary(jsonDocument.stats, response.durationMs) : t.outputLocalMeta}
            actions={<>
              <Segmented label={t.outputView} value={outputMode} options={[["text", t.textView], ["tree", t.treeView]]} onChange={(value) => setOutputMode(value as OutputMode)} compact />
              <button type="button" className="ghost-button" onClick={downloadOutput} disabled={!isReady}>{t.download}</button>
              <button type="button" className="primary-button" onClick={() => void copyOutput()} disabled={!isReady}>{copyLabel}</button>
            </>}
          />

          <div className="status-strip" role="status" aria-live="polite">
            <span className="status-pill">{statusLabel}</span>
            <span>{statusDetail}</span>
          </div>

          {jsonDocument && warningCount > 0 && (
            <WarningPanel warnings={jsonDocument.warnings} />
          )}

          <div className="option-row" aria-label={t.viewOptions}>
            <span className="strict-badge">{t.losslessStrictJson}</span>
            <label className="indent-label">{t.indent}
              <select value={indent} onChange={(event) => setIndent(Number(event.target.value) as 2 | 4)} aria-label={t.formattingIndentation}>
                <option value={2}>{t.twoSpaces}</option>
                <option value={4}>{t.fourSpaces}</option>
              </select>
            </label>
            <Toggle checked={minify} onChange={() => setMinify((value) => !value)} label={t.minifiedOutput} />
            <Toggle checked={colorize} onChange={() => setColorize((value) => !value)} label={t.color} />
            <Toggle checked={sortKeys} onChange={() => setSortKeys((value) => !value)} label={t.sortKeys} />
            <Toggle checked={showTypes} onChange={() => setShowTypes((value) => !value)} label={t.types} />
            <Toggle checked={showIndex} onChange={() => setShowIndex((value) => !value)} label={t.arrayIndexes} />
          </div>

          <div className={`output-views ${outputMode === 'tree' ? 'tree-active' : ''} mono`}>
            {outputMode === 'text' ? (
              <div className="text-view" aria-label={t.formattedOutputAria}>
                {isValid && outputText.length > MAX_HIGHLIGHT_CHARACTERS && colorize && <p className="large-output-note">{t.largeTextPlain}</p>}
                {isValid && colorize && outputText.length <= MAX_HIGHLIGHT_CHARACTERS
                  ? <HighlightedJson text={outputText} />
                  : <pre>{outputText}</pre>}
              </div>
            ) : (
              <div className="tree-view" aria-label={t.treeOutputAria}>
                {jsonDocument
                  ? <VirtualJsonTree document={jsonDocument} showTypes={showTypes} showArrayIndexes={showIndex} />
                  : <pre className={isReady ? 'error-block' : 'pending-block'}>{outputText}</pre>}
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function WarningPanel({ warnings }: { warnings: JsonWarning[] }) {
  const visibleWarnings = warnings.slice(0, MAX_VISIBLE_WARNINGS);
  return (
    <section className="warning-panel" aria-labelledby="warning-heading">
      <h4 id="warning-heading">{t.warningsHeading(warnings.length)}</h4>
      <ol>
        {visibleWarnings.map((warning, index) => (
          <li key={`${warning.code}-${warning.range.start}-${index}`}>
            <strong>{warningMessage(warning)}</strong>
            <span>{t.warningAt(warning.location.line, warning.location.column, warning.pathText)}</span>
          </li>
        ))}
      </ol>
      {warnings.length > visibleWarnings.length && <p>{t.moreWarnings(warnings.length - visibleWarnings.length)}</p>}
    </section>
  );
}

function PanelHeader({ id, title, meta, actions }: { id: string; title: string; meta: string; actions?: React.ReactNode }) {
  return <div className="panel-header"><div><h3 id={id}>{title}</h3><p>{meta}</p></div>{actions && <div className="panel-actions">{actions}</div>}</div>;
}

function Segmented({ label, value, options, onChange, compact = false }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void; compact?: boolean }) {
  return <div className={`segmented ${compact ? 'compact' : ''}`} role="group" aria-label={label}>{options.map(([optionValue, text]) => <button key={optionValue} type="button" className={value === optionValue ? 'active' : ''} aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}>{text}</button>)}</div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={`toggle-chip ${checked ? 'on' : ''}`} onClick={onChange} aria-pressed={checked}>{label}</button>;
}

function HighlightedJson({ text }: { text: string }) {
  const tokens = text.split(/("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g);
  return <pre>{tokens.map((token, index) => {
    let cls = '';
    const nextToken = tokens[index + 1] ?? '';
    if (/^".*"$/.test(token)) cls = nextToken.trimStart().startsWith(':') ? 'property' : 'string';
    if (/^-?\d/.test(token)) cls = 'number';
    if (/^(true|false)$/.test(token)) cls = 'boolean';
    if (token === 'null') cls = 'null';
    return cls ? <span key={index} className={cls}>{token}</span> : <React.Fragment key={index}>{token}</React.Fragment>;
  })}</pre>;
}

createRoot(document.getElementById('root')!).render(<App />);
