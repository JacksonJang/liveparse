export const MAX_XML_INPUT_CHARACTERS = 200_000;
export const XML_LARGE_INPUT_WARNING_CHARACTERS = 100_000;
export const MAX_XML_OUTPUT_CHARACTERS = 1_000_000;
export const MAX_XML_DEPTH = 256;
export const MAX_XML_ELEMENTS = 25_000;
export const MAX_XML_ATTRIBUTES = 25_000;
export const MAX_XML_VIEWER_ROWS = 10_000;
export const MAX_XML_ERROR_CHARACTERS = 300;

export type XmlMode = 'format' | 'validate' | 'view';
export type XmlIndentation = '2-spaces' | '4-spaces' | 'tabs';
export type XmlLineEnding = 'lf' | 'crlf';

export interface XmlFormatOptions {
  indentation: XmlIndentation;
  lineEnding: XmlLineEnding;
}

export const DEFAULT_XML_FORMAT_OPTIONS: XmlFormatOptions = {
  indentation: '2-spaces',
  lineEnding: 'lf',
};

const XML_MODES = new Set<XmlMode>(['format', 'validate', 'view']);
const XML_INDENTATIONS = new Set<XmlIndentation>(['2-spaces', '4-spaces', 'tabs']);
const XML_LINE_ENDINGS = new Set<XmlLineEnding>(['lf', 'crlf']);

export function isXmlMode(value: string): value is XmlMode {
  return XML_MODES.has(value as XmlMode);
}

export function isXmlIndentation(value: string): value is XmlIndentation {
  return XML_INDENTATIONS.has(value as XmlIndentation);
}

export function isXmlLineEnding(value: string): value is XmlLineEnding {
  return XML_LINE_ENDINGS.has(value as XmlLineEnding);
}
