import { parseXml } from '@rgrove/parse-xml';
import {
  DEFAULT_XML_FORMAT_OPTIONS,
  isXmlIndentation,
  isXmlLineEnding,
  isXmlMode,
  MAX_XML_ATTRIBUTES,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_ERROR_CHARACTERS,
  MAX_XML_INPUT_CHARACTERS,
  MAX_XML_OUTPUT_CHARACTERS,
  MAX_XML_VIEWER_ROWS,
  type XmlFormatOptions,
  type XmlMode,
} from './xml-config';
import type { XmlOperationResult, XmlStats, XmlViewerRow } from './xml-worker-protocol';

const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/';
const XML_WHITESPACE = /[\x20\t\r\n]/;
const NON_XML_WHITESPACE = /[^\x20\t\r\n]/;
const PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'apos', 'quot']);

export type XmlProcessErrorCode =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'INPUT_TOO_COMPLEX'
  | 'OUTPUT_TOO_LARGE'
  | 'INVALID_OPTIONS'
  | 'CUSTOM_ENTITIES_UNSUPPORTED'
  | 'DOCTYPE_UNSUPPORTED'
  | 'UNSUPPORTED_XML_VERSION'
  | 'UNDEFINED_ENTITY'
  | 'NAMESPACE_ERROR'
  | 'MALFORMED_XML'
  | 'PROCESS_FAILED';

export class XmlProcessError extends Error {
  readonly code: XmlProcessErrorCode;
  readonly line?: number;
  readonly column?: number;

