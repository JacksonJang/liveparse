import type { JsonDocument, JsonPathSegment, JsonSourceLocation } from './types';

export function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (code === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function locationFromLineStarts(lineStarts: readonly number[], offset: number): JsonSourceLocation {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { offset, line: low + 1, column: offset - lineStarts[low] + 1 };
}

export function getJsonLocation(sourceOrDocument: string | JsonDocument, offset: number): JsonSourceLocation {
  const source = typeof sourceOrDocument === 'string' ? sourceOrDocument : sourceOrDocument.source;
  const boundedOffset = Math.max(0, Math.min(source.length, offset));
  return locationFromLineStarts(buildLineStarts(source), boundedOffset);
}

export function formatJsonPath(path: readonly JsonPathSegment[]): string {
  let result = '$';
  for (const segment of path) {
    if (segment.type === 'index') {
      result += `[${segment.index}]`;
    } else {
      result += `[${JSON.stringify(segment.key)}]`;
      if (segment.occurrence > 1) result += `#${segment.occurrence}`;
    }
  }
  return result;
}
