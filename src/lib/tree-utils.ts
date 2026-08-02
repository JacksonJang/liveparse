import type { JsonDocument, JsonNode } from './lossless-json';

export type TreeSearchScope = 'keys' | 'values' | 'both';

export type TreeEntry = {
  id: number;
  node: JsonNode;
  parentId: number | null;
  childIds: number[];
  depth: number;
  positionInSet: number;
  setSize: number;
  subtreeEnd: number;
  key?: string;
  keyRaw?: string;
  arrayIndex?: number;
  duplicateKey: boolean;
  occurrence: number;
};

export type TreeIndex = {
  document: JsonDocument;
  entries: TreeEntry[];
  rootId: number;
};

export type TreePathInfo = {
  jsonPath: string;
  pointer: string;
  ambiguous: boolean;
};

type PendingNode = {
  node: JsonNode;
  parentId: number | null;
  depth: number;
  positionInSet: number;
  setSize: number;
  key?: string;
  keyRaw?: string;
  arrayIndex?: number;
  duplicateKey?: boolean;
  occurrence?: number;
};

/**
 * Builds a preorder index without recursion. Node ids are stable for the life of
 * an immutable JsonDocument and every subtree occupies a contiguous id range.
 */
export function buildTreeIndex(document: JsonDocument): TreeIndex {
  const entries: TreeEntry[] = [];
  const pending: PendingNode[] = [{
    node: document.root,
    parentId: null,
    depth: 0,
    positionInSet: 1,
    setSize: 1,
  }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const id = entries.length;
    const entry: TreeEntry = {
      id,
      node: current.node,
      parentId: current.parentId,
      childIds: [],
      depth: current.depth,
      positionInSet: current.positionInSet,
      setSize: current.setSize,
      subtreeEnd: id + 1,
      key: current.key,
      keyRaw: current.keyRaw,
      arrayIndex: current.arrayIndex,
      duplicateKey: current.duplicateKey ?? false,
      occurrence: current.occurrence ?? 0,
    };
    entries.push(entry);

    if (current.parentId !== null) entries[current.parentId].childIds.push(id);

    if (current.node.type === 'object') {
      const keyCounts = new Map<string, number>();
      for (const member of current.node.members) {
        keyCounts.set(member.key.value, (keyCounts.get(member.key.value) ?? 0) + 1);
      }
      for (let memberIndex = current.node.members.length - 1; memberIndex >= 0; memberIndex -= 1) {
        const member = current.node.members[memberIndex];
        pending.push({
          node: member.value,
          parentId: id,
          depth: current.depth + 1,
          positionInSet: memberIndex + 1,
          setSize: current.node.members.length,
          key: member.key.value,
          keyRaw: member.key.raw,
          duplicateKey: member.duplicate || (keyCounts.get(member.key.value) ?? 0) > 1,
          occurrence: member.occurrence,
        });
      }
    } else if (current.node.type === 'array') {
      for (let elementIndex = current.node.elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
        pending.push({
          node: current.node.elements[elementIndex],
          parentId: id,
          depth: current.depth + 1,
          positionInSet: elementIndex + 1,
          setSize: current.node.elements.length,
          arrayIndex: elementIndex,
        });
      }
    }
  }

  for (let id = entries.length - 1; id >= 0; id -= 1) {
    const children = entries[id].childIds;
    entries[id].subtreeEnd = children.length === 0
      ? id + 1
      : entries[children[children.length - 1]].subtreeEnd;
  }

  return { document, entries, rootId: 0 };
}

export function isContainer(entry: TreeEntry): boolean {
  return entry.node.type === 'object' || entry.node.type === 'array';
}

export function getVisibleNodeIds(index: TreeIndex, expanded: ReadonlySet<number>): number[] {
  const visible: number[] = [];
  let id = index.rootId;

  while (id < index.entries.length) {
    const entry = index.entries[id];
    visible.push(id);
    id = isContainer(entry) && !expanded.has(id) ? entry.subtreeEnd : id + 1;
  }

  return visible;
}

export function getContainerNodeIds(index: TreeIndex): Set<number> {
  const ids = new Set<number>();
  for (const entry of index.entries) {
    if (isContainer(entry)) ids.add(entry.id);
  }
  return ids;
}

