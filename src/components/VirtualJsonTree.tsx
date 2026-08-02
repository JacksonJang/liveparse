import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { JsonDocument, JsonNode } from '../lib/lossless-json';
import {
  buildTreeIndex,
  getContainerNodeIds,
  getKeyboardAnchorId,
  getRawNodeText,
  getTreeEntryKeyText,
  getTreeEntryValueText,
  getTreePathInfo,
  getVisibleNodeIds,
  isContainer,
  isDescendant,
  revealNodeAncestors,
  treeEntryMatches,
  type TreeEntry,
  type TreeIndex,
  type TreePathInfo,
  type TreeSearchScope,
} from '../lib/tree-utils';
import './virtual-tree.css';

export const VIRTUAL_TREE_ROW_HEIGHT = 28;
const DEFAULT_OVERSCAN = 12;
const SEARCH_DEBOUNCE_MS = 100;
const SEARCH_CHUNK_SIZE = 2_000;
const MAX_ROW_TEXT = 240;

export type VirtualJsonTreeLocale = 'en' | 'ko';
export type TreeCopyKind = 'raw' | 'jsonPath' | 'pointer';

export type VirtualJsonTreeLabels = {
  treeLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchScopeLabel: string;
  keys: string;
  values: string;
  both: string;
  searching: string;
  noMatches: string;
  matchCount: (current: number, total: number) => string;
  previousMatch: string;
  nextMatch: string;
  expandAll: string;
  collapseAll: string;
  copyValue: string;
  copyJsonPath: string;
  copyPointer: string;
  copiedValue: string;
  copiedJsonPath: string;
  copiedPointer: string;
  copyFailed: string;
  duplicatePathWarning: string;
  expandNode: string;
  collapseNode: string;
  duplicateKey: string;
  typeName: (type: JsonNode['type']) => string;
  emptyTree: string;
};

export type VirtualJsonTreeProps = {
  document: JsonDocument;
  locale?: VirtualJsonTreeLocale;
  labels?: Partial<VirtualJsonTreeLabels>;
  className?: string;
  overscan?: number;
  showArrayIndexes?: boolean;
  showTypes?: boolean;
  onSelectionChange?: (entry: TreeEntry, path: TreePathInfo) => void;
  onCopy?: (kind: TreeCopyKind, text: string, entry: TreeEntry) => void;
};

const defaultLabels: Record<VirtualJsonTreeLocale, VirtualJsonTreeLabels> = {
  en: {
    treeLabel: 'JSON tree',
    searchLabel: 'Search JSON tree',
    searchPlaceholder: 'Search keys or values',
    searchScopeLabel: 'Search in',
    keys: 'Keys',
    values: 'Values',
    both: 'Keys & values',
    searching: 'Searching…',
    noMatches: 'No matches',
    matchCount: (current, total) => `${current} / ${total}`,
    previousMatch: 'Previous match',
    nextMatch: 'Next match',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    copyValue: 'Copy value',
    copyJsonPath: 'Copy JSONPath',
    copyPointer: 'Copy JSON Pointer',
    copiedValue: 'Raw value copied.',
    copiedJsonPath: 'JSONPath copied.',
    copiedPointer: 'JSON Pointer copied.',
    copyFailed: 'Copy failed.',
    duplicatePathWarning: 'This path crosses a duplicate key and may resolve ambiguously.',
    expandNode: 'Expand node',
    collapseNode: 'Collapse node',
    duplicateKey: 'duplicate',
    typeName: (type) => type,
    emptyTree: 'No JSON nodes to display.',
  },
  ko: {
    treeLabel: 'JSON 트리',
    searchLabel: 'JSON 트리 검색',
    searchPlaceholder: '키 또는 값 검색',
    searchScopeLabel: '검색 범위',
    keys: '키',
    values: '값',
    both: '키와 값',
    searching: '검색 중…',
    noMatches: '검색 결과 없음',
    matchCount: (current, total) => `${current} / ${total}`,
    previousMatch: '이전 결과',
    nextMatch: '다음 결과',
    expandAll: '전체 펼치기',
    collapseAll: '전체 접기',
    copyValue: '값 복사',
    copyJsonPath: 'JSONPath 복사',
    copyPointer: 'JSON Pointer 복사',
    copiedValue: '원본 값을 복사했습니다.',
    copiedJsonPath: 'JSONPath를 복사했습니다.',
    copiedPointer: 'JSON Pointer를 복사했습니다.',
    copyFailed: '복사하지 못했습니다.',
    duplicatePathWarning: '이 경로에는 중복 키가 있어 대상을 하나로 식별하지 못할 수 있습니다.',
    expandNode: '노드 펼치기',
    collapseNode: '노드 접기',
    duplicateKey: '중복 키',
    typeName: (type) => ({
      object: '객체',
      array: '배열',
      string: '문자열',
      number: '숫자',
      boolean: '불리언',
      null: 'null',
    })[type],
    emptyTree: '표시할 JSON 노드가 없습니다.',
  },
};

