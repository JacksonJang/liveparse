const JSON_EXTENSIONS = ['.json', '.jsonc', '.ndjson', '.jsonl'];
const JSON_TYPES = new Set([
  'application/json',
  'application/geo+json',
  'application/ld+json',
  'application/x-ndjson',
  'text/json',
  'text/plain',
]);

export function isLikelyJsonFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return JSON_TYPES.has(file.type) || JSON_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function selectJsonDropFile(files: readonly File[] | FileList | null): File | null | Error {
  if (!files || files.length === 0) return null;
  if (files.length > 1) return new Error('Drop one JSON file at a time.');
  const file = files[0];
  if (!isLikelyJsonFile(file)) {
    return new Error(`“${file.name}” does not look like a JSON file. Use .json, .jsonl, or a text file.`);
  }
  return file;
}