  constructor(code: XmlProcessErrorCode, message: string, line?: number, column?: number) {
    const cleanMessage = message.trim().replace(/\s+/g, ' ').slice(0, MAX_XML_ERROR_CHARACTERS)
      || 'XML processing failed.';
    super(cleanMessage);
    this.name = 'XmlProcessError';
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

interface AttributeToken {
  name: string;
  raw: string;
  rawValue: string;
  start: number;
}

type LexTokenKind =
  | 'bom'
  | 'declaration'
  | 'doctype'
  | 'open'
  | 'empty'
  | 'close'
  | 'text'
  | 'comment'
  | 'cdata'
  | 'pi';

interface LexToken {
  kind: LexTokenKind;
  start: number;
  end: number;
  raw: string;
  depth: number;
  name?: string;
  attributes?: AttributeToken[];
  elementId?: number;
}

interface ElementInfo {
  id: number;
  name: string;
  startTokenIndex: number;
  endTokenIndex: number;
  effectivePreserveSpace: boolean;
  hasSignificantText: boolean;
}

interface ElementFrame {
  info: ElementInfo;
  namespaceDeclarations: Map<string, string>;
}

interface LexedDocument {
  tokens: LexToken[];
  elements: ElementInfo[];
  stats: XmlStats;
}

function locationAt(input: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const boundedIndex = Math.max(0, Math.min(index, input.length));
  let cursor = 0;
  while (cursor < boundedIndex) {
    const character = input[cursor];
    if (character === '\r') {
      line += 1;
      column = 1;
      cursor += input[cursor + 1] === '\n' && cursor + 1 < boundedIndex ? 2 : 1;
    } else if (character === '\n') {
      line += 1;
      column = 1;
      cursor += 1;
    } else {
      column += 1;
      cursor += (input.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1;
    }
  }
  return { line, column };
}

function failAt(
  input: string,
  index: number,
  code: XmlProcessErrorCode,
  message: string,
): never {
  const { line, column } = locationAt(input, index);
  throw new XmlProcessError(code, message, line, column);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && XML_WHITESPACE.test(character);
}

function skipWhitespace(input: string, initial: number, limit: number): number {
  let cursor = initial;
  while (cursor < limit && isWhitespace(input[cursor])) cursor += 1;
  return cursor;
}

function scanUntil(input: string, start: number, terminator: string, label: string): number {
  const terminatorStart = input.indexOf(terminator, start);
  if (terminatorStart === -1) {
    failAt(input, start, 'MALFORMED_XML', `Unclosed ${label}.`);
  }
  return terminatorStart + terminator.length;
}

function scanTagEnd(input: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let cursor = start + 1; cursor < input.length; cursor += 1) {
    const character = input[cursor];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor + 1;
    }
  }
  failAt(input, start, 'MALFORMED_XML', 'Unclosed XML tag.');
}

function scanDoctypeEnd(input: string, start: number, tolerateUnclosed: boolean): number {
  let quote: '"' | "'" | null = null;
  let subsetDepth = 0;
  let cursor = start + '<!DOCTYPE'.length;
  while (cursor < input.length) {
    const character = input[cursor];
    if (quote !== null) {
      if (character === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (input.startsWith('<!--', cursor)) {
      const commentEnd = input.indexOf('-->', cursor + 4);
      if (commentEnd === -1) {
        if (tolerateUnclosed) return input.length;
        failAt(input, cursor, 'MALFORMED_XML', 'Unclosed comment in the document type declaration.');
      }
      cursor = commentEnd + 3;
      continue;
    }
    if (input.startsWith('<?', cursor)) {
      const instructionEnd = input.indexOf('?>', cursor + 2);
      if (instructionEnd === -1) {
        if (tolerateUnclosed) return input.length;
        failAt(input, cursor, 'MALFORMED_XML', 'Unclosed processing instruction in the document type declaration.');
      }
      cursor = instructionEnd + 2;
      continue;
    }
    if (input.startsWith('<!ENTITY', cursor)) {
      failAt(
        input,
        cursor,
        'CUSTOM_ENTITIES_UNSUPPORTED',
        'Custom ENTITY declarations are not supported. Remove the declaration and use predefined or numeric character references.',
      );
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      subsetDepth += 1;
    } else if (character === ']' && subsetDepth > 0) {
      subsetDepth -= 1;
    } else if (character === '>' && subsetDepth === 0) {
      return cursor + 1;
    }
    cursor += 1;
  }
  if (tolerateUnclosed) return input.length;
  failAt(input, start, 'MALFORMED_XML', 'Unclosed document type declaration.');
}

function assertValidXmlDeclaration(input: string, start: number, raw: string): void {
  const declarationMatch = /^<\?xml[\x20\t\r\n]+version[\x20\t\r\n]*=[\x20\t\r\n]*(?:"(1\.[0-9]+)"|'(1\.[0-9]+)')(?:[\x20\t\r\n]+encoding[\x20\t\r\n]*=[\x20\t\r\n]*(?:"([A-Za-z][A-Za-z0-9._-]*)"|'([A-Za-z][A-Za-z0-9._-]*)'))?(?:[\x20\t\r\n]+standalone[\x20\t\r\n]*=[\x20\t\r\n]*(?:"(yes|no)"|'(yes|no)'))?[\x20\t\r\n]*\?>$/.exec(raw);
  if (!declarationMatch) {
    failAt(
      input,
      start,
      'MALFORMED_XML',
      'Invalid XML declaration. Use version first, followed by optional encoding and standalone fields separated by XML whitespace.',
    );
  }
  const version = declarationMatch[1] ?? declarationMatch[2] ?? '';
  if (version === '1.0') return;
  const versionIndex = raw.indexOf(version, '<?xml'.length);
  failAt(
    input,
    start + Math.max(0, versionIndex),
    'UNSUPPORTED_XML_VERSION',
    `XML version ${version || '(empty)'} is not supported. This tool parses XML 1.0 documents only.`,
  );
}

function assertSupportedReferences(input: string, segmentStart: number, segmentEnd: number): void {
  let cursor = segmentStart;
  while (cursor < segmentEnd) {
    const ampersand = input.indexOf('&', cursor);
    if (ampersand === -1 || ampersand >= segmentEnd) return;
    const semicolon = input.indexOf(';', ampersand + 1);
    if (semicolon === -1 || semicolon >= segmentEnd) return;
    const reference = input.slice(ampersand + 1, semicolon);
    const isNumeric = /^#(?:[0-9]+|x[0-9A-Fa-f]+)$/.test(reference);
    if (!isNumeric && !PREDEFINED_ENTITIES.has(reference) && /^[^#\s<&]+$/.test(reference)) {
      failAt(
        input,
        ampersand,
        'UNDEFINED_ENTITY',
        `Undefined named entity &${reference};. Only amp, lt, gt, apos, quot, and numeric character references are supported.`,
      );
    }
    cursor = semicolon + 1;
  }
}

function parseStartTag(input: string, start: number, end: number): {
  name: string;
  attributes: AttributeToken[];
  selfClosing: boolean;
} {
  const contentEnd = end - 1;
  let cursor = start + 1;
  const nameStart = cursor;
  while (cursor < contentEnd
      && !isWhitespace(input[cursor])
      && input[cursor] !== '/'
      && input[cursor] !== '='
      && input[cursor] !== '>') cursor += 1;
  const name = input.slice(nameStart, cursor);
  if (!name) failAt(input, start, 'MALFORMED_XML', 'An element name is required.');

  const attributes: AttributeToken[] = [];
  while (cursor < contentEnd) {
    cursor = skipWhitespace(input, cursor, contentEnd);
    if (cursor >= contentEnd) break;
    if (input[cursor] === '/') {
      if (cursor !== contentEnd - 1) {
        failAt(input, cursor, 'MALFORMED_XML', 'The empty-element delimiter must end with />.');
      }
      return { name, attributes, selfClosing: true };
    }

    const attributeStart = cursor;
    while (cursor < contentEnd
        && !isWhitespace(input[cursor])
        && input[cursor] !== '='
        && input[cursor] !== '/'
        && input[cursor] !== '>') cursor += 1;
    const attributeName = input.slice(attributeStart, cursor);
    if (!attributeName) failAt(input, cursor, 'MALFORMED_XML', 'An attribute name is required.');
    cursor = skipWhitespace(input, cursor, contentEnd);
    if (input[cursor] !== '=') {
      failAt(input, cursor, 'MALFORMED_XML', `Attribute ${attributeName} requires an equals sign and quoted value.`);
    }
    cursor = skipWhitespace(input, cursor + 1, contentEnd);
    const quote = input[cursor];
    if (quote !== '"' && quote !== "'") {
      failAt(input, cursor, 'MALFORMED_XML', `Attribute ${attributeName} requires a quoted value.`);
    }
    const valueStart = cursor + 1;
    const valueEnd = input.indexOf(quote, valueStart);
    if (valueEnd === -1 || valueEnd >= contentEnd) {
      failAt(input, cursor, 'MALFORMED_XML', `Attribute ${attributeName} is not closed.`);
    }
    cursor = valueEnd + 1;
    assertSupportedReferences(input, valueStart, valueEnd);
    attributes.push({
      name: attributeName,
      raw: input.slice(attributeStart, cursor),
      rawValue: input.slice(valueStart, valueEnd),
      start: attributeStart,
    });
  }
  return { name, attributes, selfClosing: false };
}

function parseClosingName(input: string, start: number, end: number): string {
  const contentEnd = end - 1;
  let cursor = start + 2;
  const nameStart = cursor;
  while (cursor < contentEnd && !isWhitespace(input[cursor]) && input[cursor] !== '>') cursor += 1;
  const name = input.slice(nameStart, cursor);
  cursor = skipWhitespace(input, cursor, contentEnd);
  if (!name || cursor !== contentEnd) {
    failAt(input, start, 'MALFORMED_XML', 'Invalid closing tag.');
  }
  return name;
}

function decodeAttributeValue(input: string, attribute: AttributeToken): string {
  const normalized = attribute.rawValue.replace(/\r\n|\r|\n|\t/g, ' ');
  return normalized.replace(/&([^;]+);/g, (_match, reference: string) => {
    const predefined: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      apos: "'",
      quot: '"',
    };
    if (reference in predefined) return predefined[reference] as string;
    const radix = reference.startsWith('#x') ? 16 : 10;
    const digits = reference.startsWith('#x') ? reference.slice(2) : reference.slice(1);
    if (!reference.startsWith('#') || !digits) return _match;
    const codePoint = Number.parseInt(digits, radix);
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      failAt(input, attribute.start, 'MALFORMED_XML', `Attribute ${attribute.name} contains an invalid character reference.`);
    }
  });
}

function isNcNameStartCodePoint(codePoint: number): boolean {
  return codePoint === 0x5f
    || (codePoint >= 0x41 && codePoint <= 0x5a)
    || (codePoint >= 0x61 && codePoint <= 0x7a)
    || (codePoint >= 0xc0 && codePoint <= 0xd6)
    || (codePoint >= 0xd8 && codePoint <= 0xf6)
    || (codePoint >= 0xf8 && codePoint <= 0x2ff)
    || (codePoint >= 0x370 && codePoint <= 0x37d)
    || (codePoint >= 0x37f && codePoint <= 0x1fff)
    || (codePoint >= 0x200c && codePoint <= 0x200d)
    || (codePoint >= 0x2070 && codePoint <= 0x218f)
    || (codePoint >= 0x2c00 && codePoint <= 0x2fef)
    || (codePoint >= 0x3001 && codePoint <= 0xd7ff)
    || (codePoint >= 0xf900 && codePoint <= 0xfdcf)
    || (codePoint >= 0xfdf0 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0xeffff);
}

function isNcNameCodePoint(codePoint: number): boolean {
  return isNcNameStartCodePoint(codePoint)
    || codePoint === 0x2d
    || codePoint === 0x2e
    || (codePoint >= 0x30 && codePoint <= 0x39)
    || codePoint === 0xb7
    || (codePoint >= 0x300 && codePoint <= 0x36f)
    || (codePoint >= 0x203f && codePoint <= 0x2040);
}

function assertNcName(input: string, name: string, index: number): void {
  const codePoints = Array.from(name, (character) => character.codePointAt(0) as number);
  if (codePoints.length === 0
      || !isNcNameStartCodePoint(codePoints[0] as number)
      || codePoints.slice(1).some((codePoint) => !isNcNameCodePoint(codePoint))) {
    failAt(input, index, 'NAMESPACE_ERROR', `QName part ${name || '(empty)'} is not a valid namespace name.`);
  }
}

function splitQName(input: string, name: string, index: number): { prefix: string; localName: string } {
  const firstColon = name.indexOf(':');
  if (firstColon === -1) {
    assertNcName(input, name, index);
    return { prefix: '', localName: name };
  }
  if (firstColon === 0 || firstColon === name.length - 1 || name.indexOf(':', firstColon + 1) !== -1) {
    failAt(input, index, 'NAMESPACE_ERROR', `QName ${name} must contain at most one colon with a name on each side.`);
  }
  const prefix = name.slice(0, firstColon);
  const localName = name.slice(firstColon + 1);
  assertNcName(input, prefix, index);
  assertNcName(input, localName, index + firstColon + 1);
  return { prefix, localName };
}

function resolveNamespace(
  prefix: string,
  currentDeclarations: Map<string, string>,
  stack: ElementFrame[],
): string | undefined {
  if (prefix === 'xml') return XML_NAMESPACE_URI;
  if (currentDeclarations.has(prefix)) return currentDeclarations.get(prefix);
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const declarations = stack[index]?.namespaceDeclarations;
    if (declarations?.has(prefix)) return declarations.get(prefix);
  }
  return prefix === '' ? '' : undefined;
}

function validateNamespaces(
  input: string,
  elementName: string,
  elementStart: number,
  attributes: AttributeToken[],
  stack: ElementFrame[],
  namespaceUris: Set<string>,
): { declarations: Map<string, string>; preserveSpaceSetting?: boolean } {
  const declarations = new Map<string, string>();
  let preserveSpaceSetting: boolean | undefined;

  for (const attribute of attributes) {
    if (attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) continue;
    const declaredPrefix = attribute.name === 'xmlns' ? '' : attribute.name.slice('xmlns:'.length);
    splitQName(input, attribute.name, attribute.start);
    const uri = decodeAttributeValue(input, attribute);
    if (declarations.has(declaredPrefix)) {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', `Namespace prefix ${declaredPrefix || '(default)'} is declared more than once.`);
    }
    if (declaredPrefix === 'xmlns') {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', 'The reserved xmlns prefix cannot be declared.');
    }
    if (declaredPrefix === 'xml' && uri !== XML_NAMESPACE_URI) {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', `The xml prefix must be bound to ${XML_NAMESPACE_URI}.`);
    }
    if (declaredPrefix !== 'xml' && uri === XML_NAMESPACE_URI) {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', 'Only the xml prefix may use the reserved XML namespace URI.');
    }
    if (uri === XMLNS_NAMESPACE_URI) {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', 'The XMLNS namespace URI cannot be used as a namespace name.');
    }
    if (declaredPrefix !== '' && uri === '') {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', `Namespace prefix ${declaredPrefix} cannot be bound to an empty URI.`);
    }
    declarations.set(declaredPrefix, uri);
    if (uri) namespaceUris.add(uri);
  }

  const elementQName = splitQName(input, elementName, elementStart + 1);
  if (elementQName.prefix === 'xmlns') {
    failAt(input, elementStart, 'NAMESPACE_ERROR', 'The reserved xmlns prefix cannot be used on an element.');
  }
  const elementUri = resolveNamespace(elementQName.prefix, declarations, stack);
  if (elementQName.prefix && elementUri === undefined) {
    failAt(input, elementStart, 'NAMESPACE_ERROR', `Element prefix ${elementQName.prefix} is not bound to a namespace.`);
  }
  if (elementUri) namespaceUris.add(elementUri);

  const expandedAttributes = new Set<string>();
  for (const attribute of attributes) {
    if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
    const qname = splitQName(input, attribute.name, attribute.start);
    if (qname.prefix === 'xmlns') {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', 'The reserved xmlns prefix can only declare namespaces.');
    }
    const uri = qname.prefix ? resolveNamespace(qname.prefix, declarations, stack) : '';
    if (qname.prefix && uri === undefined) {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', `Attribute prefix ${qname.prefix} is not bound to a namespace.`);
    }
    if (uri) namespaceUris.add(uri);
    const expandedName = `${uri ?? ''}\u0000${qname.localName}`;
    if (expandedAttributes.has(expandedName)) {
      failAt(input, attribute.start, 'NAMESPACE_ERROR', `Duplicate expanded attribute name ${qname.localName}.`);
    }
    expandedAttributes.add(expandedName);
    if (attribute.name === 'xml:space') {
      const value = decodeAttributeValue(input, attribute);
      if (value === 'preserve') preserveSpaceSetting = true;
      else if (value === 'default') preserveSpaceSetting = false;
    }
  }
  return { declarations, preserveSpaceSetting };
}

function emptyStats(): XmlStats {
  return {
    rootName: '',
    elements: 0,
    attributes: 0,
    textNodes: 0,
    comments: 0,
    cdataSections: 0,
    processingInstructions: 0,
    documentTypes: 0,
    maxDepth: 0,
    namespaces: 0,
  };
}

function lexXml(input: string, mode: XmlMode): LexedDocument {
  const tokens: LexToken[] = [];
  const elements: ElementInfo[] = [];
  const stack: ElementFrame[] = [];
  const stats = emptyStats();
  const namespaceUris = new Set<string>();
  let cursor = 0;

  if (input.startsWith('\uFEFF')) {
    tokens.push({ kind: 'bom', start: 0, end: 1, raw: '\uFEFF', depth: 0 });
    cursor = 1;
  }

  while (cursor < input.length) {
    const start = cursor;
    if (input[cursor] !== '<') {
      const markupStart = input.indexOf('<', cursor);
      const end = markupStart === -1 ? input.length : markupStart;
      assertSupportedReferences(input, start, end);
      const raw = input.slice(start, end);
      tokens.push({ kind: 'text', start, end, raw, depth: stack.length });
      if (stack.length > 0) {
        stats.textNodes += 1;
        if (NON_XML_WHITESPACE.test(raw)) {
          const frame = stack[stack.length - 1];
          if (frame) frame.info.hasSignificantText = true;
        }
      }
      cursor = end;
      continue;
    }

    if (input.startsWith('<!--', cursor)) {
      const end = scanUntil(input, cursor + 4, '-->', 'XML comment');
      tokens.push({ kind: 'comment', start, end, raw: input.slice(start, end), depth: stack.length });
      stats.comments += 1;
      cursor = end;
      continue;
    }
    if (input.startsWith('<![CDATA[', cursor)) {
      const end = scanUntil(input, cursor + 9, ']]>', 'CDATA section');
      tokens.push({ kind: 'cdata', start, end, raw: input.slice(start, end), depth: stack.length });
      stats.cdataSections += 1;
      const frame = stack[stack.length - 1];
      if (frame) frame.info.hasSignificantText = true;
      cursor = end;
      continue;
    }
    if (input.startsWith('<!DOCTYPE', cursor)) {
      const end = scanDoctypeEnd(input, cursor, mode === 'validate');
      if (mode === 'validate') {
        failAt(
          input,
          cursor,
          'DOCTYPE_UNSUPPORTED',
          'DOCTYPE is not supported by the well-formedness validator because DTD grammar, declarations, and external identifiers are intentionally not checked.',
        );
      }
      tokens.push({ kind: 'doctype', start, end, raw: input.slice(start, end), depth: stack.length });
      stats.documentTypes += 1;
      cursor = end;
      continue;
    }
    if (input.startsWith('<!ENTITY', cursor)) {
      failAt(input, cursor, 'CUSTOM_ENTITIES_UNSUPPORTED', 'Custom ENTITY declarations are not supported.');
    }
    if (input.startsWith('<?', cursor)) {
      const end = scanUntil(input, cursor + 2, '?>', 'processing instruction');
      const raw = input.slice(start, end);
      const targetMatch = /^<\?([^\s?]+)/.exec(raw);
      const target = targetMatch?.[1] ?? '';
      const kind: LexTokenKind = target === 'xml' ? 'declaration' : 'pi';
      if (kind === 'declaration') assertValidXmlDeclaration(input, start, raw);
      else assertNcName(input, target, start + 2);
      tokens.push({ kind, start, end, raw, depth: stack.length, name: target });
      if (kind === 'pi') stats.processingInstructions += 1;
      cursor = end;
      continue;
    }
    if (input.startsWith('</', cursor)) {
      const end = scanTagEnd(input, cursor);
      const name = parseClosingName(input, cursor, end);
      const frame = stack.pop();
      if (!frame || frame.info.name !== name) {
        failAt(
          input,
          cursor,
          'MALFORMED_XML',
          frame ? `Closing tag ${name} does not match open element ${frame.info.name}.` : `Unexpected closing tag ${name}.`,
        );
      }
      const token: LexToken = {
        kind: 'close', start, end, raw: input.slice(start, end), depth: stack.length, name, elementId: frame.info.id,
      };
      tokens.push(token);
      frame.info.endTokenIndex = tokens.length - 1;
      cursor = end;
      continue;
    }
    if (input.startsWith('<!', cursor)) {
      failAt(input, cursor, 'MALFORMED_XML', 'Unsupported or misplaced XML declaration.');
    }

    const end = scanTagEnd(input, cursor);
    const parsed = parseStartTag(input, cursor, end);
    stats.elements += 1;
    if (stats.elements > MAX_XML_ELEMENTS) {
      failAt(input, cursor, 'INPUT_TOO_COMPLEX', `XML is limited to ${MAX_XML_ELEMENTS.toLocaleString('en-US')} elements.`);
    }
    stats.attributes += parsed.attributes.length;
    if (stats.attributes > MAX_XML_ATTRIBUTES) {
      failAt(input, cursor, 'INPUT_TOO_COMPLEX', `XML is limited to ${MAX_XML_ATTRIBUTES.toLocaleString('en-US')} attributes.`);
    }
    const depth = stack.length + 1;
    if (depth > MAX_XML_DEPTH) {
      failAt(input, cursor, 'INPUT_TOO_COMPLEX', `XML nesting is limited to ${MAX_XML_DEPTH} elements.`);
    }
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    if (!stats.rootName && stack.length === 0) stats.rootName = parsed.name;

    const namespaceResult = validateNamespaces(
      input,
      parsed.name,
      cursor,
      parsed.attributes,
      stack,
      namespaceUris,
    );
    const inheritedSpace = stack[stack.length - 1]?.info.effectivePreserveSpace ?? false;
    const effectivePreserveSpace = namespaceResult.preserveSpaceSetting ?? inheritedSpace;
    const id = elements.length;
    const info: ElementInfo = {
      id,
      name: parsed.name,
      startTokenIndex: tokens.length,
      endTokenIndex: tokens.length,
      effectivePreserveSpace,
      hasSignificantText: false,
    };
    elements.push(info);
    const token: LexToken = {
      kind: parsed.selfClosing ? 'empty' : 'open',
      start,
      end,
      raw: input.slice(start, end),
      depth: stack.length,
      name: parsed.name,
      attributes: parsed.attributes,
      elementId: id,
    };
    tokens.push(token);
    if (!parsed.selfClosing) {
      stack.push({ info, namespaceDeclarations: namespaceResult.declarations });
    }
    cursor = end;
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed) {
    const token = tokens[unclosed.info.startTokenIndex];
    failAt(input, token?.start ?? input.length, 'MALFORMED_XML', `Element ${unclosed.info.name} is missing a closing tag.`);
  }
  stats.namespaces = namespaceUris.size;
  return { tokens, elements, stats };
}

function assertParserWellFormed(input: string): void {
  try {
    parseXml(input, {
      ignoreUndefinedEntities: false,
      preserveCdata: true,
      preserveComments: true,
      preserveDocumentType: true,
      preserveXmlDeclaration: true,
      sortAttributes: false,
    });
  } catch (error) {
    if (error instanceof XmlProcessError) throw error;
    const details = error as { message?: unknown; line?: unknown; column?: unknown; pos?: unknown };
    const message = typeof details.message === 'string'
      ? (details.message.split(/\r?\n/, 1)[0] ?? 'XML is not well formed.')
        .replace(/\s+\(line\s+\d+,\s*column\s+\d+\)\.?$/i, '')
      : 'XML is not well formed.';
    const computedLocation = typeof details.pos === 'number' ? locationAt(input, details.pos) : null;
    const line = computedLocation?.line ?? (typeof details.line === 'number' ? details.line : undefined);
    const column = computedLocation?.column ?? (typeof details.column === 'number' ? details.column : undefined);
    throw new XmlProcessError('MALFORMED_XML', message, line, column);
  }
}

export function normalizeXmlFormatOptions(options: Partial<XmlFormatOptions> = {}): XmlFormatOptions {
  const normalized = { ...DEFAULT_XML_FORMAT_OPTIONS, ...options };
  if (!isXmlIndentation(normalized.indentation)) {
    throw new XmlProcessError('INVALID_OPTIONS', 'Indentation must be 2-spaces, 4-spaces, or tabs.');
  }
  if (!isXmlLineEnding(normalized.lineEnding)) {
    throw new XmlProcessError('INVALID_OPTIONS', 'Line ending must be lf or crlf.');
  }
  return normalized;
}

function renderFormattedXml(input: string, document: LexedDocument, options: XmlFormatOptions): string {
  const newline = options.lineEnding === 'crlf' ? '\r\n' : '\n';
  const indentUnit = options.indentation === 'tabs' ? '\t' : options.indentation === '4-spaces' ? '    ' : '  ';
  const indent = (depth: number) => indentUnit.repeat(depth);
  const { tokens, elements } = document;
  const throwOutputTooLarge = (): never => {
    throw new XmlProcessError(
      'OUTPUT_TOO_LARGE',
      `Formatted output exceeded ${MAX_XML_OUTPUT_CHARACTERS.toLocaleString('en-US')} UTF-16 code units and was discarded.`,
    );
  };

  const renderElement = (elementId: number, level: number): string => {
    const info = elements[elementId];
    if (!info) throw new XmlProcessError('PROCESS_FAILED', 'The XML element index could not be rendered.');
    const open = tokens[info.startTokenIndex];
    if (!open) throw new XmlProcessError('PROCESS_FAILED', 'The XML opening token could not be rendered.');
    if (open.kind === 'empty') return open.raw;
    const close = tokens[info.endTokenIndex];
    if (!close || close.kind !== 'close') {
      throw new XmlProcessError('PROCESS_FAILED', `Element ${info.name} has no closing token.`);
    }
    if (info.effectivePreserveSpace || info.hasSignificantText) {
      return input.slice(open.start, close.end);
    }

    const children: string[] = [];
    let projectedLength = open.raw.length + close.raw.length;
    let tokenIndex = info.startTokenIndex + 1;
    while (tokenIndex < info.endTokenIndex) {
      const token = tokens[tokenIndex];
      if (!token) break;
      if (token.kind === 'text') {
        if (NON_XML_WHITESPACE.test(token.raw)) {
          projectedLength += newline.length + indent(level + 1).length + token.raw.length;
          if (projectedLength > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
          children.push(token.raw);
        }
        tokenIndex += 1;
        continue;
      }
      if ((token.kind === 'open' || token.kind === 'empty') && token.elementId !== undefined) {
        const childInfo = elements[token.elementId];
        const child = renderElement(token.elementId, level + 1);
        projectedLength += newline.length + indent(level + 1).length + child.length;
        if (projectedLength > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
        children.push(child);
        tokenIndex = (childInfo?.endTokenIndex ?? tokenIndex) + 1;
        continue;
      }
      projectedLength += newline.length + indent(level + 1).length + token.raw.length;
      if (projectedLength > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
      children.push(token.raw);
      tokenIndex += 1;
    }
    if (children.length === 0) return `${open.raw}${close.raw}`;
    projectedLength += newline.length + indent(level).length;
    if (projectedLength > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
    return `${open.raw}${children.map((child) => `${newline}${indent(level + 1)}${child}`).join('')}${newline}${indent(level)}${close.raw}`;
  };

  const documentItems: string[] = [];
  let documentLength = 0;
  let bom = '';
  let tokenIndex = 0;
  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];
    if (!token) break;
    if (token.kind === 'bom') {
      bom = token.raw;
      tokenIndex += 1;
      continue;
    }
    if (token.kind === 'text') {
      if (NON_XML_WHITESPACE.test(token.raw)) {
        documentLength += token.raw.length + (documentItems.length > 0 ? newline.length : 0);
        if (documentLength > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
        documentItems.push(token.raw);
      }
      tokenIndex += 1;
      continue;
    }
    if ((token.kind === 'open' || token.kind === 'empty') && token.elementId !== undefined) {
      const info = elements[token.elementId];
      const element = renderElement(token.elementId, 0);
      documentLength += element.length + (documentItems.length > 0 ? newline.length : 0);
      if (documentLength + bom.length > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
      documentItems.push(element);
      tokenIndex = (info?.endTokenIndex ?? tokenIndex) + 1;
      continue;
    }
    documentLength += token.raw.length + (documentItems.length > 0 ? newline.length : 0);
    if (documentLength + bom.length > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
    documentItems.push(token.raw);
    tokenIndex += 1;
  }
  const output = `${bom}${documentItems.join(newline)}`;
  if (output.length > MAX_XML_OUTPUT_CHARACTERS) throwOutputTooLarge();
  return output;
}

function createViewerRows(document: LexedDocument): { rows: XmlViewerRow[]; truncated: boolean } {
  const rows: XmlViewerRow[] = [];
  let rowOrdinal = 0;
  let serializedCharacters = 2;
  let truncated = false;
  const addRow = (row: Omit<XmlViewerRow, 'id'>): void => {
    const completed: XmlViewerRow = { id: rowOrdinal, ...row };
    rowOrdinal += 1;
    const serializedLength = JSON.stringify(completed).length + (rows.length === 0 ? 0 : 1);
    if (rows.length >= MAX_XML_VIEWER_ROWS
        || serializedCharacters + serializedLength > MAX_XML_OUTPUT_CHARACTERS) {
      truncated = true;
      return;
    }
    rows.push(completed);
    serializedCharacters += serializedLength;
  };

  for (const token of document.tokens) {
    switch (token.kind) {
      case 'bom':
        addRow({ depth: 0, kind: 'text', label: '#byte-order-mark', value: token.raw });
        break;
      case 'declaration':
        addRow({ depth: token.depth, kind: 'declaration', label: 'XML declaration', value: token.raw });
        break;
      case 'doctype':
        addRow({ depth: token.depth, kind: 'doctype', label: 'DOCTYPE', value: token.raw });
        break;
      case 'open':
      case 'empty':
        addRow({
          depth: token.depth,
          kind: token.kind === 'open' ? 'element-open' : 'element-empty',
          label: token.name ?? '(element)',
          value: token.raw,
        });
        for (const attribute of token.attributes ?? []) {
          addRow({ depth: token.depth + 1, kind: 'attribute', label: attribute.name, value: attribute.raw });
        }
        break;
      case 'close':
        addRow({ depth: token.depth, kind: 'element-close', label: token.name ?? '(element)', value: token.raw });
        break;
      case 'text':
        addRow({ depth: token.depth, kind: 'text', label: '#text', value: token.raw });
        break;
      case 'comment':
        addRow({ depth: token.depth, kind: 'comment', label: '#comment', value: token.raw });
        break;
      case 'cdata':
        addRow({ depth: token.depth, kind: 'cdata', label: '#cdata', value: token.raw });
        break;
      case 'pi':
        addRow({ depth: token.depth, kind: 'processing-instruction', label: token.name || '#processing-instruction', value: token.raw });
        break;
    }
  }
  return { rows, truncated };
}

export function processXmlText(
  input: string,
  mode: XmlMode,
  options: Partial<XmlFormatOptions> = {},
): XmlOperationResult {
  if (typeof input !== 'string') {
    throw new XmlProcessError('INVALID_OPTIONS', 'XML input must be text.');
  }
  if (!isXmlMode(mode)) {
    throw new XmlProcessError('INVALID_OPTIONS', 'Mode must be format, validate, or view.');
  }
  if (input.trim().length === 0) {
    throw new XmlProcessError('EMPTY_INPUT', 'Paste an XML document before processing.');
  }
  if (input.length > MAX_XML_INPUT_CHARACTERS) {
    throw new XmlProcessError(
      'INPUT_TOO_LARGE',
      `XML input is limited to ${MAX_XML_INPUT_CHARACTERS.toLocaleString('en-US')} UTF-16 code units to keep the browser responsive.`,
    );
  }
  const normalizedOptions = normalizeXmlFormatOptions(options);
  const document = lexXml(input, mode);
  assertParserWellFormed(input);

  if (mode === 'format') {
    return { mode, output: renderFormattedXml(input, document, normalizedOptions), stats: document.stats };
  }
  if (mode === 'view') {
    const viewer = createViewerRows(document);
    return { mode, rows: viewer.rows, stats: document.stats, truncated: viewer.truncated };
  }
  return { mode, stats: document.stats };
}

export function formatXmlText(input: string, options: Partial<XmlFormatOptions> = {}): string {
  const result = processXmlText(input, 'format', options);
  return result.mode === 'format' ? result.output : '';
}

export function validateXmlText(input: string): XmlStats {
  const result = processXmlText(input, 'validate');
  return result.stats;
}

export function viewXmlText(input: string): Extract<XmlOperationResult, { mode: 'view' }> {
  const result = processXmlText(input, 'view');
  if (result.mode !== 'view') throw new XmlProcessError('PROCESS_FAILED', 'The XML viewer did not return rows.');
  return result;
}
