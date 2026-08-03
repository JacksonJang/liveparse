import type { JsonStats } from './lossless-json';
import type { YamlMode, YamlOptions, YamlVersion } from './yaml-config';

export interface YamlDiagnostic {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface YamlStats {
  documents: number;
  mappings: number;
  sequences: number;
  scalars: number;
  aliases: number;
  anchors: number;
  comments: number;
  nodes: number;
  maxDepth: number;
  versions: YamlVersion[];
}

export type YamlViewerRowKind = 'document' | 'mapping' | 'sequence' | 'scalar' | 'alias' | 'empty';

export interface YamlViewerRow {
  id: number;
  depth: number;
  kind: YamlViewerRowKind;
  label: string;
  value?: string;
  valueType?: string;
  anchor?: string;
  tag?: string;
  line?: number;
  column?: number;
}

export type YamlOperationResult =
  | { mode: 'format'; output: string; stats: YamlStats; diagnostics: YamlDiagnostic[] }
  | { mode: 'validate'; stats: YamlStats; diagnostics: YamlDiagnostic[] }
  | { mode: 'view'; rows: YamlViewerRow[]; stats: YamlStats; diagnostics: YamlDiagnostic[]; truncated: boolean }
  | { mode: 'yaml-to-json'; output: string; stats: YamlStats; diagnostics: YamlDiagnostic[] }
  | { mode: 'json-to-yaml'; output: string; jsonStats: JsonStats; diagnostics: YamlDiagnostic[] };

export interface YamlWorkerRequest {
  id: number;
  mode: YamlMode;
  input: string;
  options: YamlOptions;
}

export type YamlWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; ok: true; result: YamlOperationResult }
  | { type: 'result'; id: number; ok: false; code: string; message: string; line?: number; column?: number }
  | { type: 'protocol-error'; code: string; message: string };