type SearchResult = {
  query: string;
  scope: TreeSearchScope;
  matches: number[];
  searching: boolean;
};

function useChunkedTreeSearch(index: TreeIndex, query: string, scope: TreeSearchScope): SearchResult {
  const normalizedQuery = query.trim();
  const [result, setResult] = useState<SearchResult>({
    query: '',
    scope,
    matches: [],
    searching: false,
  });

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    if (!normalizedQuery) {
      setResult({ query: '', scope, matches: [], searching: false });
      return undefined;
    }

    const matches: number[] = [];
    let cursor = 0;
    setResult({ query: normalizedQuery, scope, matches: [], searching: true });

    const searchChunk = () => {
      if (cancelled) return;
      const end = Math.min(cursor + SEARCH_CHUNK_SIZE, index.entries.length);
      for (; cursor < end; cursor += 1) {
        if (treeEntryMatches(index.entries[cursor], normalizedQuery, scope)) matches.push(cursor);
      }

      if (cursor < index.entries.length) {
        timer = window.setTimeout(searchChunk, 0);
      } else {
        setResult({ query: normalizedQuery, scope, matches, searching: false });
      }
    };

    timer = window.setTimeout(searchChunk, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [index, normalizedQuery, scope]);

  if (result.query !== normalizedQuery || result.scope !== scope) {
    return { query: normalizedQuery, scope, matches: [], searching: Boolean(normalizedQuery) };
  }
  return result;
}

function mergeLabels(
  locale: VirtualJsonTreeLocale,
  overrides: Partial<VirtualJsonTreeLabels> | undefined,
): VirtualJsonTreeLabels {
  return { ...defaultLabels[locale], ...overrides };
}

function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  if (typeof window === 'undefined') return Promise.reject(new Error('Clipboard is unavailable'));

  const textarea = window.document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  window.document.body.appendChild(textarea);
  textarea.select();
  const copied = window.document.execCommand('copy');
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Copy command failed'));
}

