export interface SearchableTool {
  readonly id: string;
  readonly text: string;
}

export interface ToolSearchResult<T extends SearchableTool> {
  readonly query: string;
  readonly matches: readonly T[];
}

export function normalizeToolSearchQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function toolMatchesQuery(tool: SearchableTool, query: string): boolean {
  const terms = normalizeToolSearchQuery(query);
  if (terms.length === 0) return true;
  const text = tool.text.toLowerCase();
  return terms.every((term) => text.includes(term));
}

export function filterTools<T extends SearchableTool>(
  tools: readonly T[],
  query: string,
): ToolSearchResult<T> {
  return {
    query: query.trim(),
    matches: normalizeToolSearchQuery(query).length === 0
      ? tools
      : tools.filter((tool) => toolMatchesQuery(tool, query)),
  };
}
