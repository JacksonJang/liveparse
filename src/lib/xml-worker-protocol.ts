import type { XmlFormatOptions, XmlMode } from './xml-config';

export interface XmlStats {
  rootName: string;
  elements: number;
  attributes: number;
  textNodes: number;
  comments: number;
  cdataSections: number;
  processingInstructions: number;
  documentTypes: number;
  maxDepth: number;
  namespaces: number;
}

export type XmlViewerRowKind =
  | 'declaration'
  | 'doctype'
  | 'element-open'
  | 'element-empty'
  | 'element-close'
  | 'attribute'
  | 'text'
  | 'comment'
  | 'cdata'
  | 'processing-instruction';

export interface XmlViewerRow {
  id: number;
  depth: number;
  kind: XmlViewerRowKind;
  label: string;
  value?: string;
}

export type XmlOperationResult =
  | { mode: 'format'; output: string; stats: XmlStats }
  | { mode: 'validate'; stats: XmlStats }
  | { mode: 'view'; rows: XmlViewerRow[]; stats: XmlStats; truncated: boolean };

export interface XmlWorkerRequest {
  id: number;
  mode: XmlMode;
  input: string;
  options: XmlFormatOptions;
}

export type XmlWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; ok: true; result: XmlOperationResult }
  | { type: 'result'; id: number; ok: false; code: string; message: string; line?: number; column?: number }
  | { type: 'protocol-error'; code: string; message: string };