function excerptAroundMatch(text: string, query: string, limit = MAX_ROW_TEXT): string {
  if (text.length <= limit) return text;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchAt = normalizedQuery ? text.toLocaleLowerCase().indexOf(normalizedQuery) : -1;
  if (matchAt < 0 || matchAt < limit - 1) return `${text.slice(0, limit - 1)}…`;

  const room = Math.max(20, limit - normalizedQuery.length - 2);
  const before = Math.floor(room / 2);
  const start = Math.max(0, matchAt - before);
  const end = Math.min(text.length, start + limit - 2);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function HighlightedText({ text, query, enabled }: { text: string; query: string; enabled: boolean }) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!enabled || !normalizedQuery) return <>{text}</>;

  const normalizedText = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchAt = normalizedText.indexOf(normalizedQuery);
  let partIndex = 0;

  while (matchAt >= 0) {
    if (matchAt > cursor) parts.push(text.slice(cursor, matchAt));
    parts.push(<mark className="lp-tree-match" key={`${matchAt}-${partIndex}`}>{text.slice(matchAt, matchAt + normalizedQuery.length)}</mark>);
    cursor = matchAt + normalizedQuery.length;
    matchAt = normalizedText.indexOf(normalizedQuery, cursor);
    partIndex += 1;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function entryValueSearchText(entry: TreeEntry): string {
  switch (entry.node.type) {
    case 'string': return entry.node.value;
    case 'number': return entry.node.raw;
    case 'boolean': return String(entry.node.value);
    case 'null': return 'null';
    default: return '';
  }
}

export function VirtualJsonTree({
  document: jsonDocument,
  locale = 'en',
  labels: labelOverrides,
  className = '',
  overscan = DEFAULT_OVERSCAN,
  showArrayIndexes = true,
  showTypes = false,
  onSelectionChange,
  onCopy,
}: VirtualJsonTreeProps) {
  const labels = useMemo(() => mergeLabels(locale, labelOverrides), [labelOverrides, locale]);
  const index = useMemo(() => buildTreeIndex(jsonDocument), [jsonDocument]);
  const allContainerIds = useMemo(() => getContainerNodeIds(index), [index]);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([index.rootId]));
  const [selectedId, setSelectedId] = useState(index.rootId);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<TreeSearchScope>('both');
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [copyStatus, setCopyStatus] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingNavigation = useRef<{ nodeId: number; focus: boolean } | null>(null);

  useEffect(() => {
    setExpanded(new Set([index.rootId]));
    setSelectedId(index.rootId);
    setActiveMatchIndex(-1);
    setCopyStatus('');
    pendingNavigation.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [index]);

  const visibleIds = useMemo(() => getVisibleNodeIds(index, expanded), [expanded, index]);
  const visiblePositions = useMemo(() => {
    const positions = new Int32Array(index.entries.length);
    positions.fill(-1);
    for (let position = 0; position < visibleIds.length; position += 1) {
      positions[visibleIds[position]] = position;
    }
    return positions;
  }, [index.entries.length, visibleIds]);

  const safeOverscan = Math.max(0, Math.min(100, Math.floor(overscan)));
  const requestedFirst = Math.max(0, Math.floor(scrollTop / VIRTUAL_TREE_ROW_HEIGHT) - safeOverscan);
  const firstRendered = Math.min(Math.max(0, visibleIds.length - 1), requestedFirst);
  const lastRendered = Math.min(
    visibleIds.length,
    Math.ceil((scrollTop + viewportHeight) / VIRTUAL_TREE_ROW_HEIGHT) + safeOverscan,
  );
  const renderedIds = visibleIds.slice(firstRendered, lastRendered);
  const keyboardAnchorId = getKeyboardAnchorId(selectedId, renderedIds);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    const measure = () => setViewportHeight(Math.max(VIRTUAL_TREE_ROW_HEIGHT, element.clientHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectNode = useCallback((nodeId: number, focus = true) => {
    if (!index.entries[nodeId]) return;
    setSelectedId(nodeId);
    if (focus) pendingNavigation.current = { nodeId, focus: true };
  }, [index]);

  const revealAndSelect = useCallback((nodeId: number, focus = true) => {
    if (!index.entries[nodeId]) return;
    setExpanded((current) => revealNodeAncestors(index, nodeId, current));
    setSelectedId(nodeId);
    pendingNavigation.current = { nodeId, focus };
  }, [index]);

  useEffect(() => {
    const navigation = pendingNavigation.current;
    if (!navigation) return undefined;
    const { nodeId } = navigation;
    const position = visiblePositions[nodeId] ?? -1;
    const scroller = scrollRef.current;
    if (position < 0 || !scroller) return undefined;

    const rowTop = position * VIRTUAL_TREE_ROW_HEIGHT;
    const rowBottom = rowTop + VIRTUAL_TREE_ROW_HEIGHT;
    if (rowTop < scroller.scrollTop) scroller.scrollTop = rowTop;
    else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = rowBottom - scroller.clientHeight;
    }
    setScrollTop(scroller.scrollTop);

    const frame = window.requestAnimationFrame(() => {
      const row = rowRefs.current.get(nodeId);
      if (row) {
        if (navigation.focus) row.focus();
        pendingNavigation.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [firstRendered, lastRendered, selectedId, visiblePositions]);

  const search = useChunkedTreeSearch(index, query, scope);
  const matches = search.matches;

  useEffect(() => {
    if (search.searching || !search.query) {
      setActiveMatchIndex(-1);
      return;
    }
    if (matches.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }
    setActiveMatchIndex(0);
    revealAndSelect(matches[0], false);
  }, [matches, revealAndSelect, search.query, search.searching]);

  const path = useMemo(() => getTreePathInfo(index, selectedId), [index, selectedId]);
  const selectedEntry = index.entries[selectedId] ?? index.entries[index.rootId];

  useEffect(() => setCopyStatus(''), [selectedId]);

  useEffect(() => {
    if (selectedEntry) onSelectionChange?.(selectedEntry, path);
  }, [onSelectionChange, path, selectedEntry]);

  const toggleNode = useCallback((nodeId: number) => {
    const entry = index.entries[nodeId];
    if (!entry || !isContainer(entry)) return;
    const willCollapse = expanded.has(nodeId);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
    if (willCollapse && (selectedId === nodeId || isDescendant(index, nodeId, selectedId))) {
      selectNode(nodeId, false);
    }
  }, [expanded, index, selectNode, selectedId]);

  const expandAll = useCallback(() => setExpanded(new Set(allContainerIds)), [allContainerIds]);
  const collapseAll = useCallback(() => {
    setExpanded(new Set([index.rootId]));
    selectNode(index.rootId);
  }, [index.rootId, selectNode]);

  const goToMatch = useCallback((direction: -1 | 1) => {
    if (matches.length === 0) return;
    const nextIndex = activeMatchIndex < 0
      ? 0
      : (activeMatchIndex + direction + matches.length) % matches.length;
    setActiveMatchIndex(nextIndex);
    revealAndSelect(matches[nextIndex]);
  }, [activeMatchIndex, matches, revealAndSelect]);

  const copySelected = useCallback(async (kind: TreeCopyKind) => {
    if (!selectedEntry) return;
    const text = kind === 'raw'
      ? getRawNodeText(index, selectedEntry.id)
      : kind === 'jsonPath'
        ? path.jsonPath
        : path.pointer;
    try {
      await writeClipboard(text);
      setCopyStatus(kind === 'raw'
        ? labels.copiedValue
        : kind === 'jsonPath'
          ? labels.copiedJsonPath
          : labels.copiedPointer);
      onCopy?.(kind, text, selectedEntry);
    } catch {
      setCopyStatus(labels.copyFailed);
    }
  }, [index, labels, onCopy, path.jsonPath, path.pointer, selectedEntry]);

  const moveFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, entry: TreeEntry) => {
    const position = visiblePositions[entry.id] ?? -1;
    let destination: number | undefined;

    switch (event.key) {
      case 'ArrowDown':
        destination = visibleIds[Math.min(visibleIds.length - 1, position + 1)];
        break;
      case 'ArrowUp':
        destination = visibleIds[Math.max(0, position - 1)];
        break;
      case 'Home':
        destination = visibleIds[0];
        break;
      case 'End':
        destination = visibleIds[visibleIds.length - 1];
        break;
      case 'ArrowRight':
        if (isContainer(entry) && !expanded.has(entry.id)) toggleNode(entry.id);
        else if (isContainer(entry) && entry.childIds.length > 0) destination = entry.childIds[0];
        break;
      case 'ArrowLeft':
        if (isContainer(entry) && expanded.has(entry.id)) toggleNode(entry.id);
        else if (entry.parentId !== null) destination = entry.parentId;
        break;
      case 'Enter':
      case ' ':
        if (isContainer(entry)) toggleNode(entry.id);
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (destination !== undefined) selectNode(destination);
  }, [expanded, selectNode, toggleNode, visibleIds, visiblePositions]);

  const currentMatchNumber = matches.length > 0 && activeMatchIndex >= 0 ? activeMatchIndex + 1 : 0;
  const matchLabel = search.searching
    ? labels.searching
    : query.trim() && matches.length === 0
      ? labels.noMatches
      : labels.matchCount(currentMatchNumber, matches.length);
  const activeMatchId = activeMatchIndex >= 0 ? matches[activeMatchIndex] : -1;

  return (
    <section className={`lp-virtual-tree ${className}`.trim()} aria-busy={search.searching}>
      <div className="lp-tree-toolbar">
        <div className="lp-tree-search" role="search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches.length > 0) {
                event.preventDefault();
                goToMatch(event.shiftKey ? -1 : 1);
              }
            }}
            aria-label={labels.searchLabel}
            placeholder={labels.searchPlaceholder}
          />
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as TreeSearchScope)}
            aria-label={labels.searchScopeLabel}
          >
            <option value="both">{labels.both}</option>
            <option value="keys">{labels.keys}</option>
            <option value="values">{labels.values}</option>
          </select>
          <span className="lp-tree-match-count" aria-live="polite">{matchLabel}</span>
          <button className="lp-tree-button" type="button" onClick={() => goToMatch(-1)} disabled={matches.length === 0} aria-label={labels.previousMatch}>↑</button>
          <button className="lp-tree-button" type="button" onClick={() => goToMatch(1)} disabled={matches.length === 0} aria-label={labels.nextMatch}>↓</button>
        </div>

        <div className="lp-tree-actions">
          <button className="lp-tree-button" type="button" onClick={expandAll}>{labels.expandAll}</button>
          <button className="lp-tree-button" type="button" onClick={collapseAll}>{labels.collapseAll}</button>
          <button className="lp-tree-button" type="button" onClick={() => void copySelected('raw')}>{labels.copyValue}</button>
          <button className="lp-tree-button" type="button" onClick={() => void copySelected('jsonPath')}>{labels.copyJsonPath}</button>
          <button className="lp-tree-button" type="button" onClick={() => void copySelected('pointer')}>{labels.copyPointer}</button>
        </div>

        {path.ambiguous && <p className="lp-tree-notice" role="status">{labels.duplicatePathWarning}</p>}
        {copyStatus && <p className="lp-tree-copy-status" role="status" aria-live="polite">{copyStatus}</p>}
      </div>

      {index.entries.length === 0 ? <div className="lp-tree-empty">{labels.emptyTree}</div> : (
        <div
          className="lp-tree-scroll"
          ref={scrollRef}
          role="tree"
          aria-label={labels.treeLabel}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div
            className="lp-tree-spacer"
            style={{ height: visibleIds.length * VIRTUAL_TREE_ROW_HEIGHT }}
          >
            {renderedIds.map((nodeId, renderedIndex) => {
              const entry = index.entries[nodeId];
              const position = firstRendered + renderedIndex;
              const expandedNode = isContainer(entry) && expanded.has(nodeId);
              const keyText = getTreeEntryKeyText(entry);
              const valueSearchText = entryValueSearchText(entry);
              const normalizedQuery = query.trim().toLocaleLowerCase();
              const keyMatches = Boolean(normalizedQuery) && scope !== 'values'
                && Boolean(entry.key?.toLocaleLowerCase().includes(normalizedQuery));
              const valueMatches = Boolean(normalizedQuery) && scope !== 'keys'
                && Boolean(valueSearchText.toLocaleLowerCase().includes(normalizedQuery));
              const valueText = excerptAroundMatch(getTreeEntryValueText(entry), valueMatches ? query : '');
              const rowStyle = {
                paddingLeft: 8 + Math.min(entry.depth, 100) * 16,
                transform: `translateY(${position * VIRTUAL_TREE_ROW_HEIGHT}px)`,
              } satisfies CSSProperties;

              return (
                <div
                  className={`lp-tree-row${nodeId === activeMatchId ? ' is-active-match' : ''}`}
                  key={nodeId}
                  ref={(element) => {
                    if (element) rowRefs.current.set(nodeId, element);
                    else rowRefs.current.delete(nodeId);
                  }}
                  role="treeitem"
                  aria-level={entry.depth + 1}
                  aria-posinset={entry.positionInSet}
                  aria-setsize={entry.setSize}
                  aria-expanded={isContainer(entry) ? expandedNode : undefined}
                  aria-selected={selectedId === nodeId}
                  tabIndex={keyboardAnchorId === nodeId ? 0 : -1}
                  style={rowStyle}
                  onFocus={() => setSelectedId(nodeId)}
                  onClick={() => selectNode(nodeId)}
                  onDoubleClick={() => toggleNode(nodeId)}
                  onKeyDown={(event) => moveFromKeyboard(event, entry)}
                >
                  {isContainer(entry) ? (
                    <button
                      className="lp-tree-disclosure"
                      type="button"
                      tabIndex={-1}
                      aria-label={expandedNode ? labels.collapseNode : labels.expandNode}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectNode(nodeId);
                        toggleNode(nodeId);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >{expandedNode ? '−' : '+'}</button>
                  ) : <span className="lp-tree-disclosure-spacer" aria-hidden="true" />}

                  {showArrayIndexes && entry.arrayIndex !== undefined && <span className="lp-tree-index">{entry.arrayIndex}</span>}
                  {entry.key !== undefined && (
                    <>
                      <span className="lp-tree-key">
                        <HighlightedText text={keyText} query={query} enabled={keyMatches} />
                      </span>
                      {entry.duplicateKey && <span className="lp-tree-duplicate">{labels.duplicateKey}</span>}
                      <span className="lp-tree-colon">:</span>
                    </>
                  )}
                  {showTypes && <span className={`lp-tree-type lp-tree-type-${entry.node.type}`}>{labels.typeName(entry.node.type)}</span>}
                  <span className={`lp-tree-value ${entry.node.type}`}>
                    <HighlightedText text={valueText} query={query} enabled={valueMatches} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default VirtualJsonTree;
