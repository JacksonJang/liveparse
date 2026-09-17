import { filterTools, type SearchableTool, type ToolSearchResult } from './lib/tool-search';

interface ToolElement extends SearchableTool {
  readonly element: HTMLElement;
  readonly section: HTMLElement;
}

const CATEGORY_IDS = [
  'json',
  'yaml-xml',
  'sql',
  'dates',
  'encoding',
  'security',
  'images-text',
] as const;

const form = document.querySelector<HTMLFormElement>('.tool-search-form');
const input = document.querySelector<HTMLInputElement>('#tool-search-input');
const status = document.querySelector<HTMLElement>('#tool-search-status');
const clearButton = document.querySelector<HTMLButtonElement>('#tool-search-clear');

if (form && input && status && clearButton) {
  const tools: ToolElement[] = CATEGORY_IDS.flatMap((id) => {
    const section = document.getElementById(id);
    if (!(section instanceof HTMLElement)) return [];
    return [...section.querySelectorAll<HTMLElement>('.use-case-grid > article')]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) => ({
        id: `${id}:${element.querySelector('a')?.getAttribute('href') ?? element.textContent?.trim() ?? ''}`,
        text: element.textContent ?? '',
        element,
        section,
      }));
  });

  const describe = (result: ToolSearchResult<ToolElement>): string => {
    if (result.query === '') return `Showing all ${tools.length} tools.`;
    if (result.matches.length === 1) return `1 tool matches “${result.query}”.`;
    return result.matches.length === 0
      ? `No tools match “${result.query}”. Try a shorter term such as JSON, date, or hash.`
      : `${result.matches.length} tools match “${result.query}”.`;
  };

  const applySearch = (query: string): void => {
    const result = filterTools(tools, query);
    const matches = new Set(result.matches);
    for (const tool of tools) tool.element.hidden = !matches.has(tool);
    const popular = document.getElementById('popular-tools');
    if (popular) popular.hidden = result.query !== '';
    for (const id of ['about-liveparse', 'guides']) {
      const section = document.getElementById(id);
      if (section) section.hidden = result.query !== '';
    }
    for (const id of CATEGORY_IDS) {
      const section = document.getElementById(id);
      if (section) section.hidden = result.matches.every((tool) => tool.section.id !== id);
    }
    status.textContent = describe(result);
    clearButton.hidden = result.query === '';
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', () => applySearch(input.value));
  clearButton.addEventListener('click', () => {
    input.value = '';
    applySearch('');
    input.focus({ preventScroll: true });
  });
  applySearch('');
  form.hidden = false;
}