/** Keeps one virtualized row in the tab order even when selection is offscreen. */
export function getKeyboardAnchorId(
  selectedId: number,
  renderedIds: readonly number[],
): number | undefined {
  if (renderedIds.includes(selectedId)) return selectedId;
  return renderedIds[0];
}

export function revealNodeAncestors(
  index: TreeIndex,
  nodeId: number,
  expanded: ReadonlySet<number>,
): Set<number> {
  const next = new Set(expanded);
  let parentId = index.entries[nodeId]?.parentId ?? null;
  while (parentId !== null) {
    next.add(parentId);
    parentId = index.entries[parentId].parentId;
  }
  return next;
}

export function isDescendant(index: TreeIndex, ancestorId: number, candidateId: number): boolean {
  const ancestor = index.entries[ancestorId];
  return candidateId > ancestorId && candidateId < ancestor.subtreeEnd;
}

export function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Uses RFC 9535 name selectors with JSON double-quoted string literals. */
export function getTreePathInfo(index: TreeIndex, nodeId: number): TreePathInfo {
  if (!index.entries[nodeId]) return { jsonPath: '$', pointer: '', ambiguous: false };

  const segments: Array<{ key?: string; arrayIndex?: number; duplicate: boolean }> = [];
  let currentId: number | null = nodeId;

  while (currentId !== null && currentId !== index.rootId) {
    const entry: TreeEntry = index.entries[currentId];
    segments.push({
      key: entry.key,
      arrayIndex: entry.arrayIndex,
      duplicate: entry.duplicateKey,
    });
    currentId = entry.parentId;
  }

  segments.reverse();
  let jsonPath = '$';
  let pointer = '';
  let ambiguous = false;

  for (const segment of segments) {
    if (segment.arrayIndex !== undefined) {
      const indexText = String(segment.arrayIndex);
      jsonPath += `[${indexText}]`;
      pointer += `/${indexText}`;
    } else {
      const key = segment.key ?? '';
      jsonPath += `[${JSON.stringify(key) ?? '""'}]`;
      pointer += `/${escapeJsonPointerSegment(key)}`;
    }
    ambiguous ||= segment.duplicate;
  }

  return { jsonPath, pointer, ambiguous };
}

export function getRawNodeText(index: TreeIndex, nodeId: number): string {
  const node = index.entries[nodeId]?.node;
  if (!node) return '';
  const start = Math.max(0, Math.min(index.document.source.length, node.start));
  const end = Math.max(start, Math.min(index.document.source.length, node.end));
  return index.document.source.slice(start, end);
}

export function getTreeEntryKeyText(entry: TreeEntry): string {
  if (entry.arrayIndex !== undefined) return String(entry.arrayIndex);
  return entry.key === undefined ? '' : (JSON.stringify(entry.key) ?? '""');
}

export function getTreeEntryValueText(entry: TreeEntry): string {
  switch (entry.node.type) {
    case 'object':
      return `{${entry.node.members.length === 0 ? '' : ` ${entry.node.members.length} `}}`;
    case 'array':
      return `[${entry.node.elements.length === 0 ? '' : ` ${entry.node.elements.length} `}]`;
    case 'string':
      return JSON.stringify(entry.node.value) ?? '""';
    case 'number':
      return entry.node.raw;
    case 'boolean':
      return String(entry.node.value);
    case 'null':
      return 'null';
    default:
      return '';
  }
}

export function treeEntryMatches(entry: TreeEntry, query: string, scope: TreeSearchScope): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return false;

  if (scope !== 'values' && entry.key?.toLocaleLowerCase().includes(normalizedQuery)) return true;
  if (scope === 'keys') return false;

  let value = '';
  switch (entry.node.type) {
    case 'string': value = entry.node.value; break;
    case 'number': value = entry.node.raw; break;
    case 'boolean': value = String(entry.node.value); break;
    case 'null': value = 'null'; break;
    default: return false;
  }
  return value.toLocaleLowerCase().includes(normalizedQuery);
}

export function findTreeMatches(index: TreeIndex, query: string, scope: TreeSearchScope): number[] {
  if (!query.trim()) return [];
  const matches: number[] = [];
  for (const entry of index.entries) {
    if (treeEntryMatches(entry, query, scope)) matches.push(entry.id);
  }
  return matches;
}
